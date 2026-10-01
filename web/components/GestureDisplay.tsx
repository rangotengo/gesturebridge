'use client';

import React, { useState, useEffect } from 'react';
import type { HandPrediction } from '@/ml/gestureUtils';
import { loadCalibrationSettings, CalibrationSettings } from '@/lib/calibration';
import { loadActiveProfile, GestureProfile, AVAILABLE_ACTIONS } from '@/lib/gestureProfiles';

interface GestureDisplayProps {
  predictions: HandPrediction[];
  isMouseModeActive?: boolean;
  isElectron?: boolean;
  gestureLabels?: string[];
}

const ACTION_ICONS: Record<string, string> = {
  pointer_move: '🖱️',
  left_click: '👆',
  right_click: '⚡',
  middle_click: '🖱️',
  drag_hold: '🔒',
  scroll_up: '⬆️',
  scroll_down: '⬇️',
  zoom_in: '🔍',
  zoom_out: '🔎',
  freeze_cursor: '❄️',
  none: '⚪',
};

const GESTURE_ICONS: Record<string, string> = {
  Pointing: '👉',
  Fist: '✊',
  Peace: '✌️',
  'Open Palm': '🖐️',
  Rock: '🤘',
  Thumb: '👍',
};

const DEFAULT_GESTURE_INDICES: Record<string, number> = {
  Pointing: 0,
  Fist: 1,
  Peace: 2,
  'Open Palm': 3,
  Rock: 4,
  Thumb: 5,
};

export default function GestureDisplay({
  predictions,
  isMouseModeActive = false,
  isElectron = false,
  gestureLabels,
}: GestureDisplayProps): React.ReactElement {
  const [calibration, setCalibration] = useState<CalibrationSettings>(() => loadCalibrationSettings());
  const [profile, setProfile] = useState<GestureProfile>(() => loadActiveProfile());

  useEffect(() => {
    const handleCalibrationUpdate = () => {
      setCalibration(loadCalibrationSettings());
    };
    const handleProfileUpdate = () => {
      setProfile(loadActiveProfile());
    };

    window.addEventListener('gesturebridge:calibration-updated', handleCalibrationUpdate);
    window.addEventListener('gesturebridge:profile-updated', handleProfileUpdate);
    window.addEventListener('storage', handleCalibrationUpdate);
    window.addEventListener('storage', handleProfileUpdate);

    return () => {
      window.removeEventListener('gesturebridge:calibration-updated', handleCalibrationUpdate);
      window.removeEventListener('gesturebridge:profile-updated', handleProfileUpdate);
      window.removeEventListener('storage', handleCalibrationUpdate);
      window.removeEventListener('storage', handleProfileUpdate);
    };
  }, []);

  const hasPredictions = predictions && predictions.length > 0;

  // Determine dominant hand preference
  const dominantHandPreference = calibration.dominantHand;

  return (
    <div
      className="fixed bottom-24 left-1/2 -translate-x-1/2 z-30 flex gap-6 items-stretch justify-center max-w-[90vw]"
      role="status"
      aria-live="polite"
      aria-label={
        hasPredictions
          ? `Gestures detected: ${predictions
              .map((p) => {
                const isDominant =
                  dominantHandPreference === 'Left'
                    ? p.hand === 'Left'
                    : p.hand === 'Right';
                return `${isDominant ? 'Dominant' : 'Modifier'} hand: ${p.gesture || 'none'} (${Math.round(p.confidence * 100)}%)`;
              })
              .join(', ')}`
          : 'No hand in frame'
      }
    >
      {!hasPredictions ? (
        <div className="bg-black/75 backdrop-blur-md border border-white/10 rounded-xl px-10 py-5 text-center border-l-4 border-l-white/20 shadow-2xl transition-all duration-300">
          <p className="text-4xl font-black tracking-tight" style={{ color: 'rgba(255,255,255,0.15)' }}>
            —
          </p>
          <p className="mt-1.5 text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>
            No hand in frame
          </p>
        </div>
      ) : (
        predictions.map((pred, index) => {
          const isDominant =
            dominantHandPreference === 'Left'
              ? pred.hand === 'Left'
              : pred.hand === 'Right';

          const handColor = isDominant ? '#f472b6' : '#00f0ff'; // Dominant is Pink, Modifier is Cyan
          const hasGesture = pred.gesture !== null && pred.confidence > 0.3;

          let displayGesture = '—';
          if (hasGesture && pred.gesture) {
            const icon = GESTURE_ICONS[pred.gesture] ?? '✋';
            displayGesture = `${icon} ${pred.gesture}`;
          }

          let activeAction = 'Ready';

          if (hasGesture && pred.gesture) {
            if (isDominant) {
              if (isMouseModeActive) {
                // Dominant hand mouse action derived from active profile mapping
                const gestureIndex =
                  gestureLabels && gestureLabels.length > 0
                    ? gestureLabels.indexOf(pred.gesture)
                    : DEFAULT_GESTURE_INDICES[pred.gesture];

                const mappedActionType =
                  gestureIndex !== undefined && gestureIndex !== -1
                    ? profile.mappings[gestureIndex]
                    : undefined;

                if (mappedActionType) {
                  const actionDef = AVAILABLE_ACTIONS.find((a) => a.type === mappedActionType);
                  const icon = ACTION_ICONS[mappedActionType] ?? '🎯';
                  activeAction = `${icon} ${actionDef?.label ?? mappedActionType}`;
                } else {
                  activeAction = 'Ready';
                }
              } else {
                // Non-mouse mode
                if (isElectron) {
                  if (pred.gesture === 'Open Palm') {
                    activeAction = 'Mode Toggle (5s Hold)';
                  } else if (pred.gesture === 'Fist') {
                    activeAction = 'Mirror Mode (Hold)';
                  } else {
                    activeAction = 'Ready';
                  }
                } else {
                  activeAction = 'Ready';
                }
              }
            } else {
              // Modifier Hand mapping
              if (isMouseModeActive) {
                if (pred.gesture === 'Fist') {
                  activeAction = '🔒 Drag Mode Active';
                } else if (pred.gesture === 'Peace') {
                  activeAction = '🖱️ Middle Click';
                } else if (pred.gesture === 'Open Palm') {
                  activeAction = '❄️ Freeze Mouse';
                } else {
                  activeAction = 'Ready';
                }
              } else {
                activeAction = 'Ready';
              }
            }
          }

          return (
            <div
              key={`${pred.hand}-${index}`}
              className="bg-black/80 backdrop-blur-md border border-white/10 rounded-xl px-8 py-4 text-center shadow-2xl transition-all duration-300 min-w-[220px] flex flex-col justify-between"
              style={{
                borderLeft: `4px solid ${handColor}`,
              }}
            >
              <div>
                <span
                  className="text-[10px] font-black uppercase tracking-widest px-2.5 py-0.5 rounded-full inline-block mb-2"
                  style={{
                    backgroundColor: isDominant ? 'rgba(244, 114, 182, 0.15)' : 'rgba(0, 240, 255, 0.15)',
                    color: handColor,
                  }}
                >
                  {isDominant ? `Dominant (${pred.hand})` : `Modifier (${pred.hand})`}
                </span>
                <p
                  className="text-3xl font-extrabold tracking-tight mt-1"
                  style={{
                    color: hasGesture ? 'var(--color-text-heading)' : 'rgba(255,255,255,0.15)',
                  }}
                >
                  {hasGesture ? displayGesture : '—'}
                </p>
              </div>
              <div className="mt-3 border-t border-white/5 pt-2">
                <p className="text-[11px] font-semibold text-emerald-400 tracking-wide uppercase">
                  {activeAction}
                </p>
                <p className="mt-1 text-[10px] font-semibold" style={{ color: 'var(--color-text-muted)' }}>
                  {hasGesture ? `${Math.round(pred.confidence * 100)}% match` : 'Calibrating...'}
                </p>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
