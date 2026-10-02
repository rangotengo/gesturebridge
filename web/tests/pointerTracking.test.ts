import { describe, expect, it } from 'vitest';
import {
  getMirroredIndexTipPosition,
  mapPointerToScreen,
  mapRawLandmarkToMirroredCoverViewport,
  smoothPointer,
} from '../features/control/pointerTracking';
import type { Landmark } from '../ml/gestureUtils';

function landmarksWithIndexTip(indexTip: Landmark): Landmark[] {
  return Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 })).map((landmark, index) =>
    index === 8 ? indexTip : landmark
  );
}

describe('pointer tracking', () => {
  it('maps the index fingertip into mirrored screen coordinates', () => {
    const pointer = getMirroredIndexTipPosition(landmarksWithIndexTip({ x: 0.2, y: 0.4, z: 0 }));

    expect(pointer).toEqual({ x: 0.8, y: 0.4 });
    expect(pointer && mapPointerToScreen(pointer, { width: 1_920, height: 1_080 })).toEqual({
      x: 1_536,
      y: 432,
    });
  });

  it('rejects missing and non-finite fingertips', () => {
    expect(getMirroredIndexTipPosition([])).toBeNull();
    expect(getMirroredIndexTipPosition(landmarksWithIndexTip({ x: Number.NaN, y: 0.4, z: 0 }))).toBeNull();
  });

  it('maps raw landmarks through mirrored object-cover into viewport space', () => {
    // 1280x720 video letterboxed into a taller 1280x800 window → horizontal crop.
    const viewport = mapRawLandmarkToMirroredCoverViewport(
      { x: 0.2, y: 0.5 },
      { width: 1_280, height: 720 },
      { width: 1_280, height: 800 }
    );

    // scale = max(1280/1280, 800/720) = 10/9
    // displayed = 1422.22 x 800, offsetX = (1280 - 1422.22) / 2 = -71.11
    // mirroredX = 0.8 → pixelX = 0.8 * 1422.22 - 71.11 = 1066.67
    expect(viewport).not.toBeNull();
    expect(viewport!.x).toBeCloseTo(1066.67 / 1280, 3);
    expect(viewport!.y).toBeCloseTo(0.5, 3);
  });

  it('keeps the mirrored center point centered after object-cover', () => {
    const viewport = mapRawLandmarkToMirroredCoverViewport(
      { x: 0.5, y: 0.5 },
      { width: 1_280, height: 720 },
      { width: 1_280, height: 800 }
    );

    expect(viewport).toEqual({ x: 0.5, y: 0.5 });
  });

  it('adds the virtual desktop origin when a display sits left of the primary', () => {
    expect(mapPointerToScreen({ x: 0.5, y: 0 }, { x: -1_920, y: 0, width: 3_840, height: 1_080 })).toEqual({
      x: 0,
      y: 0,
    });
  });

  it('smooths travel past the deadzone and ignores smaller tremor', () => {
    const origin = { x: 0.4, y: 0.4 };
    expect(smoothPointer({ x: 0.402, y: 0.4 }, origin, 0.5, 0.01)).toEqual(origin);
    expect(smoothPointer({ x: 0.5, y: 0.4 }, origin, 0.5, 0.01)).toEqual({ x: 0.45, y: 0.4 });
  });
});
