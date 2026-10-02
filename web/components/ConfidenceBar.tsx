'use client';

import React from 'react';
import type { HandPrediction } from '@/ml/gestureUtils';

interface ConfidenceBarProps {
  predictions: HandPrediction[];
}

export default function ConfidenceBar({ predictions }: ConfidenceBarProps): React.ReactElement {
  const hasPredictions = predictions && predictions.length > 0;

  return (
    <div
      className="fixed bottom-0 inset-x-0 z-30 backdrop-blur-sm border-t border-white/10 flex flex-col justify-center px-6 py-2.5 gap-2 transition-all duration-300"
      style={{ backgroundColor: 'rgba(17,17,17,0.9)' }}
      role="status"
      aria-label="Gesture confidence levels"
    >
      {!hasPredictions ? (
        <div className="flex items-center gap-4 w-full h-6">
          <span className="text-xs shrink-0 font-medium tracking-wide uppercase text-white/30">
            No Hands Detected
          </span>
          <div className="flex-1 h-1 rounded-full bg-white/5" />
          <span className="text-xs w-10 text-right shrink-0 font-bold text-white/20">
            0%
          </span>
        </div>
      ) : (
        predictions.map((pred) => {
          const pct = Math.round(pred.confidence * 100);
          const isLeft = pred.hand === 'Left';
          const handColor = isLeft ? '#00f0ff' : '#f472b6';

          return (
            <div
              key={pred.hand}
              className="flex items-center gap-4 w-full animate-fade-in"
              role="progressbar"
              aria-label={`${pred.hand} hand ${pred.gesture} confidence`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
              aria-valuetext={`${pct}%`}
            >
              {/* Hand Label */}
              <span
                className="text-[10px] shrink-0 font-black uppercase tracking-wider px-2 py-0.5 rounded"
                style={{
                  backgroundColor: isLeft ? 'rgba(0, 240, 255, 0.15)' : 'rgba(244, 114, 182, 0.15)',
                  color: handColor,
                  minWidth: '54px',
                  textAlign: 'center',
                }}
              >
                {isLeft ? 'Left' : 'Right'}
              </span>

              {/* Bar track */}
              <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-150"
                  style={{
                    width: `${pct}%`,
                    backgroundColor: handColor,
                    boxShadow: `0 0 8px ${handColor}80`,
                  }}
                />
              </div>

              {/* Percentage */}
              <span
                className="text-xs w-10 text-right shrink-0 font-extrabold tracking-tight"
                style={{ color: handColor }}
              >
                {pct}%
              </span>
            </div>
          );
        })
      )}
    </div>
  );
}
