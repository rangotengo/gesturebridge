'use client';

import { useEffect, useRef, useState } from 'react';
import type {
  FaceMesh as MediaPipeFaceMesh,
  NormalizedLandmark,
  Results as FaceMeshResults,
} from '@mediapipe/face_mesh';

declare global {
  interface Window {
    FaceMesh?: new (config: { locateFile: (file: string) => string }) => MediaPipeFaceMesh;
  }
}

const FACE_MESH_SCRIPT = '/vendor/mediapipe/face_mesh/face_mesh.js';
const FACE_MESH_ASSET_ROOT = '/vendor/mediapipe/face_mesh';
const DEFAULT_HOLD_DURATION_MS = 420;
const DEFAULT_COOLDOWN_MS = 1_500;
const DEFAULT_SAMPLE_EVERY_N_FRAMES = 3;
const MIN_LIP_PROTRUSION_RATIO = 0.055;
const MIN_APERTURE_RATIO = 0.035;
const MAX_APERTURE_RATIO = 0.18;
const MAX_MOUTH_TO_FACE_WIDTH_RATIO = 0.35;

interface PuckerMetrics {
  apertureRatio: number;
  lipProtrusionRatio: number;
  mouthToFaceWidthRatio: number;
}

export interface UseFacePuckerOptions {
  /** Existing webcam element. This hook never opens a second camera stream. */
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** Face Mesh and its RAF loop exist only while this is true. */
  enabled: boolean;
  /** Fired once after a sustained pucker; cooldown suppresses repeat events. */
  onPucker: () => void;
  /** Time a pucker must remain valid before firing. Default: 420ms. */
  holdDurationMs?: number;
  /** Minimum time between pucker events. Default: 1500ms. */
  cooldownMs?: number;
  /** Analyze every nth animation frame. Default: 3. */
  sampleEveryNFrames?: number;
}

export interface FacePuckerState {
  isLoading: boolean;
  isAvailable: boolean;
  error: string | null;
}

let faceMeshScriptPromise: Promise<void> | null = null;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === 'true') {
        resolve();
        return;
      }

      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => {
      script.dataset.loaded = 'true';
      resolve();
    };
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

function ensureFaceMeshScript(): Promise<void> {
  if (window.FaceMesh) return Promise.resolve();
  if (faceMeshScriptPromise) return faceMeshScriptPromise;

  faceMeshScriptPromise = loadScript(FACE_MESH_SCRIPT)
    .then(() => {
      if (!window.FaceMesh) {
        throw new Error('MediaPipe Face Mesh library (window.FaceMesh) is not loaded.');
      }
    })
    .catch((error: unknown) => {
      faceMeshScriptPromise = null;
      throw error;
    });

  return faceMeshScriptPromise;
}

function distance2d(a: NormalizedLandmark, b: NormalizedLandmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Resolution-independent mouth ratios. Face Mesh z becomes more negative as a
 * landmark moves toward the camera, so centre lips protruding toward camera
 * create a positive protrusion value relative to the mouth corners.
 */
export function getPuckerMetrics(landmarks: NormalizedLandmark[]): PuckerMetrics | null {
  const upperLip = landmarks[13];
  const lowerLip = landmarks[14];
  const leftCorner = landmarks[61];
  const rightCorner = landmarks[291];
  const leftCheek = landmarks[234];
  const rightCheek = landmarks[454];

  if (!upperLip || !lowerLip || !leftCorner || !rightCorner || !leftCheek || !rightCheek) {
    return null;
  }

  const mouthWidth = distance2d(leftCorner, rightCorner);
  const faceWidth = distance2d(leftCheek, rightCheek);
  if (mouthWidth <= Number.EPSILON || faceWidth <= Number.EPSILON) return null;

  const apertureRatio = distance2d(upperLip, lowerLip) / mouthWidth;
  const cornerDepth = (leftCorner.z + rightCorner.z) / 2;
  const lipDepth = (upperLip.z + lowerLip.z) / 2;

  return {
    apertureRatio,
    lipProtrusionRatio: Math.max(0, cornerDepth - lipDepth) / mouthWidth,
    mouthToFaceWidthRatio: mouthWidth / faceWidth,
  };
}

export function isMouthPuckered(landmarks: NormalizedLandmark[]): boolean {
  const metrics = getPuckerMetrics(landmarks);
  if (!metrics) return false;

  return (
    metrics.lipProtrusionRatio >= MIN_LIP_PROTRUSION_RATIO &&
    metrics.apertureRatio >= MIN_APERTURE_RATIO &&
    metrics.apertureRatio <= MAX_APERTURE_RATIO &&
    metrics.mouthToFaceWidthRatio <= MAX_MOUTH_TO_FACE_WIDTH_RATIO
  );
}

/**
 * Detects a sustained, rounded mouth pucker from the existing webcam feed.
 * It is intentionally isolated from hand tracking and samples only every third
 * display frame to keep the fallback from competing with MediaPipe Hands.
 */
export function useFacePucker({
  videoRef,
  enabled,
  onPucker,
  holdDurationMs = DEFAULT_HOLD_DURATION_MS,
  cooldownMs = DEFAULT_COOLDOWN_MS,
  sampleEveryNFrames = DEFAULT_SAMPLE_EVERY_N_FRAMES,
}: UseFacePuckerOptions): FacePuckerState {
  const [state, setState] = useState<FacePuckerState>({
    isLoading: false,
    isAvailable: false,
    error: null,
  });
  const onPuckerRef = useRef(onPucker);

  useEffect(() => {
    onPuckerRef.current = onPucker;
  }, [onPucker]);

  useEffect(() => {
    let isCancelled = false;
    let animationFrameId: number | null = null;
    let faceMesh: MediaPipeFaceMesh | null = null;
    let frameCount = 0;
    let isSending = false;
    let hasProcessingError = false;
    let puckerStartedAt: number | null = null;
    let cooldownUntil = 0;

    if (!enabled) {
      return () => {
        isCancelled = true;
      };
    }

    const resetPucker = (): void => {
      puckerStartedAt = null;
    };

    const handleResults = (results: FaceMeshResults): void => {
      if (isCancelled) return;

      const landmarks = results.multiFaceLandmarks[0];
      if (!landmarks || !isMouthPuckered(landmarks)) {
        resetPucker();
        return;
      }

      const now = performance.now();
      if (now < cooldownUntil) {
        resetPucker();
        return;
      }

      if (puckerStartedAt === null) {
        puckerStartedAt = now;
        return;
      }

      if (now - puckerStartedAt >= holdDurationMs) {
        cooldownUntil = now + cooldownMs;
        resetPucker();
        onPuckerRef.current();
      }
    };

    const scheduleFrame = (): void => {
      animationFrameId = window.requestAnimationFrame(() => {
        if (isCancelled || !faceMesh || hasProcessingError) return;

        frameCount += 1;
        const video = videoRef.current;
        const canAnalyze =
          frameCount % Math.max(1, sampleEveryNFrames) === 0 &&
          !isSending &&
          video !== null &&
          video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;

        if (!canAnalyze) {
          scheduleFrame();
          return;
        }

        isSending = true;
        void faceMesh.send({ image: video }).catch((reason: unknown) => {
          if (isCancelled) return;
          hasProcessingError = true;
          setState({
            isLoading: false,
            isAvailable: false,
            error: reason instanceof Error ? reason.message : 'Face Mesh processing failed.',
          });
        }).finally(() => {
          isSending = false;
          if (!isCancelled && !hasProcessingError) scheduleFrame();
        });
      });
    };

    void ensureFaceMeshScript()
      .then(() => {
        if (isCancelled) return;

        const FaceMesh = window.FaceMesh;
        if (!FaceMesh) {
          throw new Error('MediaPipe Face Mesh library (window.FaceMesh) is not loaded.');
        }

        faceMesh = new FaceMesh({
          locateFile: (file: string) => `${FACE_MESH_ASSET_ROOT}/${file}`,
        });
        faceMesh.setOptions({
          maxNumFaces: 1,
          refineLandmarks: false,
          selfieMode: true,
          minDetectionConfidence: 0.6,
          minTrackingConfidence: 0.5,
        });
        faceMesh.onResults(handleResults);
        setState({ isLoading: false, isAvailable: true, error: null });
        scheduleFrame();
      })
      .catch((reason: unknown) => {
        if (isCancelled) return;
        setState({
          isLoading: false,
          isAvailable: false,
          error: reason instanceof Error ? reason.message : 'Face Mesh unavailable.',
        });
      });

    return () => {
      isCancelled = true;
      if (animationFrameId !== null) window.cancelAnimationFrame(animationFrameId);
      if (faceMesh) void faceMesh.close();
    };
  }, [cooldownMs, enabled, holdDurationMs, sampleEveryNFrames, videoRef]);

  if (!enabled) return { isLoading: false, isAvailable: false, error: null };
  return {
    ...state,
    isLoading: !state.isAvailable && state.error === null,
  };
}
