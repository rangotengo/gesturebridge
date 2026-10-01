'use client';

import React, { useState, useEffect, useCallback, useRef, useSyncExternalStore } from 'react';
import ProtectedRoute from '@/components/ProtectedRoute';
import WebcamView from '@/components/WebcamView';
import GestureDisplay from '@/components/GestureDisplay';
import ConfidenceBar from '@/components/ConfidenceBar';
import ModeToggle from '@/components/ModeToggle';
import MirrorFogOverlay from '@/components/MirrorFogOverlay';
import { useGestureModel } from '@/hooks/useGestureModel';
import { useMouseControl } from '@/hooks/useMouseControl';
import { useSocket } from '@/hooks/useSocket';
import { useGestures } from '@/context/GestureContext';
import { normalizeLandmarks, type HandData, type HandPrediction } from '@/ml/gestureUtils';
import { useModeToggle } from '@/hooks/useModeToggle';
import ModeToggleOverlay from '@/components/ModeToggleOverlay';
import { useHoldToToggle } from '@/hooks/useHoldToToggle';
import { assignHandRoles } from '@/hooks/useHandRoles';
import { useTwoHandControl } from '@/hooks/useTwoHandControl';
import { useTwoHandZoom } from '@/hooks/useTwoHandZoom';
import { useAdminSession } from '@/hooks/useAdminSession';
import { useBlowDetection } from '@/hooks/useBlowDetection';
import { useFacePucker } from '@/hooks/useFacePucker';
import type { ControlMode } from '@/features/control/modes';
import { mapRawLandmarkToMirroredCoverViewport } from '@/features/control/pointerTracking';
import { saveCollectedSamples, trainDatasetModel } from '@/features/datasets/queries';
import CalibrationModal from '@/components/CalibrationModal';
import ProfileSelectorModal from '@/components/ProfileSelectorModal';
import { getPinchDistance } from '@/hooks/usePinchDetector';


const LOG_THROTTLE_MS = 2000;

// ────────────────────────────────────────────────────────────
// Camera icon SVGs (inline, no external lib needed)
// ────────────────────────────────────────────────────────────
function CameraOnIcon(): React.ReactElement {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

function CameraOffIcon(): React.ReactElement {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="1" y1="1" x2="23" y2="23" />
      <path d="M21 21H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3m3-3h6l2 3h4a2 2 0 0 1 2 2v9.34m-7.72-2.06A4 4 0 1 1 8.71 8.71" />
    </svg>
  );
}

function ChevronDownIcon(): React.ReactElement {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

// ────────────────────────────────────────────────────────────
// Main page
// ────────────────────────────────────────────────────────────
function HomePage(): React.ReactElement {
  // ── State ──────────────────────────────────────────────────
  const [hands, setHands] = useState<HandData[]>([]);
  const [isCameraOn, setIsCameraOn] = useState(true);
  const [isInitializing, setIsInitializing] = useState(true);
  const [initVisible, setInitVisible] = useState(true);   // controls fade-out
  const [isImproveOpen, setIsImproveOpen] = useState(false);
  const [isCalibrationOpen, setIsCalibrationOpen] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [predictions, setPredictions] = useState<HandPrediction[]>([]);
  const [activeMode, setActiveMode] = useState<ControlMode>('recognition');
  const [fogDensity, setFogDensity] = useState(0);
  const [blowNonce, setBlowNonce] = useState(0);

  // Improve-AI panel state
  const [selectedImproveGesture, setSelectedImproveGesture] = useState('');
  const [newCustomGestureName, setNewCustomGestureName] = useState('');
  const [isCreatingGesture, setIsCreatingGesture] = useState(false);
  const [capturedSamples, setCapturedSamples] = useState<{ features: number[]; label: number }[]>([]);
  const [improveMessage, setImproveMessage] = useState<{
    type: 'error' | 'info' | 'success';
    text: string;
  } | null>(null);
  const [isSubmittingSamples, setIsSubmittingSamples] = useState(false);
  const [isTrainingModel, setIsTrainingModel] = useState(false);
  const [videoDimensions, setVideoDimensions] = useState<{ width: number; height: number }>({
    width: 1280,
    height: 720,
  });

  const lastLoggedTime = useRef(0);
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);

  // ── Hooks ──────────────────────────────────────────────────
  const { predict, isReady: isModelReady, error: modelError, reloadModel } = useGestureModel();
  const { gestureLabels, addCustomGesture } = useGestures();
  const { isAdmin } = useAdminSession();
  const { emit } = useSocket();
  const isElectron = useSyncExternalStore(
    () => () => undefined,
    () => Boolean(window.electronAPI),
    () => false
  );
  const isMouseModeActive = activeMode === 'mouse-control';
  const isMirrorModeActive = activeMode === 'mirror';

  const selectControlMode = useCallback((mode: ControlMode): void => {
    setActiveMode(mode);
    // Mirror Mode starts clear — mist only appears after a blow/pucker.
    setFogDensity(0);
    setBlowNonce(0);
  }, []);

  const toggleInteractiveMode = useCallback((mode: 'mouse-control' | 'mirror'): void => {
    selectControlMode(activeMode === mode ? 'recognition' : mode);
  }, [activeMode, selectControlMode]);

  const triggerFogBurst = useCallback((): void => {
    setFogDensity((density) => Math.min(1, density + 0.28));
    setBlowNonce((nonce) => nonce + 1);
  }, []);

  useEffect(() => {
    if (!isElectron || typeof window === 'undefined' || typeof window.electronAPI?.onEmergencyStop !== 'function') {
      return;
    }
    return window.electronAPI.onEmergencyStop(() => {
      selectControlMode('recognition');
    });
  }, [isElectron, selectControlMode]);

  // Identify dominant and modifier hands and get their predicted gesture index and wrist coordinate
  const handRoles = assignHandRoles(hands.map((h) => h.handedness));
  const dominantHand = handRoles.dominantHand !== null ? hands[handRoles.dominantHand] : null;
  const modifierHand = handRoles.modifierHand !== null ? hands[handRoles.modifierHand] : null;

  const dominantPrediction = dominantHand
    ? predictions.find((p) => p.hand === dominantHand.handedness)
    : null;
  const currentGestureLabel = dominantPrediction && dominantPrediction.confidence > 0.6
    ? gestureLabels.indexOf(dominantPrediction.gesture)
    : -1;
  const wristPosition = dominantHand ? dominantHand.landmarks[0] : null;

  const modifierPrediction = modifierHand
    ? predictions.find((p) => p.hand === modifierHand.handedness)
    : null;
  const modifierGestureLabel = modifierPrediction && modifierPrediction.confidence > 0.6
    ? gestureLabels.indexOf(modifierPrediction.gesture)
    : -1;

  const mouseHold = useModeToggle(
    currentGestureLabel,
    wristPosition,
    () => toggleInteractiveMode('mouse-control'),
    isElectron
  );
  const mirrorHold = useHoldToToggle({
    isGestureActive: currentGestureLabel === 1 && wristPosition !== null,
    durationMs: 5_000,
    onToggle: () => toggleInteractiveMode('mirror'),
    enabled: isElectron,
  });
  const mirrorExperienceEnabled = isElectron && isMirrorModeActive && isCameraOn;
  const { microphoneStatus } = useBlowDetection({
    enabled: mirrorExperienceEnabled,
    onBlow: triggerFogBurst,
  });
  useFacePucker({
    videoRef: cameraVideoRef,
    enabled: mirrorExperienceEnabled && microphoneStatus === 'unavailable',
    onPucker: triggerFogBurst,
  });
  // Raw MediaPipe coords — MirrorFogOverlay lives inside the CSS-mirrored camera plane.
  const mirrorFingertipPosition =
    isMirrorModeActive && currentGestureLabel === 0 && dominantHand?.landmarks[8]
      ? {
          x: dominantHand.landmarks[8].x,
          y: dominantHand.landmarks[8].y,
        }
      : null;

  const mirroredWristPosition =
    wristPosition && typeof window !== 'undefined'
      ? mapRawLandmarkToMirroredCoverViewport(
          wristPosition,
          {
            width: videoDimensions.width || window.innerWidth,
            height: videoDimensions.height || window.innerHeight,
          },
          { width: window.innerWidth, height: window.innerHeight }
        )
      : null;

  // Two-hand control hooks
  const { isFrozen, isDragging } = useTwoHandControl(
    dominantHand ? dominantHand.landmarks : null,
    modifierHand ? modifierHand.landmarks : null,
    modifierGestureLabel !== -1 ? modifierGestureLabel : null,
    isMouseModeActive
  );

  const bothHandsActive =
    dominantHand !== null &&
    modifierHand !== null &&
    isMouseModeActive &&
    modifierGestureLabel !== 1 &&
    modifierGestureLabel !== 2 &&
    modifierGestureLabel !== 3;

  const { isZooming, zoomDirection } = useTwoHandZoom(
    dominantHand ? dominantHand.landmarks : null,
    modifierHand ? modifierHand.landmarks : null,
    bothHandsActive
  );

  useMouseControl(dominantHand, isMouseModeActive, currentGestureLabel, isFrozen);

  const handleCameraToggle = (): void => {
    const nextCameraState = !isCameraOn;
    setIsCameraOn(nextCameraState);
    if (!nextCameraState) {
      setHands([]);
      setPredictions([]);
      selectControlMode('recognition');
    }
  };

  // Sync isMouseModeActive changes with Socket.IO server, Electron compact mode, and body class
  useEffect(() => {
    emit('mode:toggle', { active: isMouseModeActive });
    if (typeof window !== 'undefined' && window.electronAPI?.setCompactMode) {
      window.electronAPI.setCompactMode(isMouseModeActive);
    }
    if (isMouseModeActive) {
      document.body.classList.add('compact');
    } else {
      document.body.classList.remove('compact');
    }
    return () => {
      document.body.classList.remove('compact');
    };
  }, [isMouseModeActive, emit]);

  const activeImproveGesture = gestureLabels.includes(selectedImproveGesture)
    ? selectedImproveGesture
    : (gestureLabels[0] ?? '');

  // ── Callbacks ──────────────────────────────────────────────
  const onLandmarksUpdate = useCallback((newHands: HandData[]): void => {
    setHands(newHands);

    if (newHands.length > 0 && isModelReady) {
      const handPredictions: HandPrediction[] = [];
      newHands.forEach((hand) => {
        const res = predict(hand.landmarks);
        if (res && res.gesture) {
          handPredictions.push({
            hand: hand.handedness,
            gesture: res.gesture,
            confidence: res.confidence,
          });
        }
      });
      setPredictions(handPredictions);

      // Process emits & logging for high-confidence predictions
      handPredictions.forEach((pred) => {
        if (pred.confidence > 0.7) {
          emit('gesture', { hand: pred.hand, gesture: pred.gesture, confidence: pred.confidence });

          // Throttled server log
          const now = Date.now();
          if (isAdmin && now - lastLoggedTime.current > LOG_THROTTLE_MS) {
            lastLoggedTime.current = now;
            fetch('/api/logs', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                hand: pred.hand,
                gesture: pred.gesture,
                confidence: parseFloat(pred.confidence.toFixed(2)),
                platform: isElectron ? 'desktop' : 'browser',
                mode: activeMode,
              }),
            }).catch((err: unknown) => console.error('Failed to log gesture:', err));
          }
        }
      });
    } else {
      setPredictions([]);
    }
  }, [predict, isModelReady, isElectron, activeMode, emit, isAdmin]);


  /** Called by WebcamView once the first frame from MediaPipe arrives */
  const onFirstFrame = useCallback((): void => {
    // Start fade-out
    setIsInitializing(false);
    // Remove from DOM after transition completes
    setTimeout(() => setInitVisible(false), 600);
  }, []);

  /** Dismiss loading overlay if camera fails to initialize so error is visible */
  const onCameraError = useCallback((error: string | null): void => {
    if (error) {
      setIsInitializing(false);
      setInitVisible(false);
    }
  }, []);

  // ── Capture / upload / train helpers ───────────────────────
  const capturedCounts = gestureLabels.reduce<Record<string, number>>((acc, label) => {
    const labelIndex = gestureLabels.indexOf(label);
    const count = capturedSamples.filter((s) => s.label === labelIndex).length;
    return { ...acc, [label]: count };
  }, {});

  const handleCapturePose = useCallback((): void => {
    if (hands.length === 0) {
      setImproveMessage({ type: 'error', text: 'No hand detected! Position your hand clearly.' });
      return;
    }
    const controlHand = hands[0];
    const normalized = normalizeLandmarks(controlHand.landmarks);
    const labelIndex = gestureLabels.indexOf(activeImproveGesture);
    if (labelIndex < 0) return;
    setCapturedSamples((prev) => [...prev, { features: normalized, label: labelIndex }]);
    setImproveMessage({
      type: 'success',
      text: `Captured pose for "${activeImproveGesture}" (${controlHand.handedness} hand)! Press Spacebar or click again.`,
    });
  }, [hands, gestureLabels, activeImproveGesture]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.code === 'Space' && isImproveOpen) {
        const activeEl = document.activeElement as HTMLElement | null;
        if (
          activeEl &&
          (activeEl.tagName === 'INPUT' ||
            activeEl.tagName === 'TEXTAREA' ||
            activeEl.tagName === 'SELECT' ||
            activeEl.isContentEditable)
        ) {
          return;
        }
        e.preventDefault();
        handleCapturePose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isImproveOpen, handleCapturePose]);

  const handleUploadSamples = async (): Promise<void> => {
    if (capturedSamples.length === 0) return;
    setIsSubmittingSamples(true);
    setImproveMessage(null);
    try {
      const data = await saveCollectedSamples(capturedSamples);
      if (data.success) {
        const accepted = data.acceptedCount ?? capturedSamples.length;
        const rejected = data.rejectedCount ?? 0;
        if (rejected > 0) {
          setImproveMessage({
            type: 'info',
            text: `Uploaded ${accepted} samples! ${rejected} invalid samples retained for review.`,
          });
          const rejectedIndices = new Set(data.rejectedIndices ?? []);
          setCapturedSamples((prev) => prev.filter((_, idx) => rejectedIndices.has(idx)));
        } else {
          setImproveMessage({ type: 'success', text: `Uploaded ${accepted} samples!` });
          setCapturedSamples([]);
        }
      } else {
        setImproveMessage({ type: 'error', text: data.error ?? 'Failed to upload samples.' });
      }
    } catch (err) {
      setImproveMessage({ type: 'error', text: err instanceof Error ? err.message : 'Upload failed' });
    } finally {
      setIsSubmittingSamples(false);
    }
  };

  const handleTrainModel = async (): Promise<void> => {
    setIsTrainingModel(true);
    setImproveMessage({ type: 'info', text: 'Starting model training on server...' });
    try {
      setImproveMessage({ type: 'info', text: 'Training in progress on server (~10-20s)...' });
      const result = await trainDatasetModel();
      setImproveMessage({ type: 'info', text: 'Training complete! Hot-reloading new model...' });
      const reloaded = await reloadModel();
      setImproveMessage({
        type: reloaded ? 'success' : 'error',
        text: reloaded
          ? `AI model retrained (${result.samplesCount ?? ''} samples) and reloaded! Test it above.`
          : 'Retrained but failed to reload. Please refresh the page.',
      });
    } catch (err) {
      setImproveMessage({ type: 'error', text: err instanceof Error ? err.message : 'Training failed' });
    } finally {
      setIsTrainingModel(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────
  return (
    <>
      {/* ── Camera + skeleton overlay ── */}
      <WebcamView
        onLandmarksUpdate={onLandmarksUpdate}
        onFirstFrame={onFirstFrame}
        onError={onCameraError}
        isActive={isCameraOn}
        isCompact={isMouseModeActive}
        videoElementRef={cameraVideoRef}
        onVideoDimensionsChange={setVideoDimensions}
        mirrorOverlay={
          mirrorExperienceEnabled ? (
            <MirrorFogOverlay
              density={fogDensity}
              blowNonce={blowNonce}
              fingertipPosition={mirrorFingertipPosition}
              clearRadiusPx={52}
              videoRef={cameraVideoRef}
            />
          ) : null
        }
      />

      {/* ── Mode Toggle Gesture Animations Overlay (Electron / desktop only) ── */}
      {isElectron && (
        <ModeToggleOverlay
          phase={mirrorHold.phase !== 'idle' ? mirrorHold.phase : mouseHold.phase}
          progress={mirrorHold.phase !== 'idle' ? mirrorHold.progress : mouseHold.progress}
          wristPosition={mirroredWristPosition}
          stageIndex={mirrorHold.phase !== 'idle' ? mirrorHold.stageIndex : mouseHold.stageIndex}
          mode={mirrorHold.phase !== 'idle' ? 'mirror' : 'mouse'}
          isModeActive={mirrorHold.phase !== 'idle' ? isMirrorModeActive : isMouseModeActive}
        />
      )}
      {/* ── Compact Square UI ── */}
      {isMouseModeActive && (
        <div
          className="fixed inset-0 w-[220px] h-[220px] bg-slate-950/20 border border-white/15 rounded-2xl shadow-2xl flex flex-col items-center justify-between p-4 select-none overflow-hidden z-20"
          style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        >
          {/* Zoom Overlay (rendered absolutely inside the container) */}
          <div className={`absolute inset-0 flex flex-col items-center justify-center bg-slate-950/90 backdrop-blur-sm z-30 transition-all duration-300 pointer-events-none ${isZooming ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`}>
            <span className="text-4xl font-extrabold text-cyan-400 drop-shadow-lg flex flex-col items-center gap-1">
              <span>{zoomDirection === 'in' ? '🔍+' : '🔍−'}</span>
              <span className="text-[10px] uppercase font-black tracking-widest text-white/80 bg-white/10 px-2.5 py-0.5 rounded-full">
                Zoom {zoomDirection === 'in' ? 'In' : 'Out'}
              </span>
            </span>
          </div>

          {/* Top Bar: Title & Drag Indicator */}
          <div className="w-full flex items-center justify-between pointer-events-none">
            <span className="text-[10px] uppercase tracking-wider font-bold text-white/40">GestureBridge</span>
            <div className="flex gap-1 items-center">
              {isDragging && (
                <span className="text-[9px] uppercase font-black tracking-widest text-yellow-400 bg-yellow-400/10 border border-yellow-400/20 px-1.5 py-0.5 rounded">
                  Drag
                </span>
              )}
              {isFrozen && (
                <span className="text-[9px] uppercase font-black tracking-widest text-cyan-400 bg-cyan-400/10 border border-cyan-400/20 px-1.5 py-0.5 rounded">
                  Frozen
                </span>
              )}
            </div>
          </div>

          {/* Bottom: current gesture names displayed live */}
          <div
            className="w-full flex flex-col gap-1.5 items-center font-extrabold text-xs tracking-tight text-white/95"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            {/* Dominant Hand Gesture */}
            {currentGestureLabel !== -1 && gestureLabels[currentGestureLabel] ? (
              <span className="bg-slate-950/80 backdrop-blur-md px-3 py-1 rounded-full text-[11px] font-black border border-white/10 flex items-center gap-1 animate-fade-in whitespace-nowrap">
                <span className="w-1.5 h-1.5 rounded-full bg-pink-500" />
                {gestureLabels[currentGestureLabel] === 'Fist' && '✊ '}
                {gestureLabels[currentGestureLabel] === 'Peace' && '✌️ '}
                {gestureLabels[currentGestureLabel] === 'Pointing' && '👉 '}
                {gestureLabels[currentGestureLabel] === 'Open Palm' && '🖐️ '}
                {gestureLabels[currentGestureLabel] === 'Rock' && '🤘 '}
                {gestureLabels[currentGestureLabel] === 'Thumb' && '👍 '}
                {gestureLabels[currentGestureLabel]}
              </span>
            ) : (
              <span className="bg-slate-950/80 backdrop-blur-md px-3 py-1 rounded-full text-[10px] font-bold text-white/60 border border-white/5 uppercase tracking-wider">
                No hand
              </span>
            )}

            {/* Modifier Hand Gesture */}
            {modifierHand && modifierGestureLabel !== -1 && gestureLabels[modifierGestureLabel] ? (
              <span className="bg-slate-950/80 backdrop-blur-md px-3 py-1 rounded-full text-[10px] font-black border border-white/10 flex items-center gap-1 shadow-lg whitespace-nowrap">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-500" />
                {gestureLabels[modifierGestureLabel] === 'Fist' && '✊ '}
                {gestureLabels[modifierGestureLabel] === 'Peace' && '✌️ '}
                {gestureLabels[modifierGestureLabel] === 'Pointing' && '👉 '}
                {gestureLabels[modifierGestureLabel] === 'Open Palm' && '🖐️ '}
                {gestureLabels[modifierGestureLabel] === 'Rock' && '🤘 '}
                {gestureLabels[modifierGestureLabel] === 'Thumb' && '👍 '}
                Mod: {gestureLabels[modifierGestureLabel]}
              </span>
            ) : null}
          </div>
        </div>
      )}

      {/* ── Init loading overlay ── */}
      {initVisible && (
        <div
          className={[
            'fixed inset-0 z-20 flex items-center justify-center',
            'transition-opacity duration-500',
            isInitializing ? 'opacity-100' : 'opacity-0 pointer-events-none',
          ].join(' ')}
          style={{ backgroundColor: 'var(--color-bg)' }}
          aria-live="polite"
          aria-label="Initializing gesture recognition engine"
        >
          <div className="loading-screen">
            <div className="loading-spinner" />
            <p style={{ color: 'var(--color-text-muted)' }}>Initializing camera&hellip;</p>
          </div>
        </div>
      )}

      {/* ── Overlays (z-30+) ── */}
      {!isMouseModeActive && (
        <>
          <GestureDisplay
            predictions={predictions}
            isMouseModeActive={isMouseModeActive}
            isElectron={isElectron}
            gestureLabels={gestureLabels}
          />
          <ConfidenceBar predictions={predictions} />

          {/* Mode toggle — Electron only (mouse control is desktop-only) */}
          {isElectron && (
            <ModeToggle
              activeMode={activeMode}
              onSelectMode={selectControlMode}
            />
          )}

          {/* ── Unified Bottom Toolbar (fixed bottom-14 inset-x-0) ── */}
          <div className="fixed bottom-14 inset-x-0 z-40 px-4 pointer-events-none">
            <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 pointer-events-auto">
                <button
                  type="button"
                  onClick={() => setIsCalibrationOpen(true)}
                  title="Calibrate Webcam & Pointer"
                  aria-label="Calibrate Webcam & Pointer"
                  className="btn btn-ghost px-3 py-1.5 h-10 text-xs font-semibold flex items-center gap-1.5 bg-slate-900/80 backdrop-blur border border-white/10 text-slate-200 hover:bg-slate-800 rounded-xl shadow-lg"
                >
                  <span>⚙️</span>
                  <span>Calibrate</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsProfileModalOpen(true)}
                  title="Configure Gesture Profiles"
                  aria-label="Configure Gesture Profiles"
                  className="btn btn-ghost px-3 py-1.5 h-10 text-xs font-semibold flex items-center gap-1.5 bg-slate-900/80 backdrop-blur border border-white/10 text-slate-200 hover:bg-slate-800 rounded-xl shadow-lg"
                >
                  <span>🎯</span>
                  <span>Profiles</span>
                </button>
                {isAdmin && (
                  <button
                    id="improve-panel-toggle-btn"
                    type="button"
                    onClick={() => setIsImproveOpen((v) => !v)}
                    className={`improve-toggle${isImproveOpen ? ' is-open' : ''}`}
                    aria-expanded={isImproveOpen}
                    aria-controls="improve-panel"
                  >
                    Train AI
                    <span className="improve-toggle-chevron">
                      <ChevronDownIcon />
                    </span>
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2 pointer-events-auto">
                <button
                  id="camera-toggle-btn"
                  onClick={handleCameraToggle}
                  title={isCameraOn ? 'Turn camera off' : 'Turn camera on'}
                  aria-label={isCameraOn ? 'Turn camera off' : 'Turn camera on'}
                  className="btn btn-ghost p-0 w-10 h-10 flex items-center justify-center bg-slate-900/80 backdrop-blur border border-white/10 text-slate-200 hover:bg-slate-800 rounded-xl shadow-lg"
                  aria-pressed={isCameraOn}
                >
                  {isCameraOn ? <CameraOnIcon /> : <CameraOffIcon />}
                </button>
              </div>
            </div>
          </div>

          {/* ── Model error notice ── */}
          {modelError && (
            <div className="fixed top-20 inset-x-0 z-30 flex justify-center px-4 pointer-events-none">
              <div className="alert alert-warning pointer-events-auto max-w-md">
                {isAdmin ? (
                  <>
                    No trained model found —{' '}
                    <a href="/ml/import" className="underline font-semibold">
                      import a dataset
                    </a>{' '}
                    or train one below.
                  </>
                ) : (
                  'No trained model found. An admin can import a dataset and train the model.'
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* ── AI Improve panel (slides up from bottom) ── */}
      {isAdmin && isImproveOpen && !isMouseModeActive && (
        <div id="improve-panel" className="improve-panel" role="dialog" aria-label="Train and improve AI">
          <header className="improve-panel-header">
            <h2 className="improve-panel-title">Train &amp; Improve AI</h2>
            <p className="improve-panel-subtitle">
              Capture poses, upload samples, then retrain the model.
            </p>
          </header>

          <div className="improve-panel-body">
            <section className="improve-section">
              <p className="improve-section-label">Add custom gesture</p>
              <div className="improve-row">
                <input
                  type="text"
                  value={newCustomGestureName}
                  onChange={(e) => setNewCustomGestureName(e.target.value)}
                  placeholder="e.g. Wave, Thumbs Up"
                  className="form-input"
                  disabled={isCreatingGesture}
                  aria-label="Custom gesture name"
                  onKeyDown={async (e) => {
                    if (e.key === 'Enter' && newCustomGestureName.trim()) {
                      e.preventDefault();
                      setIsCreatingGesture(true);
                      const name = newCustomGestureName.trim();
                      const result = await addCustomGesture(name);
                      setIsCreatingGesture(false);
                      if (result.success) {
                        setSelectedImproveGesture(name);
                        setNewCustomGestureName('');
                        setImproveMessage({ type: 'success', text: `Created "${name}"!` });
                      } else {
                        setImproveMessage({ type: 'error', text: result.error });
                      }
                    }
                  }}
                />
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={isCreatingGesture || !newCustomGestureName.trim()}
                  onClick={async () => {
                    if (!newCustomGestureName.trim()) return;
                    setIsCreatingGesture(true);
                    const name = newCustomGestureName.trim();
                    const result = await addCustomGesture(name);
                    setIsCreatingGesture(false);
                    if (result.success) {
                      setSelectedImproveGesture(name);
                      setNewCustomGestureName('');
                      setImproveMessage({ type: 'success', text: `Created "${name}"!` });
                    } else {
                      setImproveMessage({ type: 'error', text: result.error });
                    }
                  }}
                >
                  {isCreatingGesture ? '…' : 'Add'}
                </button>
              </div>
            </section>

            <section className="improve-section">
              <p className="improve-section-label">1. Capture pose</p>
              <div className="improve-row">
                <select
                  id="gesture-select"
                  value={activeImproveGesture}
                  onChange={(e) => setSelectedImproveGesture(e.target.value)}
                  className="form-input"
                  aria-label="Gesture to capture"
                >
                  {gestureLabels.map((label) => (
                    <option key={label} value={label}>
                      {label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={handleCapturePose}
                >
                  Capture
                </button>
              </div>
              <p className="improve-tip">
                Tip: hold the gesture and press <kbd>Space</kbd>
              </p>
            </section>

            {capturedSamples.length > 0 && (
              <div className="improve-queue">
                <div className="improve-queue-header">
                  <span className="improve-queue-count">
                    Queue · {capturedSamples.length} sample{capturedSamples.length === 1 ? '' : 's'}
                  </span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      setCapturedSamples([]);
                      setImproveMessage({ type: 'info', text: 'Cleared unsaved poses.' });
                    }}
                  >
                    Clear
                  </button>
                </div>
                <div className="improve-queue-chips">
                  {gestureLabels.map((label) => {
                    const count = capturedCounts[label] ?? 0;
                    if (count === 0) return null;
                    return (
                      <span key={label} className="improve-chip">
                        {label}: {count}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}

            <section className="improve-section improve-actions">
              <p className="improve-section-label">2. Retrain model</p>
              <div className="improve-actions-row">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={capturedSamples.length === 0 || isSubmittingSamples}
                  onClick={() => { void handleUploadSamples(); }}
                >
                  {isSubmittingSamples ? 'Uploading…' : `Upload (${capturedSamples.length})`}
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={isTrainingModel}
                  onClick={() => { void handleTrainModel(); }}
                >
                  {isTrainingModel ? 'Training…' : 'Retrain'}
                </button>
              </div>
            </section>

            {improveMessage && (
              <div
                className={[
                  'alert',
                  improveMessage.type === 'error' ? 'alert-error'
                    : improveMessage.type === 'success' ? 'alert-success'
                    : 'alert-info',
                ].join(' ')}
                role="status"
              >
                {improveMessage.text}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Calibration & Profile Modals ── */}
      <CalibrationModal
        isOpen={isCalibrationOpen}
        onClose={() => setIsCalibrationOpen(false)}
        currentPinchDistance={dominantHand ? getPinchDistance(dominantHand.landmarks) : null}
      />
      <ProfileSelectorModal
        isOpen={isProfileModalOpen}
        onClose={() => setIsProfileModalOpen(false)}
        currentRecognizedLabel={currentGestureLabel !== -1 ? currentGestureLabel : null}
        gestureLabels={gestureLabels}
      />
    </>
  );
}

export default function Home(): React.ReactElement {
  return (
    <ProtectedRoute>
      <HomePage />
    </ProtectedRoute>
  );
}
