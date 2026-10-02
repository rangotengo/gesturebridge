import { describe, expect, it } from 'vitest';
import {
  createMouseControlState,
  stepMouseControl,
  type MouseCommand,
  type MouseControlInput,
  type MouseControlState,
} from '../features/control/mouseActions';

const screen = { x: 0, y: 0, width: 1_000, height: 1_000 };

function tick(
  state: MouseControlState,
  overrides: Partial<MouseControlInput> = {}
): { state: MouseControlState; commands: MouseCommand[] } {
  return stepMouseControl(state, {
    now: 1_000,
    enabled: true,
    tracking: true,
    externallyFrozen: false,
    movementEnabled: true,
    pinching: false,
    gestureAction: 'pointer_move',
    pointer: { x: 0.5, y: 0.5 },
    screen,
    smoothingAlpha: 0.5,
    deadzoneRadius: 0.005,
    ...overrides,
  });
}

function types(commands: MouseCommand[]): string[] {
  return commands.map((command) => command.type);
}

describe('mouse control', () => {
  it('moves the pointer from the index fingertip and keeps a virtual-desktop origin', () => {
    const first = tick(createMouseControlState(), {
      pointer: { x: 0.25, y: 0.5 },
      screen: { x: -1_000, y: 0, width: 2_000, height: 1_000 },
    });

    expect(first.commands).toEqual([{ type: 'move', x: -500, y: 500 }]);
  });

  it('holds the cursor inside the tremor deadzone and then eases past it', () => {
    const start = tick(createMouseControlState(), {
      now: 1_000,
      pointer: { x: 0.5, y: 0.5 },
      deadzoneRadius: 0.01,
      smoothingAlpha: 0.5,
    });
    const held = tick(start.state, {
      now: 1_020,
      pointer: { x: 0.505, y: 0.5 },
      deadzoneRadius: 0.01,
      smoothingAlpha: 0.5,
    });
    const eased = tick(held.state, {
      now: 1_040,
      pointer: { x: 0.52, y: 0.5 },
      deadzoneRadius: 0.01,
      smoothingAlpha: 0.5,
    });

    expect(start.commands).toEqual([{ type: 'move', x: 500, y: 500 }]);
    expect(held.commands).toEqual([{ type: 'move', x: 500, y: 500 }]);
    expect(eased.commands).toEqual([{ type: 'move', x: 510, y: 500 }]);
  });

  it('clicks once when a short pinch is released and does not chase the fingertip', () => {
    const pinched = tick(createMouseControlState(), {
      now: 1_000,
      pinching: true,
      pointer: { x: 0.2, y: 0.2 },
    });
    const stillPinched = tick(pinched.state, {
      now: 1_080,
      pinching: true,
      pointer: { x: 0.9, y: 0.9 },
    });
    const released = tick(stillPinched.state, {
      now: 1_120,
      pinching: false,
      pointer: { x: 0.9, y: 0.9 },
    });
    const pointingAgain = tick(released.state, {
      now: 1_140,
      pinching: false,
      pointer: { x: 0.4, y: 0.4 },
    });

    expect(types(pinched.commands)).not.toContain('move');
    expect(types(pinched.commands)).not.toContain('click');
    expect(types(stillPinched.commands)).not.toContain('move');
    expect(released.commands).toEqual([{ type: 'click', button: 'left' }]);
    expect(pointingAgain.commands).toEqual([{ type: 'move', x: 400, y: 400 }]);
  });

  it('ignores a pinch that is too brief to be intentional', () => {
    const pinched = tick(createMouseControlState(), { now: 1_000, pinching: true });
    const released = tick(pinched.state, { now: 1_030, pinching: false });

    expect(released.commands).toEqual([]);
  });

  it('holds the left button for a long pinch and does not also emit a click', () => {
    let state = createMouseControlState();
    state = tick(state, { now: 1_000, pinching: true }).state;
    state = tick(state, { now: 1_080, pinching: true }).state;
    const dragging = tick(state, { now: 1_320, pinching: true, pointer: { x: 0.8, y: 0.2 } });
    const released = tick(dragging.state, { now: 1_400, pinching: false });

    expect(dragging.commands).toEqual([{ type: 'button', button: 'left', action: 'down' }]);
    expect(released.commands).toEqual([{ type: 'button', button: 'left', action: 'up' }]);
  });

  it('fires a gesture click once, at the cursor, without following the click pose', () => {
    const pointing = tick(createMouseControlState(), {
      now: 1_000,
      pointer: { x: 0.25, y: 0.25 },
    });
    const clicked = tick(pointing.state, {
      now: 1_020,
      gestureAction: 'left_click',
      pointer: { x: 0.9, y: 0.1 },
    });
    const held = tick(clicked.state, {
      now: 1_040,
      gestureAction: 'left_click',
      pointer: { x: 0.95, y: 0.05 },
    });
    const moved = tick(held.state, {
      now: 1_100,
      gestureAction: 'pointer_move',
      pointer: { x: 0.3, y: 0.3 },
    });
    const tooSoon = tick(moved.state, {
      now: 1_200,
      gestureAction: 'right_click',
    });
    const released = tick(tooSoon.state, {
      now: 1_520,
      gestureAction: 'pointer_move',
      pointer: { x: 0.3, y: 0.3 },
    });
    const again = tick(released.state, {
      now: 1_540,
      gestureAction: 'right_click',
    });

    expect(clicked.commands).toEqual([{ type: 'click', button: 'left' }]);
    expect(held.commands).toEqual([]);
    expect(moved.commands).toEqual([{ type: 'move', x: 300, y: 300 }]);
    expect(tooSoon.commands).toEqual([]);
    expect(again.commands).toEqual([{ type: 'click', button: 'right' }]);
  });

  it('keeps the pointer still while frozen and still accepts a click', () => {
    const frozenGesture = tick(createMouseControlState(), {
      gestureAction: 'freeze_cursor',
      pointer: { x: 0.1, y: 0.1 },
    });
    const frozenHand = tick(createMouseControlState(), {
      now: 2_000,
      externallyFrozen: true,
      gestureAction: 'middle_click',
      pointer: { x: 0.2, y: 0.2 },
    });

    expect(frozenGesture.commands).toEqual([]);
    expect(frozenHand.commands).toEqual([{ type: 'click', button: 'middle' }]);
  });

  it('presses and releases drag-hold without a separate click', () => {
    const down = tick(createMouseControlState(), { gestureAction: 'drag_hold' });
    const held = tick(down.state, { now: 1_100, gestureAction: 'drag_hold' });
    const up = tick(held.state, { now: 1_200, gestureAction: 'pointer_move', pointer: { x: 0.6, y: 0.4 } });

    expect(down.commands).toEqual([{ type: 'button', button: 'left', action: 'down' }]);
    expect(held.commands).toEqual([]);
    expect(up.commands).toEqual([
      { type: 'button', button: 'left', action: 'up' },
      { type: 'move', x: 600, y: 400 },
    ]);
  });

  it('repeats scroll on the scroll interval and does not move', () => {
    const first = tick(createMouseControlState(), { gestureAction: 'scroll_up' });
    const early = tick(first.state, { now: 1_100, gestureAction: 'scroll_up' });
    const next = tick(early.state, { now: 1_120, gestureAction: 'scroll_down' });

    expect(first.commands).toEqual([{ type: 'scroll', direction: 'up' }]);
    expect(early.commands).toEqual([]);
    expect(next.commands).toEqual([{ type: 'scroll', direction: 'down' }]);
  });

  it('releases a held button when mouse mode turns off or the hand leaves', () => {
    const dragging = tick(createMouseControlState(), { now: 1_000, pinching: true });
    const armed = tick(dragging.state, { now: 1_080, pinching: true });
    const held = tick(armed.state, { now: 1_400, pinching: true });
    const lost = tick(held.state, { now: 1_420, tracking: false, pointer: null, pinching: false });
    const stopped = tick(held.state, { now: 1_420, enabled: false });

    expect(held.commands).toEqual([{ type: 'button', button: 'left', action: 'down' }]);
    expect(lost.commands).toEqual([{ type: 'button', button: 'left', action: 'up' }]);
    expect(stopped.commands).toEqual([{ type: 'button', button: 'left', action: 'up' }]);
    expect(stopped.state.leftDown).toBe(false);
  });
});
