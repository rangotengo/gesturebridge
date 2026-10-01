'use client';

import React, { useRef, useCallback, useEffect } from 'react';
import { useMediaPipe } from '@/hooks/useMediaPipe';
import type { HandData } from '@/ml/gestureUtils';

interface WebcamViewProps {
  onLandmarksUpdate: (hands: HandData[]) => void;
  /** Called once after the first frame is processed — used to dismiss the init overlay */
  onFirstFrame?: () => void;
  /** Called when a camera or MediaPipe initialization error occurs or is cleared */
  onError?: (error: string | null) => void;
  /** When false, stops camera tracks and MediaPipe processing. */
  isActive?: boolean;
  isCompact?: boolean;
  /** Use embedded when the camera belongs inside normal page flow. */
  layout?: 'viewport' | 'embedded';
  /** Optional shared video element ref for isolated consumers such as Face Mesh. */
  videoElementRef?: React.RefObject<HTMLVideoElement | null>;
  /** Optional overlay rendered inside the mirrored camera plane (e.g. Mirror fog). */
  mirrorOverlay?: React.ReactNode;
  /** Optional callback fired when video metadata loads with the actual resolution */
  onVideoDimensionsChange?: (dimensions: { width: number; height: number }) => void;
}

export default function WebcamView({
  onLandmarksUpdate,
  onFirstFrame,
  onError,
  isActive = true,
  isCompact = false,
  layout = 'viewport',
  videoElementRef,
  mirrorOverlay,
  onVideoDimensionsChange,
}: WebcamViewProps): React.ReactElement {
  const internalVideoRef = useRef<HTMLVideoElement | null>(null);
  const videoRef = videoElementRef ?? internalVideoRef;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const firstFrameFiredRef = useRef(false);

  const handleHands = useCallback((hands: HandData[]): void => {
    onLandmarksUpdate(hands);
    // Fire onFirstFrame once after any result (hand or no hand) is received
    if (!firstFrameFiredRef.current) {
      firstFrameFiredRef.current = true;
      onFirstFrame?.();
    }
  }, [onLandmarksUpdate, onFirstFrame]);

  const { error, retry } = useMediaPipe(videoRef, canvasRef, handleHands, isActive);

  useEffect(() => {
    onError?.(error);
  }, [error, onError]);

  const isEmbedded = layout === 'embedded';
  const frameLayoutClasses = isEmbedded
    ? 'absolute inset-0 h-full w-full'
    : isCompact
      ? 'fixed inset-0 h-full w-full rounded-2xl z-10 border border-white/15 transition-all duration-300'
      : 'fixed inset-0 h-full w-full z-0';

  return (
    <>
      {/*
        Single CSS mirror on the shared camera plane so video, skeleton, and
        optional mirror overlays stay pixel-aligned under object-cover.
      */}
      <div
        className={`${frameLayoutClasses} -scale-x-100 ${isActive ? 'block' : 'hidden'}`}
      >
        <video
          ref={videoRef}
          className="absolute inset-0 h-full w-full object-cover"
          muted
          playsInline
          aria-label="Webcam feed"
          onLoadedMetadata={(e) => {
            const video = e.currentTarget;
            if (video.videoWidth > 0 && video.videoHeight > 0) {
              onVideoDimensionsChange?.({ width: video.videoWidth, height: video.videoHeight });
            }
          }}
        />

        {/* Skeleton overlay — hidden in compact mode */}
        <canvas
          ref={canvasRef}
          className={`absolute inset-0 h-full w-full object-cover pointer-events-none ${
            isCompact ? 'hidden' : 'block'
          }`}
          aria-hidden="true"
        />

        {mirrorOverlay}
      </div>

      {/* Camera-off placeholder */}
      {!isActive && (
        <div className={`${frameLayoutClasses} z-0 bg-black flex items-center justify-center`}>
          <div className="text-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="mx-auto mb-3 text-white/20" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="1" y1="23" x2="23" y2="1" />
              <path d="M21 21H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3m3-3h6l2 3h4a2 2 0 0 1 2 2v9.34m-7.72-2.06A4 4 0 1 1 8.71 8.71" />
            </svg>
            <p className="font-mono text-xs text-white/20 tracking-widest uppercase">Camera Off</p>
          </div>
        </div>
      )}

      {/* Error state with retry action */}
      {error && (
        <div
          className={`${
            isEmbedded ? 'absolute inset-x-0 top-3' : 'fixed inset-x-0 top-16'
          } z-50 flex justify-center px-4`}
        >
          <div className="bg-red-950/90 border border-red-500/60 rounded-xl px-5 py-3.5 shadow-2xl flex flex-col sm:flex-row items-center gap-3 max-w-lg pointer-events-auto backdrop-blur-md">
            <div className="flex items-center gap-2 text-red-300 text-xs font-mono">
              <span className="text-base leading-none" aria-hidden="true">⚠️</span>
              <span>{error}</span>
            </div>
            <button
              type="button"
              onClick={retry}
              className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white font-mono text-xs font-medium uppercase tracking-wider transition-colors shrink-0 shadow cursor-pointer"
            >
              Retry Camera
            </button>
          </div>
        </div>
      )}
    </>
  );
}
