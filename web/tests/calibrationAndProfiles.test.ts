import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_CALIBRATION_SETTINGS,
  applyCalibrationMapping,
  computePinchRatioThreshold,
  computeWorkspaceBounds,
  loadCalibrationSettings,
  pointerFilterParams,
} from '../lib/calibration';
import { PINCH_RELEASE_FACTOR } from '../lib/gestureConfig';
import {
  PRESET_PROFILES,
  validateProfileMappings,
} from '../lib/gestureProfiles';

describe('calibration math', () => {
  it('maps points correctly within workspace bounds', () => {
    const centerPoint = { x: 0.5, y: 0.5 };
    const mapped = applyCalibrationMapping(centerPoint, DEFAULT_CALIBRATION_SETTINGS);
    expect(mapped.x).toBeCloseTo(0.5, 2);
    expect(mapped.y).toBeCloseTo(0.5, 2);
  });

  it('clamps coordinates outside bounds', () => {
    const edgePoint = { x: 0.05, y: 0.95 };
    const mapped = applyCalibrationMapping(edgePoint, DEFAULT_CALIBRATION_SETTINGS);
    expect(mapped.x).toBeGreaterThanOrEqual(0);
    expect(mapped.y).toBeLessThanOrEqual(1);
  });

  it('maps an off-center active area onto the full screen', () => {
    const settings = {
      pointerSensitivity: 1,
      workspaceBounds: { minX: 0.5, maxX: 0.9, minY: 0.2, maxY: 0.6 },
    };
    expect(applyCalibrationMapping({ x: 0.5, y: 0.2 }, settings)).toEqual({ x: 0, y: 0 });
    expect(applyCalibrationMapping({ x: 0.9, y: 0.6 }, settings)).toEqual({ x: 1, y: 1 });
  });

  it('steadies harder at high smoothing and reacts harder at high responsiveness', () => {
    const steady = pointerFilterParams({ smoothing: 1, responsiveness: 0 });
    const loose = pointerFilterParams({ smoothing: 0, responsiveness: 1 });
    expect(steady.minCutoff).toBeLessThan(loose.minCutoff);
    expect(steady.beta).toBeLessThan(loose.beta);
  });
});

describe('guided calibration', () => {
  it('derives an active area from a sweep, trimming stray samples and insetting the edges', () => {
    const samples: { x: number; y: number }[] = [];
    for (let i = 0; i <= 10; i += 1) {
      for (let j = 0; j <= 10; j += 1) {
        samples.push({ x: 0.4 + (0.5 * i) / 10, y: 0.2 + (0.5 * j) / 10 });
      }
    }
    samples.push({ x: 0.02, y: 0.98 });

    const bounds = computeWorkspaceBounds(samples);
    expect(bounds).not.toBeNull();
    expect(bounds!.minX).toBeGreaterThan(0.4);
    expect(bounds!.minX).toBeLessThan(0.47);
    expect(bounds!.maxX).toBeLessThan(0.9);
    expect(bounds!.maxX).toBeGreaterThan(0.83);
    expect(bounds!.minY).toBeGreaterThan(0.2);
    expect(bounds!.maxY).toBeLessThan(0.7);
  });

  it('rejects a sweep that is too small or too short', () => {
    const tiny = Array.from({ length: 50 }, (_, i) => ({ x: 0.5 + (i % 5) * 0.01, y: 0.5 }));
    expect(computeWorkspaceBounds(tiny)).toBeNull();
    expect(computeWorkspaceBounds([{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.9 }])).toBeNull();
  });

  it('sets the pinch threshold between the resting pose and a firm pinch', () => {
    const open = [0.62, 0.58, 0.6, 0.61, 0.59];
    const closed = [0.12, 0.15, 0.14, 0.13, 0.9];

    const threshold = computePinchRatioThreshold(open, closed);
    expect(threshold).not.toBeNull();
    expect(threshold!).toBeGreaterThan(0.14);
    expect(threshold! * PINCH_RELEASE_FACTOR).toBeLessThan(0.6);
  });

  it('refuses a pinch calibration when the two poses look alike', () => {
    expect(computePinchRatioThreshold([0.3, 0.31], [0.25, 0.26])).toBeNull();
    expect(computePinchRatioThreshold([], [0.1])).toBeNull();
  });
});

describe('stored calibration', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubStorage(value: unknown): void {
    const store = new Map([['gesturebridge_calibration_settings_v1', JSON.stringify(value)]]);
    vi.stubGlobal('window', {});
    vi.stubGlobal('localStorage', { getItem: (key: string) => store.get(key) ?? null });
  }

  it('drops old-unit fields, floors sensitivity at 1x, and keeps an asymmetric active area', () => {
    stubStorage({
      pinchThreshold: 0.06,
      smoothingAlpha: 0.2,
      deadzoneRadius: 0.005,
      pointerSensitivity: 0.7,
      workspaceBounds: { minX: 0.45, maxX: 0.95, minY: 0.1, maxY: 0.2 },
    });

    const settings = loadCalibrationSettings();
    expect(settings.pinchRatio).toBe(DEFAULT_CALIBRATION_SETTINGS.pinchRatio);
    expect(settings.smoothing).toBe(DEFAULT_CALIBRATION_SETTINGS.smoothing);
    expect(settings.trackingPoint).toBe('palm');
    expect(settings.pointerSensitivity).toBe(1);
    expect(settings.workspaceBounds).toEqual({ minX: 0.45, maxX: 0.95, minY: 0.1, maxY: 0.9 });
  });
});

describe('gesture profiles validation', () => {
  it('validates default preset profiles without warnings', () => {
    for (const profile of Object.values(PRESET_PROFILES)) {
      const { isValid, warnings } = validateProfileMappings(profile.mappings);
      expect(isValid).toBe(true);
      expect(warnings).toHaveLength(0);
    }
  });

  it('detects missing pointer movement mapping', () => {
    const broken = {
      0: 'none' as const,
      1: 'scroll_down' as const,
    };
    const { isValid, warnings } = validateProfileMappings(broken);
    expect(isValid).toBe(false);
    expect(warnings.some((w) => w.includes('Move Cursor'))).toBe(true);
  });

  it('detects duplicate pointer move mappings', () => {
    const duplicate = {
      0: 'pointer_move' as const,
      1: 'pointer_move' as const,
    };
    const { isValid, warnings } = validateProfileMappings(duplicate);
    expect(isValid).toBe(false);
    expect(warnings.some((w) => w.includes('Multiple gestures'))).toBe(true);
  });
});
