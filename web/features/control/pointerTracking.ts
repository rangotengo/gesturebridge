import type { Landmark } from '@/ml/gestureUtils';

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
 * Shared point-to-screen mapping for OS cursor control.
 * MediaPipe Hand landmark 8 is the index fingertip; X is mirrored to match the
 * CSS-mirrored camera feed. Hand-update filtering stays owned by useMediaPipe.
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

/**
 * One-euro-free exponential smoothing with a tremor deadzone.
 * Distance is measured from the last emitted point, so a slow drift still
 * breaks out of the deadzone once the accumulated travel exceeds it.
 * Higher `smoothingAlpha` follows the hand more closely.
 */
export function smoothPointer(
  next: NormalizedPointerPosition,
  previous: NormalizedPointerPosition | null,
  smoothingAlpha: number,
  deadzoneRadius: number
): NormalizedPointerPosition {
  if (
    !previous ||
    !Number.isFinite(previous.x) ||
    !Number.isFinite(previous.y) ||
    !Number.isFinite(next.x) ||
    !Number.isFinite(next.y)
  ) {
    return { x: next.x, y: next.y };
  }

  const dx = next.x - previous.x;
  const dy = next.y - previous.y;
  if (Math.hypot(dx, dy) < Math.max(0, deadzoneRadius)) {
    return previous;
  }

  const alpha = Math.min(1, Math.max(0, smoothingAlpha));
  return {
    x: previous.x + dx * alpha,
    y: previous.y + dy * alpha,
  };
}
