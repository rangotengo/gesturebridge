export interface WorkspaceBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface CalibrationSettings {
  dominantHand: 'Right' | 'Left' | 'Auto';
  pointerSensitivity: number; // 0.5 - 3.0, default 1.2
  smoothingAlpha: number; // 0.05 - 0.6, default 0.2
  pinchThreshold: number; // 0.02 - 0.15, default 0.06
  deadzoneRadius: number; // 0.0 - 0.05, default 0.005
  workspaceBounds: WorkspaceBounds;
}

export const DEFAULT_CALIBRATION_SETTINGS: CalibrationSettings = {
  dominantHand: 'Right',
  pointerSensitivity: 1.2,
  smoothingAlpha: 0.2,
  pinchThreshold: 0.06,
  deadzoneRadius: 0.005,
  workspaceBounds: {
    minX: 0.1,
    maxX: 0.9,
    minY: 0.1,
    maxY: 0.9,
  },
};

const STORAGE_KEY = 'gesturebridge_calibration_settings_v1';

export function loadCalibrationSettings(): CalibrationSettings {
  if (typeof window === 'undefined') return { ...DEFAULT_CALIBRATION_SETTINGS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CALIBRATION_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<CalibrationSettings>;
    return {
      dominantHand: parsed.dominantHand === 'Left' || parsed.dominantHand === 'Auto' ? parsed.dominantHand : 'Right',
      pointerSensitivity:
        typeof parsed.pointerSensitivity === 'number' && Number.isFinite(parsed.pointerSensitivity)
          ? Math.min(3.0, Math.max(0.5, parsed.pointerSensitivity))
          : DEFAULT_CALIBRATION_SETTINGS.pointerSensitivity,
      smoothingAlpha:
        typeof parsed.smoothingAlpha === 'number' && Number.isFinite(parsed.smoothingAlpha)
          ? Math.min(0.6, Math.max(0.05, parsed.smoothingAlpha))
          : DEFAULT_CALIBRATION_SETTINGS.smoothingAlpha,
      pinchThreshold:
        typeof parsed.pinchThreshold === 'number' && Number.isFinite(parsed.pinchThreshold)
          ? Math.min(0.15, Math.max(0.02, parsed.pinchThreshold))
          : DEFAULT_CALIBRATION_SETTINGS.pinchThreshold,
      deadzoneRadius:
        typeof parsed.deadzoneRadius === 'number' && Number.isFinite(parsed.deadzoneRadius)
          ? Math.min(0.05, Math.max(0.0, parsed.deadzoneRadius))
          : DEFAULT_CALIBRATION_SETTINGS.deadzoneRadius,
      workspaceBounds: {
        minX:
          typeof parsed.workspaceBounds?.minX === 'number'
            ? Math.max(0.0, Math.min(0.4, parsed.workspaceBounds.minX))
            : DEFAULT_CALIBRATION_SETTINGS.workspaceBounds.minX,
        maxX:
          typeof parsed.workspaceBounds?.maxX === 'number'
            ? Math.max(0.6, Math.min(1.0, parsed.workspaceBounds.maxX))
            : DEFAULT_CALIBRATION_SETTINGS.workspaceBounds.maxX,
        minY:
          typeof parsed.workspaceBounds?.minY === 'number'
            ? Math.max(0.0, Math.min(0.4, parsed.workspaceBounds.minY))
            : DEFAULT_CALIBRATION_SETTINGS.workspaceBounds.minY,
        maxY:
          typeof parsed.workspaceBounds?.maxY === 'number'
            ? Math.max(0.6, Math.min(1.0, parsed.workspaceBounds.maxY))
            : DEFAULT_CALIBRATION_SETTINGS.workspaceBounds.maxY,
      },
    };
  } catch {
    return { ...DEFAULT_CALIBRATION_SETTINGS };
  }
}

export function saveCalibrationSettings(settings: CalibrationSettings): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    window.dispatchEvent(new CustomEvent('gesturebridge:calibration-updated', { detail: settings }));
  } catch (err) {
    console.error('Failed to save calibration settings:', err);
  }
}

export function resetCalibrationSettings(): CalibrationSettings {
  saveCalibrationSettings(DEFAULT_CALIBRATION_SETTINGS);
  return { ...DEFAULT_CALIBRATION_SETTINGS };
}

/**
 * Apply workspace bounding box mapping and sensitivity scaling to raw normalized coordinate.
 */
export function applyCalibrationMapping(
  normalizedPoint: { x: number; y: number },
  settings: CalibrationSettings
): { x: number; y: number } {
  const { workspaceBounds, pointerSensitivity } = settings;
  const rangeX = Math.max(0.1, workspaceBounds.maxX - workspaceBounds.minX);
  const rangeY = Math.max(0.1, workspaceBounds.maxY - workspaceBounds.minY);

  // Normalize into calibrated box
  const clampedX = Math.min(workspaceBounds.maxX, Math.max(workspaceBounds.minX, normalizedPoint.x));
  const clampedY = Math.min(workspaceBounds.maxY, Math.max(workspaceBounds.minY, normalizedPoint.y));

  const relX = (clampedX - workspaceBounds.minX) / rangeX;
  const relY = (clampedY - workspaceBounds.minY) / rangeY;

  // Sensitivity scaling around center (0.5, 0.5)
  const centeredX = 0.5 + (relX - 0.5) * pointerSensitivity;
  const centeredY = 0.5 + (relY - 0.5) * pointerSensitivity;

  return {
    x: Math.max(0, Math.min(1, centeredX)),
    y: Math.max(0, Math.min(1, centeredY)),
  };
}
