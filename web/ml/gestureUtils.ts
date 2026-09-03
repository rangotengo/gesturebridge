export interface Landmark {
  x: number;
  y: number;
  z: number;
}

/** Which hand MediaPipe detected (from the user's perspective, already mirror-corrected) */
export type Handedness = 'Left' | 'Right';

/** Single hand with its landmarks and classification */
export interface HandData {
  landmarks: Landmark[];
  handedness: Handedness;
}

/** Prediction result tagged with which hand it came from */
export interface HandPrediction {
  hand: Handedness;
  gesture: string;
  confidence: number;
}

/**
 * Normalize 21 MediaPipe hand landmarks → flat array of 63 numbers in [-1, 1].
 * 1. Subtracts wrist (landmark 0) to make it origin-relative.
 * 2. Divides by the maximum absolute coordinate value for scale invariance.
 */
export function normalizeLandmarks(landmarks: Landmark[]): number[] {
  if (!landmarks || landmarks.length !== 21) return new Array(63).fill(0) as number[];

  const wrist = landmarks[0];

  const relative = landmarks.map((lm) => ({
    x: lm.x - wrist.x,
    y: lm.y - wrist.y,
    z: lm.z - wrist.z,
  }));

  const flat = relative.flatMap((lm) => [lm.x, lm.y, lm.z]);
  const maxVal = Math.max(...flat.map(Math.abs));

  return flat.map((v) => v / (maxVal + 1e-7));
}

/**
 * Rule-based finger state detection using landmark y-axis comparison.
 * y increases downward; tip.y < pip.y means finger is UP.
 */
export function getFingerStates(landmarks: Landmark[]) {
  return {
    index: landmarks[8].y < landmarks[6].y,
    middle: landmarks[12].y < landmarks[10].y,
    ring: landmarks[16].y < landmarks[14].y,
    pinky: landmarks[20].y < landmarks[18].y,
    thumb:
      Math.abs(landmarks[4].x - landmarks[2].x) >
      Math.abs(landmarks[3].x - landmarks[2].x),
  };
}

/**
 * Classify a gesture purely from MediaPipe landmarks using rule-based logic.
 * Returns null if no known gesture matches.
 */
export function detectGestureByRules(landmarks: Landmark[]): string | null {
  const f = getFingerStates(landmarks);
  if (f.index && !f.middle && !f.ring && !f.pinky) return 'Pointing';
  if (!f.index && !f.middle && !f.ring && !f.pinky) return 'Fist';
  if (f.index && f.middle && !f.ring && !f.pinky) return 'Peace';
  if (f.index && f.middle && f.ring && f.pinky) return 'Open Palm';
  if (!f.index && !f.middle && !f.ring && f.pinky) return 'Pinky-Thumb';
  return null;
}
