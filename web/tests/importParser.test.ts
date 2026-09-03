import { describe, expect, it } from 'vitest';

import {
  parseCsvDataset,
  parseCsvRow,
  parseImportDataset,
  parseJsonDataset,
} from '../features/datasets/importParser';

const gestures = [
  { _id: '0', name: 'Pointing', labelIndex: 0, isCustom: false },
  { _id: '8', name: 'Wave', labelIndex: 8, isCustom: true },
];
const features = Array.from({ length: 63 }, (_, index) => String(index / 10));

describe('dataset import parser', () => {
  it('preserves label zero and keeps unknown names unresolved', () => {
    const parsed = parseJsonDataset(JSON.stringify([
      { features, label: 0 },
      { features, label: 'Wave' },
      { features, label: 'Custom pose' },
      { features: features.slice(1), label: 0 },
    ]), gestures);

    expect(parsed.samples.map((sample) => sample.label)).toEqual([0, 8, -1]);
    expect(parsed.samples[2]?.rawStringLabel).toBe('Custom pose');
    expect(parsed.unresolvedNames).toEqual(['Custom pose']);
    expect(parsed.invalidCount).toBe(1);
  });

  it('does not silently map unknown numeric labels to Pointing', () => {
    const parsed = parseJsonDataset(JSON.stringify([
      { features, label: 0 },
      { features, label: 12 },
    ]), gestures);
    expect(parsed.samples.map((sample) => sample.label)).toEqual([0]);
    expect(parsed.invalidCount).toBe(1);
  });

  it('parses escaped CSV labels and finds the label column automatically', () => {
    expect(parseCsvRow('1,"Wave, extended",3')).toEqual(['1', 'Wave, extended', '3']);
    const csv = [`"Custom ""Wave""",${features.join(',')}`].join('\n');
    const parsed = parseCsvDataset(csv, gestures, 'auto');

    expect(parsed.samples).toHaveLength(1);
    expect(parsed.samples[0]?.label).toBe(-1);
    expect(parsed.samples[0]?.rawStringLabel).toBe('Custom "Wave"');
  });

  it('rejects unsupported extensions', () => {
    expect(() => parseImportDataset('', 'samples.txt', gestures, 'last')).toThrow('Unsupported file extension');
  });
});
