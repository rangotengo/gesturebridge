'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { Landmark } from '@/ml/gestureUtils';
import {
  CalibrationSettings,
  PINCH_RATIO_RANGE,
  SENSITIVITY_RANGE,
  computePinchRatioThreshold,
  computeWorkspaceBounds,
  loadCalibrationSettings,
  saveCalibrationSettings,
  resetCalibrationSettings,
  type WorkspaceBounds,
} from '@/lib/calibration';
import { PINCH_RELEASE_FACTOR } from '@/lib/gestureConfig';
import { getMirroredTrackingPoint, type NormalizedPointerPosition } from '@/features/control/pointerTracking';
import { getPinchRatio } from '@/hooks/usePinchDetector';

interface CalibrationModalProps {
  isOpen?: boolean;
  onClose: () => void;
  /** Dominant hand landmarks from the live camera, or null when no hand is in frame. */
  handLandmarks?: Landmark[] | null;
  /** Camera width / height, used to measure the pinch without stretching. */
  cameraAspect?: number;
}

type CaptureKind = 'reach' | 'pinch-open' | 'pinch-closed';

const CAPTURE_PLAN: Record<CaptureKind, { durationMs: number; step: string; prompt: string }> = {
  reach: {
    durationMs: 6_000,
    step: 'Tracing your reach',
    prompt: 'Sweep your hand slowly to each corner you can reach without stretching.',
  },
  'pinch-open': {
    durationMs: 2_200,
    step: 'Step 1 of 2',
    prompt: 'Hold your normal pointing pose with your thumb away from your index finger.',
  },
  'pinch-closed': {
    durationMs: 2_200,
    step: 'Step 2 of 2',
    prompt: 'Pinch your thumb and index fingertip together and hold.',
  },
};

/** Samples from the first moments of each step are skipped while the user reacts. */
const CAPTURE_WARMUP_MS = 600;
const RATIO_BAR_MAX = 0.8;

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function ActiveAreaMap({
  bounds,
  point,
  aspect,
}: {
  bounds: WorkspaceBounds;
  point: NormalizedPointerPosition | null;
  aspect: number;
}): React.JSX.Element {
  return (
    <div
      className="relative w-full overflow-hidden rounded-lg border border-slate-700 bg-slate-950"
      style={{ aspectRatio: aspect }}
      aria-hidden="true"
    >
      <div
        className="absolute rounded border-2 border-cyan-400/80 bg-cyan-400/10"
        style={{
          left: percent(bounds.minX),
          top: percent(bounds.minY),
          width: percent(bounds.maxX - bounds.minX),
          height: percent(bounds.maxY - bounds.minY),
        }}
      />
      {point && (
        <div
          className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-pink-400 shadow-[0_0_8px_rgba(244,114,182,0.9)]"
          style={{ left: percent(point.x), top: percent(point.y) }}
        />
      )}
      <span className="absolute left-2 top-1.5 text-[10px] uppercase tracking-wider text-slate-500">
        Camera view
      </span>
    </div>
  );
}

export default function CalibrationModal({
  isOpen = true,
  onClose,
  handLandmarks = null,
  cameraAspect = 16 / 9,
}: CalibrationModalProps): React.JSX.Element | null {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [settings, setSettings] = useState<CalibrationSettings>(() => loadCalibrationSettings());
  const [activeTab, setActiveTab] = useState<'hand' | 'workspace' | 'pointer' | 'pinch'>('hand');
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);

  const [capture, setCapture] = useState<{ kind: CaptureKind; startedAt: number } | null>(null);
  const [captureElapsed, setCaptureElapsed] = useState(0);
  const [captureMessage, setCaptureMessage] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const reachSamplesRef = useRef<NormalizedPointerPosition[]>([]);
  const openRatiosRef = useRef<number[]>([]);
  const closedRatiosRef = useRef<number[]>([]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (dialog.showModal && !dialog.open) {
      dialog.showModal();
    }

    return () => {
      if (dialog.close && dialog.open) {
        dialog.close();
      }
    };
  }, []);

  const startCapture = useCallback((kind: CaptureKind): void => {
    if (kind === 'reach') {
      reachSamplesRef.current = [];
    } else {
      openRatiosRef.current = [];
      closedRatiosRef.current = [];
    }
    setCaptureMessage(null);
    setCaptureElapsed(0);
    setCapture({ kind, startedAt: Date.now() });
  }, []);

  const finishCapture = useCallback((kind: CaptureKind): void => {
    if (kind === 'pinch-open') {
      setCaptureElapsed(0);
      setCapture({ kind: 'pinch-closed', startedAt: Date.now() });
      return;
    }

    setCapture(null);
    if (kind === 'reach') {
      const bounds = computeWorkspaceBounds(reachSamplesRef.current);
      if (!bounds) {
        setCaptureMessage({
          tone: 'error',
          text: 'Not enough movement was tracked. Keep your hand in view and sweep a wider area.',
        });
        return;
      }
      setSettings((s) => ({ ...s, workspaceBounds: bounds }));
      setCaptureMessage({ tone: 'success', text: 'Active area captured. Save to apply it.' });
      return;
    }

    const threshold = computePinchRatioThreshold(openRatiosRef.current, closedRatiosRef.current);
    if (threshold === null) {
      setCaptureMessage({
        tone: 'error',
        text: 'Your open hand and pinch looked too similar. Keep your hand in view, hold the thumb farther away in step 1, and pinch firmly in step 2.',
      });
      return;
    }
    setSettings((s) => ({ ...s, pinchRatio: threshold }));
    setCaptureMessage({ tone: 'success', text: `Pinch threshold set to ${threshold.toFixed(2)}. Save to apply it.` });
  }, []);

  useEffect(() => {
    if (!capture) return;
    const ticker = window.setInterval(() => setCaptureElapsed(Date.now() - capture.startedAt), 100);
    const done = window.setTimeout(() => finishCapture(capture.kind), CAPTURE_PLAN[capture.kind].durationMs);
    return () => {
      window.clearInterval(ticker);
      window.clearTimeout(done);
    };
  }, [capture, finishCapture]);

  useEffect(() => {
    if (!capture || !handLandmarks) return;
    if (Date.now() - capture.startedAt < CAPTURE_WARMUP_MS) return;
    if (capture.kind === 'reach') {
      const point = getMirroredTrackingPoint(handLandmarks, settings.trackingPoint);
      if (point) reachSamplesRef.current.push(point);
      return;
    }
    const ratio = getPinchRatio(handLandmarks, cameraAspect);
    if (ratio === null) return;
    (capture.kind === 'pinch-open' ? openRatiosRef : closedRatiosRef).current.push(ratio);
  }, [capture, handLandmarks, settings.trackingPoint, cameraAspect]);

  if (!isOpen) return null;

  const handleSave = () => {
    setCapture(null);
    saveCalibrationSettings(settings);
    setSaveFeedback('Calibration saved successfully!');
    setTimeout(() => {
      setSaveFeedback(null);
      onClose();
    }, 800);
  };

  const handleReset = () => {
    setCapture(null);
    setCaptureMessage(null);
    const res = resetCalibrationSettings();
    setSettings(res);
    setSaveFeedback('Reset to default calibration.');
    setTimeout(() => setSaveFeedback(null), 1500);
  };

  const livePoint = handLandmarks ? getMirroredTrackingPoint(handLandmarks, settings.trackingPoint) : null;
  const liveRatio = handLandmarks ? getPinchRatio(handLandmarks, cameraAspect) : null;
  const releaseRatio = settings.pinchRatio * PINCH_RELEASE_FACTOR;
  const bounds = settings.workspaceBounds;
  const capturePlan = capture ? CAPTURE_PLAN[capture.kind] : null;

  const captureStatus = (
    <>
      {capture && capturePlan && (
        <div
          className="rounded-xl border border-cyan-500/40 bg-cyan-950/40 p-3 text-xs text-cyan-100"
          role="status"
          aria-live="polite"
        >
          <p className="text-[10px] font-bold uppercase tracking-wider text-cyan-300">{capturePlan.step}</p>
          <p className="mt-0.5 font-semibold">{capturePlan.prompt}</p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full bg-cyan-400 transition-[width] duration-100"
              style={{ width: `${Math.min(100, (captureElapsed / capturePlan.durationMs) * 100)}%` }}
            />
          </div>
          {!handLandmarks && (
            <p className="mt-1.5 text-amber-300">No hand detected. Move your hand into the camera view.</p>
          )}
        </div>
      )}
      {!capture && captureMessage && (
        <p
          className={`rounded-lg border p-2.5 text-xs ${
            captureMessage.tone === 'error'
              ? 'border-amber-500/40 bg-amber-950/40 text-amber-200'
              : 'border-emerald-500/40 bg-emerald-950/40 text-emerald-200'
          }`}
          role="status"
        >
          {captureMessage.text}
        </p>
      )}
    </>
  );

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="calibration-modal-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === dialogRef.current) {
          onClose();
        }
      }}
      className="fixed inset-0 m-auto bg-transparent p-0 border-none outline-none max-w-none max-h-none w-full h-full flex items-center justify-center backdrop:bg-black/70 backdrop:backdrop-blur-sm z-[110]"
    >
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-fade-in mx-4">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/80">
          <div>
            <h2 id="calibration-modal-title" className="text-xl font-bold text-slate-100 flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-cyan-400"></span>
              Webcam &amp; Pointer Calibration
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Customize tracking bounds, sensitivity, and pinch click thresholds for your environment.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
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
            { id: 'pointer', label: '3. Pointer' },
            { id: 'pinch', label: '4. Pinch Click' },
          ].map((tab) => (
            <button
              key={tab.id}
              id={`calibration-tab-${tab.id}`}
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-controls={`calibration-panel-${tab.id}`}
              tabIndex={activeTab === tab.id ? 0 : -1}
              onClick={() => {
                setCapture(null);
                setCaptureMessage(null);
                setActiveTab(tab.id as typeof activeTab);
              }}
              className={`pb-2.5 px-3 font-semibold transition border-b-2 -mb-px ${
                activeTab === tab.id
                  ? 'border-cyan-400 text-cyan-300'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 text-slate-200 text-sm">
          {/* Tab 1: Hand Preference */}
          {activeTab === 'hand' && (
            <div id="calibration-panel-hand" role="tabpanel" aria-labelledby="calibration-tab-hand" className="space-y-4">
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

          {/* Tab 2: Active Workspace Area */}
          {activeTab === 'workspace' && (
            <div id="calibration-panel-workspace" role="tabpanel" aria-labelledby="calibration-tab-workspace" className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
                  Active Screen Area Bounding Box
                </label>
                <p className="text-xs text-slate-400">
                  The cyan box maps to your whole screen. Trace your comfortable reach so every screen edge is
                  easy to hit without your hand leaving the camera view.
                </p>
              </div>

              <ActiveAreaMap bounds={bounds} point={livePoint} aspect={cameraAspect} />

              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-xs text-cyan-300">
                  X {percent(bounds.minX)}–{percent(bounds.maxX)} · Y {percent(bounds.minY)}–{percent(bounds.maxY)}
                </span>
                <button
                  type="button"
                  onClick={() => startCapture('reach')}
                  disabled={capture !== null}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-cyan-500 hover:bg-cyan-400 text-slate-950 disabled:opacity-50 transition"
                >
                  Trace My Reach
                </button>
              </div>

              {captureStatus}

              <div className="space-y-3 bg-slate-950/60 p-4 rounded-xl border border-slate-800">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Manual (centered)</p>
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span>Horizontal Reach Margin (X):</span>
                    <span className="font-mono text-cyan-300">
                      {percent(bounds.minX)} – {percent(bounds.maxX)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0.05"
                    max="0.35"
                    step="0.01"
                    value={bounds.minX}
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
                      {percent(bounds.minY)} – {percent(bounds.maxY)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0.05"
                    max="0.35"
                    step="0.01"
                    value={bounds.minY}
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

          {/* Tab 3: Tracking point, speed, and smoothing */}
          {activeTab === 'pointer' && (
            <div id="calibration-panel-pointer" role="tabpanel" aria-labelledby="calibration-tab-pointer" className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
                  Tracking Point
                </label>
                <div className="grid grid-cols-2 gap-3">
                  {([
                    { id: 'palm', title: 'Palm (steady)', detail: 'Cursor stays put while you pinch or change gestures.' },
                    { id: 'fingertip', title: 'Index fingertip', detail: 'Finer finger control, but moves when the finger bends.' },
                  ] as const).map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      aria-pressed={settings.trackingPoint === option.id}
                      onClick={() => setSettings((s) => ({ ...s, trackingPoint: option.id }))}
                      className={`py-2.5 px-3 rounded-xl border text-left transition ${
                        settings.trackingPoint === option.id
                          ? 'bg-cyan-950/60 border-cyan-500 text-cyan-200'
                          : 'bg-slate-800/60 border-slate-700 text-slate-300 hover:bg-slate-800'
                      }`}
                    >
                      <span className="block text-xs font-semibold">{option.title}</span>
                      <span className="mt-0.5 block text-[11px] text-slate-400">{option.detail}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-4 bg-slate-950/60 p-4 rounded-xl border border-slate-800">
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span>Pointer Sensitivity:</span>
                    <span className="font-mono text-cyan-300">{settings.pointerSensitivity.toFixed(2)}x</span>
                  </div>
                  <input
                    type="range"
                    min={SENSITIVITY_RANGE.min}
                    max="2.5"
                    step="0.05"
                    value={settings.pointerSensitivity}
                    onChange={(e) =>
                      setSettings((s) => ({ ...s, pointerSensitivity: parseFloat(e.target.value) }))
                    }
                    className="w-full accent-cyan-400"
                  />
                  <p className="mt-1 text-[11px] text-slate-500">
                    Above 1x, the screen edges are reached before the edges of the active area.
                  </p>
                </div>

                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span>Steadiness:</span>
                    <span className="font-mono text-cyan-300">{percent(settings.smoothing)}</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={settings.smoothing}
                    onChange={(e) => setSettings((s) => ({ ...s, smoothing: parseFloat(e.target.value) }))}
                    className="w-full accent-cyan-400"
                  />
                  <p className="mt-1 text-[11px] text-slate-500">
                    Higher holds the cursor still against hand tremor, but slow moves take longer to settle.
                  </p>
                </div>

                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span>Fast-Move Response:</span>
                    <span className="font-mono text-cyan-300">{percent(settings.responsiveness)}</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={settings.responsiveness}
                    onChange={(e) => setSettings((s) => ({ ...s, responsiveness: parseFloat(e.target.value) }))}
                    className="w-full accent-cyan-400"
                  />
                  <p className="mt-1 text-[11px] text-slate-500">
                    Higher keeps the cursor close behind quick sweeps. Lower it if fast moves overshoot or wobble.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Tab 4: Pinch Click Calibration */}
          {activeTab === 'pinch' && (
            <div id="calibration-panel-pinch" role="tabpanel" aria-labelledby="calibration-tab-pinch" className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
                    Pinch Click Threshold
                  </label>
                  <p className="text-xs text-slate-400">
                    Measured as the thumb-to-index gap relative to your palm size, so it holds at any distance
                    from the camera. A quick pinch clicks; holding the pinch starts a drag.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => startCapture('pinch-open')}
                  disabled={capture !== null}
                  className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold bg-cyan-500 hover:bg-cyan-400 text-slate-950 disabled:opacity-50 transition"
                >
                  Auto-Calibrate
                </button>
              </div>

              {captureStatus}

              <div className="space-y-3 bg-slate-950/60 p-4 rounded-xl border border-slate-800">
                <div className="flex justify-between text-xs mb-1">
                  <span>Pinch Trigger Ratio:</span>
                  <span className="font-mono text-cyan-300">
                    {settings.pinchRatio.toFixed(2)} (releases above {releaseRatio.toFixed(2)})
                  </span>
                </div>
                <input
                  type="range"
                  min={PINCH_RATIO_RANGE.min}
                  max={PINCH_RATIO_RANGE.max}
                  step="0.01"
                  value={settings.pinchRatio}
                  onChange={(e) =>
                    setSettings((s) => ({ ...s, pinchRatio: parseFloat(e.target.value) }))
                  }
                  className="w-full accent-cyan-400"
                />

                {/* Real-time Pinch Visualizer */}
                <div className="mt-4 pt-3 border-t border-slate-800/80">
                  <div className="flex justify-between items-center text-xs text-slate-400 mb-1.5">
                    <span>Live Thumb–Index Ratio:</span>
                    <span className="flex items-center gap-2 font-mono">
                      {liveRatio !== null ? liveRatio.toFixed(2) : 'No hand detected'}
                      {liveRatio !== null && (
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                            liveRatio <= settings.pinchRatio
                              ? 'bg-emerald-500/20 text-emerald-300'
                              : 'bg-slate-700/60 text-slate-300'
                          }`}
                        >
                          {liveRatio <= settings.pinchRatio ? 'Pinched' : 'Open'}
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="relative h-3 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="absolute top-0 bottom-0 left-0 bg-slate-600 transition-all duration-75"
                      style={{
                        width: `${Math.min(100, Math.max(0, ((liveRatio ?? RATIO_BAR_MAX) / RATIO_BAR_MAX) * 100))}%`,
                      }}
                    />
                    <div
                      className="absolute top-0 bottom-0 w-1 bg-cyan-400 shadow-sm"
                      style={{ left: `${Math.min(100, (settings.pinchRatio / RATIO_BAR_MAX) * 100)}%` }}
                    />
                    <div
                      className="absolute top-0 bottom-0 w-1 bg-amber-400/80"
                      style={{ left: `${Math.min(100, (releaseRatio / RATIO_BAR_MAX) * 100)}%` }}
                    />
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1.5">
                    A pinch starts when the bar passes left of the cyan line and ends once it moves right of the
                    amber line, so small tremors cannot split one pinch into two clicks.
                  </p>
                </div>
              </div>
            </div>
          )}

          {saveFeedback && (
            <div className="p-3 bg-emerald-950/50 border border-emerald-500/40 rounded-xl text-emerald-300 text-xs text-center animate-fade-in" role="status">
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
              onClick={onClose}
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
    </dialog>
  );
}
