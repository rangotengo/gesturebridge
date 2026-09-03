import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import GestureLog from '@/models/GestureLog';
import { requireAdmin } from '@/lib/adminAuth';
import { internalServerError, isRecord, rateLimit, readJsonBody, requireSameOrigin } from '@/lib/requestGuards';
import { isControlMode } from '@/features/control/modes';

const LOG_BODY_LIMIT_BYTES = 16 * 1024;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const admin = requireAdmin(req);
  if (admin instanceof NextResponse) return admin;

  try {
    await connectDB();
    const logs = await GestureLog.find({})
      .sort({ timestamp: -1 })
      .limit(100)
      .lean();
    return NextResponse.json(logs);
  } catch (err) {
    return internalServerError('logs:get', err);
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const admin = requireAdmin(req);
  if (admin instanceof NextResponse) return admin;

  const originError = requireSameOrigin(req);
  if (originError) return originError;

  const rateLimitError = rateLimit(req, 'logs:write', 60, 60_000);
  if (rateLimitError) return rateLimitError;

  const bodyResult = await readJsonBody(req, LOG_BODY_LIMIT_BYTES);
  if (!bodyResult.ok) return bodyResult.response;

  try {
    await connectDB();
    if (!isRecord(bodyResult.data)) {
      return NextResponse.json({ error: 'Request body must be an object.' }, { status: 400 });
    }
    const body = bodyResult.data;

    const { gesture, confidence, platform, mode } = body;

    if (typeof gesture !== 'string' || !gesture.trim() || gesture.length > 100) {
      return NextResponse.json({ error: 'gesture is required' }, { status: 400 });
    }
    if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      return NextResponse.json({ error: 'confidence must be a finite number between 0 and 1' }, { status: 400 });
    }
    if (platform !== 'browser' && platform !== 'desktop') {
      return NextResponse.json({ error: 'platform must be browser or desktop' }, { status: 400 });
    }
    if (!isControlMode(mode)) {
      return NextResponse.json({ error: 'mode must be recognition, mouse-control, or mirror' }, { status: 400 });
    }

    const log = new GestureLog({ gesture: gesture.trim(), confidence, platform, mode });
    await log.save();
    return NextResponse.json(log, { status: 201 });
  } catch (err) {
    return internalServerError('logs:create', err);
  }
}
