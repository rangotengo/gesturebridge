export const IPC_RATE_LIMIT_WINDOW_MS = 1_000;
export const MAX_ABSOLUTE_COORDINATE = 100_000;

export type MouseButton = 'left' | 'right' | 'middle';
export type MouseToggleButton = 'left' | 'right';
export type MouseAction = 'down' | 'up';
export type ScrollDirection = 'up' | 'down';
export type ZoomDirection = 'in' | 'out';

export interface PointPayload {
  x: number;
  y: number;
}

export interface IpcRateLimitEntry {
  count: number;
  windowStartedAt: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
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

/**
 * Bounds the number of active renderer/channel entries as well as each channel's event rate.
 * This limiter is process-local; deployment-wide limits belong at the web-server boundary.
 */
export class IpcRateLimiter {
  private readonly entries = new Map<string, IpcRateLimitEntry>();

  public constructor(
    private readonly windowMs = IPC_RATE_LIMIT_WINDOW_MS,
    private readonly maxEntries = 1_000
  ) {}

  public consume(senderId: number, channel: string, limit: number, now = Date.now()): boolean {
    const key = `${senderId}:${channel}`;
    const current = this.entries.get(key);

    if (!current || now - current.windowStartedAt >= this.windowMs) {
      this.prune(now);
      this.entries.set(key, { count: 1, windowStartedAt: now });
      return true;
    }

    if (current.count >= limit) return false;
    current.count += 1;
    return true;
  }

  public clear(): void {
    this.entries.clear();
  }

  private prune(now: number): void {
    for (const [key, entry] of this.entries) {
      if (now - entry.windowStartedAt >= this.windowMs) this.entries.delete(key);
    }

    if (this.entries.size < this.maxEntries) return;
    const oldestKeys = [...this.entries.entries()]
      .sort(([, left], [, right]) => left.windowStartedAt - right.windowStartedAt)
      .slice(0, this.entries.size - this.maxEntries + 1)
      .map(([key]) => key);
    for (const key of oldestKeys) this.entries.delete(key);
  }
}

export function isValidAuthToken(payload: unknown, expectedToken: string): boolean {
  if (!expectedToken || typeof expectedToken !== 'string') return false;
  if (!isRecord(payload) || typeof payload.token !== 'string') return false;
  if (payload.token.length !== expectedToken.length) return false;
  let match = 0;
  for (let i = 0; i < expectedToken.length; i += 1) {
    match |= payload.token.charCodeAt(i) ^ expectedToken.charCodeAt(i);
  }
  return match === 0;
}

export const DEADMAN_TIMEOUT_MS = 1_000;

export class DeadmanTimer {
  private timer: NodeJS.Timeout | null = null;

  public constructor(
    private readonly timeoutMs: number,
    private readonly onTimeout: () => void
  ) {}

  public heartbeat(): void {
    this.cancel();
    this.timer = setTimeout(() => {
      this.timer = null;
      this.onTimeout();
    }, this.timeoutMs);
    if (typeof this.timer?.unref === 'function') {
      this.timer.unref();
    }
  }

  public cancel(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  public isActive(): boolean {
    return this.timer !== null;
  }
}

export class HeldButtonTracker {
  private heldButtons = new Set<MouseToggleButton>();

  public press(button: MouseToggleButton): void {
    this.heldButtons.add(button);
  }

  public release(button: MouseToggleButton): boolean {
    return this.heldButtons.delete(button);
  }

  public has(button: MouseToggleButton): boolean {
    return this.heldButtons.has(button);
  }

  public releaseAll(reason: string = 'manual'): { buttons: MouseToggleButton[]; reason: string } | null {
    if (this.heldButtons.size === 0) return null;
    const buttons = Array.from(this.heldButtons);
    this.heldButtons.clear();
    return { buttons, reason };
  }

  public size(): number {
    return this.heldButtons.size;
  }
}
