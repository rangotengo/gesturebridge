/**
 * Shared Feature Contract for GestureBridge
 * Contract Version: wrist-maxabs-v1
 *
 * Requirements:
 * 1. Exactly 63 finite numbers.
 * 2. Wrist origin (landmarks[0] -> features[0, 1, 2]) is (0, 0, 0) within precision (1e-4).
 * 3. Bounded in [-1.0001, 1.0001].
 * 4. Scale invariance: max absolute value is >= 0.95.
 * 5. Non-degenerate: all-zero vectors or collapsed landmarks are rejected.
 */

export const FEATURE_CONTRACT_VERSION = 'wrist-maxabs-v1';

export interface FeatureValidationResult {
  valid: boolean;
  reason?: string;
}

export function validateFeatureContract(features: unknown): FeatureValidationResult {
  if (!Array.isArray(features)) {
    return { valid: false, reason: 'Features must be an array.' };
  }
  if (features.length !== 63) {
    return { valid: false, reason: 'Features must contain exactly 63 values.' };
  }
  if (!features.every((v) => typeof v === 'number' && Number.isFinite(v) && v >= -1.0001 && v <= 1.0001)) {
    return {
      valid: false,
      reason: 'All 63 feature values must be finite numbers normalized between -1.0 and 1.0.',
    };
  }

  const wristX = Math.abs(features[0] ?? 0);
  const wristY = Math.abs(features[1] ?? 0);
  const wristZ = Math.abs(features[2] ?? 0);
  if (wristX > 1e-4 || wristY > 1e-4 || wristZ > 1e-4) {
    return { valid: false, reason: 'Wrist origin (first 3 coordinates) must be (0, 0, 0).' };
  }

  const maxAbs = Math.max(...features.map(Math.abs));
  if (maxAbs < 0.95) {
    return {
      valid: false,
      reason: `Features must be scaled to unit range (max absolute coordinate >= 0.95; got ${maxAbs.toFixed(4)}). Degenerate and all-zero vectors are rejected.`,
    };
  }

  let nonZeroJoints = 0;
  for (let i = 3; i < 63; i++) {
    if (Math.abs(features[i] ?? 0) > 1e-4) {
      nonZeroJoints++;
    }
  }
  if (nonZeroJoints < 10) {
    return {
      valid: false,
      reason: 'Features must exhibit non-degenerate joint spread across hand landmarks.',
    };
  }

  return { valid: true };
}

export function isWristMaxAbsNormalized(features: unknown): features is number[] {
  return validateFeatureContract(features).valid;
}
