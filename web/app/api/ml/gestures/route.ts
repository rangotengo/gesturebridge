import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import Gesture from '@/models/Gesture';
import { requireAdmin } from '@/lib/adminAuth';
import { ensureDefaultGestures, findOrCreateGesture } from '@/lib/gestures';
import { internalServerError, isRecord, rateLimit, readJsonBody, requireSameOrigin } from '@/lib/requestGuards';

const GESTURE_BODY_LIMIT_BYTES = 16 * 1024;

export async function GET(): Promise<NextResponse> {
  try {
    await connectDB();
    const gestures = await Gesture.find({}).sort({ labelIndex: 1 }).lean();
    return NextResponse.json(gestures);
  } catch (err) {
    return internalServerError('ml:gestures:get', err);
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const admin = requireAdmin(req);
  if (admin instanceof NextResponse) return admin;

  const originError = requireSameOrigin(req);
  if (originError) return originError;

  const rateLimitError = rateLimit(req, 'ml:gestures:create', 20, 60_000);
  if (rateLimitError) return rateLimitError;

  const bodyResult = await readJsonBody(req, GESTURE_BODY_LIMIT_BYTES);
  if (!bodyResult.ok) return bodyResult.response;

  try {
    await connectDB();
    await ensureDefaultGestures();

    if (!isRecord(bodyResult.data)) {
      return NextResponse.json({ error: 'Request body must be an object.' }, { status: 400 });
    }
    const body = bodyResult.data;
    const { name } = body;

    if (typeof name !== 'string' || !name.trim() || name.trim().length > 64) {
      return NextResponse.json({ error: 'Gesture name is required' }, { status: 400 });
    }

    const result = await findOrCreateGesture(name);
    return NextResponse.json(result.gesture, { status: result.created ? 201 : 200 });
  } catch (err) {
    return internalServerError('ml:gestures:create', err);
  }
}
