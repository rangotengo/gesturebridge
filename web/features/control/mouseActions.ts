import {
  filterPointer,
  mapPointerToScreen,
  type NormalizedPointerPosition,
  type PointerFilterParams,
  type PointerFilterState,
  type ScreenSpace,
} from './pointerTracking';
import {
  CLICK_COOLDOWN_MS,
  PINCH_COOLDOWN_MS,
  PINCH_RELEASE_FACTOR,
  SCROLL_INTERVAL_MS,
} from '../../lib/gestureConfig';
import type { GestureActionType } from '../../lib/gestureProfiles';

/** A pinch must stay closed this long before it counts. */
const PINCH_ARM_MS = 50;
/** A pinch held this long presses the button for a drag instead of clicking. */
const DRAG_HOLD_MS = 350;
/** With the button held, the hand travels this far before the cursor follows. */
const DRAG_UNLOCK_DISTANCE = 0.012;
/** The hand drifts while a click pose forms; aim from this long before it began. */
const CLICK_REWIND_MS = 90;
/** Hold the cursor after a click or release so the OS event lands on target. */
const POST_CLICK_HOLD_MS = 180;
/** A classified gesture must persist this long before it acts. */
const GESTURE_CONFIRM_MS = 90;
/** After a hold, the cursor eases back onto the hand with this time constant. */
const RESUME_GLIDE_MS = 120;
const HISTORY_MS = 400;
/**
 * Below this hand speed (normalized screens per second, ~100 px/s on 1080p)
 * the hand counts as still, and moves under STILL_DEADZONE_PX are dropped so
 * filtered landmark noise does not twitch the cursor while aiming.
 */
const STILL_SPEED = 0.05;
const STILL_DEADZONE_PX = 4;

export type MouseButtonName = 'left' | 'right' | 'middle';

export type MouseCommand =
  | { type: 'move'; x: number; y: number }
  | { type: 'click'; button: MouseButtonName }
  | { type: 'button'; button: 'left' | 'right'; action: 'down' | 'up' }
  | { type: 'scroll'; direction: 'up' | 'down' }
  | { type: 'zoom'; direction: 'in' | 'out' };

export interface MouseControlState {
  filter: PointerFilterState | null;
  /** Where the controller wants the cursor, normalized to the desktop. */
  cursor: NormalizedPointerPosition | null;
  /** Last position actually sent to the OS; differs from `cursor` inside the still deadzone. */
  shown: NormalizedPointerPosition | null;
  /** Cursor minus filtered hand position. Eases to zero while pointing. */
  offset: NormalizedPointerPosition;
  locked: boolean;
  /** Recent `shown` positions, so a click can aim where the user saw the cursor. */
  history: { t: number; x: number; y: number }[];
  lastStepAt: number;
  lastMovePx: { x: number; y: number } | null;
  holdUntil: number;
  lastClickAt: number;
  lastScrollAt: number;
  pinchClosed: boolean;
  pinchStartedAt: number | null;
  pinchArmed: boolean;
  pinchDragging: boolean;
  gestureDragging: boolean;
  leftDown: boolean;
  /** Filtered hand position when the button went down. */
  dragAnchor: NormalizedPointerPosition | null;
  dragUnlocked: boolean;
  candidateAction: GestureActionType | null;
  candidateSince: number;
  stableAction: GestureActionType | null;
}

export interface MouseControlInput {
  now: number;
  /** Mouse mode is on and the desktop bridge can receive commands. */
  enabled: boolean;
  /** A dominant hand with a usable tracking point is in frame. */
  tracking: boolean;
  externallyFrozen: boolean;
  /** Profile includes a Move Cursor binding. */
  movementEnabled: boolean;
  /** Thumb–index gap divided by palm length; null when it cannot be measured. */
  pinchRatio: number | null;
  /** A pinch starts at or below this ratio and ends above it × PINCH_RELEASE_FACTOR. */
  pinchThreshold: number;
  gestureAction: GestureActionType | null;
  /** Calibrated hand position, normalized to the desktop. */
  pointer: NormalizedPointerPosition | null;
  screen: ScreenSpace;
  filter: PointerFilterParams;
}

export function createMouseControlState(): MouseControlState {
  return {
    filter: null,
    cursor: null,
    shown: null,
    offset: { x: 0, y: 0 },
    locked: true,
    history: [],
    lastStepAt: 0,
    lastMovePx: null,
    holdUntil: 0,
    lastClickAt: 0,
    lastScrollAt: 0,
    pinchClosed: false,
    pinchStartedAt: null,
    pinchArmed: false,
    pinchDragging: false,
    gestureDragging: false,
    leftDown: false,
    dragAnchor: null,
    dragUnlocked: false,
    candidateAction: null,
    candidateSince: 0,
    stableAction: null,
  };
}

/** Desktop released the button on its own (deadman, emergency stop). */
export function clearHeldButton(state: MouseControlState): MouseControlState {
  return {
    ...state,
    pinchStartedAt: null,
    pinchArmed: false,
    pinchDragging: false,
    gestureDragging: false,
    leftDown: false,
    dragAnchor: null,
    dragUnlocked: false,
  };
}

function releaseLeftButton(state: MouseControlState, commands: MouseCommand[]): void {
  state.pinchDragging = false;
  state.gestureDragging = false;
  state.dragAnchor = null;
  state.dragUnlocked = false;
  if (!state.leftDown) return;
  state.leftDown = false;
  commands.push({ type: 'button', button: 'left', action: 'up' });
}

function clickButton(action: GestureActionType): MouseButtonName | null {
  if (action === 'left_click') return 'left';
  if (action === 'right_click') return 'right';
  if (action === 'middle_click') return 'middle';
  return null;
}

function isPointing(action: GestureActionType | null): boolean {
  return action === null || action === 'pointer_move';
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function emitMove(
  state: MouseControlState,
  screen: ScreenSpace,
  commands: MouseCommand[],
  deadzonePx = 0
): void {
  if (!state.cursor) return;
  const coords = mapPointerToScreen(state.cursor, screen);
  if (!Number.isFinite(coords.x) || !Number.isFinite(coords.y)) return;
  const px = { x: Math.round(coords.x), y: Math.round(coords.y) };
  const last = state.lastMovePx;
  if (last && Math.hypot(px.x - last.x, px.y - last.y) < Math.max(1, deadzonePx)) return;
  state.lastMovePx = px;
  state.shown = { ...state.cursor };
  commands.push({ type: 'move', x: coords.x, y: coords.y });
}

/** Put the cursor back where it was at `time`, before the click pose moved it. */
function rewindCursor(
  state: MouseControlState,
  time: number,
  screen: ScreenSpace,
  commands: MouseCommand[]
): void {
  if (state.history.length === 0) return;
  let sample = state.history[0];
  for (const entry of state.history) {
    if (entry.t > time) break;
    sample = entry;
  }
  state.cursor = { x: sample.x, y: sample.y };
  state.locked = true;
  emitMove(state, screen, commands);
}

/**
 * One control frame.
 * The cursor follows the filtered hand only while pointing. A pinch, click,
 * scroll, or freeze holds it so the hand cannot pull it off target. Clicks aim
 * at where the cursor was just before the click pose started forming.
 * A short pinch clicks on release. A pinch held past DRAG_HOLD_MS presses the
 * left button; the cursor then drags once the hand clearly moves.
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
    history: previous.history.slice(),
  };
  const commands: MouseCommand[] = [];
  const now = input.now;

  if (!input.tracking || !input.pointer) {
    releaseLeftButton(state, commands);
    // Keep `cursor` and `shown` so the next sighting eases from where the pointer stopped.
    return {
      state: {
        ...state,
        filter: null,
        locked: true,
        history: [],
        pinchClosed: false,
        pinchStartedAt: null,
        pinchArmed: false,
        candidateAction: null,
        candidateSince: now,
        stableAction: null,
      },
      commands,
    };
  }

  const elapsed = state.lastStepAt > 0 ? now - state.lastStepAt : 0;
  state.lastStepAt = now;
  state.filter = filterPointer(state.filter, input.pointer, now, input.filter);
  const hand = { x: state.filter.x, y: state.filter.y };

  // Pinch, with hysteresis so noise around the threshold cannot flicker it.
  const wasPinching = state.pinchStartedAt !== null;
  const pinchAllowed = wasPinching || (isPointing(state.stableAction) && !state.gestureDragging);
  const ratio = input.pinchRatio;
  state.pinchClosed =
    ratio !== null &&
    pinchAllowed &&
    (state.pinchClosed
      ? ratio < input.pinchThreshold * PINCH_RELEASE_FACTOR
      : ratio <= input.pinchThreshold);

  const armPinch = (): void => {
    state.pinchArmed = true;
    rewindCursor(state, state.pinchStartedAt! - CLICK_REWIND_MS, input.screen, commands);
  };

  let pinchReleased = false;
  if (state.pinchClosed) {
    if (!wasPinching) {
      state.pinchStartedAt = now;
      state.pinchArmed = false;
    } else if (!state.pinchArmed && now - state.pinchStartedAt! >= PINCH_ARM_MS) {
      armPinch();
    }
    if (state.pinchArmed && now - state.pinchStartedAt! >= DRAG_HOLD_MS) {
      state.pinchDragging = true;
    }
  } else if (wasPinching) {
    pinchReleased = true;
    if (!state.pinchArmed && now - state.pinchStartedAt! >= PINCH_ARM_MS) armPinch();
    const armed = state.pinchArmed;
    const wasDragging = state.pinchDragging;
    state.pinchDragging = false;
    state.pinchStartedAt = null;
    state.pinchArmed = false;
    if (!wasDragging && armed && now - state.lastClickAt >= PINCH_COOLDOWN_MS) {
      state.lastClickAt = now;
      state.holdUntil = now + POST_CLICK_HOLD_MS;
      commands.push({ type: 'click', button: 'left' });
    }
  }
  const pinchOwnsHand = state.pinchStartedAt !== null || pinchReleased;

  // Classified gestures act only after they hold steady for GESTURE_CONFIRM_MS.
  const raw = input.gestureAction;
  if (raw !== state.candidateAction) {
    state.candidateAction = raw;
    state.candidateSince = now;
  }
  const previousStable = state.stableAction;
  if (pinchOwnsHand) {
    // Adopt without acting, so a pose held through the pinch does not fire on release.
    state.stableAction = raw;
    state.gestureDragging = false;
  } else {
    if (state.stableAction !== raw && now - state.candidateSince >= GESTURE_CONFIRM_MS) {
      state.stableAction = raw;
    }
    const stable = state.stableAction;
    state.gestureDragging = stable === 'drag_hold';

    const button = stable && stable !== previousStable ? clickButton(stable) : null;
    if (button && now - state.lastClickAt >= CLICK_COOLDOWN_MS) {
      rewindCursor(state, state.candidateSince - CLICK_REWIND_MS, input.screen, commands);
      state.lastClickAt = now;
      state.holdUntil = now + POST_CLICK_HOLD_MS;
      commands.push({ type: 'click', button });
    }

    if (
      stable === raw &&
      (stable === 'scroll_up' || stable === 'scroll_down' || stable === 'zoom_in' || stable === 'zoom_out') &&
      now - state.lastScrollAt >= SCROLL_INTERVAL_MS
    ) {
      if (stable === 'scroll_up' || stable === 'scroll_down') {
        commands.push({ type: 'scroll', direction: stable === 'scroll_up' ? 'up' : 'down' });
      } else {
        commands.push({ type: 'zoom', direction: stable === 'zoom_in' ? 'in' : 'out' });
      }
      state.lastScrollAt = now;
    }
  }

  const wantDown = state.pinchDragging || state.gestureDragging;
  if (wantDown && !state.leftDown) {
    if (state.gestureDragging) {
      rewindCursor(state, state.candidateSince - CLICK_REWIND_MS, input.screen, commands);
    }
    state.leftDown = true;
    state.dragAnchor = hand;
    state.dragUnlocked = false;
    commands.push({ type: 'button', button: 'left', action: 'down' });
  } else if (!wantDown && state.leftDown) {
    state.leftDown = false;
    state.dragAnchor = null;
    state.dragUnlocked = false;
    state.holdUntil = Math.max(state.holdUntil, now + POST_CLICK_HOLD_MS);
    commands.push({ type: 'button', button: 'left', action: 'up' });
  }

  const blocked =
    !input.movementEnabled ||
    input.externallyFrozen ||
    raw === 'freeze_cursor' ||
    state.stableAction === 'freeze_cursor';
  let free = false;
  if (!blocked && state.leftDown) {
    if (
      !state.dragUnlocked &&
      state.dragAnchor &&
      Math.hypot(hand.x - state.dragAnchor.x, hand.y - state.dragAnchor.y) >= DRAG_UNLOCK_DISTANCE
    ) {
      state.dragUnlocked = true;
    }
    free = state.dragUnlocked;
  } else if (!blocked) {
    free =
      !pinchOwnsHand &&
      isPointing(raw) &&
      isPointing(state.stableAction) &&
      now >= state.holdUntil;
  }

  if (free) {
    if (state.locked || !state.cursor) {
      const from = state.shown ?? state.cursor;
      state.offset = from ? { x: from.x - hand.x, y: from.y - hand.y } : { x: 0, y: 0 };
    } else if (elapsed > 0) {
      const keep = Math.exp(-elapsed / RESUME_GLIDE_MS);
      state.offset = { x: state.offset.x * keep, y: state.offset.y * keep };
    }
    state.locked = false;
    state.cursor = {
      x: clamp01(hand.x + state.offset.x),
      y: clamp01(hand.y + state.offset.y),
    };
    const still = Math.hypot(state.filter.dx, state.filter.dy) < STILL_SPEED;
    emitMove(state, input.screen, commands, still ? STILL_DEADZONE_PX : 0);
  } else {
    state.locked = true;
  }

  if (state.shown) {
    state.history.push({ t: now, x: state.shown.x, y: state.shown.y });
    while (state.history.length > 1 && now - state.history[0].t > HISTORY_MS) {
      state.history.shift();
    }
  }

  return { state, commands };
}
