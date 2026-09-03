import { useEffect, useRef, useState } from 'react';
import { Landmark } from '@/ml/gestureUtils';
import { ZOOM_THRESHOLD, ZOOM_INTERVAL_MS } from '@/lib/gestureConfig';

export function useTwoHandZoom(
  hand1Landmarks: Landmark[] | null,
  hand2Landmarks: Landmark[] | null,
  bothHandsActive: boolean
): { isZooming: boolean; zoomDirection: 'in' | 'out' | null } {
  const [isZooming, setIsZooming] = useState(false);
  const [zoomDirection, setZoomDirection] = useState<'in' | 'out' | null>(null);

  const prevDistanceRef = useRef<number | null>(null);
  const lastZoomTimeRef = useRef<number>(0);
  const zoomTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const getInterHandDistance = (
    h1: Landmark[],
    h2: Landmark[]
  ): number => {
    const w1 = h1[0];
    const w2 = h2[0];
    if (!w1 || !w2) return 0;
    return Math.sqrt((w1.x - w2.x) ** 2 + (w1.y - w2.y) ** 2);
  };

  useEffect(() => {
    if (!bothHandsActive || !hand1Landmarks || !hand2Landmarks) {
      prevDistanceRef.current = null;
      return;
    }

    const currentDistance = getInterHandDistance(hand1Landmarks, hand2Landmarks);
    const prevDistance = prevDistanceRef.current;
    prevDistanceRef.current = currentDistance;

    if (prevDistance === null) return;

    const delta = currentDistance - prevDistance;
    const now = Date.now();

    if (Math.abs(delta) > ZOOM_THRESHOLD) {
      if (now - lastZoomTimeRef.current >= ZOOM_INTERVAL_MS) {
        lastZoomTimeRef.current = now;
        const direction = delta > 0 ? 'in' : 'out';

        if (typeof window !== 'undefined') {
          window.electronAPI?.zoom(direction);
        }

        setZoomDirection(direction);
        setIsZooming(true);

        // Clear existing timeout
        if (zoomTimeoutRef.current) {
          clearTimeout(zoomTimeoutRef.current);
        }

        // Keep isZooming true for 600ms to show the UI indicator then fade
        zoomTimeoutRef.current = setTimeout(() => {
          setIsZooming(false);
          setZoomDirection(null);
        }, 600);
      }
    }
  }, [hand1Landmarks, hand2Landmarks, bothHandsActive]);

  useEffect(() => {
    return () => {
      if (zoomTimeoutRef.current) {
        clearTimeout(zoomTimeoutRef.current);
      }
    };
  }, []);

  return { isZooming, zoomDirection };
}
