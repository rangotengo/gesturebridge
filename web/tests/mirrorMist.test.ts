import { describe, expect, it } from 'vitest';

/** Mirrors the ease used by MirrorFogOverlay breath blooms. */
function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

function bloomRadiusProgress(elapsedMs: number, durationMs: number, peakRadius: number): number {
  const progress = Math.min(1, Math.max(0, elapsedMs / durationMs));
  return peakRadius * easeOutCubic(progress);
}

function stackedFogDensity(current: number, step = 0.28): number {
  return Math.min(1, current + step);
}

describe('mirror mist blow behavior', () => {
  it('stacks fog density in layers until capped', () => {
    expect(stackedFogDensity(0)).toBeCloseTo(0.28);
    expect(stackedFogDensity(0.28)).toBeCloseTo(0.56);
    expect(stackedFogDensity(0.84)).toBeCloseTo(1);
    expect(stackedFogDensity(1)).toBe(1);
  });

  it('expands a breath bloom from zero toward peak over ~1.5s', () => {
    expect(bloomRadiusProgress(0, 1_500, 0.5)).toBe(0);
    expect(bloomRadiusProgress(750, 1_500, 0.5)).toBeGreaterThan(0.35);
    expect(bloomRadiusProgress(1_500, 1_500, 0.5)).toBeCloseTo(0.5);
  });
});
