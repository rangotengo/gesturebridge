import { useEffect, useRef, useState } from 'react';
import { HandData } from '@/ml/gestureUtils';
import { isPinching } from '@/hooks/usePinchDetector';
import { getMirroredIndexTipPosition, type ScreenSpace } from '@/features/control/pointerTracking';
import {
  createMouseControlState,
  stepMouseControl,
  type MouseCommand,
} from '@/features/control/mouseActions';
import {
  loadCalibrationSettings,
  applyCalibrationMapping,
  type CalibrationSettings,
} from '@/lib/calibration';
import {
  loadActiveProfile,
  type GestureActionType,
  type GestureProfile,
} from '@/lib/gestureProfiles';

const DEFAULT_SCREEN: ScreenSpace = { x: 0, y: 0, width: 1920, height: 1080 };

function readScreenSpace(size: Partial<ScreenSpace> | null | undefined): ScreenSpace | null {
  if (!size || typeof size.width !== 'number' || typeof size.height !== 'number') return null;
  if (size.width <= 0 || size.height <= 0) return null;
  return {
    x: typeof size.x === 'number' && Number.isFinite(size.x) ? size.x : 0,
    y: typeof size.y === 'number' && Number.isFinite(size.y) ? size.y : 0,
    width: size.width,
    height: size.height,
  };
}

function dispatchMouseCommand(command: MouseCommand): void {
  const api = window.electronAPI;
  if (!api) return;
  switch (command.type) {
    case 'move':
      api.mouseMove(command.x, command.y);
      break;
    case 'click':
      api.mouseClick(command.button);
      break;
    case 'button':
      api.mouseButton(command.button, command.action);
      break;
    case 'scroll':
      api.mouseScroll(command.direction);
      break;
    case 'zoom':
      api.zoom(command.direction);
      break;
    default:
      break;
  }
}

// Extend window with Electron API types
declare global {
  interface Window {
    electronAPI?: {
      mouseMove: (x: number, y: number) => void;
      mouseClick: (button: 'left' | 'right' | 'middle') => void;
      mouseButton: (button: 'left' | 'right', action: 'down' | 'up') => void;
      mouseScroll: (direction: 'up' | 'down') => void;
      zoom: (direction: 'in' | 'out') => void;
      getScreenSize: () => Promise<{ x?: number; y?: number; width: number; height: number }>;
      getAccessibilityStatus?: () => Promise<{ trusted: boolean }>;
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
  const controlStateRef = useRef(createMouseControlState());
  const screenSizeRef = useRef<ScreenSpace>(DEFAULT_SCREEN);

  // Settings
  const [calibration, setCalibration] = useState<CalibrationSettings>(loadCalibrationSettings);
  const [profile, setProfile] = useState<GestureProfile>(loadActiveProfile);

  useEffect(() => {
    const handleSettingsChange = (): void => {
      setCalibration(loadCalibrationSettings());
      setProfile(loadActiveProfile());
    };
    window.addEventListener('storage', handleSettingsChange);
    window.addEventListener('gesturebridge:calibration-updated', handleSettingsChange);
    window.addEventListener('gesturebridge:profile-updated', handleSettingsChange);
    return () => {
      window.removeEventListener('storage', handleSettingsChange);
      window.removeEventListener('gesturebridge:calibration-updated', handleSettingsChange);
      window.removeEventListener('gesturebridge:profile-updated', handleSettingsChange);
    };
  }, []);

  // Fetch and cache screen dimensions for high-frequency cursor mapping
  useEffect(() => {
    if (!window.electronAPI?.getScreenSize) return;

    let mounted = true;
    const fetchScreenSize = (): void => {
      window.electronAPI
        ?.getScreenSize()
        .then((size) => {
          const next = readScreenSpace(size);
          if (mounted && next) {
            screenSizeRef.current = next;
          }
        })
        .catch((err: unknown) => {
          console.warn('Failed to query screen size for mouse control:', err);
        });
    };

    fetchScreenSize();
    window.addEventListener('resize', fetchScreenSize);
    return () => {
      mounted = false;
      window.removeEventListener('resize', fetchScreenSize);
    };
  }, [isMouseModeActive]);

  // Sync drag release from desktop safety events (e.g. window blur, emergency stop)
  useEffect(() => {
    if (!window.electronAPI?.onDragReleased) return;
    const unsubscribe = window.electronAPI.onDragReleased((data) => {
      if (!data.buttons.includes('left')) return;
      const state = controlStateRef.current;
      controlStateRef.current = {
        ...state,
        pinchStartedAt: null,
        pinchArmed: false,
        pinchDragging: false,
        gestureDragging: false,
        leftDown: false,
      };
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    const landmarks = dominantHand?.landmarks;
    const rawPos = landmarks ? getMirroredIndexTipPosition(landmarks) : null;
    const pointer = rawPos ? applyCalibrationMapping(rawPos, calibration) : null;
    const mappedAction: GestureActionType | null =
      currentGestureLabel >= 0 ? (profile.mappings[currentGestureLabel] ?? null) : null;
    const gestureAction = mappedAction && mappedAction !== 'none' ? mappedAction : null;

    const step = stepMouseControl(controlStateRef.current, {
      now: Date.now(),
      enabled: isMouseModeActive,
      tracking: Boolean(pointer),
      externallyFrozen: isFrozen,
      movementEnabled: Object.values(profile.mappings).includes('pointer_move'),
      pinching: landmarks ? isPinching(landmarks, calibration.pinchThreshold) : false,
      gestureAction,
      pointer,
      screen: screenSizeRef.current,
      smoothingAlpha: calibration.smoothingAlpha,
      deadzoneRadius: calibration.deadzoneRadius,
    });
    controlStateRef.current = step.state;

    if (!window.electronAPI) return;
    for (const command of step.commands) {
      dispatchMouseCommand(command);
    }
  }, [dominantHand, isMouseModeActive, currentGestureLabel, isFrozen, calibration, profile]);
}
