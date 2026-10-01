import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { connectDB } from '@/lib/db';
import { requireAdmin } from '@/lib/adminAuth';
import EvaluationRun from '@/models/EvaluationRun';
import Sample from '@/models/Sample';
import Gesture from '@/models/Gesture';
import { internalServerError, rateLimit } from '@/lib/requestGuards';

export const runtime = 'nodejs';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const rateLimitError = rateLimit(req, 'ml:evaluation', 60, 60_000);
  if (rateLimitError) return rateLimitError;

  const admin = requireAdmin(req);
  if (admin instanceof NextResponse) return admin;

  try {
    // 1. Read the active model manifest
    const manifestPath = path.join(process.cwd(), 'public', 'ml', 'model', 'manifest.json');
    let activeManifest = null;
    if (fs.existsSync(manifestPath)) {
      activeManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    }

    // 2. Read database records if DB is reachable
    let history: unknown[] = [];
    let classCounts: Array<{ label: number; count: number; name: string }> = [];

    try {
      await connectDB();
      history = await EvaluationRun.find({}).sort({ createdAt: -1 }).limit(20).lean();

      // Aggregate sample counts per class
      const counts = await Sample.aggregate([
        { $group: { _id: '$label', count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]);

      const gestures = await Gesture.find({}).lean();
      const gestureMap = new Map<number, string>(gestures.map((g) => [g.labelIndex, g.name]));

      classCounts = counts.map((c: { _id: number; count: number }) => ({
        label: c._id,
        count: c.count,
        name: gestureMap.get(c._id) ?? `Class ${c._id}`,
      }));
    } catch (dbErr) {
      console.warn('[ML-Evaluation] DB query skipped or failed:', dbErr);
    }

    return NextResponse.json({
      success: true,
      activeManifest,
      history,
      classCounts,
    });
  } catch (error) {
    return internalServerError('ML-Evaluation', error);
  }
}
