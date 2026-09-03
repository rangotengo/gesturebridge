import { useEffect, useRef, useState } from 'react';

export type MicrophoneStatus = 'idle' | 'requesting' | 'available' | 'unavailable';

export interface UseBlowDetectionOptions {
  /** Starts microphone capture only while Mirror Mode is active. */
  enabled: boolean;
  /** Called once for each detected exhale burst. */
  onBlow: () => void;
  /** Minimum time between fog bursts. Defaults to 1.4 seconds. */
  cooldownMs?: number;
  /** Quiet period used to learn the room's normal sound level. Defaults to 800ms. */
  calibrationMs?: number;
}

export interface BlowDetectionState {
  microphoneStatus: MicrophoneStatus;
  /** False when browser/Electron permission is denied or capture is unavailable. */
  isMicrophoneAvailable: boolean;
}

const FFT_SIZE = 1024;
const MIN_BLOW_ENERGY = 0.000025;
const MIN_BURST_MS = 110;

interface SpectrumMetrics {
  broadbandEnergy: number;
  lowWeightedEnergy: number;
  spectralFlatness: number;
}

function averagePower(
  spectrum: Float32Array<ArrayBuffer>,
  startBin: number,
  endBin: number
): number {
  let total = 0;
  const start = Math.max(0, startBin);
  const end = Math.min(spectrum.length - 1, endBin);

  if (end < start) return 0;

  for (let index = start; index <= end; index += 1) {
    const amplitude = 10 ** (spectrum[index] / 20);
    total += amplitude * amplitude;
  }

  return total / (end - start + 1);
}

function calculateMetrics(
  spectrum: Float32Array<ArrayBuffer>,
  sampleRate: number
): SpectrumMetrics {
  const binFor = (hertz: number): number => Math.round((hertz * FFT_SIZE) / sampleRate);
  const lowEnergy = averagePower(spectrum, binFor(90), binFor(900));
  const middleEnergy = averagePower(spectrum, binFor(900), binFor(2_400));
  const broadbandEnergy = averagePower(spectrum, binFor(120), binFor(2_400));

  // Spectral flatness differentiates turbulent air (relatively flat/broadband)
  // from voiced speech, which concentrates energy in harmonics.
  const flatnessStart = Math.max(0, binFor(120));
  const flatnessEnd = Math.min(spectrum.length - 1, binFor(2_400));
  let logPowerTotal = 0;
  let powerTotal = 0;
  let count = 0;

  for (let index = flatnessStart; index <= flatnessEnd; index += 1) {
    const amplitude = 10 ** (spectrum[index] / 20);
    const power = Math.max(amplitude * amplitude, Number.EPSILON);
    logPowerTotal += Math.log(power);
    powerTotal += power;
    count += 1;
  }

  const arithmeticMean = count > 0 ? powerTotal / count : 0;
  const geometricMean = count > 0 ? Math.exp(logPowerTotal / count) : 0;

  return {
    broadbandEnergy,
    // Exhales normally have more low/mid turbulent energy than a sharp high-frequency sound.
    lowWeightedEnergy: lowEnergy * 1.35 + middleEnergy * 0.65,
    spectralFlatness: arithmeticMean > 0 ? geometricMean / arithmeticMean : 0,
  };
}

/**
 * Detects a short, turbulent exhale instead of treating any loud sound as a blow.
 * Permission failures intentionally remain silent: callers can use microphoneStatus
 * to activate the Face Mesh fallback without interrupting Mirror Mode.
 */
export function useBlowDetection({
  enabled,
  onBlow,
  cooldownMs = 1_400,
  calibrationMs = 800,
}: UseBlowDetectionOptions): BlowDetectionState {
  const [microphoneStatus, setMicrophoneStatus] = useState<MicrophoneStatus>('idle');
  const onBlowRef = useRef(onBlow);

  useEffect(() => {
    onBlowRef.current = onBlow;
  }, [onBlow]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let cancelled = false;
    let unavailableTimeout: number | null = null;
    const reportUnavailable = (): void => {
      unavailableTimeout = window.setTimeout(() => {
        if (!cancelled) setMicrophoneStatus('unavailable');
      }, 0);
    };

    if (
      typeof window === 'undefined' ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getUserMedia !== 'function' ||
      typeof AudioContext === 'undefined'
    ) {
      reportUnavailable();
      return () => {
        cancelled = true;
        if (unavailableTimeout !== null) window.clearTimeout(unavailableTimeout);
      };
    }

    let animationFrameId: number | null = null;
    let stream: MediaStream | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let analyser: AnalyserNode | null = null;
    let audioContext: AudioContext | null = null;

    const stopAudio = (): void => {
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      }
      source?.disconnect();
      analyser?.disconnect();
      stream?.getTracks().forEach((track) => track.stop());
      if (audioContext && audioContext.state !== 'closed') {
        void audioContext.close();
      }
    };

    const start = async (): Promise<void> => {
      setMicrophoneStatus('requesting');

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            autoGainControl: false,
            channelCount: 1,
            echoCancellation: false,
            noiseSuppression: false,
          },
          video: false,
        });

        if (cancelled) {
          stopAudio();
          return;
        }

        audioContext = new AudioContext();
        source = audioContext.createMediaStreamSource(stream);
        analyser = audioContext.createAnalyser();
        analyser.fftSize = FFT_SIZE;
        analyser.smoothingTimeConstant = 0.18;
        source.connect(analyser);
        await audioContext.resume();

        if (cancelled) {
          stopAudio();
          return;
        }

        const activeAnalyser = analyser;
        const activeContext = audioContext;
        const frequencyData = new Float32Array(activeAnalyser.frequencyBinCount);
        const calibrationStartedAt = performance.now();
        let calibrationSamples = 0;
        let baselineBroadband = 0;
        let baselineLowWeighted = 0;
        let burstStartedAt: number | null = null;
        let lastBlowAt = Number.NEGATIVE_INFINITY;

        setMicrophoneStatus('available');

        const analyze = (timestamp: number): void => {
          if (cancelled) return;

          activeAnalyser.getFloatFrequencyData(frequencyData);
          const metrics = calculateMetrics(frequencyData, activeContext.sampleRate);
          const stillCalibrating = timestamp - calibrationStartedAt < calibrationMs;

          if (stillCalibrating) {
            calibrationSamples += 1;
            baselineBroadband += (metrics.broadbandEnergy - baselineBroadband) / calibrationSamples;
            baselineLowWeighted += (metrics.lowWeightedEnergy - baselineLowWeighted) / calibrationSamples;
            animationFrameId = window.requestAnimationFrame(analyze);
            return;
          }

          const energyThreshold = Math.max(MIN_BLOW_ENERGY, baselineBroadband * 3.8);
          const lowEnergyThreshold = Math.max(MIN_BLOW_ENERGY, baselineLowWeighted * 3.1);
          const isTurbulentExhale =
            metrics.broadbandEnergy >= energyThreshold &&
            metrics.lowWeightedEnergy >= lowEnergyThreshold &&
            metrics.spectralFlatness >= 0.42;

          if (isTurbulentExhale) {
            burstStartedAt ??= timestamp;
            if (
              timestamp - burstStartedAt >= MIN_BURST_MS &&
              timestamp - lastBlowAt >= cooldownMs
            ) {
              lastBlowAt = timestamp;
              burstStartedAt = null;
              onBlowRef.current();
            }
          } else {
            burstStartedAt = null;
            // Follow a changing room noise level, but only while not observing a blow.
            baselineBroadband = baselineBroadband * 0.985 + metrics.broadbandEnergy * 0.015;
            baselineLowWeighted = baselineLowWeighted * 0.985 + metrics.lowWeightedEnergy * 0.015;
          }

          animationFrameId = window.requestAnimationFrame(analyze);
        };

        animationFrameId = window.requestAnimationFrame(analyze);
      } catch {
        stopAudio();
        if (!cancelled) setMicrophoneStatus('unavailable');
      }
    };

    void start();

    return () => {
      cancelled = true;
      if (unavailableTimeout !== null) window.clearTimeout(unavailableTimeout);
      stopAudio();
    };
  }, [calibrationMs, cooldownMs, enabled]);

  return {
    microphoneStatus: enabled ? microphoneStatus : 'idle',
    isMicrophoneAvailable: enabled && microphoneStatus === 'available',
  };
}
