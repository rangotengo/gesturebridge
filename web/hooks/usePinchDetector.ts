import { Landmark } from '@/ml/gestureUtils';
import { PINCH_THRESHOLD } from '@/lib/gestureConfig';

/**
 * Geometric pinch detection between thumb tip (landmark 4) and index tip (landmark 8).
 * Returns true if the Euclidean distance between them is less than PINCH_THRESHOLD.
 */
export function isPinching(landmarks: Landmark[]): boolean {
  if (!landmarks || landmarks.length <= 8) return false;

  const thumbTip = landmarks[4];
  const indexTip = landmarks[8];

  if (!thumbTip || !indexTip) return false;

  const dx = thumbTip.x - indexTip.x;
  const dy = thumbTip.y - indexTip.y;
  const distance = Math.sqrt(dx * dx + dy * dy);

  return distance < PINCH_THRESHOLD;
}
