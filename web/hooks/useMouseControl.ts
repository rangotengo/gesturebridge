import { useEffect, useRef, useState } from 'react';
import { HandData } from '@/ml/gestureUtils';
import { isPinching } from '@/hooks/usePinchDetector';
import {
  PINCH_COOLDOWN_MS,
  CLICK_COOLDOWN_MS,
  SCROLL_INTERVAL_MS,
} from '@/lib/gestureConfig';
import { getMirroredIndexTipPosition, mapPointerToScreen } from '@/features/control/pointerTracking';

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

  const [screenSize, setScreenSize] = useState({ width: 1920, height: 1080 });
  const isElectron = typeof window !== 'undefined' && !!window.electronAPI;

  // Track previous gesture label to implement leading-edge click logic
  const prevGestureLabelRef = useRef<number>(-1);
  const prevPinchingRef = useRef<boolean>(false);
  const lastClickTimesRef = useRef<Record<string, number>>({ left: 0, right: 0 });
  const lastScrollTimeRef = useRef<number>(0);

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
    if (!isElectron) return; // Mouse control is desktop/Electron only
    if (!isMouseModeActive) {
      // Reset previous states when inactive
      prevGestureLabelRef.current = -1;
      prevPinchingRef.current = false;
      return;
    }

    if (!dominantHand) return;

    const { landmarks } = dominantHand;
    const prevLabel = prevGestureLabelRef.current;
    const currLabel = currentGestureLabel;
    prevGestureLabelRef.current = currLabel;

    const now = Date.now();

    // ── 1. Pinch Left Click (Geometric Check in Parallel) ──
    const pinching = isPinching(landmarks);
    const prevPinching = prevPinchingRef.current;
    prevPinchingRef.current = pinching;

    const isPinchLeadingEdge = !prevPinching && pinching;
    if (isPinchLeadingEdge) {
      if (now - lastClickTimesRef.current.left >= PINCH_COOLDOWN_MS) {
        lastClickTimesRef.current.left = now;
        window.electronAPI?.mouseClick('left');
      }
    }

    // ── 2. Peace Right Click (Label 2, Leading Edge) ──
    const isPeaceLeadingEdge = prevLabel !== 2 && currLabel === 2;
    if (isPeaceLeadingEdge) {
      if (now - lastClickTimesRef.current.right >= CLICK_COOLDOWN_MS) {
        lastClickTimesRef.current.right = now;
        window.electronAPI?.mouseClick('right');
      }
    }

    // ── Throttled mouse movements and scrolling ──
    if (now - lastEventTime.current < THROTTLE_MS) return;
    lastEventTime.current = now;

    // ── 3. Scroll Up (Rock = Label 4) & Scroll Down (Fist = Label 1) ──
    if (currLabel === 4) { // Rock -> Scroll Up
      if (now - lastScrollTimeRef.current >= SCROLL_INTERVAL_MS) {
        lastScrollTimeRef.current = now;
        window.electronAPI?.mouseScroll('up');
      }
    } else if (currLabel === 1) { // Fist -> Scroll Down
      if (now - lastScrollTimeRef.current >= SCROLL_INTERVAL_MS) {
        lastScrollTimeRef.current = now;
        window.electronAPI?.mouseScroll('down');
      }
    }

    // ── 4. Mouse Move (Pointing 👉 = Label 0) gated by isFrozen ──
    if (currLabel === 0 && !isFrozen) {
      const pointer = getMirroredIndexTipPosition(landmarks);
      if (pointer) {
        const screenPoint = mapPointerToScreen(pointer, screenSize);
        window.electronAPI?.mouseMove(screenPoint.x, screenPoint.y);
      }
    }
  }, [dominantHand, isMouseModeActive, currentGestureLabel, isFrozen, isElectron, screenSize]);
}
