import { describe, expect, it } from 'vitest';
import { selectDistinctHands, type HandDetection } from '../features/control/handDetections';
import { assignHandRoles } from '../hooks/useHandRoles';

function detection(
  handedness: HandDetection['handedness'],
  x: number,
  score = 0.9,
  scale = 1
): HandDetection {
  const landmarks = Array.from({ length: 21 }, (_, index) => ({
    x: x + ((index % 4) - 1.5) * 0.025 * scale,
    y: 0.6 - Math.floor(index / 4) * 0.035 * scale,
    z: -index * 0.002 * scale,
  }));
  return { handedness, landmarks, score };
}

describe('selectDistinctHands', () => {
  it('removes duplicate Right detections from a one-hand frame, keeping the better estimate', () => {
    const weaker = detection('Right', 0.5, 0.8);
    const stronger = detection('Right', 0.51, 0.98);
    const hands = selectDistinctHands([weaker, stronger]);
    expect(hands).toEqual([{ handedness: 'Right', landmarks: stronger.landmarks }]);
    expect(assignHandRoles(hands.map((hand) => hand.handedness))).toEqual({
      dominantHand: 0, modifierHand: null,
    });
  });

  it.each([0.3, 1, 2])('removes overlapping opposite-label estimates at palm scale %s', (scale) => {
    const stronger = detection('Left', 0.5, 0.95, scale);
    const weaker = detection('Right', 0.5 + 0.008 * scale, 0.8, scale);
    expect(selectDistinctHands([weaker, stronger])).toEqual([
      { handedness: 'Left', landmarks: stronger.landmarks },
    ]);
  });

  it('preserves two nearby real hands and their dominant/modifier roles', () => {
    const left = detection('Left', 0.4);
    const right = detection('Right', 0.5);
    const hands = selectDistinctHands([right, left]);
    expect(hands).toEqual([
      { handedness: 'Left', landmarks: left.landmarks },
      { handedness: 'Right', landmarks: right.landmarks },
    ]);
    expect(assignHandRoles(hands.map((hand) => hand.handedness))).toEqual({
      dominantHand: 1, modifierHand: 0,
    });
  });

  it('keeps the order stable when MediaPipe reverses its results', () => {
    const left = detection('Left', 0.2);
    const right = detection('Right', 0.7);
    expect(selectDistinctHands([right, left])).toEqual(selectDistinctHands([left, right]));
  });

  it('does not mutate input order or landmarks', () => {
    const candidates = [detection('Right', 0.7), detection('Left', 0.2)];
    const snapshot = structuredClone(candidates);
    selectDistinctHands(candidates);
    expect(candidates).toEqual(snapshot);
  });

  it('clears immediately when the hand leaves, without retaining a stale control hand', () => {
    expect(selectDistinctHands([detection('Right', 0.5)])).toHaveLength(1);
    expect(selectDistinctHands([])).toEqual([]);
  });

  it('rejects incomplete or non-finite detections', () => {
    const incomplete = { ...detection('Left', 0.2), landmarks: [] };
    const invalid = detection('Right', 0.7);
    invalid.landmarks[9].x = Number.NaN;
    expect(selectDistinctHands([incomplete, invalid])).toEqual([]);
  });
});
