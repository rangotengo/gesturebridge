import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { generateBenchmarkDataset } from '../scripts/evaluateBundledModel';
import { computeDatasetRevision } from '../ml/trainingHelpers';

describe('benchmark evaluation dataset', () => {
  it('generates consistent multi-participant samples with valid feature contracts', () => {
    const dataset = generateBenchmarkDataset(42);
    expect(dataset.length).toBe(5 * 6 * 30); // 5 participants, 6 gestures, 30 samples = 900 samples

    const pids = new Set(dataset.map((d) => d.participantId));
    expect(pids.size).toBe(5);

    const labels = new Set(dataset.map((d) => d.label));
    expect(labels.size).toBe(6);

    for (const sample of dataset.slice(0, 20)) {
      expect(sample.features.length).toBe(63);
      // Wrist origin is (0, 0, 0)
      expect(Math.abs(sample.features[0])).toBeLessThan(1e-4);
      expect(Math.abs(sample.features[1])).toBeLessThan(1e-4);
      expect(Math.abs(sample.features[2])).toBeLessThan(1e-4);
    }
  });

  it('computes a consistent sha256 dataset revision', () => {
    const dataset1 = generateBenchmarkDataset(42);
    const dataset2 = generateBenchmarkDataset(42);
    const hash1 = computeDatasetRevision(dataset1);
    const hash2 = computeDatasetRevision(dataset2);

    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);
  });

  it('manifest files in public/ml match the reproducible schema', () => {
    const manifestPath = path.join(process.cwd(), 'public', 'ml', 'models', 'v1.0.0', 'manifest.json');
    expect(fs.existsSync(manifestPath)).toBe(true);

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    expect(manifest.version).toBe('v1.0.0');
    expect(manifest.datasetRevision).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.metrics.splitStrategy).toBe('grouped-participant');
    expect(manifest.metrics.confusionMatrix).toHaveLength(6);
    expect(manifest.metrics.perGestureMetrics).toHaveLength(6);
    expect(manifest.metrics.validationAccuracy).toBeGreaterThan(0.9);
  });
});
