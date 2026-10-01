import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CALIBRATION_SETTINGS,
  applyCalibrationMapping,
} from '../lib/calibration';
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
