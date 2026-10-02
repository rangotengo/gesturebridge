import * as crypto from 'crypto';

export const IPC_RATE_LIMIT_WINDOW_MS = 1_000;
export const MAX_ABSOLUTE_COORDINATE = 100_000;

export type MouseAction = 'down' | 'up';
export type MouseButton = 'left' | 'right' | 'middle';
export type MouseToggleButton = 'left' | 'right';
export type ScrollDirection = 'up' | 'down';
export type ZoomDirection = 'in' | 'out';

export interface PointPayload {
  x: number;
  y: number;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isFiniteCoordinate(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    Math.abs(value) <= MAX_ABSOLUTE_COORDINATE
  );
}

export function isMouseButton(value: unknown): value is MouseButton {
  return value === 'left' || value === 'right' || value === 'middle';
}

export function isMouseToggleButton(value: unknown): value is MouseToggleButton {
  return value === 'left' || value === 'right';
}

export function isMouseAction(value: unknown): value is MouseAction {
  return value === 'down' || value === 'up';
}

export function isScrollDirection(value: unknown): value is ScrollDirection {
  return value === 'up' || value === 'down';
}

export function isZoomDirection(value: unknown): value is ZoomDirection {
  return value === 'in' || value === 'out';
}

export const ALLOWED_MEDIA_PERMISSIONS = new Set([
  'media',
  'camera',
  'microphone',
  'video-capture',
  'audio-capture',
  'clipboard-read',
  'clipboard-sanitized-write',
]);

export function isAllowedMediaPermission(permission: string): boolean {
  return ALLOWED_MEDIA_PERMISSIONS.has(permission);
}

export function parsePointPayload(value: unknown): PointPayload | null {
  if (!isRecord(value) || !isFiniteCoordinate(value.x) || !isFiniteCoordinate(value.y)) {
    return null;
  }

  return { x: value.x, y: value.y };
}

export function isAllowedLocalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const isLocalHost =
      url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1' ||
      url.hostname === '::1' ||
      url.hostname === '[::1]';

    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      isLocalHost &&
      url.username === '' &&
      url.password === ''
    );
  } catch {
    return false;
  }
}

export function isAllowedNavigation(targetUrl: string, allowedOrigin: string): boolean {
  try {
    return new URL(targetUrl).origin === allowedOrigin && isAllowedLocalUrl(targetUrl);
  } catch {
    return false;
  }
}

export function isTrustedSenderUrl(senderUrl: string, trustedOrigin: string): boolean {
  try {
    const url = new URL(senderUrl);
    return url.origin === trustedOrigin && url.pathname === '/' && isAllowedLocalUrl(senderUrl);
  } catch {
    return false;
  }
}

export function isTrustedOriginUrl(senderUrl: string, trustedOrigin: string): boolean {
  try {
    const url = new URL(senderUrl);
    return url.origin === trustedOrigin && isAllowedLocalUrl(senderUrl);
  } catch {
    return false;
  }
}

/**
 * Bounds the number of active renderer/channel entries as well as each channel's event rate.
 * This limiter is process-local; deployment-wide limits belong at the web-server boundary.
 */
export class IpcRateLimiter {
  private readonly entries = new Map<string, { count: number; windowStartedAt: number }>();

  public constructor(
    private readonly windowMs: number = IPC_RATE_LIMIT_WINDOW_MS,
    private readonly maxEntries: number = 256
  ) {}

  public consume(senderId: number, channel: string, limit: number, now: number = Date.now()): boolean {
    const key = `${senderId}:${channel}`;
    const current = this.entries.get(key);

    if (!current || now - current.windowStartedAt >= this.windowMs) {
      this.prune(now);
      this.entries.set(key, { count: 1, windowStartedAt: now });
      return true;
    }

    if (current.count >= limit) {
      return false;
    }

    current.count += 1;
    return true;
  }

  public clear(): void {
    this.entries.clear();
  }

  private prune(now: number): void {
    if (this.entries.size < this.maxEntries) return;

    for (const [key, entry] of this.entries.entries()) {
      if (now - entry.windowStartedAt >= this.windowMs) {
        this.entries.delete(key);
      }
    }
  }
}

export function isValidAuthToken(payload: unknown, expectedToken: string): boolean {
  if (!expectedToken || !isRecord(payload) || typeof payload.token !== 'string') {
    return false;
  }

  const tokenBuffer = Buffer.from(payload.token);
  const expectedBuffer = Buffer.from(expectedToken);

  if (tokenBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(tokenBuffer, expectedBuffer);
}

export const DEADMAN_TIMEOUT_MS = 3_000;

export class DeadmanTimer {
  private timer: NodeJS.Timeout | null = null;
  private readonly timeoutMs: number;
  private readonly onTimeout: () => void;

  public constructor(timeoutMs: number, onTimeout: () => void) {
    this.timeoutMs = timeoutMs;
    this.onTimeout = onTimeout;
  }

  public heartbeat(): void {
    this.cancel();
    this.timer = setTimeout(() => {
      this.timer = null;
      this.onTimeout();
    }, this.timeoutMs);
  }

  public cancel(): void {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = null;
  }

  public isRunning(): boolean {
    return this.timer !== null;
  }
}

export interface ButtonReleaseResult {
  buttons: MouseToggleButton[];
  reason: string;
}

export class HeldButtonTracker {
  private readonly heldButtons = new Set<MouseToggleButton>();

  public press(button: MouseToggleButton): boolean {
    if (this.heldButtons.has(button)) {
      return false;
    }
    this.heldButtons.add(button);
    return true;
  }

  public release(button: MouseToggleButton): boolean {
    return this.heldButtons.delete(button);
  }

  public has(button: MouseToggleButton): boolean {
    return this.heldButtons.has(button);
  }

  public size(): number {
    return this.heldButtons.size;
  }

  public getHeldButtons(): MouseToggleButton[] {
    return Array.from(this.heldButtons);
  }

  public releaseAll(reason: string = 'manual'): ButtonReleaseResult | null {
    if (this.heldButtons.size === 0) {
      return null;
    }
    const buttons = Array.from(this.heldButtons);
    this.heldButtons.clear();
    return { buttons, reason };
  }
}

export interface DesktopBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RobotScreenSize {
  width: number;
  height: number;
}

const FALLBACK_DESKTOP_BOUNDS: DesktopBounds = { x: 0, y: 0, width: 1920, height: 1080 };

function isPositiveSize(width: number, height: number): boolean {
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;
}

function isDesktopBounds(bounds: DesktopBounds): boolean {
  return Number.isFinite(bounds.x) && Number.isFinite(bounds.y) && isPositiveSize(bounds.width, bounds.height);
}

function unionDesktopBounds(displays: readonly DesktopBounds[]): DesktopBounds | null {
  const visible = displays.filter(isDesktopBounds);
  if (visible.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const display of visible) {
    minX = Math.min(minX, display.x);
    minY = Math.min(minY, display.y);
    maxX = Math.max(maxX, display.x + display.width);
    maxY = Math.max(maxY, display.y + display.height);
  }

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Pointer coordinates must use the same space as the OS mouse event.
 * On macOS, robotjs `getScreenSize()` returns physical pixels (`CGDisplayPixelsWide`)
 * while `moveMouse` posts `CGEvent`s in points. Electron display bounds are points,
 * including a non-zero virtual origin when another display sits left or above.
 * Other platforms keep robotjs pixels when that module is available.
 */
export function resolvePointerDesktop(
  platform: string,
  displays: readonly DesktopBounds[],
  robotScreen: RobotScreenSize | null
): DesktopBounds {
  const union = unionDesktopBounds(displays);
  if (platform === 'darwin') {
    return union ?? { ...FALLBACK_DESKTOP_BOUNDS };
  }

  if (robotScreen && isPositiveSize(robotScreen.width, robotScreen.height)) {
    return { x: 0, y: 0, width: robotScreen.width, height: robotScreen.height };
  }

  return union ?? { ...FALLBACK_DESKTOP_BOUNDS };
}
