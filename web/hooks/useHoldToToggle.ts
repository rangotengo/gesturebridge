import { useEffect, useRef, useState } from 'react';

export type HoldToTogglePhase = 'idle' | 'holding' | 'confirm_wait' | 'toggled';

interface HoldStateMachine {
  phase: HoldToTogglePhase;
  isGestureActive: boolean;
  stageIndex: number;
  startTime: number;
}

interface HoldTiming {
  durationMs: number;
  initialHoldDurationMs?: number;
  confirmationWindowMs: number;
  completionDurationMs: number;
}

export interface UseHoldToToggleOptions {
  /** True only while the configured gesture and its required landmarks are present. */
  isGestureActive: boolean;
  /** Duration for the final hold that triggers the toggle. */
  durationMs: number;
  /**
   * Optional first hold before the final hold. This preserves the existing
   * mouse-control confirmation flow without giving each consumer a timer loop.
   */
  initialHoldDurationMs?: number;
  /** Called once after every completed hold sequence. */
  onToggle: () => void;
  /** Disable timers and reset visual feedback. */
  enabled?: boolean;
  /** Maximum time between the initial and final holds. */
  confirmationWindowMs?: number;
  /** Duration for the successful-toggle feedback state. */
  completionDurationMs?: number;
}

export interface HoldToToggleState {
  phase: HoldToTogglePhase;
  /** 0-based active hold stage; 0 for a single-hold sequence. */
  stageIndex: number;
  progress: number;
}

const DEFAULT_CONFIRMATION_WINDOW_MS = 1_000;
const DEFAULT_COMPLETION_DURATION_MS = 1_500;
const TICK_INTERVAL_MS = 30;

/**
 * Shared gesture-hold state machine.
 *
 * A consumer supplies only its gesture predicate, duration, and state change.
 * `initialHoldDurationMs` enables the legacy two-step mouse confirmation flow;
 * omitting it gives Mirror Mode a single Fist-hold duration.
 */
export function useHoldToToggle({
  isGestureActive,
  durationMs,
  initialHoldDurationMs,
  onToggle,
  enabled = true,
  confirmationWindowMs = DEFAULT_CONFIRMATION_WINDOW_MS,
  completionDurationMs = DEFAULT_COMPLETION_DURATION_MS,
}: UseHoldToToggleOptions): HoldToToggleState {
  const [phase, setPhase] = useState<HoldToTogglePhase>('idle');
  const [stageIndex, setStageIndex] = useState(0);
  const [progress, setProgress] = useState(0);

  const stateRef = useRef<HoldStateMachine>({
    phase: 'idle',
    isGestureActive: false,
    stageIndex: 0,
    startTime: 0,
  });
  const timingRef = useRef<HoldTiming>({
    durationMs,
    initialHoldDurationMs,
    confirmationWindowMs,
    completionDurationMs,
  });
  const onToggleRef = useRef(onToggle);
  const confirmationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const completionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    stateRef.current.isGestureActive = enabled && isGestureActive;
  }, [enabled, isGestureActive]);

  useEffect(() => {
    timingRef.current = {
      durationMs: Math.max(durationMs, 1),
      initialHoldDurationMs:
        initialHoldDurationMs === undefined ? undefined : Math.max(initialHoldDurationMs, 1),
      confirmationWindowMs: Math.max(confirmationWindowMs, 0),
      completionDurationMs: Math.max(completionDurationMs, 0),
    };
    onToggleRef.current = onToggle;
  }, [completionDurationMs, confirmationWindowMs, durationMs, initialHoldDurationMs, onToggle]);

  useEffect(() => {
    if (enabled) return;

    if (confirmationTimeoutRef.current) {
      clearTimeout(confirmationTimeoutRef.current);
      confirmationTimeoutRef.current = null;
    }
    if (completionTimeoutRef.current) {
      clearTimeout(completionTimeoutRef.current);
      completionTimeoutRef.current = null;
    }

    stateRef.current.phase = 'idle';
    stateRef.current.stageIndex = 0;
    stateRef.current.startTime = 0;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Disable must immediately remove stale gesture feedback.
    setPhase('idle');
    setStageIndex(0);
    setProgress(0);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;

    const reset = (): void => {
      stateRef.current.phase = 'idle';
      stateRef.current.stageIndex = 0;
      stateRef.current.startTime = 0;
      setPhase('idle');
      setStageIndex(0);
      setProgress(0);
    };

    const startHolding = (nextStageIndex: number): void => {
      stateRef.current.phase = 'holding';
      stateRef.current.stageIndex = nextStageIndex;
      stateRef.current.startTime = Date.now();
      setPhase('holding');
      setStageIndex(nextStageIndex);
      setProgress(0);
    };

    const interval = setInterval(() => {
      const current = stateRef.current;
      const timing = timingRef.current;

      if (current.phase === 'idle') {
        if (current.isGestureActive) startHolding(0);
        return;
      }

      if (current.phase === 'confirm_wait') {
        if (current.isGestureActive) {
          if (confirmationTimeoutRef.current) {
            clearTimeout(confirmationTimeoutRef.current);
            confirmationTimeoutRef.current = null;
          }
          startHolding(1);
        }
        return;
      }

      if (current.phase !== 'holding') return;

      if (!current.isGestureActive) {
        reset();
        return;
      }

      const targetDurationMs =
        current.stageIndex === 0 && timing.initialHoldDurationMs !== undefined
          ? timing.initialHoldDurationMs
          : timing.durationMs;
      const nextProgress = Math.min((Date.now() - current.startTime) / targetDurationMs, 1);
      setProgress(nextProgress);

      if (nextProgress < 1) return;

      const needsConfirmation = current.stageIndex === 0 && timing.initialHoldDurationMs !== undefined;
      if (needsConfirmation) {
        stateRef.current.phase = 'confirm_wait';
        setPhase('confirm_wait');
        setProgress(0);

        if (confirmationTimeoutRef.current) clearTimeout(confirmationTimeoutRef.current);
        confirmationTimeoutRef.current = setTimeout(() => {
          if (stateRef.current.phase === 'confirm_wait') reset();
        }, timing.confirmationWindowMs);
        return;
      }

      stateRef.current.phase = 'toggled';
      setPhase('toggled');
      setProgress(0);
      onToggleRef.current();

      if (completionTimeoutRef.current) clearTimeout(completionTimeoutRef.current);
      completionTimeoutRef.current = setTimeout(() => {
        if (stateRef.current.phase === 'toggled') reset();
      }, timing.completionDurationMs);
    }, TICK_INTERVAL_MS);

    return () => {
      clearInterval(interval);
      if (confirmationTimeoutRef.current) {
        clearTimeout(confirmationTimeoutRef.current);
        confirmationTimeoutRef.current = null;
      }
      if (completionTimeoutRef.current) {
        clearTimeout(completionTimeoutRef.current);
        completionTimeoutRef.current = null;
      }
    };
  }, [enabled]);

  return { phase, stageIndex, progress };
}
