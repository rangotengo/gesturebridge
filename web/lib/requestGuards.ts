import { NextRequest, NextResponse } from 'next/server';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();
const MAX_RATE_LIMIT_KEYS = 10_000;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getClientKey(req: NextRequest, scope: string): string {
  const trustProxy = process.env.TRUST_PROXY === 'true';
  const forwardedFor = trustProxy
    ? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    : null;
  const realIp = trustProxy ? req.headers.get('x-real-ip')?.trim() : null;
  return `${scope}:${forwardedFor ?? realIp ?? 'unknown'}`;
}

export function requireSameOrigin(req: NextRequest): NextResponse | null {
  const origin = req.headers.get('origin');
  const fetchSite = req.headers.get('sec-fetch-site');
  if (!origin) {
    if (fetchSite === 'cross-site') {
      return NextResponse.json({ error: 'Cross-origin mutation rejected.' }, { status: 403 });
    }
    return null;
  }

  let requestOrigin: string;
  try {
    requestOrigin = new URL(req.url).origin;
  } catch {
    return NextResponse.json({ error: 'Invalid request URL.' }, { status: 400 });
  }
  if (origin !== requestOrigin) {
    return NextResponse.json({ error: 'Cross-origin mutation rejected.' }, { status: 403 });
  }

  return null;
}

export function rateLimit(
  req: NextRequest,
  scope: string,
  limit: number,
  windowMs: number
): NextResponse | null {
  const key = getClientKey(req, scope);
  const now = Date.now();

  if (rateLimitStore.size >= MAX_RATE_LIMIT_KEYS) {
    for (const [storedKey, entry] of rateLimitStore) {
      if (entry.resetAt <= now) rateLimitStore.delete(storedKey);
    }
    if (rateLimitStore.size >= MAX_RATE_LIMIT_KEYS) {
      const oldestKey = rateLimitStore.keys().next().value as string | undefined;
      if (oldestKey) rateLimitStore.delete(oldestKey);
    }
  }
  const current = rateLimitStore.get(key);

  if (!current || current.resetAt <= now) {
    rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
    return null;
  }

  if (current.count >= limit) {
    const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
    return NextResponse.json(
      { error: 'Too many requests. Please try again later.' },
      {
        status: 429,
        headers: { 'Retry-After': String(retryAfter) },
      }
    );
  }

  current.count += 1;
  rateLimitStore.set(key, current);
  return null;
}

export async function readJsonBody(req: NextRequest, maxBytes: number): Promise<
  | { ok: true; data: unknown }
  | { ok: false; response: NextResponse }
> {
  const contentLength = req.headers.get('content-length');
  const parsedContentLength = contentLength === null ? null : Number(contentLength);
  if (
    parsedContentLength !== null &&
    (!Number.isFinite(parsedContentLength) || parsedContentLength < 0)
  ) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Invalid Content-Length header.' }, { status: 400 }),
    };
  }
  if (parsedContentLength !== null && parsedContentLength > maxBytes) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Request body is too large.' }, { status: 413 }),
    };
  }

  let text: string;
  try {
    text = await req.text();
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Unable to read request body.' }, { status: 400 }),
    };
  }
  if (new TextEncoder().encode(text).length > maxBytes) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Request body is too large.' }, { status: 413 }),
    };
  }

  try {
    return { ok: true, data: JSON.parse(text) as unknown };
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Invalid JSON request body.' }, { status: 400 }),
    };
  }
}

export function internalServerError(context: string, error: unknown): NextResponse {
  console.error(`[${context}]`, error);
  return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
}
