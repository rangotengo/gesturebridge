import { PINCH_RATIO_THRESHOLD, PINCH_RELEASE_FACTOR } from './gestureConfig';

export interface WorkspaceBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export type TrackingPoint = 'palm' | 'fingertip';

export interface CalibrationSettings {
  dominantHand: 'Right' | 'Left' | 'Auto';
  trackingPoint: TrackingPoint;
  pointerSensitivity: number; // 1.0 - 3.0, default 1.2
  smoothing: number; // 0 - 1, default 0.6; higher holds a still hand steadier
  responsiveness: number; // 0 - 1, default 0.4; higher lags less on fast moves
  pinchRatio: number; // 0.12 - 0.6, default 0.3; thumb–index gap / palm length
  workspaceBounds: WorkspaceBounds;
}

export const SENSITIVITY_RANGE = { min: 1.0, max: 3.0 } as const;
export const PINCH_RATIO_RANGE = { min: 0.12, max: 0.6 } as const;
/** Smallest usable active-area side, as a fraction of the camera frame. */
export const MIN_WORKSPACE_SPAN = 0.15;

export const DEFAULT_CALIBRATION_SETTINGS: CalibrationSettings = {
  dominantHand: 'Right',
  trackingPoint: 'palm',
  pointerSensitivity: 1.2,
  smoothing: 0.6,
  responsiveness: 0.4,
  pinchRatio: PINCH_RATIO_THRESHOLD,
  workspaceBounds: {
    minX: 0.1,
    maxX: 0.9,
    minY: 0.1,
    maxY: 0.9,
  },
};

const STORAGE_KEY = 'gesturebridge_calibration_settings_v1';

function readNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function readAxis(
  min: unknown,
  max: unknown,
  fallback: { min: number; max: number }
): { min: number; max: number } {
  if (typeof min !== 'number' || typeof max !== 'number') return fallback;
  if (!Number.isFinite(min) || !Number.isFinite(max)) return fallback;
  if (min < 0 || max > 1 || max - min < MIN_WORKSPACE_SPAN) return fallback;
  return { min, max };
}

function readWorkspaceBounds(value: unknown): WorkspaceBounds {
  const defaults = DEFAULT_CALIBRATION_SETTINGS.workspaceBounds;
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Partial<WorkspaceBounds>;
  const x = readAxis(raw.minX, raw.maxX, { min: defaults.minX, max: defaults.maxX });
  const y = readAxis(raw.minY, raw.maxY, { min: defaults.minY, max: defaults.maxY });
  return { minX: x.min, maxX: x.max, minY: y.min, maxY: y.max };
}

export function loadCalibrationSettings(): CalibrationSettings {
  const defaults = DEFAULT_CALIBRATION_SETTINGS;
  if (typeof window === 'undefined') return { ...defaults };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...defaults };
    // Fields from older builds (pinchThreshold, smoothingAlpha, deadzoneRadius)
    // used different units and are dropped in favor of the defaults.
    const parsed = JSON.parse(raw) as Partial<CalibrationSettings>;
    return {
      dominantHand: parsed.dominantHand === 'Left' || parsed.dominantHand === 'Auto' ? parsed.dominantHand : 'Right',
      trackingPoint: parsed.trackingPoint === 'fingertip' ? 'fingertip' : 'palm',
      pointerSensitivity: readNumber(
        parsed.pointerSensitivity,
        SENSITIVITY_RANGE.min,
        SENSITIVITY_RANGE.max,
        defaults.pointerSensitivity
      ),
      smoothing: readNumber(parsed.smoothing, 0, 1, defaults.smoothing),
      responsiveness: readNumber(parsed.responsiveness, 0, 1, defaults.responsiveness),
      pinchRatio: readNumber(parsed.pinchRatio, PINCH_RATIO_RANGE.min, PINCH_RATIO_RANGE.max, defaults.pinchRatio),
      workspaceBounds: readWorkspaceBounds(parsed.workspaceBounds),
    };
  } catch {
    return { ...defaults };
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
  settings: Pick<CalibrationSettings, 'workspaceBounds' | 'pointerSensitivity'>
): { x: number; y: number } {
  const { workspaceBounds, pointerSensitivity } = settings;
  const rangeX = Math.max(MIN_WORKSPACE_SPAN, workspaceBounds.maxX - workspaceBounds.minX);
  const rangeY = Math.max(MIN_WORKSPACE_SPAN, workspaceBounds.maxY - workspaceBounds.minY);

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

const STILL_CUTOFF_HZ = { steadiest: 0.3, loosest: 4 } as const;
const MAX_FILTER_BETA = 25;

/** One Euro filter parameters for the cursor, in normalized screen units. */
export function pointerFilterParams(
  settings: Pick<CalibrationSettings, 'smoothing' | 'responsiveness'>
): { minCutoff: number; beta: number; derivativeCutoff: number } {
  const smoothing = readNumber(settings.smoothing, 0, 1, DEFAULT_CALIBRATION_SETTINGS.smoothing);
  const responsiveness = readNumber(settings.responsiveness, 0, 1, DEFAULT_CALIBRATION_SETTINGS.responsiveness);
  return {
    minCutoff: STILL_CUTOFF_HZ.loosest * Math.pow(STILL_CUTOFF_HZ.steadiest / STILL_CUTOFF_HZ.loosest, smoothing),
    beta: MAX_FILTER_BETA * responsiveness,
    derivativeCutoff: 1,
  };
}

function quantile(sorted: readonly number[], q: number): number {
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

export const MIN_WORKSPACE_SAMPLES = 20;

/**
 * Active area from tracking-point samples swept over the user's comfortable reach.
 * The outer 3% of samples are treated as tracking noise, and each edge moves in
 * by 5% of the span so screen edges are reachable without full extension.
 */
export function computeWorkspaceBounds(
  samples: readonly { x: number; y: number }[]
): WorkspaceBounds | null {
  const finite = samples.filter((s) => Number.isFinite(s.x) && Number.isFinite(s.y));
  if (finite.length < MIN_WORKSPACE_SAMPLES) return null;

  const xs = finite.map((s) => s.x).sort((a, b) => a - b);
  const ys = finite.map((s) => s.y).sort((a, b) => a - b);
  const axis = (sorted: number[]): { min: number; max: number } => {
    const low = quantile(sorted, 0.03);
    const high = quantile(sorted, 0.97);
    const inset = (high - low) * 0.05;
    return {
      min: Math.max(0, low + inset),
      max: Math.min(1, high - inset),
    };
  };

  const x = axis(xs);
  const y = axis(ys);
  if (x.max - x.min < MIN_WORKSPACE_SPAN || y.max - y.min < MIN_WORKSPACE_SPAN) return null;
  return { minX: x.min, maxX: x.max, minY: y.min, maxY: y.max };
}

function median(values: readonly number[]): number | null {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (finite.length === 0) return null;
  return quantile(finite, 0.5);
}

/** Resting and pinched poses closer than this cannot be told apart reliably. */
const MIN_PINCH_CONTRAST = 0.12;

/**
 * Pinch threshold between the user's resting pointing pose and a firm pinch.
 * Medians keep a few mistracked frames from skewing it. The release level
 * (threshold × PINCH_RELEASE_FACTOR) has to stay below the resting pose, or a
 * pinch would never end.
 */
export function computePinchRatioThreshold(
  openRatios: readonly number[],
  closedRatios: readonly number[]
): number | null {
  const open = median(openRatios);
  const closed = median(closedRatios);
  if (open === null || closed === null || open - closed < MIN_PINCH_CONTRAST) return null;

  const span = open - closed;
  const threshold = Math.min(closed + 0.4 * span, (closed + 0.85 * span) / PINCH_RELEASE_FACTOR);
  if (threshold <= closed * 1.1) return null;
  if (threshold < PINCH_RATIO_RANGE.min || threshold > PINCH_RATIO_RANGE.max) return null;
  return threshold;
}
