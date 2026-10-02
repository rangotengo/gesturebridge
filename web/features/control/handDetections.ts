import type { HandData, Landmark } from '../../ml/gestureUtils';

export interface HandDetection extends HandData {
  /** MediaPipe's handedness confidence, before gesture classification. */
  score: number;
}

const PALM_INDICES = [0, 5, 9, 13, 17];

function distance(a: Landmark, b: Landmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function palmSize(landmarks: Landmark[]): number {
  return Math.max(distance(landmarks[0], landmarks[9]), distance(landmarks[5], landmarks[17]));
}

function overlapsSameHand(a: HandDetection, b: HandDetection): boolean {
  // Compare palm anchors rather than fingertips, which move as a pose changes.
  // Scale with the palm so near and far camera positions use the same tolerance.
  const scale = (palmSize(a.landmarks) + palmSize(b.landmarks)) / 2;
  if (scale <= 0) return false;
  const palmDistance = PALM_INDICES.reduce(
    (sum, index) => sum + distance(a.landmarks[index], b.landmarks[index]),
    0
  ) / PALM_INDICES.length;
  return distance(a.landmarks[0], b.landmarks[0]) < scale * 0.5 && palmDistance < scale * 0.35;
}

/**
 * Keep one reliable detection per physical hand and handedness slot.
 * MediaPipe can briefly return two estimates of one palm (even with opposite
 * labels). Same-label estimates cannot form distinct dominant/modifier roles.
 */
export function selectDistinctHands(detections: HandDetection[]): HandData[] {
  const ranked = detections.filter((detection) => (
    Number.isFinite(detection.score) &&
    detection.landmarks.length === 21 &&
    detection.landmarks.every((point) => (
      Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z)
    ))
  )).sort((a, b) => b.score - a.score);
  const selected: HandDetection[] = [];

  for (const detection of ranked) {
    if (selected.some((existing) => (
      existing.handedness === detection.handedness || overlapsSameHand(existing, detection)
    ))) continue;
    selected.push(detection);
  }

  // Detector result order can swap between frames. Keep card and control order stable.
  return selected.sort((a, b) => a.handedness.localeCompare(b.handedness))
    .map(({ handedness, landmarks }) => ({ handedness, landmarks }));
}
