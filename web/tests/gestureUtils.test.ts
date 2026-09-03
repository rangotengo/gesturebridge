import { describe, expect, it } from 'vitest';

import {
  detectGestureByRules,
  getFingerStates,
  normalizeLandmarks,
  type Landmark,
} from '../ml/gestureUtils';

function landmarksFor(fingersUp: Partial<Record<'index' | 'middle' | 'ring' | 'pinky', boolean>>): Landmark[] {
  const landmarks = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  const joints = {
    index: [8, 6],
    middle: [12, 10],
    ring: [16, 14],
    pinky: [20, 18],
  } as const;

  for (const [finger, [tip, pip]] of Object.entries(joints) as Array<
    [keyof typeof joints, readonly [number, number]]
  >) {
    landmarks[pip].y = 0.5;
    landmarks[tip].y = fingersUp[finger] ? 0.2 : 0.8;
  }

  return landmarks;
}

describe('normalizeLandmarks', () => {
  it('returns a stable 63-value zero vector for malformed input', () => {
    expect(normalizeLandmarks([])).toEqual(Array(63).fill(0));
    expect(normalizeLandmarks(Array.from({ length: 20 }, () => ({ x: 0, y: 0, z: 0 })))).toEqual(
      Array(63).fill(0)
    );
  });

  it('is translation and positive-scale invariant', () => {
    const shape = Array.from({ length: 21 }, (_, index) => ({
      x: 1 + index * 0.1,
      y: 2 - index * 0.05,
      z: -1 + index * 0.02,
    }));
    const transformed = shape.map((point) => ({
      x: point.x * 4 + 100,
      y: point.y * 4 - 30,
      z: point.z * 4 + 8,
    }));

    const normalized = normalizeLandmarks(shape);
    const transformedNormalized = normalizeLandmarks(transformed);

    expect(normalized).toHaveLength(63);
    normalized.forEach((value, index) => {
      expect(Number.isFinite(value)).toBe(true);
      expect(Math.abs(value)).toBeLessThanOrEqual(1);
      expect(transformedNormalized[index]).toBeCloseTo(value, 6);
    });
    expect(normalized.slice(0, 3)).toEqual([0, 0, 0]);
  });

  it('keeps a collapsed hand finite', () => {
    const collapsed = Array.from({ length: 21 }, () => ({ x: 3, y: -2, z: 9 }));
    expect(normalizeLandmarks(collapsed)).toEqual(Array(63).fill(0));
  });
});

describe('rule-based gesture detection', () => {
  it.each([
    [{ index: true }, 'Pointing'],
    [{}, 'Fist'],
    [{ index: true, middle: true }, 'Peace'],
    [{ index: true, middle: true, ring: true, pinky: true }, 'Open Palm'],
  ] as const)('recognizes configured finger states %j as %s', (fingerState, gesture) => {
    expect(detectGestureByRules(landmarksFor(fingerState))).toBe(gesture);
  });

  it('returns null for an unsupported combination', () => {
    expect(detectGestureByRules(landmarksFor({ middle: true, ring: true }))).toBeNull();
  });

  it('uses tip-above-PIP semantics for the four non-thumb fingers', () => {
    const states = getFingerStates(landmarksFor({ index: true, ring: true }));
    expect(states).toMatchObject({ index: true, middle: false, ring: true, pinky: false });
  });
});
