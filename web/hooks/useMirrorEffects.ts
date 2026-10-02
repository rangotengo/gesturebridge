'use client';

import { useCallback, useRef } from 'react';
import { useBlowDetection } from './useBlowDetection';
import { useFacePucker } from './useFacePucker';

/** Keep visual detection available even when a working microphone misses an exhale. */
export function useMirrorEffects(
  enabled: boolean,
  videoRef: React.RefObject<HTMLVideoElement | null>,
  onFog: () => void
) {
  const lastBurstAt = useRef(Number.NEGATIVE_INFINITY);
  const trigger = useCallback(() => {
    if (!enabled) return;
    const now = performance.now();
    // Both detectors can observe the same breath; add only one layer.
    if (now - lastBurstAt.current < 1_400) return;
    lastBurstAt.current = now;
    onFog();
  }, [enabled, onFog]);

  const { microphoneStatus } = useBlowDetection({ enabled, onBlow: trigger });
  const face = useFacePucker({ enabled, videoRef, onPucker: trigger });
  return { microphoneStatus, face };
}
