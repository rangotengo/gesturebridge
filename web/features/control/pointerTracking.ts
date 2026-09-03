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
  screenSize: Size2D
): { x: number; y: number } {
  return {
    x: pointer.x * screenSize.width,
    y: pointer.y * screenSize.height,
  };
}
