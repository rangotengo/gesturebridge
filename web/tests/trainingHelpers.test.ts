import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MAX_TRAINING_SAMPLES,
  NUM_FEATURES,
  buildDenseLabelMap,
  createModelManifest,
  createSeededRandom,
  getMaxTrainingSamples,
  stratifiedSplit,
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
