import { useEffect, useRef, useState } from 'react';
import { HandData } from '@/ml/gestureUtils';
import { isPinching } from '@/hooks/usePinchDetector';
import {
  PINCH_COOLDOWN_MS,
  CLICK_COOLDOWN_MS,
  SCROLL_INTERVAL_MS,
} from '@/lib/gestureConfig';
import { getMirroredIndexTipPosition, mapPointerToScreen } from '@/features/control/pointerTracking';
import {
  loadCalibrationSettings,
  applyCalibrationMapping,
  type CalibrationSettings,
} from '@/lib/calibration';
import {
  loadActiveProfile,
  type GestureProfile,
} from '@/lib/gestureProfiles';

// Extend window with Electron API types
declare global {
  interface Window {
    electronAPI?: {
      mouseMove: (x: number, y: number) => void;
      mouseClick: (button: 'left' | 'right' | 'middle') => void;
      mouseButton: (button: 'left' | 'right', action: 'down' | 'up') => void;
      mouseScroll: (direction: 'up' | 'down') => void;
      zoom: (direction: 'in' | 'out') => void;
      getScreenSize: () => Promise<{ width: number; height: number }>;
      isElectron: boolean;
      setCompactMode?: (compact: boolean) => void;
      onEmergencyStop?: (callback: () => void) => () => void;
      onDragReleased?: (callback: (data: { buttons: ('left' | 'right')[]; reason: string }) => void) => () => void;
    };
  }
}

export function useMouseControl(
  dominantHand: HandData | null,
  isMouseModeActive: boolean,
  currentGestureLabel: number,
  isFrozen: boolean
): void {
  const lastEventTime = useRef(0);
  const THROTTLE_MS = 16; // ~60fps
  const ZOOM_INTERVAL_MS = 150;

  const [screenSize, setScreenSize] = useState({ width: 1920, height: 1080 });
  const isElectron = typeof window !== 'undefined' && !!window.electronAPI;

  const calibrationRef = useRef<CalibrationSettings>(loadCalibrationSettings());
  const profileRef = useRef<GestureProfile>(loadActiveProfile());
  const smoothedPosRef = useRef<{ x: number; y: number } | null>(null);
  const isProfileDraggingRef = useRef<boolean>(false);

  // Track previous states
  const prevGestureLabelRef = useRef<number>(-1);
  const prevPinchingRef = useRef<boolean>(false);
  const lastClickTimesRef = useRef<Record<string, number>>({ left: 0, right: 0, middle: 0 });
  const lastScrollTimeRef = useRef<number>(0);
  const lastZoomTimeRef = useRef<number>(0);

  // Sync settings when modified from CalibrationModal or ProfileSelectorModal
  useEffect(() => {
    const handleCalibration = (e: Event) => {
      const detail = (e as CustomEvent<CalibrationSettings>).detail;
      if (detail) calibrationRef.current = detail;
    };
    const handleProfile = (e: Event) => {
      const detail = (e as CustomEvent<GestureProfile>).detail;
      if (detail) profileRef.current = detail;
    };

    window.addEventListener('gesturebridge:calibration-updated', handleCalibration);
    window.addEventListener('gesturebridge:profile-updated', handleProfile);
    return () => {
      window.removeEventListener('gesturebridge:calibration-updated', handleCalibration);
      window.removeEventListener('gesturebridge:profile-updated', handleProfile);
    };
  }, []);

  useEffect(() => {
    async function fetchScreenSize(): Promise<void> {
      if (isElectron && window.electronAPI) {
        const size = await window.electronAPI.getScreenSize();
        setScreenSize((prev) => {
          if (prev.width === size.width && prev.height === size.height) {
            return prev;
          }
          return size;
        });
      }
    }
    void fetchScreenSize();
  }, [isElectron]);

  useEffect(() => {
    if (!isElectron) return;

    if (!isMouseModeActive) {
      if (isProfileDraggingRef.current) {
        window.electronAPI?.mouseButton('left', 'up');
        isProfileDraggingRef.current = false;
      }
      prevGestureLabelRef.current = -1;
      prevPinchingRef.current = false;
      smoothedPosRef.current = null;
      return;
    }

    if (!dominantHand) {
      if (isProfileDraggingRef.current) {
        window.electronAPI?.mouseButton('left', 'up');
        isProfileDraggingRef.current = false;
      }
      return;
    }

    const { landmarks } = dominantHand;
    const prevLabel = prevGestureLabelRef.current;
    const currLabel = currentGestureLabel;
    prevGestureLabelRef.current = currLabel;

    const currentAction = profileRef.current.mappings[currLabel] ?? 'none';
    const prevAction = prevLabel >= 0 ? (profileRef.current.mappings[prevLabel] ?? 'none') : 'none';

    const now = Date.now();

    // ── 1. Geometric Pinch Check with calibrated threshold ──
    const pinching = isPinching(landmarks, calibrationRef.current.pinchThreshold);
    const prevPinching = prevPinchingRef.current;
    prevPinchingRef.current = pinching;

    const isPinchLeadingEdge = !prevPinching && pinching;
    if (isPinchLeadingEdge) {
      if (now - lastClickTimesRef.current.left >= PINCH_COOLDOWN_MS) {
        lastClickTimesRef.current.left = now;
        window.electronAPI?.mouseClick('left');
      }
    }

    // ── 2. Profile-driven Click Actions (Leading Edge) ──
    if (currentAction !== prevAction) {
      if (currentAction === 'left_click') {
        if (now - lastClickTimesRef.current.left >= CLICK_COOLDOWN_MS) {
          lastClickTimesRef.current.left = now;
          window.electronAPI?.mouseClick('left');
        }
      } else if (currentAction === 'right_click') {
        if (now - lastClickTimesRef.current.right >= CLICK_COOLDOWN_MS) {
          lastClickTimesRef.current.right = now;
          window.electronAPI?.mouseClick('right');
        }
      } else if (currentAction === 'middle_click') {
        if (now - lastClickTimesRef.current.middle >= CLICK_COOLDOWN_MS) {
          lastClickTimesRef.current.middle = now;
          window.electronAPI?.mouseClick('middle');
        }
      }
    }

    // ── 3. Profile-driven Drag / Hold ──
    if (currentAction === 'drag_hold' && !isProfileDraggingRef.current) {
      isProfileDraggingRef.current = true;
      window.electronAPI?.mouseButton('left', 'down');
    } else if (currentAction !== 'drag_hold' && isProfileDraggingRef.current) {
      isProfileDraggingRef.current = false;
      window.electronAPI?.mouseButton('left', 'up');
    }

    // ── Throttled continuous actions ──
    if (now - lastEventTime.current < THROTTLE_MS) return;
    lastEventTime.current = now;

    // ── 4. Scrolling Actions ──
    if (currentAction === 'scroll_up') {
      if (now - lastScrollTimeRef.current >= SCROLL_INTERVAL_MS) {
        lastScrollTimeRef.current = now;
        window.electronAPI?.mouseScroll('up');
      }
    } else if (currentAction === 'scroll_down') {
      if (now - lastScrollTimeRef.current >= SCROLL_INTERVAL_MS) {
        lastScrollTimeRef.current = now;
        window.electronAPI?.mouseScroll('down');
      }
    }

    // ── 5. Zoom Actions ──
    if (currentAction === 'zoom_in') {
      if (now - lastZoomTimeRef.current >= ZOOM_INTERVAL_MS) {
        lastZoomTimeRef.current = now;
        window.electronAPI?.zoom('in');
      }
    } else if (currentAction === 'zoom_out') {
      if (now - lastZoomTimeRef.current >= ZOOM_INTERVAL_MS) {
        lastZoomTimeRef.current = now;
        window.electronAPI?.zoom('out');
      }
    }

    // ── 6. Mouse Move with Calibrated Workspace Mapping & Smoothing ──
    const allowMove = (currentAction === 'pointer_move' || isProfileDraggingRef.current) && !isFrozen;
    if (allowMove) {
      const rawPointer = getMirroredIndexTipPosition(landmarks);
      if (rawPointer) {
        const calibrated = applyCalibrationMapping(rawPointer, calibrationRef.current);
        const alpha = calibrationRef.current.smoothingAlpha;

        if (!smoothedPosRef.current) {
          smoothedPosRef.current = calibrated;
        } else {
          const dx = calibrated.x - smoothedPosRef.current.x;
          const dy = calibrated.y - smoothedPosRef.current.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > calibrationRef.current.deadzoneRadius) {
            smoothedPosRef.current = {
              x: smoothedPosRef.current.x + alpha * dx,
              y: smoothedPosRef.current.y + alpha * dy,
            };
          }
        }

        const screenPoint = mapPointerToScreen(smoothedPosRef.current, screenSize);
        window.electronAPI?.mouseMove(screenPoint.x, screenPoint.y);
      }
    }
  }, [dominantHand, isMouseModeActive, currentGestureLabel, isFrozen, isElectron, screenSize]);
}
