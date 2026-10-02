import { describe, expect, it } from 'vitest';
import {
  filterPointer,
  getMirroredIndexTipPosition,
  getMirroredTrackingPoint,
  mapPointerToScreen,
  mapRawLandmarkToMirroredCoverViewport,
  type PointerFilterState,
} from '../features/control/pointerTracking';
import { DEFAULT_CALIBRATION_SETTINGS, pointerFilterParams } from '../lib/calibration';
import type { Landmark } from '../ml/gestureUtils';

function landmarksWithIndexTip(indexTip: Landmark): Landmark[] {
  return Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 })).map((landmark, index) =>
    index === 8 ? indexTip : landmark
  );
}

const FRAME_MS = 33;
const defaultFilter = pointerFilterParams(DEFAULT_CALIBRATION_SETTINGS);

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

  it('tracks the knuckle line for the palm point so curling the index finger does not move it', () => {
    const open = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
    [5, 9, 13, 17].forEach((index, i) => {
      open[index] = { x: 0.3 + i * 0.02, y: 0.4, z: 0 };
    });
    open[8] = { x: 0.3, y: 0.2, z: 0 };
    const curled = open.map((landmark, index) => (index === 8 ? { x: 0.32, y: 0.45, z: 0 } : landmark));

    const palmOpen = getMirroredTrackingPoint(open, 'palm');
    expect(palmOpen?.x).toBeCloseTo(0.67, 6);
    expect(palmOpen?.y).toBeCloseTo(0.4, 6);
    expect(getMirroredTrackingPoint(curled, 'palm')).toEqual(palmOpen);
    expect(getMirroredTrackingPoint(curled, 'fingertip')).not.toEqual(getMirroredTrackingPoint(open, 'fingertip'));
  });

  it('passes the first sample through and ignores a duplicate frame', () => {
    const first = filterPointer(null, { x: 0.3, y: 0.6 }, 1_000, defaultFilter);
    const duplicate = filterPointer(first, { x: 0.9, y: 0.9 }, 1_001, defaultFilter);

    expect(first).toEqual({ x: 0.3, y: 0.6, dx: 0, dy: 0, t: 1_000 });
    expect(duplicate).toEqual(first);
  });

  it('removes most of the jitter from a still hand', () => {
    let state: PointerFilterState | null = null;
    const outputs: number[] = [];
    for (let frame = 0; frame < 90; frame += 1) {
      const jitter = frame % 2 === 0 ? 0.003 : -0.003;
      state = filterPointer(state, { x: 0.5 + jitter, y: 0.5 }, frame * FRAME_MS, defaultFilter);
      if (frame >= 60) outputs.push(state.x);
    }

    const spread = Math.max(...outputs) - Math.min(...outputs);
    expect(spread).toBeLessThan(0.006 * 0.2);
  });

  it('keeps up with a fast sweep far better than a fixed low-cutoff average', () => {
    const speed = 1.5; // screens per second
    const emaAlpha = 1 / (1 + 1 / (2 * Math.PI * defaultFilter.minCutoff) / (FRAME_MS / 1000));
    let state: PointerFilterState | null = null;
    let ema = 0.1;
    let target = 0.1;
    for (let frame = 0; frame <= 20; frame += 1) {
      target = 0.1 + speed * (frame * FRAME_MS) / 1000;
      state = filterPointer(state, { x: target, y: 0.5 }, frame * FRAME_MS, defaultFilter);
      ema += emaAlpha * (target - ema);
    }

    const lag = target - state!.x;
    expect(lag).toBeLessThan(0.03);
    expect(lag).toBeLessThan((target - ema) / 4);
  });
});
