import { NextRequest, NextResponse } from 'next/server';
import {
  createAdminSessionToken,
  setAdminSessionCookie,
  verifyAdminCredentials,
} from '@/lib/adminAuth';
import { rateLimit, readJsonBody, requireSameOrigin } from '@/lib/requestGuards';

export const runtime = 'nodejs';

const LOGIN_BODY_LIMIT_BYTES = 8 * 1024;

function isLoginBody(value: unknown): value is { email: string; password: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'email' in value &&
    'password' in value &&
    typeof (value as Record<string, unknown>).email === 'string' &&
    typeof (value as Record<string, unknown>).password === 'string'
  );
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const originError = requireSameOrigin(req);
  if (originError) return originError;

  const rateLimitError = rateLimit(req, 'admin:login', 5, 60_000);
  if (rateLimitError) return rateLimitError;

  const bodyResult = await readJsonBody(req, LOGIN_BODY_LIMIT_BYTES);
  if (!bodyResult.ok) return bodyResult.response;

  if (!isLoginBody(bodyResult.data)) {
    return NextResponse.json({ error: 'Email and password are required.' }, { status: 400 });
  }
  if (bodyResult.data.email.length > 254 || bodyResult.data.password.length > 1024) {
    return NextResponse.json({ error: 'Invalid admin credentials.' }, { status: 400 });
  }

  try {
    const admin = await verifyAdminCredentials(bodyResult.data.email, bodyResult.data.password);
    if (!admin) {
      return NextResponse.json({ error: 'Invalid admin credentials.' }, { status: 401 });
    }

    const token = createAdminSessionToken(admin);
    const response = NextResponse.json({ admin });
    setAdminSessionCookie(response, token);
    return response;
  } catch (err) {
    console.error('[admin-login]', err);
    return NextResponse.json({ error: 'Admin login is unavailable.' }, { status: 503 });
  }
}
