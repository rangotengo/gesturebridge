import type { Landmark } from '@/ml/gestureUtils';
import type { TrackingPoint } from '@/lib/calibration';

export interface NormalizedPointerPosition {
  /** Camera feed is mirrored, so X is normalized in rendered screen space. */
  x: number;
  y: number;
}

export interface Size2D {
  width: number;
  height: number;
}

export interface ScreenSpace extends Size2D {
  /** Virtual desktop origin. Negative when a display sits left or above the primary. */
  x?: number;
  y?: number;
}

/**
 * MediaPipe Hand landmark 8 is the index fingertip; X is mirrored to match the
 * CSS-mirrored camera feed.
 */
export function getMirroredIndexTipPosition(
  landmarks: readonly Landmark[]
): NormalizedPointerPosition | null {
  const fingertip = landmarks[8];
  if (!fingertip || !Number.isFinite(fingertip.x) || !Number.isFinite(fingertip.y)) {
    return null;
  }

  return {
    x: 1 - fingertip.x,
    y: fingertip.y,
  };
}

/** Index, middle, ring, and pinky knuckles (MCP joints). */
const PALM_KNUCKLES = [5, 9, 13, 17] as const;

/**
 * The knuckle line stays put while fingers curl, so pinching or switching
 * gestures does not drag the cursor. The fingertip follows finer finger
 * motion but jumps whenever the index finger bends.
 */
export function getMirroredTrackingPoint(
  landmarks: readonly Landmark[],
  trackingPoint: TrackingPoint
): NormalizedPointerPosition | null {
  if (trackingPoint === 'fingertip') return getMirroredIndexTipPosition(landmarks);

  let sumX = 0;
  let sumY = 0;
  for (const index of PALM_KNUCKLES) {
    const knuckle = landmarks[index];
    if (!knuckle || !Number.isFinite(knuckle.x) || !Number.isFinite(knuckle.y)) return null;
    sumX += knuckle.x;
    sumY += knuckle.y;
  }

  return {
    x: 1 - sumX / PALM_KNUCKLES.length,
    y: sumY / PALM_KNUCKLES.length,
  };
}

/**
 * Map a raw MediaPipe landmark into normalized viewport coordinates (0..1)
 * for overlays drawn on top of a CSS-mirrored `object-cover` video.
 *
 * object-cover crops the video to fill the viewport, so landmark → screen is
 * not a simple (1-x, y) scale — off-center points need the cover scale/offset.
 */
export function mapRawLandmarkToMirroredCoverViewport(
  landmark: { x: number; y: number },
  videoSize: Size2D,
  viewportSize: Size2D
): NormalizedPointerPosition | null {
  if (
    !Number.isFinite(landmark.x) ||
    !Number.isFinite(landmark.y) ||
    videoSize.width <= 0 ||
    videoSize.height <= 0 ||
    viewportSize.width <= 0 ||
    viewportSize.height <= 0
  ) {
    return null;
  }

  const scale = Math.max(
    viewportSize.width / videoSize.width,
    viewportSize.height / videoSize.height
  );
  const displayedWidth = videoSize.width * scale;
  const displayedHeight = videoSize.height * scale;
  const offsetX = (viewportSize.width - displayedWidth) / 2;
  const offsetY = (viewportSize.height - displayedHeight) / 2;

  const mirroredX = 1 - landmark.x;
  const pixelX = mirroredX * displayedWidth + offsetX;
  const pixelY = landmark.y * displayedHeight + offsetY;

  return {
    x: pixelX / viewportSize.width,
    y: pixelY / viewportSize.height,
  };
}

export function mapPointerToScreen(
  pointer: NormalizedPointerPosition,
  screenSize: ScreenSpace
): { x: number; y: number } {
  const originX = screenSize.x ?? 0;
  const originY = screenSize.y ?? 0;
  return {
    x: originX + pointer.x * screenSize.width,
    y: originY + pointer.y * screenSize.height,
  };
}

export interface PointerFilterParams {
  /** Hz. Cutoff while the hand is still; lower is steadier but lags more. */
  minCutoff: number;
  /** Extra cutoff per unit of speed (normalized screens per second). */
  beta: number;
  /** Hz. Cutoff for the speed estimate itself. */
  derivativeCutoff: number;
}

export interface PointerFilterState {
  x: number;
  y: number;
  /** Filtered velocity in normalized units per second. */
  dx: number;
  dy: number;
  t: number;
}

/** Samples closer than this are treated as duplicates of the same camera frame. */
const MIN_FILTER_STEP_MS = 4;

function smoothingFactor(elapsedSeconds: number, cutoffHz: number): number {
  const tau = 1 / (2 * Math.PI * Math.max(cutoffHz, 1e-3));
  return 1 / (1 + tau / elapsedSeconds);
}

/**
 * One Euro filter (Casiez et al., CHI 2012) over a 2D point.
 * A still hand gets a low cutoff, which removes landmark jitter. A fast hand
 * raises the cutoff, so the cursor keeps up without the lag a fixed EMA adds.
 * Both axes share one cutoff from the 2D speed so diagonal moves do not bend.
 */
export function filterPointer(
  previous: PointerFilterState | null,
  sample: NormalizedPointerPosition,
  now: number,
  params: PointerFilterParams
): PointerFilterState {
  if (!Number.isFinite(sample.x) || !Number.isFinite(sample.y)) {
    return previous ? { ...previous } : { x: 0.5, y: 0.5, dx: 0, dy: 0, t: now };
  }
  if (!previous) {
    return { x: sample.x, y: sample.y, dx: 0, dy: 0, t: now };
  }

  const elapsedMs = now - previous.t;
  if (elapsedMs < MIN_FILTER_STEP_MS) return { ...previous };
  const elapsed = elapsedMs / 1000;

  const derivativeAlpha = smoothingFactor(elapsed, params.derivativeCutoff);
  const rawDx = (sample.x - previous.x) / elapsed;
  const rawDy = (sample.y - previous.y) / elapsed;
  const dx = previous.dx + derivativeAlpha * (rawDx - previous.dx);
  const dy = previous.dy + derivativeAlpha * (rawDy - previous.dy);

  const cutoff = params.minCutoff + params.beta * Math.hypot(dx, dy);
  const alpha = smoothingFactor(elapsed, cutoff);

  return {
    x: previous.x + alpha * (sample.x - previous.x),
    y: previous.y + alpha * (sample.y - previous.y),
    dx,
    dy,
    t: now,
  };
}
