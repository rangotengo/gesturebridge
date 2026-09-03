import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchRecentLogs } from '../features/logs/queries';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('fetchRecentLogs', () => {
  it('returns validated log arrays', async () => {
    const logs = [{
      _id: 'log-1',
      gesture: 'Pointing',
      confidence: 0.9,
      platform: 'desktop',
      mode: 'mouse-control',
      timestamp: '2026-01-01T00:00:00.000Z',
    }];
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(logs), { status: 200 }));

    await expect(fetchRecentLogs()).resolves.toEqual(logs);
  });

  it('surfaces a server error without treating it as log data', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'Admin authentication required.' }), { status: 401 })
    );

    await expect(fetchRecentLogs()).rejects.toThrow('Admin authentication required.');
  });

  it('rejects malformed successful responses', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ logs: [] }), { status: 200 }));

    await expect(fetchRecentLogs()).rejects.toThrow('Invalid gesture history response.');
  });
});
