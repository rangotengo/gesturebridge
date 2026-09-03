import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { connectDB } from '@/lib/db';
import { trainModel, TrainingError } from '@/ml/trainer';
import { enqueueTrainingJob } from '@/ml/trainingQueue';
import { requireAdmin } from '@/lib/adminAuth';
import { internalServerError, rateLimit, requireSameOrigin } from '@/lib/requestGuards';

// Must run in Node.js runtime (not Edge) — @tensorflow/tfjs-node is Node-only
export const runtime = 'nodejs';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const admin = requireAdmin(req);
  if (admin instanceof NextResponse) return admin;

  const originError = requireSameOrigin(req);
  if (originError) return originError;

  const rateLimitError = rateLimit(req, 'ml:train', 5, 10 * 60_000);
  if (rateLimitError) return rateLimitError;

  const sync = req.nextUrl.searchParams.get('sync') === 'true';

  try {
    await connectDB();
    if (sync) {
      const result = await trainModel();
      return NextResponse.json(result);
    }

    const job = await enqueueTrainingJob();
    return NextResponse.json(job, { status: 202 });
  } catch (err) {
    if (err instanceof TrainingError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return internalServerError('ml:train', err);
  }
}
