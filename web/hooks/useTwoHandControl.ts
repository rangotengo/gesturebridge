import { useEffect, useRef, useState } from 'react';
import { Landmark } from '@/ml/gestureUtils';
import { CLICK_COOLDOWN_MS } from '@/lib/gestureConfig';

export function useTwoHandControl(
  dominantLandmarks: Landmark[] | null,
  modifierLandmarks: Landmark[] | null,
  modifierGestureLabel: number | null,
  mouseModeActive: boolean
): { isFrozen: boolean; isDragging: boolean } {
  const [isDragging, setIsDragging] = useState(false);
  const isDraggingRef = useRef(false);

  const prevModifierGestureLabelRef = useRef<number | null>(null);
  const lastMiddleClickTimeRef = useRef<number>(0);

  // Helper to safely stop dragging (releasing left mouse button)
  const stopDragging = () => {
    if (isDraggingRef.current) {
      isDraggingRef.current = false;
      setIsDragging(false);
      if (typeof window !== 'undefined') {
        window.electronAPI?.mouseButton('left', 'up');
      }
    }
  };

  const startDragging = () => {
    if (!isDraggingRef.current) {
      isDraggingRef.current = true;
      setIsDragging(true);
      if (typeof window !== 'undefined') {
        window.electronAPI?.mouseButton('left', 'down');
      }
    }
  };

  useEffect(() => {
    // Safety check: if mouse mode is toggled OFF, always release drag
    if (!mouseModeActive) {
      stopDragging();
      prevModifierGestureLabelRef.current = null;
      return;
    }

    // Safety check: if modifier hand disappears from frame, always release drag
    if (!modifierLandmarks) {
      stopDragging();
      prevModifierGestureLabelRef.current = null;
      return;
    }

    const prevLabel = prevModifierGestureLabelRef.current;
    const currLabel = modifierGestureLabel;
    prevModifierGestureLabelRef.current = currLabel;

    const now = Date.now();

    // 1. Drag State Machine (Fist = 1)
    if (currLabel === 1) {
      startDragging();
    } else {
      stopDragging();
    }

    // 2. Middle Click (Peace = 2) — leading-edge only, 400ms cooldown
    const isLeadingEdge = prevLabel !== 2 && currLabel === 2;
    if (isLeadingEdge) {
      if (now - lastMiddleClickTimeRef.current >= CLICK_COOLDOWN_MS) {
        lastMiddleClickTimeRef.current = now;
        if (typeof window !== 'undefined' && window.electronAPI?.mouseClick) {
          window.electronAPI.mouseClick('middle');
        }
      }
    }
  }, [modifierLandmarks, modifierGestureLabel, mouseModeActive]);

  // External release synchronization: window blur, page visibility change, desktop drag-released, and emergency-stop
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleWindowBlur = (): void => {
      stopDragging();
    };

    const handleVisibilityChange = (): void => {
      if (document.hidden) {
        stopDragging();
      }
    };

    window.addEventListener('blur', handleWindowBlur);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    const unsubscribeDrag = window.electronAPI?.onDragReleased?.(() => {
      if (isDraggingRef.current) {
        isDraggingRef.current = false;
        setIsDragging(false);
      }
    });

    const unsubscribeEmergency = window.electronAPI?.onEmergencyStop?.(() => {
      if (isDraggingRef.current) {
        isDraggingRef.current = false;
        setIsDragging(false);
      }
    });

    return () => {
      window.removeEventListener('blur', handleWindowBlur);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      unsubscribeDrag?.();
      unsubscribeEmergency?.();
      stopDragging();
    };
  }, []);

  const isFrozen = mouseModeActive && modifierLandmarks !== null && modifierGestureLabel === 3; // Open Palm = 3

  return { isFrozen, isDragging };
}
