import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import Sample from '@/models/Sample';
import { requireAdmin } from '@/lib/adminAuth';
import { getKnownGestureLabelSet } from '@/lib/gestures';
import { internalServerError, isRecord, rateLimit, readJsonBody, requireSameOrigin } from '@/lib/requestGuards';
import { validateSampleBatch } from '@/lib/sampleValidation';

const MAX_SAMPLE_BATCH_SIZE = 1000;
const SAMPLE_BODY_LIMIT_BYTES = 1024 * 1024;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const admin = requireAdmin(req);
  if (admin instanceof NextResponse) return admin;

  const originError = requireSameOrigin(req);
  if (originError) return originError;

  const rateLimitError = rateLimit(req, 'ml:collect', 20, 60_000);
  if (rateLimitError) return rateLimitError;

  const bodyResult = await readJsonBody(req, SAMPLE_BODY_LIMIT_BYTES);
  if (!bodyResult.ok) return bodyResult.response;

  try {
    await connectDB();
    if (!isRecord(bodyResult.data)) {
      return NextResponse.json({ error: 'Request body must be an object.' }, { status: 400 });
    }
    const body = bodyResult.data;
    const { samples } = body;
    const knownLabels = await getKnownGestureLabelSet();
    const validation = validateSampleBatch(samples, knownLabels, MAX_SAMPLE_BATCH_SIZE);

    const rejectedIndices = validation.rejected.map((r) => r.index);

    if (validation.accepted.length === 0) {
      return NextResponse.json({
        error: 'No valid samples found.',
        acceptedCount: 0,
        rejectedCount: validation.rejected.length,
        rejected: validation.rejected.slice(0, 50),
        rejectedIndices,
      }, { status: 400 });
    }

    await Sample.insertMany(validation.accepted.map((sample) => ({ ...sample, source: 'collection' })));
    const count = await Sample.countDocuments();

    return NextResponse.json({
      success: true,
      message: `Successfully saved ${validation.accepted.length} samples. Total: ${count}`,
      acceptedCount: validation.accepted.length,
      rejectedCount: validation.rejected.length,
      rejected: validation.rejected.slice(0, 50),
      rejectedIndices,
    });
  } catch (err) {
    return internalServerError('ml:collect', err);
  }
}
