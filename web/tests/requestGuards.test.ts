import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

import { isRecord, readJsonBody, requireSameOrigin } from '../lib/requestGuards';

describe('request guard primitives', () => {
  it('narrows only non-null, non-array objects', () => {
    expect(isRecord({ value: 1 })).toBe(true);
    expect(isRecord(Object.create(null))).toBe(true);
    expect(isRecord(null)).toBe(false);
    expect(isRecord([])).toBe(false);
    expect(isRecord('object')).toBe(false);
  });

  it('accepts same-origin mutations and rejects cross-origin mutations', async () => {
    const sameOrigin = new NextRequest('http://localhost:3000/api/ml/collect', {
      headers: { origin: 'http://localhost:3000' },
    });
    const crossOrigin = new NextRequest('http://localhost:3000/api/ml/collect', {
      headers: { origin: 'https://evil.example' },
    });

    expect(requireSameOrigin(sameOrigin)).toBeNull();
    const rejection = requireSameOrigin(crossOrigin);
    expect(rejection?.status).toBe(403);
    await expect(rejection?.json()).resolves.toEqual({ error: 'Cross-origin mutation rejected.' });
  });

  it('rejects explicit cross-site requests even without an Origin header', () => {
    const request = new NextRequest('http://localhost:3000/api/ml/collect', {
      headers: { 'sec-fetch-site': 'cross-site' },
    });
    expect(requireSameOrigin(request)?.status).toBe(403);
  });
});

describe('readJsonBody', () => {
  it('parses JSON below the byte limit', async () => {
    const request = new NextRequest('http://localhost:3000/api/test', {
      method: 'POST',
      body: JSON.stringify({ ok: true }),
    });
    await expect(readJsonBody(request, 100)).resolves.toEqual({ ok: true, data: { ok: true } });
  });

  it('rejects malformed JSON', async () => {
    const request = new NextRequest('http://localhost:3000/api/test', {
      method: 'POST',
      body: '{broken',
    });
    const result = await readJsonBody(request, 100);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(400);
  });

  it('measures actual UTF-8 bytes when Content-Length is absent', async () => {
    const request = new NextRequest('http://localhost:3000/api/test', {
      method: 'POST',
      body: '"😀"',
    });
    const result = await readJsonBody(request, 5);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(413);
  });

  it('rejects invalid and oversized Content-Length before reading', async () => {
    for (const contentLength of ['invalid', '-1', '101']) {
      const request = new NextRequest('http://localhost:3000/api/test', {
        method: 'POST',
        headers: { 'content-length': contentLength },
        body: '{}',
      });
      const result = await readJsonBody(request, 100);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.response.status).toBe(contentLength === '101' ? 413 : 400);
    }
  });
});
