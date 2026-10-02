import type { Landmark } from '@/ml/gestureUtils';

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

/** 3D distance in frame-height units. MediaPipe z shares x's scale. */
function landmarkDistance(a: Landmark, b: Landmark, aspect: number): number {
  const dx = (a.x - b.x) * aspect;
  const dy = a.y - b.y;
  const dz = (finiteOrZero(a.z) - finiteOrZero(b.z)) * aspect;
  return Math.hypot(dx, dy, dz);
}

/**
 * Thumb tip (4) to index tip (8) gap divided by palm length, wrist (0) to
 * middle knuckle (9). Dividing by the hand's own size keeps one threshold
 * valid near and far from the camera. `aspect` is video width / height,
 * because MediaPipe normalizes x by width and y by height.
 */
export function getPinchRatio(landmarks: readonly Landmark[], aspect = 16 / 9): number | null {
  const wrist = landmarks[0];
  const thumbTip = landmarks[4];
  const indexTip = landmarks[8];
  const middleKnuckle = landmarks[9];
  if (!wrist || !thumbTip || !indexTip || !middleKnuckle) return null;

  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
  const gap = landmarkDistance(thumbTip, indexTip, safeAspect);
  const palm = landmarkDistance(wrist, middleKnuckle, safeAspect);
  if (!Number.isFinite(gap) || !Number.isFinite(palm) || palm < 1e-4) return null;
  return gap / palm;
}
