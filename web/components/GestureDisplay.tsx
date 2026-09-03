'use client';

import React from 'react';
import type { HandPrediction } from '@/ml/gestureUtils';

interface GestureDisplayProps {
  predictions: HandPrediction[];
  isMouseModeActive?: boolean;
}

export default function GestureDisplay({ predictions, isMouseModeActive = false }: GestureDisplayProps): React.ReactElement {
  const hasPredictions = predictions && predictions.length > 0;

  return (
    <div
      className="fixed bottom-24 left-1/2 -translate-x-1/2 z-30 flex gap-6 items-stretch justify-center max-w-[90vw]"
      role="status"
      aria-live="polite"
      aria-label={
        hasPredictions
          ? `Gestures detected: ${predictions
              .map((p) => `${p.hand === 'Right' ? 'Dominant' : 'Modifier'} hand: ${p.gesture || 'none'} (${Math.round(p.confidence * 100)}%)`)
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
          const isRight = pred.hand === 'Right';
          const handColor = isRight ? '#f472b6' : '#00f0ff'; // Right is Dominant (pink), Left is Modifier (cyan)
          const hasGesture = pred.gesture !== null && pred.confidence > 0.3;

          let displayGesture = pred.gesture || '—';
          let activeAction = 'Ready';

          if (hasGesture) {
            if (isRight) {
              // Dominant Hand mapping
              if (pred.gesture === 'Pointing') {
                displayGesture = '👉 Pointing';
                activeAction = isMouseModeActive ? '🖱️ Move Mouse' : 'Ready';
              } else if (pred.gesture === 'Fist') {
                displayGesture = '✊ Fist';
                activeAction = isMouseModeActive ? '⬇️ Scroll Down' : 'Ready';
              } else if (pred.gesture === 'Peace') {
                displayGesture = '✌️ Peace';
                activeAction = isMouseModeActive ? '⚡ Right Click' : 'Ready';
              } else if (pred.gesture === 'Open Palm') {
                displayGesture = '🖐️ Open Palm';
                activeAction = 'Mode Toggle (5s Hold)';
              } else if (pred.gesture === 'Rock') {
                displayGesture = '🤘 Rock';
                activeAction = isMouseModeActive ? '⬆️ Scroll Up' : 'Ready';
              } else if (pred.gesture === 'Thumb') {
                displayGesture = '👍 Thumb';
                activeAction = 'Ready';
              }
            } else {
              // Modifier Hand mapping
              if (pred.gesture === 'Fist') {
                displayGesture = '✊ Fist';
                activeAction = isMouseModeActive ? '🔒 Drag Mode Active' : 'Ready';
              } else if (pred.gesture === 'Peace') {
                displayGesture = '✌️ Peace';
                activeAction = isMouseModeActive ? '🖱️ Middle Click' : 'Ready';
              } else if (pred.gesture === 'Open Palm') {
                displayGesture = '🖐️ Open Palm';
                activeAction = isMouseModeActive ? '❄️ Freeze Mouse' : 'Ready';
              } else if (pred.gesture === 'Pointing') {
                displayGesture = '👉 Pointing';
                activeAction = 'Ready';
              } else if (pred.gesture === 'Rock') {
                displayGesture = '🤘 Rock';
                activeAction = 'Ready';
              } else if (pred.gesture === 'Thumb') {
                displayGesture = '👍 Thumb';
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
                    backgroundColor: isRight ? 'rgba(244, 114, 182, 0.15)' : 'rgba(0, 240, 255, 0.15)',
                    color: handColor,
                  }}
                >
                  {isRight ? 'Dominant (Right)' : 'Modifier (Left)'}
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
