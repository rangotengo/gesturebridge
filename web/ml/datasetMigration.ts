import { connectDB } from '../lib/db';
import { logInfo, logWarn, logError } from '../lib/logger';
import Sample, { type ISample } from '../models/Sample';
import { normalizeLandmarks, type Landmark } from './gestureUtils';
import {
  isWristMaxAbsNormalized,
  validateFeatureContract,
  FEATURE_CONTRACT_VERSION,
  type FeatureValidationResult,
} from './featureContract';

export {
  isWristMaxAbsNormalized,
  validateFeatureContract,
  FEATURE_CONTRACT_VERSION,
  type FeatureValidationResult,
};

export interface MigrationSummary {
  totalChecked: number;
  migratedCount: number;
  quarantinedCount: number;
  validCount: number;
  errorCount: number;
  batchesProcessed: number;
  remainingLegacyCount: number;
  dryRun: boolean;
}

export interface MigrationOptions {
  dryRun?: boolean;
  batchSize?: number;
  drainAll?: boolean;
  maxBatches?: number;
  auditExisting?: boolean;
}

/**
 * Attempts to re-normalize 63 raw landmarks if they were saved without wrist-maxabs-v1 normalization.
 */
export function attemptRenormalizeFeatures(features: number[]): number[] | null {
  if (!Array.isArray(features) || features.length !== 63) return null;
  if (!features.every((v) => typeof v === 'number' && Number.isFinite(v))) return null;

  if (isWristMaxAbsNormalized(features)) {
    return features;
  }

  // Treat as 21 3D points and run wrist-maxabs-v1 normalization
  const landmarks: Landmark[] = [];
  for (let i = 0; i < 21; i += 1) {
    landmarks.push({
      x: features[i * 3] ?? 0,
      y: features[i * 3 + 1] ?? 0,
      z: features[i * 3 + 2] ?? 0,
    });
  }

  const normalized = normalizeLandmarks(landmarks);
  if (normalized.length === 63 && isWristMaxAbsNormalized(normalized)) {
    return normalized;
  }

  return null;
}

/**
 * Scans the Sample collection and safely migrates legacy / unnormalized samples to the
 * wrist-maxabs-v1 contract.
 *
 * Supports batch draining (drainAll: true) so all unmigrated samples are processed
 * before training or during explicit maintenance operations.
 *
 * NOTE: Unrecoverable samples are NEVER deleted. They are preserved with quarantined: true
 * and quarantineReason, allowing safe review and preventing data loss.
 */
export async function migrateLegacySamples(options?: MigrationOptions): Promise<MigrationSummary> {
  await connectDB();

  const dryRun = options?.dryRun === true;
  const batchSize = options?.batchSize ?? 1000;
  const drainAll = options?.drainAll ?? true;
  const maxBatches = options?.maxBatches ?? 50;
  const auditExisting = options?.auditExisting ?? false;

  const summary: MigrationSummary = {
    totalChecked: 0,
    migratedCount: 0,
    quarantinedCount: 0,
    validCount: 0,
    errorCount: 0,
    batchesProcessed: 0,
    remainingLegacyCount: 0,
    dryRun,
  };

  const legacyQuery = {
    quarantined: { $ne: true },
    $or: [
      { normalizationVersion: { $exists: false } },
      { normalizationVersion: null },
      { normalizationVersion: { $ne: FEATURE_CONTRACT_VERSION } },
      { source: { $exists: false } },
      { source: null },
    ],
  };

  let keepProcessing = true;

  while (keepProcessing && summary.batchesProcessed < maxBatches) {
    const legacyBatch = await Sample.find(legacyQuery)
      .limit(batchSize)
      .lean<ISample[]>();

    if (legacyBatch.length === 0) {
      break;
    }

    summary.batchesProcessed += 1;
    summary.totalChecked += legacyBatch.length;
    logInfo('ml.dataset_migration_batch_started', {
      batch: summary.batchesProcessed,
      count: legacyBatch.length,
      dryRun,
    });

    for (const doc of legacyBatch) {
      try {
        const alreadyValid = isWristMaxAbsNormalized(doc.features);
        if (alreadyValid) {
          summary.validCount += 1;
          if (!dryRun) {
            await Sample.updateOne(
              { _id: doc._id },
              {
                $set: {
                  normalizationVersion: FEATURE_CONTRACT_VERSION,
                  source: doc.source ?? 'collection',
                },
              }
            );
          }
          continue;
        }

        const normalizedFeatures = attemptRenormalizeFeatures(doc.features);
        if (!normalizedFeatures) {
          summary.quarantinedCount += 1;
          if (!dryRun) {
            await Sample.updateOne(
              { _id: doc._id },
              {
                $set: {
                  quarantined: true,
                  quarantineReason: 'unrecoverable_coordinates_or_length',
                },
              }
            );
          }
          logWarn('ml.sample_quarantined', { sampleId: String(doc._id), label: doc.label });
          continue;
        }

        summary.migratedCount += 1;
        if (!dryRun) {
          await Sample.updateOne(
            { _id: doc._id },
            {
              $set: {
                features: normalizedFeatures,
                normalizationVersion: FEATURE_CONTRACT_VERSION,
                source: doc.source ?? 'collection',
              },
            }
          );
        }
      } catch (err) {
        summary.errorCount += 1;
        logError('ml.sample_migration_failed', err, { sampleId: String(doc._id) });
      }
    }

    if (!drainAll || dryRun) {
      keepProcessing = false;
    }
  }

  // Audit existing samples tagged as normalized to catch degenerate or corrupt features
  if (auditExisting && !dryRun) {
    const taggedSamples = await Sample.find({
      quarantined: { $ne: true },
      normalizationVersion: FEATURE_CONTRACT_VERSION,
    })
      .limit(5000)
      .lean<ISample[]>();

    for (const doc of taggedSamples) {
      if (!isWristMaxAbsNormalized(doc.features)) {
        const reNormalized = attemptRenormalizeFeatures(doc.features);
        if (reNormalized) {
          summary.migratedCount += 1;
          await Sample.updateOne(
            { _id: doc._id },
            { $set: { features: reNormalized } }
          );
        } else {
          summary.quarantinedCount += 1;
          await Sample.updateOne(
            { _id: doc._id },
            {
              $set: {
                quarantined: true,
                quarantineReason: 'degenerate_or_invalid_feature_contract',
              },
            }
          );
          logWarn('ml.sample_quarantined_from_audit', { sampleId: String(doc._id), label: doc.label });
        }
      }
    }
  }

  summary.remainingLegacyCount = await Sample.countDocuments(legacyQuery);

  logInfo('ml.dataset_migration_completed', {
    totalChecked: summary.totalChecked,
    migratedCount: summary.migratedCount,
    quarantinedCount: summary.quarantinedCount,
    validCount: summary.validCount,
    errorCount: summary.errorCount,
    batchesProcessed: summary.batchesProcessed,
    remainingLegacyCount: summary.remainingLegacyCount,
    dryRun,
  });

  return summary;
}
