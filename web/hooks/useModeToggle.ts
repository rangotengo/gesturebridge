import { useCallback } from 'react';
import { useHoldToToggle, type HoldToTogglePhase } from '@/hooks/useHoldToToggle';

export type ModeTogglePhase = HoldToTogglePhase;

/**
 * Open-palm hold gesture toggles mouse-control mode.
 * Desktop-only — pass `enabled: false` in the browser so recognition stays detect-only.
 */
export function useModeToggle(
  currentGestureLabel: number,
  wristPosition: { x: number; y: number } | null,
  onToggle: () => void,
  enabled = true
): { phase: ModeTogglePhase; progress: number; stageIndex: number } {
  const toggleMouseMode = useCallback(() => {
    onToggle();
  }, [onToggle]);

  return useHoldToToggle({
    isGestureActive: currentGestureLabel === 3 && wristPosition !== null,
    initialHoldDurationMs: 2_000,
    durationMs: 5_000,
    onToggle: toggleMouseMode,
    enabled,
  });
}
