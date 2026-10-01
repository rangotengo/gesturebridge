import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MAX_TRAINING_SAMPLES,
  NUM_FEATURES,
  buildDenseLabelMap,
  createModelManifest,
  createSeededRandom,
  getMaxTrainingSamples,
  stratifiedSplit,
  groupAwareSplit,
  computeDatasetRevision,
  calculateEvaluationMetrics,
} from '../ml/trainingHelpers';

describe('training configuration', () => {
  it('uses a bounded, safe training sample cap', () => {
    expect(getMaxTrainingSamples({})).toBe(DEFAULT_MAX_TRAINING_SAMPLES);
    expect(getMaxTrainingSamples({ MAX_TRAINING_SAMPLES: '99' })).toBe(DEFAULT_MAX_TRAINING_SAMPLES);
    expect(getMaxTrainingSamples({ MAX_TRAINING_SAMPLES: '150' })).toBe(150);
    expect(getMaxTrainingSamples({ MAX_TRAINING_SAMPLES: '900000' })).toBe(500_000);
  });
});

describe('dense label mapping', () => {
  it('filters underrepresented classes and assigns dense contiguous indices', () => {
    const samples = [
      ...Array.from({ length: 10 }, () => ({ label: 0 })),
      ...Array.from({ length: 2 }, () => ({ label: 1 })), // underrepresented
      ...Array.from({ length: 8 }, () => ({ label: 4 })),
      ...Array.from({ length: 6 }, () => ({ label: 10 })),
    ];
    const gestures = [
      { labelIndex: 0, name: 'Pointing' },
      { labelIndex: 1, name: 'Fist' },
      { labelIndex: 4, name: 'Rock' },
      { labelIndex: 10, name: 'Custom Ten' },
    ];

    const mapping = buildDenseLabelMap(samples, gestures, 5);
    expect(mapping.activeOriginalLabels).toEqual([0, 4, 10]);
    expect(mapping.denseLabels).toEqual([
      { labelIndex: 0, name: 'Pointing' },
      { labelIndex: 4, name: 'Rock' },
      { labelIndex: 10, name: 'Custom Ten' },
    ]);
    expect(mapping.originalToDenseMap.get(0)).toBe(0);
    expect(mapping.originalToDenseMap.get(4)).toBe(1);
    expect(mapping.originalToDenseMap.get(10)).toBe(2);
    expect(mapping.originalToDenseMap.has(1)).toBe(false);
  });
});

describe('stratified split', () => {
  it('keeps every class in both partitions and is deterministic', () => {
    const samples = [
      ...Array.from({ length: 5 }, (_, id) => ({ id: `a-${id}`, label: 0 })),
      ...Array.from({ length: 10 }, (_, id) => ({ id: `b-${id}`, label: 1 })),
      ...Array.from({ length: 5 }, (_, id) => ({ id: `c-${id}`, label: 2 })),
    ];

    const first = stratifiedSplit(samples, createSeededRandom(42));
    const second = stratifiedSplit(samples, createSeededRandom(42));

    expect(first).toEqual(second);
    expect(first.trainingSamples).toHaveLength(16);
    expect(first.validationSamples).toHaveLength(4);
    for (const label of [0, 1, 2]) {
      expect(first.trainingSamples.some((sample) => sample.label === label)).toBe(true);
      expect(first.validationSamples.some((sample) => sample.label === label)).toBe(true);
    }
  });
});

describe('groupAwareSplit', () => {
  it('partitions strictly by participant when participantIds are present', () => {
    const samples = [
      ...Array.from({ length: 10 }, () => ({ label: 0, participantId: 'p1' })),
      ...Array.from({ length: 10 }, () => ({ label: 1, participantId: 'p1' })),
      ...Array.from({ length: 10 }, () => ({ label: 0, participantId: 'p2' })),
      ...Array.from({ length: 10 }, () => ({ label: 1, participantId: 'p2' })),
      ...Array.from({ length: 10 }, () => ({ label: 0, participantId: 'p3' })),
      ...Array.from({ length: 10 }, () => ({ label: 1, participantId: 'p3' })),
    ];

    const result = groupAwareSplit(samples, createSeededRandom(99), 0.3);
    expect(result.splitStrategy).toBe('grouped-participant');
    expect(result.groupCount).toBe(3);
    expect(result.trainingSamples.length).toBeGreaterThan(0);
    expect(result.validationSamples.length).toBeGreaterThan(0);

    const trainParticipants = new Set(result.trainingSamples.map((s) => s.participantId));
    const valParticipants = new Set(result.validationSamples.map((s) => s.participantId));
    for (const vp of valParticipants) {
      expect(trainParticipants.has(vp)).toBe(false);
    }
  });

  it('partitions strictly by session when sessions are present and participantIds missing', () => {
    const samples = [
      ...Array.from({ length: 10 }, () => ({ label: 0, sessionId: 's1' })),
      ...Array.from({ length: 10 }, () => ({ label: 0, sessionId: 's2' })),
      ...Array.from({ length: 10 }, () => ({ label: 0, sessionId: 's3' })),
      ...Array.from({ length: 10 }, () => ({ label: 0, sessionId: 's4' })),
    ];

    const result = groupAwareSplit(samples, createSeededRandom(123), 0.25);
    expect(result.splitStrategy).toBe('grouped-session');
    expect(result.groupCount).toBe(4);
    const trainSessions = new Set(result.trainingSamples.map((s) => s.sessionId));
    const valSessions = new Set(result.validationSamples.map((s) => s.sessionId));
    for (const vs of valSessions) {
      expect(trainSessions.has(vs)).toBe(false);
    }
  });

  it('falls back to stratified random when no group metadata is present', () => {
    const samples = [
      ...Array.from({ length: 10 }, () => ({ label: 0 })),
      ...Array.from({ length: 10 }, () => ({ label: 1 })),
    ];

    const result = groupAwareSplit(samples, createSeededRandom(77), 0.2);
    expect(result.splitStrategy).toBe('stratified-random');
    expect(result.trainingSamples.length).toBe(16);
    expect(result.validationSamples.length).toBe(4);
  });
});

describe('computeDatasetRevision', () => {
  it('produces identical SHA-256 hash regardless of sample ordering in array', () => {
    const sampleA = { features: [0.1, -0.2, 0.5], label: 0 };
    const sampleB = { features: [-0.3, 0.4, 0.8], label: 1 };
    const sampleC = { features: [0.0, 0.0, 1.0], label: 2 };

    const hash1 = computeDatasetRevision([sampleA, sampleB, sampleC]);
    const hash2 = computeDatasetRevision([sampleC, sampleA, sampleB]);
    const hash3 = computeDatasetRevision([sampleB, sampleC, sampleA]);

    expect(hash1).toBe(hash2);
    expect(hash2).toBe(hash3);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('calculateEvaluationMetrics', () => {
  it('computes correct confusion matrix, per-class metrics, and macro averages', () => {
    const groundTruth = [0, 0, 1, 1, 2, 2];
    const predictions = [0, 1, 1, 1, 2, 0];
    const labels = [
      { labelIndex: 0, name: 'Pointing' },
      { labelIndex: 1, name: 'Fist' },
      { labelIndex: 2, name: 'Peace' },
    ];

    const metrics = calculateEvaluationMetrics(predictions, groundTruth, labels);
    expect(metrics.sampleCount).toBe(6);
    expect(metrics.accuracy).toBeCloseTo(4 / 6, 3);
    expect(metrics.confusionMatrix).toEqual([
      [1, 1, 0],
      [0, 2, 0],
      [1, 0, 1],
    ]);
    expect(metrics.perGestureMetrics[0].name).toBe('Pointing');
    expect(metrics.perGestureMetrics[0].precision).toBe(0.5);
    expect(metrics.perGestureMetrics[0].recall).toBe(0.5);
    expect(metrics.perGestureMetrics[1].name).toBe('Fist');
    expect(metrics.perGestureMetrics[1].recall).toBe(1.0);
    expect(metrics.macroF1).toBeGreaterThan(0.6);
  });
});

describe('model manifest', () => {
  it('preserves dense label map, metrics, and artifact checksum', () => {
    const manifest = createModelManifest(
      {
        version: 'model-1',
        createdAt: '2026-07-11T00:00:00.000Z',
        featureCount: NUM_FEATURES,
        normalizationVersion: 'wrist-maxabs-v1',
        samplesCount: 20,
        datasetRevision: 'dataset-sha',
        denseLabelMap: [
          { labelIndex: 0, name: 'Pointing' },
          { labelIndex: 2, name: 'Peace' },
        ],
        labels: [
          { labelIndex: 0, name: 'Pointing' },
          { labelIndex: 2, name: 'Peace' },
        ],
        metrics: { trainingAccuracy: 0.9, validationAccuracy: 0.8 },
      },
      'model-json-sha'
    );

    expect(manifest).toMatchObject({
      featureCount: 63,
      denseLabelMap: [
        { labelIndex: 0, name: 'Pointing' },
        { labelIndex: 2, name: 'Peace' },
      ],
      modelJsonSha256: 'model-json-sha',
    });
  });
});
