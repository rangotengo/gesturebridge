'use client';

import React from 'react';
import type { ControlMode } from '@/features/control/modes';

interface ModeToggleProps {
  activeMode: ControlMode;
  onSelectMode: (mode: ControlMode) => void;
}

export default function ModeToggle({ activeMode, onSelectMode }: ModeToggleProps): React.ReactElement {
  const buttonClass = (isActive: boolean): string => [
    'rounded px-3 py-1.5 text-sm font-medium transition-colors',
    isActive ? 'bg-[var(--color-accent)] text-neutral-900' : 'text-[var(--color-text-muted)]',
  ].join(' ');

  return (
    <div
      className="fixed top-20 right-4 z-40 flex gap-1 rounded-md border border-white/10 bg-neutral-950/85 p-1 backdrop-blur-sm"
      role="group"
      aria-label="Control mode"
    >
      {/* DETECT mode button */}
      <button
        id="mode-detect-btn"
        onClick={() => onSelectMode('recognition')}
        className={buttonClass(activeMode === 'recognition')}
        aria-pressed={activeMode === 'recognition'}
      >
        Detect
      </button>

      {/* MOUSE mode button */}
      <button
        id="mode-mouse-btn"
        onClick={() => onSelectMode('mouse-control')}
        className={buttonClass(activeMode === 'mouse-control')}
        aria-pressed={activeMode === 'mouse-control'}
      >
        Mouse
      </button>

      <button
        id="mode-mirror-btn"
        onClick={() => onSelectMode('mirror')}
        className={buttonClass(activeMode === 'mirror')}
        aria-pressed={activeMode === 'mirror'}
      >
        Mirror
      </button>
    </div>
  );
}
