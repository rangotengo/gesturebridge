export const SOCKET_EVENT_WINDOW_MS = 1_000;
export const SOCKET_MAX_EVENTS_PER_WINDOW = 120;
export const SOCKET_MAX_GESTURE_LENGTH = 64;
export const SOCKET_MAX_HAND_LENGTH = 32;

export interface EventWindow {
  count: number;
  startedAt: number;
}

export interface GestureTelemetryPayload {
  hand?: string;
  gesture: string;
  confidence?: number;
}

type Environment = Readonly<Record<string, string | undefined>>;

export function configuredSocketOrigins(environment: Environment = process.env): Set<string> {
  const port = environment.PORT ?? '3000';
  const configured = environment.SOCKET_ALLOWED_ORIGINS;
  const values = configured?.split(',') ?? [
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
  ];

  return new Set(
    values
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => {
        try {
          return new URL(value).origin;
        } catch {
          throw new Error(`Invalid SOCKET_ALLOWED_ORIGINS entry: ${value}`);
        }
      })
  );
}

export function isAllowedSocketOrigin(origin: unknown, allowedOrigins: ReadonlySet<string>): boolean {
  return typeof origin === 'string' && allowedOrigins.has(origin);
}

export function consumeSocketEventBudget(
  windows: Map<string, EventWindow>,
  event: string,
  now = Date.now()
): boolean {
  const current = windows.get(event);

  if (!current || now - current.startedAt >= SOCKET_EVENT_WINDOW_MS) {
    windows.set(event, { count: 1, startedAt: now });
    return true;
  }

  if (current.count >= SOCKET_MAX_EVENTS_PER_WINDOW) return false;

  current.count += 1;
  return true;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isValidGestureTelemetryPayload(value: unknown): value is GestureTelemetryPayload {
  if (!isRecord(value)) return false;
  if (
    typeof value.gesture !== 'string' ||
    value.gesture.length === 0 ||
    value.gesture.length > SOCKET_MAX_GESTURE_LENGTH
  ) {
    return false;
  }
  if (
    value.hand !== undefined &&
    (typeof value.hand !== 'string' || value.hand.length === 0 || value.hand.length > SOCKET_MAX_HAND_LENGTH)
  ) {
    return false;
  }
  return (
    value.confidence === undefined ||
    (typeof value.confidence === 'number' &&
      Number.isFinite(value.confidence) &&
      value.confidence >= 0 &&
      value.confidence <= 1)
  );
}

export function isValidModeTogglePayload(value: unknown): value is { active: boolean } {
  return isRecord(value) && typeof value.active === 'boolean';
}
