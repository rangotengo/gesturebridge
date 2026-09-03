import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import { connectDB } from '@/lib/db';
import Sample from '@/models/Sample';
import { readTrainingStatus } from '@/ml/trainingState';
import { internalServerError } from '@/lib/requestGuards';
import { logWarn } from '@/lib/logger';

export const runtime = 'nodejs';

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(req.url);
    const jobId = searchParams.get('jobId') ?? undefined;

    await connectDB();
    const count = await Sample.countDocuments({ quarantined: { $ne: true } });
    const modelDirectory = path.join(process.cwd(), 'public', 'ml', 'model');
    const modelPath = path.join(modelDirectory, 'model.json');
    const manifestPath = path.join(modelDirectory, 'manifest.json');
    const hasModel = fs.existsSync(modelPath);
    let modelManifest: unknown = null;
    if (hasModel && fs.existsSync(manifestPath)) {
      try {
        modelManifest = JSON.parse(await fs.promises.readFile(manifestPath, 'utf8')) as unknown;
      } catch {
        logWarn('ml.status_manifest_unreadable');
      }
    }
    return NextResponse.json({
      samplesCount: count,
      hasModel,
      modelManifest,
      training: await readTrainingStatus(jobId),
    });
  } catch (err) {
    return internalServerError('ml:status', err);
  }
}
