'use client';

import React from 'react';
import type { HoldToTogglePhase } from '@/hooks/useHoldToToggle';

export type ToggleFeedbackMode = 'mouse' | 'mirror';

interface ModeToggleOverlayProps {
  phase: HoldToTogglePhase;
  progress: number;
  wristPosition: { x: number; y: number } | null;
  /** 0 for a single hold or the initial stage; 1 for mouse confirmation hold. */
  stageIndex?: number;
  /** Mode receiving feedback. Defaults to mouse for existing callers. */
  mode?: ToggleFeedbackMode;
  /** Current active state for feedback flash. */
  isModeActive?: boolean;
  /** @deprecated Use isModeActive. Kept while callers migrate. */
  mouseModeActive?: boolean;
}

export default function ModeToggleOverlay({
  phase,
  progress,
  wristPosition,
  stageIndex = 0,
  mode = 'mouse',
  isModeActive,
  mouseModeActive,
}: ModeToggleOverlayProps): React.ReactElement | null {
  const modeIsActive = isModeActive ?? mouseModeActive ?? false;
  const feedback =
    mode === 'mirror'
      ? {
          activeDescription: 'Clear glass — blow to fog, then point to wipe.',
          icon: '🪞',
          label: 'Mirror Mode',
          inactiveDescription: 'Returned to standard camera view mode.',
          gesture: 'Fist',
        }
      : {
          activeDescription: 'Docked in compact mode at the top center of your screen.',
          icon: '🖱',
          label: 'Mouse Control',
          inactiveDescription: 'Restored to standard camera view mode.',
          gesture: 'Open Palm',
        };

  // If we are in toggled phase, show the full-screen success/deactivation flash overlay
  if (phase === 'toggled') {
    return (
      <div
        className={`fixed inset-0 z-50 flex flex-col items-center justify-center transition-all duration-300 animate-in fade-in zoom-in-95 backdrop-blur-sm ${
          modeIsActive ? 'bg-emerald-600/90' : 'bg-rose-600/90'
        }`}
      >
        <div className="bg-black/50 border border-white/20 px-10 py-8 rounded-2xl shadow-2xl text-center flex flex-col items-center gap-3">
          <span className="text-6xl animate-bounce" role="img" aria-label={`${feedback.label} icon`}>
            {feedback.icon}
          </span>
          <h2 className="text-3xl font-black tracking-wider text-white">
            {feedback.label} {modeIsActive ? 'ON' : 'OFF'}
          </h2>
          <p className="text-sm font-semibold text-white/70">
            {modeIsActive ? feedback.activeDescription : feedback.inactiveDescription}
          </p>
        </div>
      </div>
    );
  }

  // Otherwise, we need a valid wrist position to draw circular loading arc/pulse on the canvas view
  if (!wristPosition || phase === 'idle') return null;

  // wristPosition is already mapped into mirrored object-cover viewport space (0..1).
  const screenX = wristPosition.x * 100;
  const screenY = wristPosition.y * 100;

  return (
    <div
      className="fixed z-20 pointer-events-none transition-all duration-150 ease-out"
      style={{
        left: `${screenX}%`,
        top: `${screenY}%`,
        transform: 'translate(-50%, -50%)',
      }}
    >
      {phase === 'holding' && (
        <div className="flex flex-col items-center gap-2">
          {/* Radial stroke-dasharray arc loader */}
          <div className="relative w-16 h-16 flex items-center justify-center bg-black/60 rounded-full border border-white/10 shadow-lg">
            <svg className="w-14 h-14 transform -rotate-90" viewBox="0 0 36 36">
              {/* Background circle stroke */}
              <circle
                cx="18"
                cy="18"
                r="15.9155"
                fill="none"
                className="text-amber-500/20"
                stroke="currentColor"
                strokeWidth="3.5"
              />
              {/* Foreground progress arc */}
              <circle
                cx="18"
                cy="18"
                r="15.9155"
                fill="none"
                className="text-amber-500 transition-all duration-100 ease-out"
                stroke="currentColor"
                strokeWidth="3.5"
                strokeDasharray={`${progress * 100}, 100`}
                strokeLinecap="round"
              />
            </svg>
            <span className="absolute text-[10px] font-mono font-black text-amber-400">
              {Math.round(progress * 100)}%
            </span>
          </div>
          <span className="bg-black/80 px-2 py-0.5 rounded text-[9px] font-black uppercase text-amber-400 border border-amber-500/30 whitespace-nowrap shadow-md tracking-wider">
            Hold {feedback.gesture} {stageIndex > 0 ? '(2/2)' : ''}
          </span>
        </div>
      )}

      {phase === 'confirm_wait' && (
        <div className="flex flex-col items-center gap-2">
          {/* Pulsing emerald confirmation ring */}
          <div className="relative w-20 h-20 flex items-center justify-center">
            <div className="absolute inset-0 rounded-full border-4 border-emerald-500/70 animate-ping" />
            <div className="absolute w-16 h-16 rounded-full border-2 border-emerald-400 bg-emerald-500/20 flex items-center justify-center shadow-lg">
              <span className="text-[10px] font-black uppercase text-emerald-400 text-center leading-tight">
                Hold
                <br />
                Again
              </span>
            </div>
          </div>
          <span className="bg-emerald-950/90 px-2 py-0.5 rounded text-[9px] font-black uppercase text-emerald-400 border border-emerald-500/30 whitespace-nowrap shadow-md tracking-wider">
            Confirming gesture...
          </span>
        </div>
      )}
    </div>
  );
}
