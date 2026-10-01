import { Landmark } from '@/ml/gestureUtils';
import { PINCH_THRESHOLD } from '@/lib/gestureConfig';

/**
 * Returns Euclidean distance between thumb tip (landmark 4) and index tip (landmark 8),
 * or null if landmarks are missing.
 */
export function getPinchDistance(landmarks: readonly Landmark[]): number | null {
  if (!landmarks || landmarks.length <= 8) return null;

  const thumbTip = landmarks[4];
  const indexTip = landmarks[8];

  if (!thumbTip || !indexTip) return null;

  const dx = thumbTip.x - indexTip.x;
  const dy = thumbTip.y - indexTip.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Geometric pinch detection between thumb tip (landmark 4) and index tip (landmark 8).
 * Returns true if the Euclidean distance between them is less than threshold.
 */
export function isPinching(landmarks: Landmark[], threshold = PINCH_THRESHOLD): boolean {
  const distance = getPinchDistance(landmarks);
  if (distance === null) return false;
  return distance < threshold;
}
