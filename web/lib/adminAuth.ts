import bcrypt from 'bcrypt';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import User, { type IUser } from '@/models/User';

export const ADMIN_SESSION_COOKIE = 'gesturebridge_admin_session';

const ADMIN_SESSION_TTL_SECONDS = 8 * 60 * 60;
const JWT_ISSUER = 'gesturebridge';
const JWT_AUDIENCE = 'gesturebridge-admin';
const BCRYPT_ROUNDS = 12;
const MIN_PASSWORD_LENGTH = 8;

export interface AdminSession {
  email: string;
  role: 'admin';
}

interface AdminJwtPayload extends JwtPayload {
  email: string;
  role: 'admin';
}

function getJwtSecret(): string | null {
  const secret = process.env.JWT_SECRET;
  return secret && secret.trim().length > 0 ? secret : null;
}

export function getAdminConfigError(): string | null {
  const secret = getJwtSecret();
  if (!secret) return 'JWT_SECRET is not configured.';
  if (process.env.NODE_ENV === 'production' && secret.length < 32) {
    return 'JWT_SECRET must contain at least 32 characters in production.';
  }
  return null;
}

function isAdminJwtPayload(payload: string | JwtPayload): payload is AdminJwtPayload {
  return (
    typeof payload !== 'string' &&
    typeof payload.email === 'string' &&
    payload.role === 'admin'
  );
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function getStoredPasswordHash(user: IUser): string | null {
  if (user.passwordHash && user.passwordHash.length > 0) return user.passwordHash;
  if (user.password && user.password.length > 0) return user.password;
  return null;
}

/** Migrate legacy User doc password format (without role escalation). */
async function migrateLegacyPasswordHash(user: IUser): Promise<void> {
  if (!user.passwordHash && user.password) {
    user.passwordHash = user.password;
    user.set('password', undefined);
    await user.save();
  }
}

/**
 * Any document in `users` means bootstrap is done.
 */
export async function hasAdminUser(): Promise<boolean> {
  await connectDB();
  const count = await User.countDocuments();
  return count > 0;
}

const DUMMY_HASH = '$2b$12$e8kPqZ9XnK1yKj9kQ4Z1Re7GfF8yR8mQ5xL0p0jO9sQ8xM6yN3aO.';
const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

export async function createBootstrapAdmin(
  email: string,
  password: string
): Promise<AdminSession> {
  const configError = getAdminConfigError();
  if (configError) throw new Error(configError);

  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || normalizedEmail.length > 254 || !EMAIL_REGEX.test(normalizedEmail)) {
    throw new Error('A valid email address is required.');
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  if (Buffer.byteLength(password, 'utf8') > 72) {
    throw new Error('Password cannot exceed 72 UTF-8 bytes.');
  }

  await connectDB();

  const existingCount = await User.countDocuments();
  if (existingCount > 0) {
    throw new Error('Admin signup is closed. An admin already exists — use login instead.');
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  try {
    const user = await User.create({
      email: normalizedEmail,
      passwordHash,
      role: 'admin',
      bootstrapSlot: 1,
    });

    return { email: user.email, role: 'admin' };
  } catch (err: unknown) {
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code?: number }).code === 11000
    ) {
      throw new Error('Admin signup is closed. An admin already exists — use login instead.');
    }
    throw err;
  }
}

export async function verifyAdminCredentials(
  email: string,
  password: string
): Promise<AdminSession | null> {
  const configError = getAdminConfigError();
  if (configError) {
    throw new Error(configError);
  }

  // Reject passwords longer than bcrypt max length without timing leaks
  if (Buffer.byteLength(password, 'utf8') > 72) {
    return null;
  }

  await connectDB();

  const user = await User.findOne({
    email: normalizeEmail(email),
  }).exec();

  const storedHash = user && user.role === 'admin' ? getStoredPasswordHash(user) : null;
  const hashToCompare = storedHash ?? DUMMY_HASH;
  const isValidPassword = await bcrypt.compare(password, hashToCompare);

  if (!user || user.role !== 'admin' || !storedHash || !isValidPassword) {
    return null;
  }

  await migrateLegacyPasswordHash(user);

  return { email: user.email, role: 'admin' };
}

export function createAdminSessionToken(session: AdminSession): string {
  const secret = getJwtSecret();
  if (!secret) {
    throw new Error('JWT_SECRET is not configured.');
  }

  return jwt.sign(session, secret, {
    algorithm: 'HS256',
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    expiresIn: ADMIN_SESSION_TTL_SECONDS,
    subject: 'gesturebridge-admin',
  });
}

export function getAdminSessionFromRequest(req: NextRequest): AdminSession | null {
  const token = req.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  const secret = getJwtSecret();
  if (!token || !secret) return null;

  try {
    const payload = jwt.verify(token, secret, {
      algorithms: ['HS256'],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      subject: 'gesturebridge-admin',
    });
    if (!isAdminJwtPayload(payload)) return null;
    return { email: payload.email.toLowerCase(), role: 'admin' };
  } catch {
    return null;
  }
}

export function requireAdmin(req: NextRequest): AdminSession | NextResponse {
  const configError = getAdminConfigError();
  if (configError) {
    console.error(`[admin-auth] ${configError}`);
    return NextResponse.json({ error: 'Admin authentication is unavailable.' }, { status: 503 });
  }

  const session = getAdminSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: 'Admin authentication required.' }, { status: 401 });
  }

  return session;
}

export function setAdminSessionCookie(response: NextResponse, token: string): void {
  response.cookies.set({
    name: ADMIN_SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: ADMIN_SESSION_TTL_SECONDS,
  });
}

export function clearAdminSessionCookie(response: NextResponse): void {
  response.cookies.set({
    name: ADMIN_SESSION_COOKIE,
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });
}
