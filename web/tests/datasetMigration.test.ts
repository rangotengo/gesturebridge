import { describe, expect, it } from 'vitest';
import {
  isWristMaxAbsNormalized,
  attemptRenormalizeFeatures,
} from '../ml/datasetMigration';

describe('dataset migration & normalization validation', () => {
  it('correctly validates wrist-maxabs-v1 normalized vectors', () => {
    // A valid normalized vector: wrist at 0, 0, 0, max absolute coordinate = 1.0
    const validFeatures = Array.from({ length: 63 }, (_, i) => (i < 3 ? 0 : (i - 3) / 59));
    expect(isWristMaxAbsNormalized(validFeatures)).toBe(true);
  });

  it('rejects bounded vectors whose wrist is not at origin', () => {
    // Raw MediaPipe coordinates may all be in [0, 1], but wrist is not at (0, 0, 0)
    const rawBoundedFeatures = Array.from({ length: 63 }, () => 0.5);
    expect(isWristMaxAbsNormalized(rawBoundedFeatures)).toBe(false);
  });

  it('rejects vectors with invalid length or non-finite values', () => {
    expect(isWristMaxAbsNormalized([])).toBe(false);
    expect(isWristMaxAbsNormalized(Array(62).fill(0))).toBe(false);
    expect(isWristMaxAbsNormalized(Array(64).fill(0))).toBe(false);

    const withNaN = Array(63).fill(0);
    withNaN[5] = Number.NaN;
    expect(isWristMaxAbsNormalized(withNaN)).toBe(false);

    const withInfinity = Array(63).fill(0);
    withInfinity[5] = Number.POSITIVE_INFINITY;
    expect(isWristMaxAbsNormalized(withInfinity)).toBe(false);
  });

  it('re-normalizes uncentered raw landmarks into wrist-maxabs-v1 contract', () => {
    // Simulate 21 raw landmarks around wrist at (100, 200, 50)
    const rawFeatures: number[] = [];
    for (let i = 0; i < 21; i += 1) {
      rawFeatures.push(100 + i * 2, 200 + i * 3, 50 - i * 1);
    }

    expect(isWristMaxAbsNormalized(rawFeatures)).toBe(false);

    const renormalized = attemptRenormalizeFeatures(rawFeatures);
    expect(renormalized).not.toBeNull();
    if (!renormalized) return;

    expect(renormalized).toHaveLength(63);
    // Wrist at origin
    expect(renormalized[0]).toBe(0);
    expect(renormalized[1]).toBe(0);
    expect(renormalized[2]).toBe(0);
    // Verified by isWristMaxAbsNormalized
    expect(isWristMaxAbsNormalized(renormalized)).toBe(true);
  });

  it('returns null for unrecoverable corrupted feature vectors', () => {
    expect(attemptRenormalizeFeatures([])).toBeNull();
    expect(attemptRenormalizeFeatures(Array(50).fill(1))).toBeNull();
    expect(attemptRenormalizeFeatures([Number.NaN, ...Array(62).fill(0)])).toBeNull();
  });
});
