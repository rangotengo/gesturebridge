import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/adminAuth';
import { internalServerError, rateLimit, requireSameOrigin } from '@/lib/requestGuards';
import { migrateLegacySamples } from '@/ml/datasetMigration';

export const runtime = 'nodejs';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const admin = requireAdmin(req);
  if (admin instanceof NextResponse) return admin;

  const originError = requireSameOrigin(req);
  if (originError) return originError;

  const rateLimitError = rateLimit(req, 'ml:migrate', 10, 60_000);
  if (rateLimitError) return rateLimitError;

  try {
    const searchParams = req.nextUrl.searchParams;
    const dryRun = searchParams.get('dryRun') === 'true';
    const auditExisting = searchParams.get('audit') === 'true';
    const batchSize = parseInt(searchParams.get('batchSize') ?? '1000', 10) || 1000;

    const summary = await migrateLegacySamples({
      dryRun,
      batchSize,
      drainAll: true,
      auditExisting,
    });

    return NextResponse.json({
      success: true,
      message: `Migration completed: checked ${summary.totalChecked}, migrated ${summary.migratedCount}, quarantined ${summary.quarantinedCount}, valid ${summary.validCount}, remaining ${summary.remainingLegacyCount}.`,
      summary,
    });
  } catch (err) {
    return internalServerError('ml:migrate', err);
  }
}
