import { NextResponse } from 'next/server';
import mongoose from 'mongoose';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Process liveness probe: returns 200 if the web process is running and responding. */
export async function GET(): Promise<NextResponse> {
  const dbState = mongoose.connection.readyState;
  const isDbReady = dbState === 1;

  return NextResponse.json(
    {
      status: 'ok',
      uptimeSeconds: Math.floor(process.uptime()),
      database: {
        state: dbState === 1 ? 'connected' : dbState === 2 ? 'connecting' : 'disconnected',
        ready: isDbReady,
      },
    },
    {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    }
  );
}
