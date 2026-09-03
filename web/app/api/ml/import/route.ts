import { NextRequest, NextResponse } from 'next/server';
import type { ClientSession } from 'mongoose';
import { connectDB } from '@/lib/db';
import { requireAdmin } from '@/lib/adminAuth';
import { ensureDefaultGestures, findOrCreateGesture, getGestureCanonicalName } from '@/lib/gestures';
import { internalServerError, isRecord, rateLimit, readJsonBody, requireSameOrigin } from '@/lib/requestGuards';
import { type RejectedSample, type ValidatedImportSample, validateImportSampleBatch } from '@/lib/sampleValidation';
import Gesture from '@/models/Gesture';
import Sample from '@/models/Sample';

const MAX_SAMPLE_BATCH_SIZE = 5000;
const SAMPLE_BODY_LIMIT_BYTES = 5 * 1024 * 1024;
const MAX_REJECTED_DETAILS = 100;

class ImportValidationError extends Error {
  constructor(public readonly rejected: RejectedSample[]) {
    super('One or more samples could not be imported.');
    this.name = 'ImportValidationError';
  }
}

interface ResolvedImport {
  samples: Array<{ features: number[]; label: number }>;
  createdGestureNames: string[];
}

function rejectedResponse(rejected: RejectedSample[]): NextResponse {
  return NextResponse.json(
    {
      error: 'No samples were imported because one or more rows are invalid.',
      acceptedCount: 0,
      rejectedCount: rejected.length,
      rejected: rejected.slice(0, MAX_REJECTED_DETAILS),
      rejectedTruncated: rejected.length > MAX_REJECTED_DETAILS,
    },
    { status: 400 }
  );
}

function isTransactionUnsupportedError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const message = 'message' in error && typeof error.message === 'string' ? error.message : '';
  const code = 'code' in error && typeof error.code === 'number' ? error.code : undefined;
  return code === 20 || /transaction numbers are only allowed|does not support transactions|replica set member or mongos/i.test(message);
}

async function resolveImportSamples(
  samples: ValidatedImportSample[],
  session?: ClientSession | null
): Promise<ResolvedImport> {
  // These writes are part of the transaction (if available).
  await ensureDefaultGestures(session ? { session } : undefined);
  const query = Gesture.find({}, { name: 1, normalizedName: 1, labelIndex: 1 });
  if (session) query.session(session);
  const existingGestures = await query.lean();
  const labels = new Set(existingGestures.map((gesture) => gesture.labelIndex));
  const labelsByName = new Map(
    existingGestures.map((gesture) => [
      gesture.normalizedName ?? getGestureCanonicalName(gesture.name),
      gesture.labelIndex,
    ])
  );

  const rejected: RejectedSample[] = [];
  const requestedNames = new Map<string, string>();
  for (const sample of samples) {
    if (typeof sample.label === 'number') {
      if (!labels.has(sample.label)) {
        rejected.push({ index: sample.index, reason: `Unknown gesture label: ${sample.label}.` });
      }
      continue;
    }

    const canonicalName = getGestureCanonicalName(sample.label);
    if (!labelsByName.has(canonicalName)) {
      requestedNames.set(canonicalName, sample.label);
    }
  }

  // Validate every input row before creating any custom gesture or sample.
  if (rejected.length > 0) throw new ImportValidationError(rejected);

  const createdGestureNames: string[] = [];
  try {
    for (const [canonicalName, requestedName] of requestedNames) {
      const result = await findOrCreateGesture(requestedName, session ? { session } : undefined);
      labelsByName.set(canonicalName, result.gesture.labelIndex);
      if (result.created) createdGestureNames.push(result.gesture.name);
    }
  } catch (gestureError) {
    if (!session && createdGestureNames.length > 0) {
      await Gesture.deleteMany({ name: { $in: createdGestureNames } }).catch(() => {});
    }
    throw gestureError;
  }

  const resolvedSamples: Array<{ features: number[]; label: number }> = [];
  for (const sample of samples) {
    const label = typeof sample.label === 'number'
      ? sample.label
      : labelsByName.get(getGestureCanonicalName(sample.label));
    if (label === undefined) {
      throw new ImportValidationError([
        { index: sample.index, reason: `Gesture name could not be resolved: ${String(sample.label)}.` },
      ]);
    }
    resolvedSamples.push({ features: sample.features, label });
  }

  return { samples: resolvedSamples, createdGestureNames };
}

/**
 * POST /api/ml/import
 *
 * Resolves named gestures, creates only genuinely new gesture labels, and
 * inserts every sample atomically (via replica-set transaction when supported,
 * or guarded batch insert with compensation on standalone MongoDB).
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const admin = requireAdmin(req);
  if (admin instanceof NextResponse) return admin;

  const originError = requireSameOrigin(req);
  if (originError) return originError;

  const rateLimitError = rateLimit(req, 'ml:import', 10, 60_000);
  if (rateLimitError) return rateLimitError;

  const bodyResult = await readJsonBody(req, SAMPLE_BODY_LIMIT_BYTES);
  if (!bodyResult.ok) return bodyResult.response;

  if (!isRecord(bodyResult.data)) {
    return NextResponse.json({ error: 'Request body must be an object.' }, { status: 400 });
  }

  const validation = validateImportSampleBatch(bodyResult.data.samples, MAX_SAMPLE_BATCH_SIZE);
  if (validation.rejected.length > 0) return rejectedResponse(validation.rejected);

  let session: ClientSession | null = null;
  try {
    const db = await connectDB();

    // 1. Attempt transaction if supported
    try {
      const activeSession = await db.startSession();
      session = activeSession;
      const transactionResult: { value: ResolvedImport | null } = { value: null };

      await activeSession.withTransaction(async () => {
        transactionResult.value = await resolveImportSamples(validation.accepted, activeSession);
        await Sample.insertMany(
          transactionResult.value.samples.map((sample) => ({ ...sample, source: 'import' })),
          { session: activeSession }
        );
      });

      const resolved = transactionResult.value;
      if (!resolved) throw new Error('Import transaction completed without a result.');
      return NextResponse.json({
        success: true,
        message: `Imported ${resolved.samples.length} samples atomically via replica transaction.`,
        acceptedCount: resolved.samples.length,
        rejectedCount: 0,
        createdGestureNames: resolved.createdGestureNames,
      });
    } catch (txError) {
      if (!isTransactionUnsupportedError(txError)) {
        throw txError;
      }
      // Standalone MongoDB fallback
      await session?.endSession();
      session = null;
    }

    // 2. Standalone fallback: Pre-resolve gestures and insert batch with compensation rollback
    const resolved = await resolveImportSamples(validation.accepted, null);
    try {
      await Sample.insertMany(
        resolved.samples.map((sample) => ({
          ...sample,
          source: 'import',
          normalizationVersion: 'wrist-maxabs-v1',
        }))
      );
    } catch (insertError) {
      // Compensation: clean up any newly created gestures if sample insertion failed
      if (resolved.createdGestureNames.length > 0) {
        await Gesture.deleteMany({ name: { $in: resolved.createdGestureNames } }).catch((cleanupErr) => {
          console.error('Failed to clean up newly created gestures after import failure:', cleanupErr);
        });
      }
      throw insertError;
    }

    return NextResponse.json({
      success: true,
      message: `Imported ${resolved.samples.length} samples successfully.`,
      acceptedCount: resolved.samples.length,
      rejectedCount: 0,
      createdGestureNames: resolved.createdGestureNames,
    });
  } catch (error) {
    if (error instanceof ImportValidationError) return rejectedResponse(error.rejected);
    return internalServerError('ml:import', error);
  } finally {
    await session?.endSession();
  }
}
