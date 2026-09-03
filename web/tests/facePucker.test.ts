import { describe, expect, it } from 'vitest';
import { getPuckerMetrics, isMouthPuckered } from '../hooks/useFacePucker';

interface LandmarkDraft {
  x: number;
  y: number;
  z: number;
}

function mouthLandmarks(overrides: Record<number, Partial<LandmarkDraft>> = {}): LandmarkDraft[] {
  const landmarks = Array.from({ length: 455 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  const base: Record<number, LandmarkDraft> = {
    13: { x: 0.5, y: 0.49, z: -0.01 },
    14: { x: 0.5, y: 0.51, z: -0.01 },
    61: { x: 0.44, y: 0.5, z: 0 },
    291: { x: 0.56, y: 0.5, z: 0 },
    234: { x: 0.2, y: 0.5, z: 0 },
    454: { x: 0.8, y: 0.5, z: 0 },
  };

  Object.entries(base).forEach(([index, landmark]) => {
    const numericIndex = Number(index);
    landmarks[numericIndex] = { ...landmark, ...overrides[numericIndex] };
  });
  return landmarks;
}

describe('Face Mesh pucker ratios', () => {
  it('recognizes a narrow, protruded mouth independent of pixel dimensions', () => {
    const landmarks = mouthLandmarks();
    const metrics = getPuckerMetrics(landmarks);

    expect(metrics?.apertureRatio).toBeCloseTo(1 / 6);
    expect(metrics?.lipProtrusionRatio).toBeCloseTo(1 / 12);
    expect(metrics?.mouthToFaceWidthRatio).toBeCloseTo(1 / 5);
    expect(isMouthPuckered(landmarks)).toBe(true);
  });

  it('rejects a mouth aperture that is too open to be a pucker', () => {
    const landmarks = mouthLandmarks({
      13: { y: 0.4 },
      14: { y: 0.6 },
    });

    expect(isMouthPuckered(landmarks)).toBe(false);
  });
});
