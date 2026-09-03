import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import Gesture from '@/models/Gesture';
import { requireAdmin } from '@/lib/adminAuth';
import { ensureDefaultGestures, findOrCreateGesture, getGestureCanonicalName } from '@/lib/gestures';
import { internalServerError, isRecord, rateLimit, readJsonBody, requireSameOrigin } from '@/lib/requestGuards';

const MAX_GESTURE_BATCH_SIZE = 50;
const GESTURE_BODY_LIMIT_BYTES = 32 * 1024;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const admin = requireAdmin(req);
  if (admin instanceof NextResponse) return admin;

  const originError = requireSameOrigin(req);
  if (originError) return originError;

  const rateLimitError = rateLimit(req, 'ml:gestures:batch', 10, 60_000);
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
    const { names } = body;

    if (!Array.isArray(names)) {
      return NextResponse.json({ error: 'Names array is required' }, { status: 400 });
    }
    if (names.length > MAX_GESTURE_BATCH_SIZE) {
      return NextResponse.json({ error: `Gesture batch exceeds the ${MAX_GESTURE_BATCH_SIZE} item limit.` }, { status: 413 });
    }

    const validNames = names.filter(
      (name): name is string => typeof name === 'string' && name.trim().length > 0 && name.trim().length <= 64
    );
    if (validNames.length !== names.length) {
      return NextResponse.json({ error: 'Every gesture name must contain 1 to 64 characters.' }, { status: 400 });
    }
    const uniqueNames = [...new Map(validNames.map((name) => [getGestureCanonicalName(name), name])).values()];
    await Promise.all(uniqueNames.map((name) => findOrCreateGesture(name)));

    const allGestures = await Gesture.find({}).sort({ labelIndex: 1 }).lean();
    return NextResponse.json(allGestures);
  } catch (err) {
    return internalServerError('ml:gestures:batch', err);
  }
}
