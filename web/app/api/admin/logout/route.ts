import { NextRequest, NextResponse } from 'next/server';
import { clearAdminSessionCookie } from '@/lib/adminAuth';
import { requireSameOrigin } from '@/lib/requestGuards';

export const runtime = 'nodejs';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const originError = requireSameOrigin(req);
  if (originError) return originError;

  const response = NextResponse.json({ success: true });
  clearAdminSessionCookie(response);
  return response;
}
