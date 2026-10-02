'use client';

import React, { useState, useEffect } from 'react';
import type { HandPrediction } from '@/ml/gestureUtils';
import { loadCalibrationSettings, CalibrationSettings } from '@/lib/calibration';

interface GestureDisplayProps {
  predictions: HandPrediction[];
  dominantHandName?: 'Left' | 'Right' | null;
  isElectron?: boolean;
}

const GESTURE_ICONS: Record<string, string> = {
  Pointing: '👉',
  Fist: '✊',
  Peace: '✌️',
  'Open Palm': '🖐️',
  Rock: '🤘',
  Thumb: '👍',
};

export default function GestureDisplay({
  predictions,
  dominantHandName,
  isElectron = false,
}: GestureDisplayProps): React.ReactElement {
  const [calibration, setCalibration] = useState<CalibrationSettings>(() => loadCalibrationSettings());

  useEffect(() => {
    const handleCalibrationUpdate = () => {
      setCalibration(loadCalibrationSettings());
    };

    window.addEventListener('gesturebridge:calibration-updated', handleCalibrationUpdate);
    window.addEventListener('storage', handleCalibrationUpdate);

    return () => {
      window.removeEventListener('gesturebridge:calibration-updated', handleCalibrationUpdate);
      window.removeEventListener('storage', handleCalibrationUpdate);
    };
  }, []);

  const hasPredictions = predictions && predictions.length > 0;
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
                  dominantHandName !== undefined
                    ? dominantHandName !== null
                      ? p.hand === dominantHandName
                      : predictions.length === 1
                    : dominantHandPreference === 'Left'
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
        predictions.map((pred) => {
          const isDominant =
            dominantHandName !== undefined
              ? dominantHandName !== null
                ? pred.hand === dominantHandName
                : predictions.length === 1
              : dominantHandPreference === 'Left'
                ? pred.hand === 'Left'
                : pred.hand === 'Right';

          const handColor = isDominant ? '#f472b6' : '#00f0ff'; // Dominant is Pink, Modifier is Cyan
          const hasGesture = pred.gesture !== null && pred.confidence > 0.3;

          let displayGesture = '—';
          if (hasGesture && pred.gesture) {
            const icon = GESTURE_ICONS[pred.gesture];
            displayGesture = icon ? `${icon} ${pred.gesture}` : pred.gesture;
          }

          let activeAction = 'Ready';

          if (hasGesture && pred.gesture) {
            if (isDominant) {
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
            } else {
              activeAction = 'Ready';
            }
          }

          return (
            <div
              key={pred.hand}
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
