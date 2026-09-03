import { NextResponse } from 'next/server';
import { getConfigurationHealth } from '@/lib/config';
import { connectDB, isDatabaseReady } from '@/lib/db';
import { logWarn } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Readiness probe for a server that is configured and can use MongoDB. */
export async function GET(): Promise<NextResponse> {
  const configuration = getConfigurationHealth();
  if (!configuration.ok) {
    return NextResponse.json(
      { status: 'not_ready', checks: { configuration: 'unhealthy', database: 'unknown' } },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  try {
    await connectDB();
    if (!isDatabaseReady()) throw new Error('MongoDB connection is not ready');
    return NextResponse.json(
      { status: 'ready', checks: { configuration: 'healthy', database: 'healthy' } },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch {
    logWarn('health.readiness_failed', { databaseReady: isDatabaseReady() });
    return NextResponse.json(
      { status: 'not_ready', checks: { configuration: 'healthy', database: 'unhealthy' } },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
