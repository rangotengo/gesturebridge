import { NextResponse } from 'next/server';
import { hasAdminUser, getAdminConfigError } from '@/lib/adminAuth';
import { internalServerError } from '@/lib/requestGuards';

export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  const configError = getAdminConfigError();
  if (configError) {
    return NextResponse.json(
      { error: 'Admin authentication is unavailable.', needsSetup: false },
      { status: 503 }
    );
  }

  try {
    const needsSetup = !(await hasAdminUser());
    return NextResponse.json({ needsSetup });
  } catch (err) {
    return internalServerError('admin:setup-status', err);
  }
}
