import { useState, useEffect, useRef } from 'react';
import type { Landmark, Handedness, HandData } from '@/ml/gestureUtils';

// ---- MediaPipe global types ----
declare global {
  interface Window {
    Hands?: new (config: { locateFile: (file: string) => string }) => MediaPipeHands;
    HAND_CONNECTIONS?: HandConnection[];
    drawConnectors?: (
      ctx: CanvasRenderingContext2D,
      landmarks: Landmark[],
      connections: HandConnection[],
      style: { color: string; lineWidth: number }
    ) => void;
    drawLandmarks?: (
      ctx: CanvasRenderingContext2D,
      landmarks: Landmark[],
      style: { color: string; lineWidth: number; radius: number }
    ) => void;
  }
}

interface HandConnection {
  start: number;
  end: number;
}

interface HandednessEntry {
  label: string;   // "Left" or "Right" (from camera perspective)
  score: number;
}

interface HandResults {
  multiHandLandmarks?: Landmark[][];
  multiHandedness?: HandednessEntry[];
}

interface MediaPipeHands {
  setOptions: (options: {
    maxNumHands: number;
    modelComplexity: number;
    minDetectionConfidence: number;
    minTrackingConfidence: number;
  }) => void;
  onResults: (callback: (results: HandResults) => void) => void;
  send: (data: { image: HTMLVideoElement }) => Promise<void>;
}

// ---- Per-hand skeleton colors ----
const HAND_COLORS: Record<Handedness, { connection: string; joint: string; wrist: string }> = {
  Left:  { connection: '#00f0ff', joint: '#ffffff', wrist: '#00f0ff' },   // cyan
  Right: { connection: '#f472b6', joint: '#ffffff', wrist: '#f472b6' },   // magenta/pink
};
const FALLBACK_COLORS = HAND_COLORS.Left;

// ---- Singleton — one WASM instance shared across all pages ----
let globalHands: MediaPipeHands | null = null;
let globalHandsPromise: Promise<MediaPipeHands> | null = null;
let mediaPipeScriptsPromise: Promise<void> | null = null;
let mediaPipeGlNoiseFiltered = false;

/**
 * Module-level ref to the currently-active consumer's results handler.
 * The singleton's onResults closure always delegates through this ref,
 * so page navigations can swap consumers without re-registering onResults
 * (which would otherwise clobber the callback on the old page's cleanup).
 */
let activeResultsHandler: ((results: HandResults) => void) | null = null;

/** Whether we have already registered the persistent onResults closure. */
let onResultsRegistered = false;

/**
 * MediaPipe WASM prints Abseil I0000/W0000 GL bootstrap lines to console.
 * Harmless, but Next.js forwards them to the terminal as [browser] noise.
 */
function suppressMediaPipeGlNoise(): void {
  if (mediaPipeGlNoiseFiltered || typeof window === 'undefined') return;
  mediaPipeGlNoiseFiltered = true;

  const noise = /gl_context(?:_webgl)?\.cc|OpenGL error checking is disabled/;
  const wrap = (method: 'log' | 'info' | 'warn' | 'debug'): void => {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      const first = args[0];
      if (typeof first === 'string' && noise.test(first)) return;
      original(...args);
    };
  };

  wrap('log');
  wrap('info');
  wrap('warn');
  wrap('debug');
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === 'true') {
        resolve();
        return;
      }
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener(
        'error',
        () => reject(new Error(`Failed to load ${src}`)),
        { once: true }
      );
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

/** Load Hands + drawing utils only when a gesture page needs them. */
async function ensureMediaPipeScripts(): Promise<void> {
  if (window.Hands && window.drawConnectors && window.drawLandmarks) return;
  if (mediaPipeScriptsPromise) return mediaPipeScriptsPromise;

  mediaPipeScriptsPromise = (async () => {
    await loadScript('/vendor/mediapipe/hands/hands.js');
    await loadScript('/vendor/mediapipe/drawing_utils.js');
    if (!window.Hands) {
      throw new Error('MediaPipe Hands library (window.Hands) is not loaded.');
    }
  })().catch((err: unknown) => {
    mediaPipeScriptsPromise = null;
    throw err;
  });

  return mediaPipeScriptsPromise;
}

async function getOrCreateHands(): Promise<MediaPipeHands> {
  if (globalHands) return globalHands;
  if (globalHandsPromise) return globalHandsPromise;

  globalHandsPromise = (async () => {
    try {
      suppressMediaPipeGlNoise();
      await ensureMediaPipeScripts();

      const ActiveHands = window.Hands;
      if (!ActiveHands) {
        throw new Error('MediaPipe Hands library (window.Hands) is not loaded.');
      }

      const hands = new ActiveHands({
        locateFile: (file: string) => `/vendor/mediapipe/hands/${file}`,
      });

      hands.setOptions({
        maxNumHands: 2,
        modelComplexity: 1,
        minDetectionConfidence: 0.7,
        minTrackingConfidence: 0.5,
      });

      globalHands = hands;
      return hands;
    } catch (err) {
      globalHandsPromise = null; // Allow retry on next mount
      throw err;
    }
  })();

  return globalHandsPromise;
}

function hasSignificantChange(
  prev: Landmark[] | null | undefined,
  current: Landmark[] | null,
  threshold = 0.002
): boolean {
  if (!prev || !current) return true;
  if (prev.length !== current.length) return true;

  // Check key tracking points: wrist (0), thumb tip (4), index tip (8), middle tip (12), pinky tip (20)
  const keyIndices = [0, 4, 8, 12, 20];
  const thresholdSq = threshold * threshold;

  for (const idx of keyIndices) {
    const p = prev[idx];
    const c = current[idx];
    if (!p || !c) return true;
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    const dz = p.z - c.z;
    const distSq = dx * dx + dy * dy + dz * dz;
    if (distSq > thresholdSq) {
      return true;
    }
  }
  return false;
}

/**
 * Mirror-correct the handedness label.
 * MediaPipe reports from the camera's perspective, but the video is CSS-mirrored,
 * so "Left" from MediaPipe = the user's Right hand on screen.
 */
function mirrorHandedness(label: string): Handedness {
  if (label === 'Left') return 'Right';
  if (label === 'Right') return 'Left';
  return 'Right'; // fallback
}

// ---- Hook ----
export function useMediaPipe(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  onHandsUpdate: (hands: HandData[], rawLandmarks?: Landmark[][], rawHandedness?: Handedness[]) => void,
  enabled = true
): {
  isLoading: boolean;
  error: string | null;
} {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const resultsHandlerRef = useRef<((results: HandResults) => void) | null>(null);

  const onHandsUpdateRef = useRef(onHandsUpdate);
  useEffect(() => {
    onHandsUpdateRef.current = onHandsUpdate;
  }, [onHandsUpdate]);

  // Per-hand dedup: undefined = "no result yet" (sentinel)
  const lastLandmarksMapRef = useRef<Map<Handedness, Landmark[] | undefined>>(
    new Map([['Left', undefined], ['Right', undefined]])
  );
  // Track which hands were present last frame (to detect hand removal)
  const lastHandSetRef = useRef<Set<Handedness>>(new Set());
  // Sentinel for very first result
  const hasReceivedFirstResult = useRef(false);

  useEffect(() => {
    let isCancelled = false;

    if (!enabled) {
      const canvas = canvasRef.current;
      canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
      return () => {
        isCancelled = true;
      };
    }

    hasReceivedFirstResult.current = false;
    lastHandSetRef.current = new Set();
    lastLandmarksMapRef.current = new Map([['Left', undefined], ['Right', undefined]]);

    async function setupMediaPipe(): Promise<void> {
      try {
        setIsLoading(true);
        setError(null);

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 1280, height: 720, frameRate: 30 },
        });

        if (isCancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch((err: unknown) => {
            console.warn('Webcam stream play interrupted:', err);
          });
        }

        const hands = await getOrCreateHands();
        if (isCancelled) return;

        const ActiveHandConnections = window.HAND_CONNECTIONS;
        const activeDrawConnectors = window.drawConnectors;
        const activeDrawLandmarks = window.drawLandmarks;

        // Build this consumer's results handler
        const myResultsHandler = (results: HandResults): void => {
          if (isCancelled) return;
          if (!canvasRef.current || !videoRef.current) return;

          // Keep canvas backing store in sync with the camera frame
          const { videoWidth, videoHeight } = videoRef.current;
          if (
            videoWidth > 0 &&
            videoHeight > 0 &&
            (canvasRef.current.width !== videoWidth ||
              canvasRef.current.height !== videoHeight)
          ) {
            canvasRef.current.width = videoWidth;
            canvasRef.current.height = videoHeight;
          }

          const canvasCtx = canvasRef.current.getContext('2d');
          if (!canvasCtx) return;

          const canvasWidth = canvasRef.current.width;
          const canvasHeight = canvasRef.current.height;

          canvasCtx.save();
          canvasCtx.clearRect(0, 0, canvasWidth, canvasHeight);

          // Draw in raw MediaPipe space. WebcamView applies one shared CSS
          // horizontal mirror to the video + canvas plane so they stay aligned.

          const detectedHands: HandData[] = [];
          const currentHandSet = new Set<Handedness>();
          const rawLandmarks: Landmark[][] = [];
          const rawHandedness: Handedness[] = [];

          if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
            for (let i = 0; i < results.multiHandLandmarks.length; i++) {
              const landmarks = results.multiHandLandmarks[i];
              const handednessEntry = results.multiHandedness?.[i];
              const handedness = handednessEntry
                ? mirrorHandedness(handednessEntry.label)
                : (i === 0 ? 'Right' : 'Left');

              currentHandSet.add(handedness);
              detectedHands.push({ landmarks, handedness });

              rawLandmarks.push(landmarks);
              rawHandedness.push(
                handednessEntry
                  ? (handednessEntry.label as Handedness)
                  : (i === 0 ? 'Left' : 'Right')
              );

              // Per-hand skeleton drawing with distinct colors
              const colors = HAND_COLORS[handedness] ?? FALLBACK_COLORS;

              if (activeDrawConnectors && ActiveHandConnections) {
                activeDrawConnectors(canvasCtx, landmarks, ActiveHandConnections, {
                  color: colors.connection,
                  lineWidth: 1.5,
                });
              }
              if (activeDrawLandmarks) {
                activeDrawLandmarks(canvasCtx, landmarks, {
                  color: colors.joint,
                  lineWidth: 1,
                  radius: 3,
                });
              }

              // Draw wrist (index 0) with a larger colored dot
              const wrist = landmarks[0];
              if (wrist) {
                const wx = wrist.x * canvasWidth;
                const wy = wrist.y * canvasHeight;
                canvasCtx.beginPath();
                canvasCtx.arc(wx, wy, 5, 0, Math.PI * 2);
                canvasCtx.fillStyle = colors.wrist;
                canvasCtx.fill();
              }
            }
          }

          canvasCtx.restore();

          // Determine if we need to fire the callback (dedup per-hand)
          let changed = false;

          // Check if a hand was removed
          for (const prevHand of lastHandSetRef.current) {
            if (!currentHandSet.has(prevHand)) {
              changed = true;
              lastLandmarksMapRef.current.set(prevHand, undefined);
            }
          }

          // Check each detected hand for significant changes
          for (const hand of detectedHands) {
            const prev = lastLandmarksMapRef.current.get(hand.handedness);
            if (hasSignificantChange(prev, hand.landmarks)) {
              changed = true;
              lastLandmarksMapRef.current.set(hand.handedness, hand.landmarks);
            }
          }

          // Always fire on the very first result (even if empty) so onFirstFrame works
          if (!hasReceivedFirstResult.current) {
            hasReceivedFirstResult.current = true;
            changed = true;
          }

          if (changed) {
            onHandsUpdateRef.current(detectedHands, rawLandmarks, rawHandedness);
          }

          lastHandSetRef.current = currentHandSet;
          setIsLoading(false);
        };
        resultsHandlerRef.current = myResultsHandler;

        // Register the persistent onResults closure only once on the singleton.
        // Subsequent consumers swap via activeResultsHandler, not via hands.onResults().
        if (!onResultsRegistered) {
          hands.onResults((results: HandResults) => {
            activeResultsHandler?.(results);
          });
          onResultsRegistered = true;
        }

        // Become the active consumer
        activeResultsHandler = myResultsHandler;

        const processFrame = async (): Promise<void> => {
          if (isCancelled) return;
          try {
            const video = videoRef.current;
            if (video && video.readyState >= 2) {
              await hands.send({ image: video });
            }
            animationFrameRef.current = requestAnimationFrame(() => {
              void processFrame();
            });
          } catch (err) {
            if (isCancelled) return;
            const msg = err instanceof Error ? err.message : 'Error processing camera frames';
            console.error('MediaPipe frame processing error:', err);
            setError(msg);
            setIsLoading(false);
          }
        };

        void processFrame();
      } catch (err) {
        if (isCancelled) return;
        const msg = err instanceof Error ? err.message : 'MediaPipe init failed';
        console.error('MediaPipe initialization error:', err);
        setError(msg);
        setIsLoading(false);
      }
    }

    // Scripts load lazily inside getOrCreateHands — start setup immediately.
    void setupMediaPipe();

    return () => {
      isCancelled = true;

      // Release active consumer slot — don't touch hands.onResults()
      if (activeResultsHandler === resultsHandlerRef.current) {
        activeResultsHandler = null;
      }
      resultsHandlerRef.current = null;

      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [canvasRef, enabled, videoRef]); // Releasing and reacquiring camera is intentional when enabled changes.

  return { isLoading: enabled ? isLoading : false, error: enabled ? error : null };
}
