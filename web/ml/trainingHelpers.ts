import crypto from 'crypto';

export const NUM_FEATURES = 63;
export const DEFAULT_MAX_TRAINING_SAMPLES = 50_000;

export interface TrainingSample {
  features?: readonly number[];
  label: number;
  participantId?: string;
  sessionId?: string;
}

export interface ModelManifestLabel {
  labelIndex: number;
  name: string;
}

export type SplitStrategy = 'grouped-participant' | 'grouped-session' | 'stratified-random';

export interface PerGestureMetric {
  labelIndex: number;
  name: string;
  precision: number;
  recall: number;
  f1Score: number;
  support: number;
}

export interface ModelMetrics {
  trainingAccuracy: number | null;
  validationAccuracy: number | null;
  macroF1?: number | null;
  macroPrecision?: number | null;
  macroRecall?: number | null;
  weightedF1?: number | null;
  confusionMatrix?: number[][];
  perGestureMetrics?: PerGestureMetric[];
  splitStrategy?: SplitStrategy;
}

export interface ModelManifest {
  version: string;
  createdAt: string;
  featureCount: number;
  normalizationVersion: 'wrist-maxabs-v1';
  samplesCount: number;
  datasetRevision: string;
  denseLabelMap: ModelManifestLabel[];
  labels: ModelManifestLabel[];
  metrics: ModelMetrics;
  modelJsonSha256: string;
  weightsSha256?: Record<string, string> | string;
}

export type ModelManifestDraft = Omit<ModelManifest, 'modelJsonSha256'>;

export interface DenseLabelMapping {
  denseLabels: ModelManifestLabel[];
  originalToDenseMap: Map<number, number>;
  activeOriginalLabels: number[];
}

export function buildDenseLabelMap(
  samples: readonly { label: number }[],
  gestures: readonly { labelIndex: number; name: string }[],
  minSamplesPerClass = 5
): DenseLabelMapping {
  const countsByLabel = new Map<number, number>();
  for (const sample of samples) {
    countsByLabel.set(sample.label, (countsByLabel.get(sample.label) ?? 0) + 1);
  }

  const gestureMap = new Map<number, string>();
  for (const gesture of gestures) {
    gestureMap.set(gesture.labelIndex, gesture.name);
  }

  const activeOriginalLabels = [...countsByLabel.entries()]
    .filter(([, count]) => count >= minSamplesPerClass)
    .map(([label]) => label)
    .sort((a, b) => a - b);

  const denseLabels: ModelManifestLabel[] = [];
  const originalToDenseMap = new Map<number, number>();

  for (let denseIndex = 0; denseIndex < activeOriginalLabels.length; denseIndex += 1) {
    const originalLabel = activeOriginalLabels[denseIndex];
    const name = gestureMap.get(originalLabel) ?? `Gesture ${originalLabel}`;
    denseLabels.push({ labelIndex: originalLabel, name });
    originalToDenseMap.set(originalLabel, denseIndex);
  }

  return { denseLabels, originalToDenseMap, activeOriginalLabels };
}

type Environment = Readonly<Record<string, string | undefined>>;

export function getMaxTrainingSamples(environment: Environment = process.env): number {
  const configured = Number(environment.MAX_TRAINING_SAMPLES);
  return Number.isInteger(configured) && configured >= 100
    ? Math.min(configured, 500_000)
    : DEFAULT_MAX_TRAINING_SAMPLES;
}

export function createSeededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function shuffled<T>(values: readonly T[], random: () => number): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

export function stratifiedSplit<T extends TrainingSample>(
  samples: readonly T[],
  random: () => number,
  validationRatio = 0.2
): { trainingSamples: T[]; validationSamples: T[] } {
  const byLabel = new Map<number, T[]>();
  for (const sample of samples) {
    const group = byLabel.get(sample.label) ?? [];
    group.push(sample);
    byLabel.set(sample.label, group);
  }

  const trainingSamples: T[] = [];
  const validationSamples: T[] = [];
  for (const group of byLabel.values()) {
    const randomized = shuffled(group, random);
    const validationCount = Math.max(1, Math.floor(randomized.length * validationRatio));
    validationSamples.push(...randomized.slice(0, validationCount));
    trainingSamples.push(...randomized.slice(validationCount));
  }
  return { trainingSamples, validationSamples };
}

export interface GroupAwareSplitResult<T> {
  trainingSamples: T[];
  validationSamples: T[];
  splitStrategy: SplitStrategy;
  groupCount: number;
}

/**
 * Group-aware split evaluates model generalization to unseen participants or sessions.
 * If >= 2 participants are available, partitions strictly by participant.
 * Otherwise, if >= 3 sessions are available, partitions strictly by session.
 * Otherwise falls back to stratified label-wise splitting.
 */
export function groupAwareSplit<T extends TrainingSample>(
  samples: readonly T[],
  random: () => number,
  validationRatio = 0.2
): GroupAwareSplitResult<T> {
  if (samples.length === 0) {
    return {
      trainingSamples: [],
      validationSamples: [],
      splitStrategy: 'stratified-random',
      groupCount: 0,
    };
  }

  // 1. Check if participant-based split is feasible
  const participantMap = new Map<string, T[]>();
  for (const sample of samples) {
    const pid = sample.participantId?.trim();
    if (pid) {
      const list = participantMap.get(pid) ?? [];
      list.push(sample);
      participantMap.set(pid, list);
    }
  }

  const allHaveParticipant = samples.every((s) => Boolean(s.participantId && s.participantId.trim() !== ''));
  if (allHaveParticipant && participantMap.size >= 2) {
    const groupKeys = shuffled([...participantMap.keys()], random);
    const targetVal = Math.max(1, Math.round(samples.length * validationRatio));

    const validationSamples: T[] = [];
    const trainingSamples: T[] = [];
    let currentValCount = 0;

    for (let i = 0; i < groupKeys.length; i++) {
      const key = groupKeys[i];
      const group = participantMap.get(key)!;
      // Ensure at least one group remains for training
      const remainingGroups = groupKeys.length - 1 - i;
      if (currentValCount < targetVal && remainingGroups > 0) {
        validationSamples.push(...group);
        currentValCount += group.length;
      } else {
        trainingSamples.push(...group);
      }
    }

    if (trainingSamples.length > 0 && validationSamples.length > 0) {
      return {
        trainingSamples,
        validationSamples,
        splitStrategy: 'grouped-participant',
        groupCount: participantMap.size,
      };
    }
  }

  // 2. Check if session-based split is feasible
  const sessionMap = new Map<string, T[]>();
  for (const sample of samples) {
    const sid = sample.sessionId?.trim();
    if (sid) {
      const list = sessionMap.get(sid) ?? [];
      list.push(sample);
      sessionMap.set(sid, list);
    }
  }

  const allHaveSession = samples.every((s) => Boolean(s.sessionId && s.sessionId.trim() !== ''));
  if (allHaveSession && sessionMap.size >= 3) {
    const groupKeys = shuffled([...sessionMap.keys()], random);
    const targetVal = Math.max(1, Math.round(samples.length * validationRatio));

    const validationSamples: T[] = [];
    const trainingSamples: T[] = [];
    let currentValCount = 0;

    for (let i = 0; i < groupKeys.length; i++) {
      const key = groupKeys[i];
      const group = sessionMap.get(key)!;
      const remainingGroups = groupKeys.length - 1 - i;
      if (currentValCount < targetVal && remainingGroups > 0) {
        validationSamples.push(...group);
        currentValCount += group.length;
      } else {
        trainingSamples.push(...group);
      }
    }

    if (trainingSamples.length > 0 && validationSamples.length > 0) {
      return {
        trainingSamples,
        validationSamples,
        splitStrategy: 'grouped-session',
        groupCount: sessionMap.size,
      };
    }
  }

  // 3. Fallback to stratified random split across classes
  const stratified = stratifiedSplit(samples, random, validationRatio);
  return {
    ...stratified,
    splitStrategy: 'stratified-random',
    groupCount: 0,
  };
}

/**
 * Computes a deterministic, order-independent SHA-256 fingerprint for a dataset.
 */
export function computeDatasetRevision(
  samples: readonly { features: readonly number[]; label: number }[]
): string {
  const hash = crypto.createHash('sha256');

  // Sort canonical entries so the hash is fully reproducible regardless of DB order
  const serializedEntries = samples.map((sample) => {
    const feats = sample.features.map((f) => f.toFixed(5)).join(',');
    return `${sample.label}:${feats}`;
  });
  serializedEntries.sort();

  for (const entry of serializedEntries) {
    hash.update(entry);
    hash.update('\n');
  }

  return hash.digest('hex');
}

export interface DetailedEvaluationMetrics {
  accuracy: number;
  macroPrecision: number;
  macroRecall: number;
  macroF1: number;
  weightedF1: number;
  perGestureMetrics: PerGestureMetric[];
  confusionMatrix: number[][];
  sampleCount: number;
}

/**
 * Computes precision, recall, F1, and confusion matrix over validation predictions.
 */
export function calculateEvaluationMetrics(
  predictions: readonly number[],
  groundTruth: readonly number[],
  denseLabels: readonly ModelManifestLabel[]
): DetailedEvaluationMetrics {
  const numClasses = denseLabels.length;
  const confusionMatrix: number[][] = Array.from({ length: numClasses }, () =>
    new Array(numClasses).fill(0)
  );

  let correctCount = 0;
  const n = Math.min(predictions.length, groundTruth.length);

  for (let i = 0; i < n; i++) {
    const pred = predictions[i];
    const actual = groundTruth[i];
    if (actual >= 0 && actual < numClasses && pred >= 0 && pred < numClasses) {
      confusionMatrix[actual][pred] += 1;
      if (pred === actual) correctCount += 1;
    }
  }

  const accuracy = n > 0 ? correctCount / n : 0;
  const perGestureMetrics: PerGestureMetric[] = [];
  let totalPrecision = 0;
  let totalRecall = 0;
  let totalF1 = 0;
  let weightedF1Sum = 0;

  for (let c = 0; c < numClasses; c++) {
    const tp = confusionMatrix[c][c];
    let fp = 0;
    let support = 0;

    for (let r = 0; r < numClasses; r++) {
      if (r !== c) fp += confusionMatrix[r][c];
      support += confusionMatrix[c][r];
    }

    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = support > 0 ? tp / support : 0;
    const f1Score = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

    totalPrecision += precision;
    totalRecall += recall;
    totalF1 += f1Score;
    weightedF1Sum += f1Score * support;

    perGestureMetrics.push({
      labelIndex: denseLabels[c]?.labelIndex ?? c,
      name: denseLabels[c]?.name ?? `Class ${c}`,
      precision: Number(precision.toFixed(4)),
      recall: Number(recall.toFixed(4)),
      f1Score: Number(f1Score.toFixed(4)),
      support,
    });
  }

  const macroPrecision = numClasses > 0 ? Number((totalPrecision / numClasses).toFixed(4)) : 0;
  const macroRecall = numClasses > 0 ? Number((totalRecall / numClasses).toFixed(4)) : 0;
  const macroF1 = numClasses > 0 ? Number((totalF1 / numClasses).toFixed(4)) : 0;
  const weightedF1 = n > 0 ? Number((weightedF1Sum / n).toFixed(4)) : 0;

  return {
    accuracy: Number(accuracy.toFixed(4)),
    macroPrecision,
    macroRecall,
    macroF1,
    weightedF1,
    perGestureMetrics,
    confusionMatrix,
    sampleCount: n,
  };
}

export function createModelManifest(
  manifest: ModelManifestDraft,
  modelJsonSha256: string
): ModelManifest {
  return { ...manifest, modelJsonSha256 };
}
