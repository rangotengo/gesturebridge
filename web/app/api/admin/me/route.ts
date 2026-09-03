import { NextRequest, NextResponse } from 'next/server';
import { getAdminSessionFromRequest } from '@/lib/adminAuth';

export const runtime = 'nodejs';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const admin = getAdminSessionFromRequest(req);
  if (!admin) {
    return NextResponse.json({ error: 'Admin authentication required.' }, { status: 401 });
  }

  return NextResponse.json({ admin });
}
