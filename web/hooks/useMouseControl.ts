import { useEffect, useRef, useState } from 'react';
import { HandData } from '@/ml/gestureUtils';
import { isPinching } from '@/hooks/usePinchDetector';
import {
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
      requestMediaAccess?: () => Promise<{ success: boolean; camera: boolean; microphone: boolean }>;
      getMediaStatus?: () => Promise<{ camera: string; microphone: string }>;
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
  const clickCooldownRef = useRef(0);
  const lastScrollTime = useRef(0);
  const wasPinchingRef = useRef(false);
  const pinchStartTimeRef = useRef(0);
  const isDraggingRef = useRef(false);
  const lastRawPositionRef = useRef<{ x: number; y: number } | null>(null);

  // Settings
  const [calibration, setCalibration] = useState<CalibrationSettings>(loadCalibrationSettings);
  const [profile, setProfile] = useState<GestureProfile>(loadActiveProfile);

  useEffect(() => {
    const handleSettingsChange = (): void => {
      setCalibration(loadCalibrationSettings());
      setProfile(loadActiveProfile());
    };
    window.addEventListener('storage', handleSettingsChange);
    window.addEventListener('calibration-updated', handleSettingsChange);
    window.addEventListener('profile-updated', handleSettingsChange);
    return () => {
      window.removeEventListener('storage', handleSettingsChange);
      window.removeEventListener('calibration-updated', handleSettingsChange);
      window.removeEventListener('profile-updated', handleSettingsChange);
    };
  }, []);

  // Sync drag release from desktop safety events (e.g. window blur, emergency stop)
  useEffect(() => {
    if (!window.electronAPI?.onDragReleased) return;
    const unsubscribe = window.electronAPI.onDragReleased((data) => {
      if (data.buttons.includes('left') && isDraggingRef.current) {
        isDraggingRef.current = false;
        wasPinchingRef.current = false;
        pinchStartTimeRef.current = 0;
      }
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    // Only run if Mouse Mode is active, not frozen, and Electron API is available
    if (!isMouseModeActive || isFrozen || !window.electronAPI || !dominantHand) {
      if (isDraggingRef.current && window.electronAPI) {
        window.electronAPI.mouseButton('left', 'up');
        isDraggingRef.current = false;
      }
      return;
    }

    const now = Date.now();
    const landmarks = dominantHand.landmarks;
    const rawPos = getMirroredIndexTipPosition(landmarks);
    if (!rawPos) return;

    // Apply calibration mapping
    const pointerPos = applyCalibrationMapping(rawPos, calibration);
    lastRawPositionRef.current = rawPos;

    // 1. Move Mouse
    if (now - lastEventTime.current >= THROTTLE_MS) {
      window.electronAPI.getScreenSize().then((screenSize) => {
        const coords = mapPointerToScreen(pointerPos, screenSize);
        window.electronAPI?.mouseMove(coords.x, coords.y);
        lastEventTime.current = now;
      }).catch((err: unknown) => {
        console.error('Failed to get screen size for mouse control:', err);
      });
    }

    // 2. Pinch Detection for Dragging
    const pinching = isPinching(landmarks, calibration.pinchThreshold);
    const DRAG_HOLD_MS = 300;

    if (pinching) {
      if (!wasPinchingRef.current) {
        wasPinchingRef.current = true;
        pinchStartTimeRef.current = now;
      } else if (now - pinchStartTimeRef.current >= DRAG_HOLD_MS && !isDraggingRef.current) {
        isDraggingRef.current = true;
        window.electronAPI.mouseButton('left', 'down');
      }
    } else {
      if (isDraggingRef.current) {
        window.electronAPI.mouseButton('left', 'up');
        isDraggingRef.current = false;
      }
      wasPinchingRef.current = false;
      pinchStartTimeRef.current = 0;
    }

    // 3. Dynamic Gesture Action Execution from Profile
    const mappedAction = profile.mappings[currentGestureLabel];

    if (mappedAction && mappedAction !== 'none') {
      switch (mappedAction) {
        case 'left_click':
          if (now - clickCooldownRef.current >= CLICK_COOLDOWN_MS) {
            window.electronAPI.mouseClick('left');
            clickCooldownRef.current = now;
          }
          break;

        case 'right_click':
          if (now - clickCooldownRef.current >= CLICK_COOLDOWN_MS) {
            window.electronAPI.mouseClick('right');
            clickCooldownRef.current = now;
          }
          break;

        case 'middle_click':
          if (now - clickCooldownRef.current >= CLICK_COOLDOWN_MS) {
            window.electronAPI.mouseClick('middle');
            clickCooldownRef.current = now;
          }
          break;

        case 'scroll_up':
          if (now - lastScrollTime.current >= SCROLL_INTERVAL_MS) {
            window.electronAPI.mouseScroll('up');
            lastScrollTime.current = now;
          }
          break;

        case 'scroll_down':
          if (now - lastScrollTime.current >= SCROLL_INTERVAL_MS) {
            window.electronAPI.mouseScroll('down');
            lastScrollTime.current = now;
          }
          break;

        case 'zoom_in':
          if (now - lastScrollTime.current >= SCROLL_INTERVAL_MS) {
            window.electronAPI.zoom('in');
            lastScrollTime.current = now;
          }
          break;

        case 'zoom_out':
          if (now - lastScrollTime.current >= SCROLL_INTERVAL_MS) {
            window.electronAPI.zoom('out');
            lastScrollTime.current = now;
          }
          break;

        default:
          break;
      }
    }
  }, [dominantHand, isMouseModeActive, currentGestureLabel, isFrozen, calibration, profile]);
}
