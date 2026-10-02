import { describe, expect, it } from 'vitest';
import { getPinchRatio } from '../hooks/usePinchDetector';
import type { Landmark } from '../ml/gestureUtils';

const WIDTH = 1_280;
const HEIGHT = 720;

/** Builds landmarks from pixel positions, normalized the way MediaPipe does. */
function handFromPixels(points: Record<number, [number, number]>): Landmark[] {
  return Array.from({ length: 21 }, (_, index) => {
    const [px, py] = points[index] ?? [640, 360];
    return { x: px / WIDTH, y: py / HEIGHT, z: 0 };
  });
}

describe('pinch ratio', () => {
  it('divides the thumb–index gap by palm length', () => {
    const hand = handFromPixels({
      0: [600, 500],
      9: [600, 300],
      4: [700, 200],
      8: [750, 200],
    });

    expect(getPinchRatio(hand, WIDTH / HEIGHT)).toBeCloseTo(50 / 200, 6);
  });

  it('gives the same ratio when the hand moves farther from the camera', () => {
    const near = handFromPixels({ 0: [600, 600], 9: [600, 300], 4: [700, 200], 8: [760, 200] });
    const far = handFromPixels({ 0: [620, 450], 9: [620, 300], 4: [670, 250], 8: [700, 250] });

    expect(getPinchRatio(far, WIDTH / HEIGHT)).toBeCloseTo(getPinchRatio(near, WIDTH / HEIGHT)!, 6);
  });

  it('measures horizontal and vertical gaps alike once the frame aspect is applied', () => {
    const horizontalGap = handFromPixels({ 0: [600, 500], 9: [600, 300], 4: [700, 200], 8: [760, 200] });
    const verticalGap = handFromPixels({ 0: [600, 500], 9: [600, 300], 4: [700, 200], 8: [700, 260] });

    expect(getPinchRatio(horizontalGap, WIDTH / HEIGHT)).toBeCloseTo(0.3, 6);
    expect(getPinchRatio(verticalGap, WIDTH / HEIGHT)).toBeCloseTo(0.3, 6);
  });

  it('returns null when landmarks are missing or the palm collapses to a point', () => {
    expect(getPinchRatio([])).toBeNull();
    const collapsed = handFromPixels({ 0: [600, 300], 9: [600, 300] });
    expect(getPinchRatio(collapsed, WIDTH / HEIGHT)).toBeNull();
  });
});
