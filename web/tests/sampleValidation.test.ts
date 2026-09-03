import { describe, expect, it } from 'vitest';

import { validateImportSampleBatch, validateSampleBatch } from '../lib/sampleValidation';

const features = Array.from({ length: 63 }, (_, index) => index / 63);
const knownLabels = new Set([0, 2]);

describe('validateSampleBatch', () => {
  it('rejects missing, empty, and oversized batches at batch level', () => {
    expect(validateSampleBatch(null, knownLabels, 2).rejected).toEqual([
      { index: -1, reason: 'Samples array is required.' },
    ]);
    expect(validateSampleBatch([], knownLabels, 2).rejected).toEqual([
      { index: -1, reason: 'Samples array cannot be empty.' },
    ]);
    expect(validateSampleBatch([{}, {}, {}], knownLabels, 2).rejected).toEqual([
      { index: -1, reason: 'Batch exceeds the 2 sample limit.' },
    ]);
  });

  it('accepts valid samples without losing label zero', () => {
    const result = validateSampleBatch(
      [
        { features, label: 0 },
        { features: [...features], label: 2 },
      ],
      knownLabels,
      10
    );

    expect(result.rejected).toEqual([]);
    expect(result.accepted).toHaveLength(2);
    expect(result.accepted.map((sample) => sample.label)).toEqual([0, 2]);
  });

  it('partitions invalid rows and preserves their source indexes', () => {
    const result = validateSampleBatch(
      [
        { features, label: 0 },
        null,
        { features: features.slice(1), label: 0 },
        { features: features.map((value, index) => (index === 4 ? Number.NaN : value)), label: 0 },
        { features: features.map((value, index) => (index === 4 ? 5.0 : value)), label: 0 },
        { features, label: 1.5 },
        { features, label: 99 },
      ],
      knownLabels,
      10
    );

    expect(result.accepted).toEqual([{ features, label: 0 }]);
    expect(result.rejected).toEqual([
      { index: 1, reason: 'Sample must be an object.' },
      { index: 2, reason: 'Features must contain exactly 63 values.' },
      { index: 3, reason: 'All 63 feature values must be finite numbers normalized between -1.0 and 1.0.' },
      { index: 4, reason: 'All 63 feature values must be finite numbers normalized between -1.0 and 1.0.' },
      { index: 5, reason: 'Label must be an integer.' },
      { index: 6, reason: 'Unknown gesture label: 99.' },
    ]);
  });

  it('rejects non-number feature coercions, out-of-bounds numbers, and infinities', () => {
    for (const invalid of ['1', 2.5, -3.0, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const candidate = [...features] as unknown[];
      candidate[0] = invalid;
      const result = validateSampleBatch([{ features: candidate, label: 0 }], knownLabels, 10);
      expect(result.accepted).toEqual([]);
      expect(result.rejected[0]?.reason).toBe('All 63 feature values must be finite numbers normalized between -1.0 and 1.0.');
    }
  });
});

describe('validateImportSampleBatch', () => {
  it('keeps explicit gesture names for transaction-time resolution', () => {
    const result = validateImportSampleBatch(
      [
        { features, label: 'Custom Wave' },
        { features, label: 0 },
      ],
      10
    );

    expect(result.rejected).toEqual([]);
    expect(result.accepted).toEqual([
      { features, label: 'Custom Wave', index: 0 },
      { features, label: 0, index: 1 },
    ]);
  });

  it('rejects invalid import rows before a transaction can mutate data', () => {
    const result = validateImportSampleBatch(
      [
        { features, label: -1 },
        { features, label: '   ' },
        { features: features.slice(1), label: 'Wave' },
      ],
      10
    );

    expect(result.accepted).toEqual([]);
    expect(result.rejected).toEqual([
      { index: 0, reason: 'Numeric labels must be non-negative integers.' },
      { index: 1, reason: 'Gesture names must contain 1 to 64 characters.' },
      { index: 2, reason: 'Features must contain exactly 63 values.' },
    ]);
  });
});
