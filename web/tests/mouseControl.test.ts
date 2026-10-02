import { describe, expect, it } from 'vitest';
import {
  clearHeldButton,
  createMouseControlState,
  stepMouseControl,
  type MouseCommand,
  type MouseControlInput,
  type MouseControlState,
} from '../features/control/mouseActions';

const screen = { x: 0, y: 0, width: 1_000, height: 1_000 };
/** A cutoff this high makes the One Euro filter pass samples straight through. */
const passthrough = { minCutoff: 1e9, beta: 0, derivativeCutoff: 1 };
const OPEN = 0.8;
const PINCHED = 0.1;

type Frame = Partial<MouseControlInput> & { now: number };

function tick(
  state: MouseControlState,
  overrides: Frame
): { state: MouseControlState; commands: MouseCommand[] } {
  return stepMouseControl(state, {
    enabled: true,
    tracking: true,
    externallyFrozen: false,
    movementEnabled: true,
    pinchRatio: OPEN,
    pinchThreshold: 0.3,
    gestureAction: 'pointer_move',
    pointer: { x: 0.5, y: 0.5 },
    screen,
    filter: passthrough,
    ...overrides,
  });
}

/** Runs frames in order and returns each frame's commands with moves rounded to pixels. */
function run(frames: Frame[], start = createMouseControlState()): { state: MouseControlState; commands: MouseCommand[][] } {
  let state = start;
  const commands: MouseCommand[][] = [];
  for (const frame of frames) {
    const step = tick(state, frame);
    state = step.state;
    commands.push(
      step.commands.map((command) =>
        command.type === 'move'
          ? { type: 'move', x: Math.round(command.x), y: Math.round(command.y) }
          : command
      )
    );
  }
  return { state, commands };
}

function at(x: number, y = x): { x: number; y: number } {
  return { x, y };
}

function types(commands: MouseCommand[][]): string[] {
  return commands.flat().map((command) => command.type);
}

describe('mouse control', () => {
  it('moves the pointer to the hand and keeps a virtual-desktop origin', () => {
    const first = tick(createMouseControlState(), {
      now: 1_000,
      pointer: { x: 0.25, y: 0.5 },
      screen: { x: -1_000, y: 0, width: 2_000, height: 1_000 },
    });

    expect(first.commands).toEqual([{ type: 'move', x: -500, y: 500 }]);
  });

  it('skips moves that land on the same pixel', () => {
    const { commands } = run([
      { now: 1_000, pointer: at(0.5) },
      { now: 1_033, pointer: at(0.5002) },
      { now: 1_066, pointer: at(0.52) },
    ]);

    expect(commands).toEqual([
      [{ type: 'move', x: 500, y: 500 }],
      [],
      [{ type: 'move', x: 520, y: 520 }],
    ]);
  });

  it('clicks once on a short pinch, aimed where the cursor was before the fingers closed', () => {
    const { commands } = run([
      { now: 1_000, pointer: at(0.2) },
      { now: 1_033, pointer: at(0.22) },
      { now: 1_066, pointer: at(0.24) },
      { now: 1_100, pointer: at(0.26), pinchRatio: PINCHED },
      { now: 1_166, pointer: at(0.3), pinchRatio: PINCHED },
      { now: 1_200, pointer: at(0.3), pinchRatio: OPEN },
      { now: 1_250, pointer: at(0.4) },
    ]);

    expect(commands[3]).toEqual([]);
    expect(commands[4]).toEqual([{ type: 'move', x: 200, y: 200 }]);
    expect(commands[5]).toEqual([{ type: 'click', button: 'left' }]);
    expect(commands[6]).toEqual([]);
  });

  it('eases back onto the hand after the post-click hold instead of jumping', () => {
    const { state, commands } = run([
      { now: 1_000, pointer: at(0.2) },
      { now: 1_033, pointer: at(0.2), pinchRatio: PINCHED },
      { now: 1_100, pointer: at(0.2), pinchRatio: PINCHED },
      { now: 1_133, pointer: at(0.2), pinchRatio: OPEN },
      { now: 1_400, pointer: at(0.4) },
      { now: 1_433, pointer: at(0.4) },
    ]);

    expect(commands[3]).toEqual([{ type: 'click', button: 'left' }]);
    expect(commands[4]).toEqual([]);
    const glide = commands[5][0];
    expect(glide?.type).toBe('move');
    if (glide?.type === 'move') {
      expect(glide.x).toBeGreaterThan(200);
      expect(glide.x).toBeLessThan(400);
    }

    let settled = state;
    for (let now = 1_466; now <= 2_400; now += 33) {
      settled = tick(settled, { now, pointer: at(0.4) }).state;
    }
    expect(settled.cursor?.x).toBeCloseTo(0.4, 3);
  });

  it('ignores a pinch that is too brief to be intentional', () => {
    const { commands } = run([
      { now: 1_000, pinchRatio: PINCHED },
      { now: 1_030, pinchRatio: OPEN },
    ]);

    expect(types(commands)).not.toContain('click');
  });

  it('keeps one pinch through noise between the start and release thresholds', () => {
    const { commands } = run([
      { now: 1_000, pinchRatio: 0.31 },
      { now: 1_033, pinchRatio: 0.29 },
      { now: 1_100, pinchRatio: 0.38 },
      { now: 1_133, pinchRatio: 0.33 },
      { now: 1_166, pinchRatio: 0.41 },
      { now: 1_200, pinchRatio: 0.45 },
    ]);

    expect(types(commands).filter((type) => type === 'click')).toHaveLength(1);
    expect(commands[5]).toEqual([{ type: 'click', button: 'left' }]);
  });

  it('never starts a pinch from a pose resting just above the threshold', () => {
    const frames = Array.from({ length: 20 }, (_, i) => ({ now: 1_000 + i * 33, pinchRatio: 0.31 }));
    const { commands } = run([...frames, { now: 1_700, pinchRatio: OPEN }]);

    expect(types(commands)).not.toContain('click');
  });

  it('holds the button on a long pinch and drags once the hand clearly moves', () => {
    const { commands } = run([
      { now: 1_000, pointer: at(0.5) },
      { now: 1_033, pointer: at(0.5), pinchRatio: PINCHED },
      { now: 1_100, pointer: at(0.5), pinchRatio: PINCHED },
      { now: 1_400, pointer: at(0.5), pinchRatio: PINCHED },
      { now: 1_433, pointer: at(0.505), pinchRatio: PINCHED },
      { now: 1_466, pointer: at(0.53), pinchRatio: PINCHED },
      { now: 1_500, pointer: at(0.6), pinchRatio: PINCHED },
      { now: 1_533, pointer: at(0.6), pinchRatio: OPEN },
    ]);

    expect(commands[3]).toEqual([{ type: 'button', button: 'left', action: 'down' }]);
    expect(commands[4]).toEqual([]);
    expect(commands[5]).toEqual([]);
    expect(commands[6]).toHaveLength(1);
    expect(commands[6][0].type).toBe('move');
    expect(commands[7]).toEqual([{ type: 'button', button: 'left', action: 'up' }]);
    expect(types(commands)).not.toContain('click');
  });

  it('fires a gesture click only after the pose holds, aimed before the pose formed', () => {
    const { commands } = run([
      { now: 1_000, pointer: at(0.25) },
      { now: 1_033, pointer: at(0.27) },
      { now: 1_066, gestureAction: 'left_click', pointer: at(0.4) },
      { now: 1_120, gestureAction: 'left_click', pointer: at(0.45) },
      { now: 1_160, gestureAction: 'left_click', pointer: at(0.5) },
      { now: 1_200, gestureAction: 'left_click', pointer: at(0.5) },
    ]);

    expect(commands[2]).toEqual([]);
    expect(commands[3]).toEqual([]);
    expect(commands[4]).toEqual([
      { type: 'move', x: 250, y: 250 },
      { type: 'click', button: 'left' },
    ]);
    expect(commands[5]).toEqual([]);
  });

  it('ignores a one-frame misclassification while pointing', () => {
    const { commands } = run([
      { now: 1_000, pointer: at(0.3) },
      { now: 1_033, pointer: at(0.3), gestureAction: 'right_click' },
      { now: 1_066, pointer: at(0.3) },
      { now: 1_200, pointer: at(0.3) },
    ]);

    expect(types(commands)).not.toContain('click');
  });

  it('applies the click cooldown across gestures', () => {
    const { commands } = run([
      { now: 1_000, gestureAction: 'left_click' },
      { now: 1_100, gestureAction: 'left_click' },
      { now: 1_150, gestureAction: 'pointer_move' },
      { now: 1_250, gestureAction: 'pointer_move' },
      { now: 1_260, gestureAction: 'right_click' },
      { now: 1_360, gestureAction: 'right_click' },
      { now: 1_400, gestureAction: 'pointer_move' },
      { now: 1_500, gestureAction: 'pointer_move' },
      { now: 1_510, gestureAction: 'right_click' },
      { now: 1_610, gestureAction: 'right_click' },
    ]);

    const clicks = commands.flat().filter((command) => command.type === 'click');
    expect(clicks).toEqual([
      { type: 'click', button: 'left' },
      { type: 'click', button: 'right' },
    ]);
    expect(commands[9]).toContainEqual({ type: 'click', button: 'right' });
  });

  it('keeps the pointer still while frozen and still accepts a click', () => {
    const frozenGesture = run([
      { now: 1_000, gestureAction: 'freeze_cursor', pointer: at(0.1) },
      { now: 1_100, gestureAction: 'freeze_cursor', pointer: at(0.2) },
    ]);
    const frozenHand = run([
      { now: 2_000, externallyFrozen: true, gestureAction: 'middle_click', pointer: at(0.2) },
      { now: 2_100, externallyFrozen: true, gestureAction: 'middle_click', pointer: at(0.3) },
    ]);

    expect(types(frozenGesture.commands)).toEqual([]);
    expect(frozenHand.commands).toEqual([[], [{ type: 'click', button: 'middle' }]]);
  });

  it('drags with the drag-hold gesture and releases without a click', () => {
    const { commands } = run([
      { now: 1_000, pointer: at(0.5) },
      { now: 1_033, gestureAction: 'drag_hold', pointer: at(0.5) },
      { now: 1_133, gestureAction: 'drag_hold', pointer: at(0.5) },
      { now: 1_166, gestureAction: 'drag_hold', pointer: at(0.6) },
      { now: 1_200, gestureAction: 'drag_hold', pointer: at(0.6) },
      { now: 1_233, gestureAction: 'pointer_move', pointer: at(0.6) },
      { now: 1_333, gestureAction: 'pointer_move', pointer: at(0.6) },
    ]);

    expect(commands[2]).toEqual([{ type: 'button', button: 'left', action: 'down' }]);
    expect(commands[4][0]?.type).toBe('move');
    expect(types([commands[5]])).not.toContain('button');
    expect(commands[6]).toEqual([{ type: 'button', button: 'left', action: 'up' }]);
    expect(types(commands)).not.toContain('click');
  });

  it('repeats scroll on the interval once confirmed and stops as soon as the pose changes', () => {
    const { commands } = run([
      { now: 1_000, gestureAction: 'scroll_up' },
      { now: 1_100, gestureAction: 'scroll_up' },
      { now: 1_200, gestureAction: 'scroll_up' },
      { now: 1_230, gestureAction: 'scroll_up' },
      { now: 1_260, gestureAction: 'scroll_down' },
      { now: 1_360, gestureAction: 'scroll_down' },
    ]);

    expect(commands).toEqual([
      [],
      [{ type: 'scroll', direction: 'up' }],
      [],
      [{ type: 'scroll', direction: 'up' }],
      [],
      [{ type: 'scroll', direction: 'down' }],
    ]);
  });

  it('does not start a pinch while another gesture owns the hand', () => {
    const { commands } = run([
      { now: 1_000, gestureAction: 'scroll_down' },
      { now: 1_100, gestureAction: 'scroll_down' },
      { now: 1_133, gestureAction: 'scroll_down', pinchRatio: PINCHED },
      { now: 1_200, gestureAction: 'scroll_down', pinchRatio: PINCHED },
      { now: 1_300, gestureAction: 'scroll_down', pinchRatio: OPEN },
    ]);

    expect(types(commands)).not.toContain('click');
  });

  it('releases a held button when mouse mode turns off or the hand leaves', () => {
    const { state: held, commands } = run([
      { now: 1_000, pinchRatio: PINCHED },
      { now: 1_080, pinchRatio: PINCHED },
      { now: 1_400, pinchRatio: PINCHED },
    ]);
    const lost = tick(held, { now: 1_420, tracking: false, pointer: null, pinchRatio: null });
    const stopped = tick(held, { now: 1_420, enabled: false });

    expect(commands[2]).toEqual([{ type: 'button', button: 'left', action: 'down' }]);
    expect(lost.commands).toEqual([{ type: 'button', button: 'left', action: 'up' }]);
    expect(stopped.commands).toEqual([{ type: 'button', button: 'left', action: 'up' }]);
    expect(stopped.state.leftDown).toBe(false);
  });

  it('forgets a held button that the desktop released on its own', () => {
    const { state: held } = run([
      { now: 1_000, pinchRatio: PINCHED },
      { now: 1_080, pinchRatio: PINCHED },
      { now: 1_400, pinchRatio: PINCHED },
    ]);
    const cleared = clearHeldButton(held);
    const next = tick(cleared, { now: 1_433, pinchRatio: OPEN });

    expect(cleared.leftDown).toBe(false);
    expect(next.commands).not.toContainEqual({ type: 'button', button: 'left', action: 'up' });
  });
});
