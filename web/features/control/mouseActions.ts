import {
  mapPointerToScreen,
  smoothPointer,
  type ScreenSpace,
} from './pointerTracking';
import {
  CLICK_COOLDOWN_MS,
  PINCH_COOLDOWN_MS,
  SCROLL_INTERVAL_MS,
} from '../../lib/gestureConfig';
import type { GestureActionType } from '../../lib/gestureProfiles';

const MOVE_INTERVAL_MS = 16;
const PINCH_ARM_MS = 50;
const DRAG_HOLD_MS = 300;

export type MouseButtonName = 'left' | 'right' | 'middle';

export type MouseCommand =
  | { type: 'move'; x: number; y: number }
  | { type: 'click'; button: MouseButtonName }
  | { type: 'button'; button: 'left' | 'right'; action: 'down' | 'up' }
  | { type: 'scroll'; direction: 'up' | 'down' }
  | { type: 'zoom'; direction: 'in' | 'out' };

export interface MouseControlState {
  filter: { x: number; y: number } | null;
  moving: boolean;
  lastMoveAt: number;
  lastClickAt: number;
  lastScrollAt: number;
  pinchStartedAt: number | null;
  pinchArmed: boolean;
  pinchDragging: boolean;
  gestureDragging: boolean;
  leftDown: boolean;
  previousAction: GestureActionType | null;
}

export interface MouseControlInput {
  now: number;
  /** Mouse mode is on and the desktop bridge can receive commands. */
  enabled: boolean;
  /** A dominant hand with a usable fingertip is in frame. */
  tracking: boolean;
  externallyFrozen: boolean;
  /** Profile includes a Move Cursor binding. */
  movementEnabled: boolean;
  pinching: boolean;
  gestureAction: GestureActionType | null;
  pointer: { x: number; y: number } | null;
  screen: ScreenSpace;
  smoothingAlpha: number;
  deadzoneRadius: number;
}

export function createMouseControlState(): MouseControlState {
  return {
    filter: null,
    moving: false,
    lastMoveAt: 0,
    lastClickAt: 0,
    lastScrollAt: 0,
    pinchStartedAt: null,
    pinchArmed: false,
    pinchDragging: false,
    gestureDragging: false,
    leftDown: false,
    previousAction: null,
  };
}

function releaseLeftButton(state: MouseControlState, commands: MouseCommand[]): void {
  state.pinchDragging = false;
  state.gestureDragging = false;
  if (!state.leftDown) return;
  state.leftDown = false;
  commands.push({ type: 'button', button: 'left', action: 'up' });
}

function syncLeftButton(state: MouseControlState, commands: MouseCommand[]): void {
  const wantDown = state.pinchDragging || state.gestureDragging;
  if (wantDown === state.leftDown) return;
  state.leftDown = wantDown;
  commands.push({ type: 'button', button: 'left', action: wantDown ? 'down' : 'up' });
}

function clickButton(action: GestureActionType): MouseButtonName | null {
  if (action === 'left_click') return 'left';
  if (action === 'right_click') return 'right';
  if (action === 'middle_click') return 'middle';
  return null;
}

/**
 * One control frame.
 * The cursor tracks only while the active action is pointing (or the gesture is
 * still uncertain). Clicks, pinches, scrolls, and freeze hold the pointer still
 * so the index fingertip cannot drag the cursor off the target.
 * A short pinch clicks on release. A pinch held past the drag threshold holds
 * the left button instead of also clicking.
 */
export function stepMouseControl(
  previous: MouseControlState,
  input: MouseControlInput
): { state: MouseControlState; commands: MouseCommand[] } {
  if (!input.enabled) {
    const commands: MouseCommand[] = [];
    if (previous.leftDown) {
      commands.push({ type: 'button', button: 'left', action: 'up' });
    }
    return { state: createMouseControlState(), commands };
  }

  const state: MouseControlState = {
    ...previous,
    filter: previous.filter ? { ...previous.filter } : null,
  };
  const commands: MouseCommand[] = [];

  if (!input.tracking || !input.pointer) {
    state.pinchStartedAt = null;
    state.pinchArmed = false;
    state.pinchDragging = false;
    state.gestureDragging = false;
    state.moving = false;
    state.filter = null;
    releaseLeftButton(state, commands);
    return { state, commands };
  }

  const wasPinching = state.pinchStartedAt !== null;

  if (input.pinching) {
    if (!wasPinching) {
      state.pinchStartedAt = input.now;
      state.pinchArmed = false;
    } else if (!state.pinchArmed && input.now - state.pinchStartedAt! >= PINCH_ARM_MS) {
      state.pinchArmed = true;
    }
    state.pinchDragging =
      state.pinchArmed && input.now - state.pinchStartedAt! >= DRAG_HOLD_MS;
  } else if (wasPinching) {
    const heldFor = input.now - state.pinchStartedAt!;
    const armed = state.pinchArmed || heldFor >= PINCH_ARM_MS;
    const wasDragging = state.pinchDragging;
    state.pinchDragging = false;
    state.pinchStartedAt = null;
    state.pinchArmed = false;
    if (!wasDragging && armed && input.now - state.lastClickAt >= PINCH_COOLDOWN_MS) {
      state.lastClickAt = input.now;
      commands.push({ type: 'click', button: 'left' });
    }
  }

  const pinchOwnsHand = input.pinching || wasPinching;
  if (pinchOwnsHand) {
    state.gestureDragging = false;
    state.previousAction = input.gestureAction;
  } else {
    const action = input.gestureAction;
    const rising = action !== state.previousAction;
    state.gestureDragging = action === 'drag_hold';

    const button = action ? clickButton(action) : null;
    if (rising && button && input.now - state.lastClickAt >= CLICK_COOLDOWN_MS) {
      state.lastClickAt = input.now;
      commands.push({ type: 'click', button });
    }

    if (
      (action === 'scroll_up' ||
        action === 'scroll_down' ||
        action === 'zoom_in' ||
        action === 'zoom_out') &&
      input.now - state.lastScrollAt >= SCROLL_INTERVAL_MS
    ) {
      if (action === 'scroll_up' || action === 'scroll_down') {
        commands.push({ type: 'scroll', direction: action === 'scroll_up' ? 'up' : 'down' });
      } else {
        commands.push({ type: 'zoom', direction: action === 'zoom_in' ? 'in' : 'out' });
      }
      state.lastScrollAt = input.now;
    }

    state.previousAction = action;
  }

  syncLeftButton(state, commands);

  const gestureFreezesPointer = input.gestureAction === 'freeze_cursor';
  const pointing =
    input.gestureAction === null || input.gestureAction === 'pointer_move';
  const shouldMove =
    input.movementEnabled &&
    !input.externallyFrozen &&
    !gestureFreezesPointer &&
    !pinchOwnsHand &&
    pointing;

  if (shouldMove && input.pointer) {
    if (!state.moving || !state.filter) {
      state.filter = { x: input.pointer.x, y: input.pointer.y };
      state.moving = true;
    } else {
      state.filter = smoothPointer(
        input.pointer,
        state.filter,
        input.smoothingAlpha,
        input.deadzoneRadius
      );
    }

    if (input.now - state.lastMoveAt >= MOVE_INTERVAL_MS) {
      const coords = mapPointerToScreen(state.filter, input.screen);
      if (Number.isFinite(coords.x) && Number.isFinite(coords.y)) {
        commands.push({ type: 'move', x: coords.x, y: coords.y });
        state.lastMoveAt = input.now;
      }
    }
  } else {
    state.moving = false;
    state.filter = null;
  }

  return { state, commands };
}
