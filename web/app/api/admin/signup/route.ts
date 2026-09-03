import { NextRequest, NextResponse } from 'next/server';
import {
  createAdminSessionToken,
  createBootstrapAdmin,
  setAdminSessionCookie,
} from '@/lib/adminAuth';
import { rateLimit, readJsonBody, requireSameOrigin, internalServerError } from '@/lib/requestGuards';

export const runtime = 'nodejs';

const SIGNUP_BODY_LIMIT_BYTES = 8 * 1024;

function isSignupBody(value: unknown): value is { email: string; password: string } {
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

  const rateLimitError = rateLimit(req, 'admin:signup', 5, 60_000);
  if (rateLimitError) return rateLimitError;

  const bodyResult = await readJsonBody(req, SIGNUP_BODY_LIMIT_BYTES);
  if (!bodyResult.ok) return bodyResult.response;

  if (!isSignupBody(bodyResult.data)) {
    return NextResponse.json({ error: 'Email and password are required.' }, { status: 400 });
  }
  if (bodyResult.data.email.length > 254 || bodyResult.data.password.length > 1024) {
    return NextResponse.json({ error: 'Invalid signup details.' }, { status: 400 });
  }

  try {
    const admin = await createBootstrapAdmin(bodyResult.data.email, bodyResult.data.password);
    const token = createAdminSessionToken(admin);
    const response = NextResponse.json({ admin }, { status: 201 });
    setAdminSessionCookie(response, token);
    return response;
  } catch (err) {
    if (err instanceof Error) {
      if (err.message.includes('already exists') || err.message.includes('closed')) {
        return NextResponse.json({ error: err.message }, { status: 409 });
      }
      if (
        err.message.includes('Password must') ||
        err.message.includes('valid email') ||
        err.message.includes('too long') ||
        err.message.includes('cannot exceed 72') ||
        err.message.includes('72 UTF-8 bytes')
      ) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      if (err.message.includes('JWT_SECRET')) {
        return NextResponse.json({ error: 'Admin authentication is unavailable.' }, { status: 503 });
      }
    }
    return internalServerError('admin-signup', err);
  }
}
