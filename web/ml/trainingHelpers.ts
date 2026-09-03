export const NUM_FEATURES = 63;
export const DEFAULT_MAX_TRAINING_SAMPLES = 50_000;

export interface TrainingSample {
  label: number;
}

export interface ModelManifestLabel {
  labelIndex: number;
  name: string;
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
  metrics: {
    trainingAccuracy: number | null;
    validationAccuracy: number | null;
  };
  modelJsonSha256: string;
  weightsSha256?: Record<string, string>;
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

function shuffled<T>(values: readonly T[], random: () => number): T[] {
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

export function createModelManifest(
  manifest: ModelManifestDraft,
  modelJsonSha256: string
): ModelManifest {
  return { ...manifest, modelJsonSha256 };
}
