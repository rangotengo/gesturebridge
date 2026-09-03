import { connectDB } from '../lib/db';
import { logInfo, logWarn, logError } from '../lib/logger';
import Sample, { type ISample } from '../models/Sample';
import { normalizeLandmarks, type Landmark } from './gestureUtils';

export interface MigrationSummary {
  totalChecked: number;
  migratedCount: number;
  quarantinedCount: number;
  validCount: number;
  errorCount: number;
  dryRun: boolean;
}

export interface MigrationOptions {
  dryRun?: boolean;
  batchSize?: number;
}

/**
 * Validates whether a feature vector satisfies the wrist-maxabs-v1 contract:
 * - Exactly 63 finite numbers in [-1.0001, 1.0001]
 * - Wrist origin at landmarks[0] (coordinates 0, 1, 2) is (0, 0, 0) within precision
 * - Max absolute value is approximately 1.0 (>= 0.99) unless hand is stationary at origin
 */
export function isWristMaxAbsNormalized(features: number[]): boolean {
  if (!Array.isArray(features) || features.length !== 63) return false;
  if (!features.every((v) => typeof v === 'number' && Number.isFinite(v) && v >= -1.0001 && v <= 1.0001)) {
    return false;
  }

  const wristX = Math.abs(features[0] ?? 0);
  const wristY = Math.abs(features[1] ?? 0);
  const wristZ = Math.abs(features[2] ?? 0);
  const wristAtOrigin = wristX < 1e-4 && wristY < 1e-4 && wristZ < 1e-4;
  if (!wristAtOrigin) return false;

  const maxAbs = Math.max(...features.map(Math.abs));
  return maxAbs >= 0.99 || maxAbs === 0;
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
 * NOTE: Unrecoverable samples are NEVER deleted. They are preserved with quarantined: true
 * and quarantineReason, allowing safe review and preventing data loss.
 */
export async function migrateLegacySamples(options?: MigrationOptions): Promise<MigrationSummary> {
  await connectDB();

  const dryRun = options?.dryRun === true;
  const batchSize = options?.batchSize ?? 1000;

  const legacySamples = await Sample.find({
    quarantined: { $ne: true },
    $or: [
      { normalizationVersion: { $exists: false } },
      { normalizationVersion: null },
      { normalizationVersion: { $ne: 'wrist-maxabs-v1' } },
      { source: { $exists: false } },
      { source: null },
    ],
  })
    .limit(batchSize)
    .lean<ISample[]>();

  const summary: MigrationSummary = {
    totalChecked: legacySamples.length,
    migratedCount: 0,
    quarantinedCount: 0,
    validCount: 0,
    errorCount: 0,
    dryRun,
  };

  if (legacySamples.length === 0) {
    return summary;
  }

  logInfo('ml.dataset_migration_started', { count: legacySamples.length, dryRun });

  for (const doc of legacySamples) {
    try {
      const alreadyValid = isWristMaxAbsNormalized(doc.features);
      if (alreadyValid) {
        summary.validCount += 1;
        if (!dryRun) {
          await Sample.updateOne(
            { _id: doc._id },
            {
              $set: {
                normalizationVersion: 'wrist-maxabs-v1',
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
              normalizationVersion: 'wrist-maxabs-v1',
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

  logInfo('ml.dataset_migration_completed', {
    totalChecked: summary.totalChecked,
    migratedCount: summary.migratedCount,
    quarantinedCount: summary.quarantinedCount,
    validCount: summary.validCount,
    errorCount: summary.errorCount,
    dryRun,
  });

  return summary;
}
