import { describe, expect, it } from 'vitest';

import {
  SOCKET_EVENT_WINDOW_MS,
  SOCKET_MAX_EVENTS_PER_WINDOW,
  configuredSocketOrigins,
  consumeSocketEventBudget,
  isAllowedSocketOrigin,
  isValidGestureTelemetryPayload,
  isValidModeTogglePayload,
} from '../lib/socketSafety';

describe('socket origin policy', () => {
  it('defaults to loopback origins for configured port', () => {
    const origins = configuredSocketOrigins({ PORT: '4310' });

    expect(origins).toEqual(new Set(['http://localhost:4310', 'http://127.0.0.1:4310']));
    expect(isAllowedSocketOrigin('http://localhost:4310', origins)).toBe(true);
    expect(isAllowedSocketOrigin('https://evil.example', origins)).toBe(false);
    expect(isAllowedSocketOrigin(undefined, origins)).toBe(false);
  });

  it('normalizes explicit origins and rejects malformed configuration', () => {
    const origins = configuredSocketOrigins({
      SOCKET_ALLOWED_ORIGINS: ' https://trusted.example/app , http://localhost:3000 ',
    });
    expect(origins).toEqual(new Set(['https://trusted.example', 'http://localhost:3000']));
    expect(() => configuredSocketOrigins({ SOCKET_ALLOWED_ORIGINS: 'not-a-url' })).toThrow(
      'Invalid SOCKET_ALLOWED_ORIGINS entry: not-a-url'
    );
  });
});

describe('socket payload validation', () => {
  it('accepts bounded, finite gesture telemetry only', () => {
    expect(isValidGestureTelemetryPayload({ gesture: 'Pointing' })).toBe(true);
    expect(isValidGestureTelemetryPayload({ gesture: 'Pointing', hand: 'Left', confidence: 0.75 })).toBe(true);

    for (const payload of [
      null,
      [],
      { gesture: '' },
      { gesture: 'x'.repeat(65) },
      { gesture: 'Pointing', hand: '' },
      { gesture: 'Pointing', hand: 'x'.repeat(33) },
      { gesture: 'Pointing', confidence: Number.NaN },
      { gesture: 'Pointing', confidence: -0.01 },
      { gesture: 'Pointing', confidence: 1.01 },
    ]) {
      expect(isValidGestureTelemetryPayload(payload)).toBe(false);
    }
  });

  it('accepts mode changes only when active is boolean', () => {
    expect(isValidModeTogglePayload({ active: true })).toBe(true);
    expect(isValidModeTogglePayload({ active: 'true' })).toBe(false);
    expect(isValidModeTogglePayload([])).toBe(false);
  });
});

describe('socket rate budget', () => {
  it('limits each event independently and resets on window boundary', () => {
    const windows = new Map();
    const start = 1_000;

    for (let index = 0; index < SOCKET_MAX_EVENTS_PER_WINDOW; index += 1) {
      expect(consumeSocketEventBudget(windows, 'gesture', start)).toBe(true);
    }
    expect(consumeSocketEventBudget(windows, 'gesture', start)).toBe(false);
    expect(consumeSocketEventBudget(windows, 'mode:toggle', start)).toBe(true);
    expect(consumeSocketEventBudget(windows, 'gesture', start + SOCKET_EVENT_WINDOW_MS)).toBe(true);
  });
});
