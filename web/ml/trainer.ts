/** Server-only TensorFlow.js training and atomic model artifact publication. */
import util from 'util';

const legacyUtil: typeof util & {
  isNullOrUndefined?: (value: unknown) => value is null | undefined;
} = util;
if (!legacyUtil.isNullOrUndefined) {
  legacyUtil.isNullOrUndefined = (value: unknown): value is null | undefined =>
    value === null || value === undefined;
}

import type * as tfType from '@tensorflow/tfjs-node';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const tf = require('@tensorflow/tfjs-node') as typeof tfType;
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import Sample from '@/models/Sample';
import Gesture from '@/models/Gesture';
import {
  acquireTrainingLease,
  completeTrainingLease,
  failTrainingLease,
  getTrainingLeaseRenewalIntervalMs,
  readTrainingStatus,
  renewTrainingLease,
  isTrainingLeaseValid,
  type TrainingLease,
  type TrainResult,
  type TrainingStatus,
} from '@/ml/trainingState';
import {
  NUM_FEATURES,
  buildDenseLabelMap,
  createModelManifest,
  createSeededRandom,
  getMaxTrainingSamples,
  groupAwareSplit,
  computeDatasetRevision,
  calculateEvaluationMetrics,
  type ModelManifest,
} from '@/ml/trainingHelpers';
import EvaluationRun from '@/models/EvaluationRun';
import { migrateLegacySamples, isWristMaxAbsNormalized } from '@/ml/datasetMigration';

export type { TrainResult, TrainingStatus } from '@/ml/trainingState';

const MODEL_ROOT_DIR = path.join(process.cwd(), 'public', 'ml');
const MODEL_SAVE_DIR = path.join(MODEL_ROOT_DIR, 'model');
const MIN_SAMPLES_PER_CLASS = 5;

export class TrainingError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number
  ) {
    super(message);
    this.name = 'TrainingError';
  }
}

export async function getTrainingStatus(): Promise<TrainingStatus> {
  return readTrainingStatus();
}

function lastMetric(history: tfType.History, names: string[]): number | null {
  for (const name of names) {
    const values = history.history[name];
    if (!Array.isArray(values) || values.length === 0) continue;
    const value = Number(values[values.length - 1]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

async function publishModelArtifact(
  model: tfType.LayersModel,
  manifest: Omit<ModelManifest, 'modelJsonSha256'>
): Promise<void> {
  const versionDir = path.join(MODEL_ROOT_DIR, 'models', manifest.version);
  await fs.promises.mkdir(versionDir, { recursive: true });
  await fs.promises.mkdir(MODEL_ROOT_DIR, { recursive: true });

  const temporaryDir = path.join(MODEL_ROOT_DIR, `.model-${manifest.version}.tmp`);
  const backupDir = path.join(MODEL_ROOT_DIR, `.model-${manifest.version}.backup`);
  await fs.promises.rm(temporaryDir, { recursive: true, force: true });
  await fs.promises.rm(backupDir, { recursive: true, force: true });

  try {
    await model.save(`file://${temporaryDir}`);
    const files = await fs.promises.readdir(temporaryDir);
    const weightsSha256: Record<string, string> = {};
    let modelJsonSha256 = '';

    for (const file of files) {
      const filePath = path.join(temporaryDir, file);
      const content = await fs.promises.readFile(filePath);
      const hash = crypto.createHash('sha256').update(content).digest('hex');
      if (file === 'model.json') {
        modelJsonSha256 = hash;
      } else if (file.endsWith('.bin')) {
        weightsSha256[file] = hash;
      }
    }

    const completeManifest = createModelManifest(
      {
        ...manifest,
        weightsSha256,
      },
      modelJsonSha256
    );

    await fs.promises.writeFile(
      path.join(temporaryDir, 'manifest.json'),
      `${JSON.stringify(completeManifest, null, 2)}\n`,
      'utf8'
    );

    // Save immutable versioned copy
    for (const file of await fs.promises.readdir(temporaryDir)) {
      await fs.promises.copyFile(
        path.join(temporaryDir, file),
        path.join(versionDir, file)
      );
    }

    // Atomic active version pointer
    const currentModelExists = await fs.promises.access(MODEL_SAVE_DIR).then(() => true, () => false);
    if (currentModelExists) await fs.promises.rename(MODEL_SAVE_DIR, backupDir);
    try {
      await fs.promises.rename(temporaryDir, MODEL_SAVE_DIR);
      await fs.promises.rm(backupDir, { recursive: true, force: true });
    } catch (error) {
      if (currentModelExists) await fs.promises.rename(backupDir, MODEL_SAVE_DIR);
      throw error;
    }

    const activeVersionJson = {
      activeVersion: manifest.version,
      updatedAt: new Date().toISOString(),
    };
    const activeVersionTmp = path.join(MODEL_ROOT_DIR, '.active_version.json.tmp');
    await fs.promises.writeFile(activeVersionTmp, JSON.stringify(activeVersionJson, null, 2), 'utf8');
    await fs.promises.rename(activeVersionTmp, path.join(MODEL_ROOT_DIR, 'active_version.json'));
  } finally {
    await fs.promises.rm(temporaryDir, { recursive: true, force: true });
  }
}

export interface TrainModelOptions {
  lease?: TrainingLease;
}

export async function trainModel(options?: TrainModelOptions): Promise<TrainResult> {
  const lease = options?.lease ?? (await acquireTrainingLease());
  if (!lease) {
    throw new TrainingError('A training job is already running.', 'TRAINING_IN_PROGRESS', 409);
  }

  let leaseLost = false;
  let renewingLease = false;
  const renewalIntervalMs = getTrainingLeaseRenewalIntervalMs();
  const renewalTimer = setInterval(() => {
    if (renewingLease || leaseLost) return;
    renewingLease = true;
    void renewTrainingLease(lease.ownerId)
      .then((renewed) => {
        if (!renewed) {
          leaseLost = true;
        }
      })
      .catch(() => {
        // Renewal errors are tracked via lease expiration check
      })
      .finally(() => {
        renewingLease = false;
      });
  }, renewalIntervalMs);
  renewalTimer.unref();

  const ensureLeaseOwnership = async (): Promise<void> => {
    if (leaseLost) {
      throw new TrainingError(
        'The training job lost its execution lease. Please retry.',
        'TRAINING_LEASE_LOST',
        503
      );
    }
    const isValid = await isTrainingLeaseValid(lease.ownerId);
    if (!isValid) {
      leaseLost = true;
      throw new TrainingError(
        'The training job lost its execution lease. Please retry.',
        'TRAINING_LEASE_LOST',
        503
      );
    }
  };

  let xTrain: tfType.Tensor2D | null = null;
  let yTrain: tfType.Tensor2D | null = null;
  let xValidation: tfType.Tensor2D | null = null;
  let yValidation: tfType.Tensor2D | null = null;
  let model: tfType.Sequential | null = null;

  try {
    // 1. Ensure all stored samples meet the wrist-maxabs-v1 contract (draining all batches)
    await migrateLegacySamples({ drainAll: true, auditExisting: true });

    const maxSamples = getMaxTrainingSamples();
    const rawSamples = await Sample.find(
      { normalizationVersion: 'wrist-maxabs-v1', quarantined: { $ne: true } },
      { features: 1, label: 1, participantId: 1, sessionId: 1 }
    )
      .sort({ _id: 1 })
      .limit(maxSamples + 1)
      .lean();

    if (rawSamples.length === 0) {
      throw new TrainingError('No training data available. Please collect samples first.', 'NO_TRAINING_DATA', 400);
    }
    if (rawSamples.length > maxSamples) {
      throw new TrainingError(
        `Training data exceeds the configured ${maxSamples} sample limit.`,
        'TRAINING_DATA_LIMIT',
        413
      );
    }

    // Shared feature contract validation: reject degenerate / collapsed samples before training
    const samples = rawSamples.filter((sample) => isWristMaxAbsNormalized(sample.features));
    if (samples.length === 0) {
      throw new TrainingError('No valid non-degenerate training data available. Please collect samples first.', 'NO_TRAINING_DATA', 400);
    }

    const gestures = await Gesture.find({}, { name: 1, labelIndex: 1 }).sort({ labelIndex: 1 }).lean();
    const { denseLabels, originalToDenseMap } = buildDenseLabelMap(
      samples,
      gestures,
      MIN_SAMPLES_PER_CLASS
    );

    if (denseLabels.length < 2) {
      throw new TrainingError(
        `At least two gesture classes with >= ${MIN_SAMPLES_PER_CLASS} samples are required.`,
        'INSUFFICIENT_CLASSES',
        400
      );
    }

    // Filter samples to active classes only and remap label to dense index 0..K-1
    const activeSamples = samples
      .filter((s) => originalToDenseMap.has(s.label))
      .map((s) => ({
        ...s,
        label: originalToDenseMap.get(s.label)!,
      }));

    const random = createSeededRandom(activeSamples.length * 31 + denseLabels.length);
    const splitResult = groupAwareSplit(activeSamples, random, 0.2);
    const { trainingSamples, validationSamples } = splitResult;

    const numClasses = denseLabels.length;
    const labels = denseLabels;

    const trainFeaturesTensor = tf.tensor2d(
      trainingSamples.map((sample) => sample.features),
      [trainingSamples.length, NUM_FEATURES]
    );
    const trainLabelsTensor = tf.tidy(() =>
      tf.oneHot(
        tf.tensor1d(trainingSamples.map((sample) => sample.label), 'int32'),
        numClasses
      ).as2D(trainingSamples.length, numClasses)
    );
    const validationFeaturesTensor = tf.tensor2d(
      validationSamples.map((sample) => sample.features),
      [validationSamples.length, NUM_FEATURES]
    );
    const validationLabelsTensor = tf.tidy(() =>
      tf.oneHot(
        tf.tensor1d(validationSamples.map((sample) => sample.label), 'int32'),
        numClasses
      ).as2D(validationSamples.length, numClasses)
    );
    xTrain = trainFeaturesTensor;
    yTrain = trainLabelsTensor;
    xValidation = validationFeaturesTensor;
    yValidation = validationLabelsTensor;

    model = tf.sequential();
    model.add(tf.layers.dense({ inputShape: [NUM_FEATURES], units: 64, activation: 'relu' }));
    model.add(tf.layers.dropout({ rate: 0.3 }));
    model.add(tf.layers.dense({ units: 32, activation: 'relu' }));
    model.add(tf.layers.dropout({ rate: 0.2 }));
    model.add(tf.layers.dense({ units: numClasses, activation: 'softmax' }));
    model.compile({
      optimizer: tf.train.adam(0.001),
      loss: 'categoricalCrossentropy',
      metrics: ['accuracy'],
    });

    const history = await model.fit(trainFeaturesTensor, trainLabelsTensor, {
      epochs: 50,
      batchSize: Math.min(32, trainingSamples.length),
      shuffle: true,
      validationData: [validationFeaturesTensor, validationLabelsTensor],
      callbacks: [tf.callbacks.earlyStopping({ monitor: 'val_loss', patience: 6 })],
      verbose: 0,
    });
    const trainingAccuracy = lastMetric(history, ['acc', 'accuracy']);
    const validationAccuracy = lastMetric(history, ['val_acc', 'val_accuracy']);

    // Detailed evaluation on held-out validation set
    const valPredictionsTensor = model.predict(validationFeaturesTensor) as tfType.Tensor2D;
    const predIndices = Array.from(valPredictionsTensor.argMax(-1).dataSync());
    valPredictionsTensor.dispose();
    const groundTruth = validationSamples.map((s) => s.label);

    const detailedMetrics = calculateEvaluationMetrics(
      predIndices,
      groundTruth,
      denseLabels
    );

    const version = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const datasetRevision = computeDatasetRevision(activeSamples);

    try {
      await EvaluationRun.create({
        modelVersion: version,
        datasetRevision,
        samplesCount: activeSamples.length,
        classCount: numClasses,
        splitStrategy: splitResult.splitStrategy,
        parameters: {
          epochs: 50,
          batchSize: Math.min(32, trainingSamples.length),
          learningRate: 0.001,
          optimizer: 'adam',
        },
        metrics: {
          trainingAccuracy: trainingAccuracy ?? detailedMetrics.accuracy,
          validationAccuracy: validationAccuracy ?? detailedMetrics.accuracy,
          macroF1: detailedMetrics.macroF1,
          macroPrecision: detailedMetrics.macroPrecision,
          macroRecall: detailedMetrics.macroRecall,
          weightedF1: detailedMetrics.weightedF1,
          perGestureMetrics: detailedMetrics.perGestureMetrics,
          confusionMatrix: detailedMetrics.confusionMatrix,
        },
        labels: denseLabels,
      });
    } catch (evalErr) {
      console.error('Failed to log evaluation run record:', evalErr);
    }

    await ensureLeaseOwnership();
    await publishModelArtifact(model, {
      version,
      createdAt: new Date().toISOString(),
      featureCount: NUM_FEATURES,
      normalizationVersion: 'wrist-maxabs-v1',
      samplesCount: activeSamples.length,
      datasetRevision,
      denseLabelMap: denseLabels,
      labels,
      metrics: {
        trainingAccuracy,
        validationAccuracy,
        macroF1: detailedMetrics.macroF1,
        macroPrecision: detailedMetrics.macroPrecision,
        macroRecall: detailedMetrics.macroRecall,
        weightedF1: detailedMetrics.weightedF1,
        perGestureMetrics: detailedMetrics.perGestureMetrics,
        confusionMatrix: detailedMetrics.confusionMatrix,
        splitStrategy: splitResult.splitStrategy,
      },
    });

    const result: TrainResult = {
      success: true,
      message: 'Model trained and saved successfully',
      samplesCount: samples.length,
      modelVersion: version,
      trainingAccuracy,
      validationAccuracy,
    };
    if (!(await completeTrainingLease(lease.ownerId, result))) {
      throw new TrainingError(
        'The training job lost its execution lease. Please retry.',
        'TRAINING_LEASE_LOST',
        503
      );
    }
    return result;
  } catch (error) {
    await failTrainingLease(
      lease.ownerId,
      error instanceof TrainingError ? error.code : 'TRAINING_FAILED'
    );
    throw error;
  } finally {
    clearInterval(renewalTimer);
    xTrain?.dispose();
    yTrain?.dispose();
    xValidation?.dispose();
    yValidation?.dispose();
    model?.dispose();
  }
}
