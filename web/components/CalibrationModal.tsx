'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  CalibrationSettings,
  loadCalibrationSettings,
  saveCalibrationSettings,
  resetCalibrationSettings,
} from '@/lib/calibration';

interface CalibrationModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentPinchDistance?: number | null;
}

export default function CalibrationModal({
  isOpen,
  onClose,
  currentPinchDistance = null,
}: CalibrationModalProps): React.JSX.Element | null {
  const [settings, setSettings] = useState<CalibrationSettings>(() => loadCalibrationSettings());
  const [activeTab, setActiveTab] = useState<'hand' | 'workspace' | 'sensitivity' | 'pinch'>('hand');
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);

  // Sync settings when modal opens
  useEffect(() => {
    if (isOpen) {
      setSettings(loadCalibrationSettings());
      setSaveFeedback(null);
    }
  }, [isOpen]);

  const handleCancel = useCallback(() => {
    setSettings(loadCalibrationSettings());
    setSaveFeedback(null);
    onClose();
  }, [onClose]);

  // Handle Escape key dismissal
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        handleCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleCancel]);

  if (!isOpen) return null;

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      handleCancel();
    }
  };

  const handleSave = () => {
    saveCalibrationSettings(settings);
    setSaveFeedback('Calibration saved successfully!');
    setTimeout(() => {
      setSaveFeedback(null);
      onClose();
    }, 800);
  };

  const handleReset = () => {
    const res = resetCalibrationSettings();
    setSettings(res);
    setSaveFeedback('Reset to default calibration.');
    setTimeout(() => setSaveFeedback(null), 1500);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="calibration-modal-title"
      onClick={handleBackdropClick}
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-fade-in"
    >
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/80">
          <div>
            <h2 id="calibration-modal-title" className="text-xl font-bold text-slate-100 flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-cyan-400"></span>
              Webcam & Pointer Calibration
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Customize tracking bounds, sensitivity, and pinch click thresholds for your environment.
            </p>
          </div>
          <button
            type="button"
            onClick={handleCancel}
            aria-label="Close calibration dialog"
            className="text-slate-400 hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-800 transition"
          >
            ✕
          </button>
        </div>

        {/* Navigation Tabs */}
        <div role="tablist" aria-label="Calibration settings sections" className="flex border-b border-slate-800 bg-slate-950/40 px-6 pt-2 gap-2 text-sm">
          {[
            { id: 'hand', label: '1. Handedness' },
            { id: 'workspace', label: '2. Active Area' },
            { id: 'sensitivity', label: '3. Sensitivity' },
            { id: 'pinch', label: '4. Pinch Click' },
          ].map((tab) => (
            <button
              key={tab.id}
              id={`calibration-tab-${tab.id}`}
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-controls={`calibration-panel-${tab.id}`}
              type="button"
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={`pb-2.5 px-3 font-medium transition border-b-2 ${
                activeTab === tab.id
                  ? 'border-cyan-400 text-cyan-300'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Body */}
        <div
          role="tabpanel"
          id={`calibration-panel-${activeTab}`}
          aria-labelledby={`calibration-tab-${activeTab}`}
          className="p-6 overflow-y-auto space-y-6 flex-1 text-sm text-slate-300"
        >
          {activeTab === 'hand' && (
            <div className="space-y-4">
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Select Dominant Hand for Pointer Movement
              </label>
              <div className="grid grid-cols-3 gap-3">
                {(['Right', 'Left', 'Auto'] as const).map((hand) => (
                  <button
                    key={hand}
                    type="button"
                    onClick={() => setSettings((s) => ({ ...s, dominantHand: hand }))}
                    className={`py-3 px-4 rounded-xl border flex flex-col items-center gap-1.5 transition ${
                      settings.dominantHand === hand
                        ? 'bg-cyan-950/60 border-cyan-500 text-cyan-200 font-semibold'
                        : 'bg-slate-800/60 border-slate-700 text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    <span className="text-xl">
                      {hand === 'Right' ? '👉' : hand === 'Left' ? '👈' : '⚡'}
                    </span>
                    <span>{hand === 'Auto' ? 'Auto-Detect' : `${hand} Hand`}</span>
                  </button>
                ))}
              </div>
              <p className="text-xs text-slate-400 bg-slate-800/40 p-3 rounded-lg border border-slate-800">
                In Right Hand mode, the right hand controls the cursor while the left hand acts as the modifier.
                In Left Hand mode, roles are inverted for comfortable southpaw navigation.
              </p>
            </div>
          )}

          {activeTab === 'workspace' && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
                  Active Screen Area Bounding Box
                </label>
                <p className="text-xs text-slate-400">
                  Constrains the natural range of motion so you don't need to stretch across the whole camera frame.
                </p>
              </div>

              <div className="space-y-3 bg-slate-950/60 p-4 rounded-xl border border-slate-800">
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span>Horizontal Reach Margin (X):</span>
                    <span className="font-mono text-cyan-300">
                      {Math.round(settings.workspaceBounds.minX * 100)}% – {Math.round(settings.workspaceBounds.maxX * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0.05"
                    max="0.35"
                    step="0.01"
                    value={settings.workspaceBounds.minX}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      setSettings((s) => ({
                        ...s,
                        workspaceBounds: {
                          ...s.workspaceBounds,
                          minX: val,
                          maxX: 1 - val,
                        },
                      }));
                    }}
                    className="w-full accent-cyan-400"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span>Vertical Reach Margin (Y):</span>
                    <span className="font-mono text-cyan-300">
                      {Math.round(settings.workspaceBounds.minY * 100)}% – {Math.round(settings.workspaceBounds.maxY * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0.05"
                    max="0.35"
                    step="0.01"
                    value={settings.workspaceBounds.minY}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      setSettings((s) => ({
                        ...s,
                        workspaceBounds: {
                          ...s.workspaceBounds,
                          minY: val,
                          maxY: 1 - val,
                        },
                      }));
                    }}
                    className="w-full accent-cyan-400"
                  />
                </div>
              </div>
            </div>
          )}

          {activeTab === 'sensitivity' && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
                  Cursor Speed & Smoothing
                </label>
                <p className="text-xs text-slate-400">
                  Higher sensitivity speeds up the pointer; higher smoothing dampens natural hand tremor.
                </p>
              </div>

              <div className="space-y-4 bg-slate-950/60 p-4 rounded-xl border border-slate-800">
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span>Pointer Sensitivity:</span>
                    <span className="font-mono text-cyan-300">{settings.pointerSensitivity.toFixed(2)}x</span>
                  </div>
                  <input
                    type="range"
                    min="0.6"
                    max="2.5"
                    step="0.05"
                    value={settings.pointerSensitivity}
                    onChange={(e) =>
                      setSettings((s) => ({ ...s, pointerSensitivity: parseFloat(e.target.value) }))
                    }
                    className="w-full accent-cyan-400"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span>EMA Smoothing Factor (Alpha):</span>
                    <span className="font-mono text-cyan-300">{settings.smoothingAlpha.toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    min="0.08"
                    max="0.5"
                    step="0.02"
                    value={settings.smoothingAlpha}
                    onChange={(e) =>
                      setSettings((s) => ({ ...s, smoothingAlpha: parseFloat(e.target.value) }))
                    }
                    className="w-full accent-cyan-400"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span>Tremor Deadzone Radius:</span>
                    <span className="font-mono text-cyan-300">{(settings.deadzoneRadius * 1000).toFixed(1)} mm</span>
                  </div>
                  <input
                    type="range"
                    min="0.0"
                    max="0.02"
                    step="0.001"
                    value={settings.deadzoneRadius}
                    onChange={(e) =>
                      setSettings((s) => ({ ...s, deadzoneRadius: parseFloat(e.target.value) }))
                    }
                    className="w-full accent-cyan-400"
                  />
                </div>
              </div>
            </div>
          )}

          {activeTab === 'pinch' && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
                  Pinch Click Threshold
                </label>
                <p className="text-xs text-slate-400">
                  Adjust how close your thumb and index fingertip must be to trigger a primary left click.
                </p>
              </div>

              <div className="space-y-3 bg-slate-950/60 p-4 rounded-xl border border-slate-800">
                <div className="flex justify-between text-xs mb-1">
                  <span>Pinch Distance Trigger:</span>
                  <span className="font-mono text-cyan-300">{settings.pinchThreshold.toFixed(3)}</span>
                </div>
                <input
                  type="range"
                  min="0.03"
                  max="0.12"
                  step="0.005"
                  value={settings.pinchThreshold}
                  onChange={(e) =>
                    setSettings((s) => ({ ...s, pinchThreshold: parseFloat(e.target.value) }))
                  }
                  className="w-full accent-cyan-400"
                />

                {/* Real-time Pinch Visualizer */}
                <div className="mt-4 pt-3 border-t border-slate-800/80">
                  <div className="flex justify-between items-center text-xs text-slate-400 mb-1.5">
                    <span>Live Fingertip Distance:</span>
                    <span className="font-mono">
                      {currentPinchDistance !== null
                        ? currentPinchDistance.toFixed(3)
                        : 'No hand detected'}
                    </span>
                  </div>
                  <div className="relative h-3 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="absolute top-0 bottom-0 left-0 bg-slate-600 transition-all duration-75"
                      style={{
                        width: `${Math.min(100, Math.max(0, ((currentPinchDistance ?? 0.2) / 0.15) * 100))}%`,
                      }}
                    />
                    {/* Threshold marker */}
                    <div
                      className="absolute top-0 bottom-0 w-1 bg-cyan-400 shadow-sm"
                      style={{
                        left: `${(settings.pinchThreshold / 0.15) * 100}%`,
                      }}
                    />
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1.5">
                    When the bar moves to the left of the cyan marker line, a click is registered.
                  </p>
                </div>
              </div>
            </div>
          )}

          {saveFeedback && (
            <div className="p-3 bg-emerald-950/50 border border-emerald-500/40 rounded-xl text-emerald-300 text-xs text-center animate-fade-in">
              ✓ {saveFeedback}
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="px-6 py-3.5 border-t border-slate-800 bg-slate-900 flex items-center justify-between">
          <button
            type="button"
            onClick={handleReset}
            className="text-xs text-slate-400 hover:text-slate-200 transition underline underline-offset-4"
          >
            Reset to Defaults
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleCancel}
              className="px-4 py-2 rounded-xl text-xs font-medium text-slate-300 hover:bg-slate-800 transition"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="px-5 py-2 rounded-xl text-xs font-semibold bg-cyan-500 hover:bg-cyan-400 text-slate-950 shadow-md shadow-cyan-500/20 transition"
            >
              Save Calibration
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
