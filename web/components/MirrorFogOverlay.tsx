'use client';

import { useEffect, useRef } from 'react';

export interface MirrorFogPoint {
  /** Normalized video coordinates: 0..1 in raw MediaPipe space (pre CSS mirror). */
  x: number;
  y: number;
}

export interface MirrorFogOverlayProps {
  /** 0 is clear and 1 is fully fogged. Values outside this range are clamped. */
  density: number;
  /**
   * Increments on every blow/pucker. Spawns a breath bloom even when density is
   * already at the cap so repeat blows still feel responsive.
   */
  blowNonce?: number;
  /** The current pointing fingertip in raw video space. Leaves a lasting wipe trail. */
  fingertipPosition?: MirrorFogPoint | null;
  /** CSS-pixel radius of the wipe brush, scaled to the video bitmap. Defaults to 52. */
  clearRadiusPx?: number;
  /**
   * Camera element used for object-cover alignment. When present, the fog bitmap
   * matches videoWidth×videoHeight so wipes stay locked to the finger.
   */
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  /** Additional layout classes. Parent should be the mirrored camera plane. */
  className?: string;
}

const NOISE_WIDTH = 192;
const NOISE_HEIGHT = 108;
/** Per-frame wipe fade. Higher = fog returns faster after a wipe. */
const WIPE_FADE_ALPHA = 0.014;
const BLOOM_DURATION_MS = 1_500;
const BLOOM_ORIGIN = { x: 0.5, y: 0.62 };
const MIN_DROPLET_DENSITY = 0.15;

interface BreathBloom {
  id: number;
  bornAt: number;
  durationMs: number;
  peakRadius: number;
  originX: number;
  originY: number;
}

interface Droplet {
  x: number;
  y: number;
  radiusX: number;
  radiusY: number;
  highlight: number;
  dripSpeed: number;
  seed: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

function smoothNoise(x: number, y: number, time: number): number {
  const first = Math.sin(x * 0.071 + time * 0.00018) * Math.cos(y * 0.063 - time * 0.00014);
  const second = Math.sin((x + y) * 0.119 - time * 0.00029);
  const third = Math.cos(x * 0.023 - y * 0.031 + time * 0.00011);
  const fourth = Math.sin(x * 0.21 + y * 0.17 + time * 0.00007) * 0.35;
  return (first * 0.4 + second * 0.25 + third * 0.2 + fourth * 0.15 + 1) * 0.5;
}

function hash01(seed: number): number {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

function createDroplet(seed: number, width: number, height: number): Droplet {
  const size = 1.4 + hash01(seed + 1) * 4.8;
  const elongated = hash01(seed + 2) > 0.55;
  return {
    x: hash01(seed + 3) * width,
    y: hash01(seed + 4) * height,
    radiusX: size * (0.7 + hash01(seed + 5) * 0.5),
    radiusY: size * (elongated ? 1.15 + hash01(seed + 6) * 0.7 : 0.85 + hash01(seed + 6) * 0.35),
    highlight: 0.45 + hash01(seed + 7) * 0.45,
    dripSpeed: hash01(seed + 8) > 0.72 ? 0.012 + hash01(seed + 9) * 0.035 : 0,
    seed,
  };
}

function targetDropletCount(density: number): number {
  if (density < MIN_DROPLET_DENSITY) return 0;
  return Math.round(12 + density * 28);
}

/**
 * Animated fog that lives inside the CSS-mirrored camera plane.
 * Blow/pucker stacks soft breath blooms; pointing leaves a lasting wipe trail.
 */
export default function MirrorFogOverlay({
  density,
  blowNonce = 0,
  fingertipPosition = null,
  clearRadiusPx = 52,
  videoRef,
  className = '',
}: MirrorFogOverlayProps): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const densityRef = useRef(density);
  const fingertipRef = useRef<MirrorFogPoint | null>(fingertipPosition);
  const radiusRef = useRef(clearRadiusPx);
  const bloomsRef = useRef<BreathBloom[]>([]);
  const dropletsRef = useRef<Droplet[]>([]);
  const nextBloomIdRef = useRef(0);
  const lastBlowNonceRef = useRef(blowNonce);

  useEffect(() => {
    densityRef.current = density;
  }, [density]);

  useEffect(() => {
    fingertipRef.current = fingertipPosition;
  }, [fingertipPosition]);

  useEffect(() => {
    radiusRef.current = clearRadiusPx;
  }, [clearRadiusPx]);

  useEffect(() => {
    if (blowNonce <= 0 || blowNonce === lastBlowNonceRef.current) return;
    lastBlowNonceRef.current = blowNonce;

    const jitter = (hash01(blowNonce * 17.3) - 0.5) * 0.08;
    bloomsRef.current.push({
      id: nextBloomIdRef.current++,
      bornAt: performance.now(),
      durationMs: BLOOM_DURATION_MS,
      peakRadius: 0.42 + hash01(blowNonce * 9.1) * 0.22,
      originX: BLOOM_ORIGIN.x + jitter,
      originY: BLOOM_ORIGIN.y + (hash01(blowNonce * 5.7) - 0.5) * 0.06,
    });
  }, [blowNonce]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext('2d');
    const noiseCanvas = document.createElement('canvas');
    noiseCanvas.width = NOISE_WIDTH;
    noiseCanvas.height = NOISE_HEIGHT;
    const noiseContext = noiseCanvas.getContext('2d', { alpha: true });

    const wipeCanvas = document.createElement('canvas');
    const wipeContext = wipeCanvas.getContext('2d', { alpha: true });

    const bloomCanvas = document.createElement('canvas');
    const bloomContext = bloomCanvas.getContext('2d', { alpha: true });

    const dropletCanvas = document.createElement('canvas');
    const dropletContext = dropletCanvas.getContext('2d', { alpha: true });

    if (!context || !noiseContext || !wipeContext || !bloomContext || !dropletContext) return;

    let animationFrameId: number | null = null;
    let width = 0;
    let height = 0;
    let lastNoiseUpdate = Number.NEGATIVE_INFINITY;
    let dropletSeedCursor = 1;

    const syncBitmapSize = (): boolean => {
      const video = videoRef?.current;
      const nextWidth =
        video && video.videoWidth > 0
          ? video.videoWidth
          : Math.max(1, Math.round(canvas.getBoundingClientRect().width));
      const nextHeight =
        video && video.videoHeight > 0
          ? video.videoHeight
          : Math.max(1, Math.round(canvas.getBoundingClientRect().height));

      if (nextWidth === width && nextHeight === height) return width > 0 && height > 0;

      const scaleX = width > 0 ? nextWidth / width : 1;
      const scaleY = height > 0 ? nextHeight / height : 1;
      dropletsRef.current = dropletsRef.current.map((drop) => ({
        ...drop,
        x: drop.x * scaleX,
        y: drop.y * scaleY,
        radiusX: drop.radiusX * scaleX,
        radiusY: drop.radiusY * scaleY,
      }));

      width = nextWidth;
      height = nextHeight;
      canvas.width = width;
      canvas.height = height;
      wipeCanvas.width = width;
      wipeCanvas.height = height;
      bloomCanvas.width = width;
      bloomCanvas.height = height;
      dropletCanvas.width = width;
      dropletCanvas.height = height;
      wipeContext.clearRect(0, 0, width, height);
      return true;
    };

    const syncDroplets = (activeDensity: number): void => {
      const target = targetDropletCount(activeDensity);
      const droplets = dropletsRef.current;

      while (droplets.length < target) {
        dropletSeedCursor += 1;
        droplets.push(createDroplet(dropletSeedCursor * 97.13, width, height));
      }
      if (droplets.length > target) {
        dropletsRef.current = droplets.slice(0, target);
      }
    };

    const updateNoise = (timestamp: number): void => {
      const image = noiseContext.createImageData(NOISE_WIDTH, NOISE_HEIGHT);
      const data = image.data;

      for (let y = 0; y < NOISE_HEIGHT; y += 1) {
        for (let x = 0; x < NOISE_WIDTH; x += 1) {
          const noise = smoothNoise(x, y, timestamp);
          const fleck = Math.sin(x * 2.4 + y * 3.1 + timestamp * 0.0014) * 0.5 + 0.5;
          const edgeFalloff =
            0.55 +
            0.45 *
              (1 -
                Math.min(
                  1,
                  Math.hypot((x / NOISE_WIDTH) * 2 - 1, (y / NOISE_HEIGHT) * 2 - 1) * 0.85
                ));
          const lowerBias = 0.85 + (y / NOISE_HEIGHT) * 0.25;
          const index = (y * NOISE_WIDTH + x) * 4;
          // Near-white milky condensation instead of a blue fog wash.
          const brightness = Math.round(228 + noise * 18 + fleck * 6);
          data[index] = brightness;
          data[index + 1] = Math.min(255, brightness + 2);
          data[index + 2] = Math.min(255, brightness + 4);
          data[index + 3] = Math.round((38 + noise * 72) * edgeFalloff * lowerBias);
        }
      }

      noiseContext.putImageData(image, 0, 0);
      lastNoiseUpdate = timestamp;
    };

    const drawBlooms = (now: number, activeDensity: number): number => {
      bloomContext.clearRect(0, 0, width, height);
      const blooms = bloomsRef.current.filter((bloom) => now - bloom.bornAt < bloom.durationMs + 400);
      bloomsRef.current = blooms;

      let peakBloom = 0;
      for (const bloom of blooms) {
        const progress = clamp((now - bloom.bornAt) / bloom.durationMs, 0, 1);
        const eased = easeOutCubic(progress);
        const radiusX = bloom.peakRadius * eased * width;
        const radiusY = bloom.peakRadius * eased * height * 1.35;
        const cx = bloom.originX * width;
        const cy = bloom.originY * height;
        const opacity = (0.55 + activeDensity * 0.35) * (progress < 0.2 ? progress / 0.2 : 1);
        peakBloom = Math.max(peakBloom, eased * opacity);

        const gradient = bloomContext.createRadialGradient(
          cx,
          cy,
          Math.max(1, radiusX * 0.08),
          cx,
          cy,
          Math.max(radiusX, radiusY)
        );
        gradient.addColorStop(0, `rgba(245, 250, 255, ${0.55 * opacity})`);
        gradient.addColorStop(0.45, `rgba(232, 240, 248, ${0.38 * opacity})`);
        gradient.addColorStop(0.78, `rgba(220, 230, 238, ${0.16 * opacity})`);
        gradient.addColorStop(1, 'rgba(220, 230, 238, 0)');

        bloomContext.save();
        bloomContext.translate(cx, cy);
        bloomContext.scale(1, radiusY / Math.max(radiusX, 1));
        bloomContext.translate(-cx, -cy);
        bloomContext.fillStyle = gradient;
        bloomContext.beginPath();
        bloomContext.arc(cx, cy, Math.max(radiusX, 1), 0, Math.PI * 2);
        bloomContext.fill();
        bloomContext.restore();
      }

      return peakBloom;
    };

    const drawDroplets = (activeDensity: number): void => {
      dropletContext.clearRect(0, 0, width, height);
      if (activeDensity < MIN_DROPLET_DENSITY) {
        dropletsRef.current = [];
        return;
      }

      syncDroplets(activeDensity);
      const visibility = clamp((activeDensity - MIN_DROPLET_DENSITY) / 0.35, 0, 1);

      for (const drop of dropletsRef.current) {
        if (drop.dripSpeed > 0) {
          drop.y += drop.dripSpeed * (0.65 + activeDensity);
          if (drop.y - drop.radiusY > height) {
            drop.y = -drop.radiusY;
            drop.x = hash01(drop.seed + drop.y) * width;
          }
        }

        const alpha = (0.35 + drop.highlight * 0.4) * visibility;

        // Soft contact shadow
        dropletContext.save();
        dropletContext.translate(drop.x, drop.y);
        dropletContext.scale(drop.radiusX, drop.radiusY);
        dropletContext.beginPath();
        dropletContext.arc(0, 0, 1, 0, Math.PI * 2);
        dropletContext.fillStyle = `rgba(40, 55, 70, ${0.18 * alpha})`;
        dropletContext.fill();
        dropletContext.restore();

        // Body — translucent lens
        dropletContext.save();
        dropletContext.translate(drop.x, drop.y);
        dropletContext.scale(drop.radiusX, drop.radiusY);
        const body = dropletContext.createRadialGradient(-0.25, -0.35, 0.05, 0, 0, 1);
        body.addColorStop(0, `rgba(255, 255, 255, ${0.72 * alpha})`);
        body.addColorStop(0.45, `rgba(210, 225, 235, ${0.28 * alpha})`);
        body.addColorStop(1, `rgba(150, 175, 195, ${0.12 * alpha})`);
        dropletContext.beginPath();
        dropletContext.arc(0, 0, 1, 0, Math.PI * 2);
        dropletContext.fillStyle = body;
        dropletContext.fill();
        dropletContext.restore();

        // Specular highlight
        dropletContext.save();
        dropletContext.translate(
          drop.x - drop.radiusX * 0.28,
          drop.y - drop.radiusY * 0.32
        );
        dropletContext.scale(drop.radiusX * 0.28, drop.radiusY * 0.22);
        dropletContext.beginPath();
        dropletContext.arc(0, 0, 1, 0, Math.PI * 2);
        dropletContext.fillStyle = `rgba(255, 255, 255, ${0.85 * drop.highlight * alpha})`;
        dropletContext.fill();
        dropletContext.restore();
      }
    };

    const render = (timestamp: number): void => {
      if (!syncBitmapSize()) {
        animationFrameId = window.requestAnimationFrame(render);
        return;
      }

      const activeDensity = clamp(densityRef.current, 0, 1);

      // Softly fade existing wipes so cleared glass slowly re-fogs.
      wipeContext.globalCompositeOperation = 'destination-out';
      wipeContext.fillStyle = `rgba(0, 0, 0, ${WIPE_FADE_ALPHA})`;
      wipeContext.fillRect(0, 0, width, height);
      wipeContext.globalCompositeOperation = 'source-over';

      const point = fingertipRef.current;
      if (point && activeDensity > 0) {
        const x = clamp(point.x, 0, 1) * width;
        const y = clamp(point.y, 0, 1) * height;
        const cssWidth = Math.max(1, canvas.getBoundingClientRect().width);
        const radius = Math.max(0, radiusRef.current) * (width / cssWidth);
        const gradient = wipeContext.createRadialGradient(x, y, radius * 0.15, x, y, radius);
        gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
        gradient.addColorStop(0.65, 'rgba(255, 255, 255, 0.85)');
        gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
        wipeContext.fillStyle = gradient;
        wipeContext.beginPath();
        wipeContext.arc(x, y, radius, 0, Math.PI * 2);
        wipeContext.fill();
      }

      context.clearRect(0, 0, width, height);

      if (activeDensity > 0 || bloomsRef.current.length > 0) {
        if (timestamp - lastNoiseUpdate > 70) updateNoise(timestamp);

        const bloomStrength = drawBlooms(timestamp, activeDensity);
        // Early blow frames are bloom-local; stacked density fills the pane over time.
        const veilOpacity = Math.min(1, activeDensity * 0.82 + bloomStrength * 0.35);

        if (veilOpacity > 0.01) {
          const veil = context.createRadialGradient(
            width * 0.5,
            height * 0.42,
            Math.min(width, height) * 0.08,
            width * 0.5,
            height * 0.55,
            Math.max(width, height) * 0.72
          );
          veil.addColorStop(0, `rgba(248, 251, 255, ${0.22 * veilOpacity})`);
          veil.addColorStop(0.55, `rgba(235, 242, 248, ${0.34 * veilOpacity})`);
          veil.addColorStop(1, `rgba(200, 214, 226, ${0.42 * veilOpacity})`);
          context.fillStyle = veil;
          context.fillRect(0, 0, width, height);

          context.globalAlpha = veilOpacity * 0.78;
          context.imageSmoothingEnabled = true;
          context.drawImage(noiseCanvas, 0, 0, width, height);
          context.globalAlpha = 1;
        }

        context.globalAlpha = 1;
        context.drawImage(bloomCanvas, 0, 0);

        drawDroplets(activeDensity);
        context.drawImage(dropletCanvas, 0, 0);

        context.globalCompositeOperation = 'destination-out';
        context.drawImage(wipeCanvas, 0, 0);
        context.globalCompositeOperation = 'source-over';
      } else {
        wipeContext.clearRect(0, 0, width, height);
        bloomsRef.current = [];
        dropletsRef.current = [];
      }

      animationFrameId = window.requestAnimationFrame(render);
    };

    animationFrameId = window.requestAnimationFrame(render);

    return () => {
      if (animationFrameId !== null) window.cancelAnimationFrame(animationFrameId);
    };
  }, [videoRef]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={`absolute inset-0 z-20 h-full w-full object-cover pointer-events-none ${className}`}
    />
  );
}
