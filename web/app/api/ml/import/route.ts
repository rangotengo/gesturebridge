import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
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
  samples: Array<{
    features: number[];
    label: number;
    participantId?: string;
    sessionId?: string;
  }>;
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
  const msg = 'message' in error && typeof error.message === 'string' ? error.message : '';
  return (
    msg.includes('Transaction numbers are only allowed on a replica set member or mongos') ||
    msg.includes('Transactions are not supported by this deployment') ||
    msg.includes('standalone')
  );
}

async function resolveImportSamples(
  samples: ValidatedImportSample[],
  session: ClientSession | null
): Promise<ResolvedImport> {
  await ensureDefaultGestures(session ? { session } : undefined);

  const existingGestures = await Gesture.find({}, null, session ? { session } : {}).lean();
  const knownNumericLabels = new Set(existingGestures.map((g) => g.labelIndex));
  const labelsByName = new Map<string, number>(
    existingGestures.map((g) => [g.normalizedName ?? getGestureCanonicalName(g.name), g.labelIndex])
  );

  const uniqueNamedLabels = [
    ...new Set(
      samples
        .map((s) => s.label)
        .filter((label): label is string => typeof label === 'string')
        .map(getGestureCanonicalName)
    ),
  ];

  const createdGestureNames: string[] = [];
  try {
    for (const name of uniqueNamedLabels) {
      if (!labelsByName.has(name)) {
        const { gesture } = await findOrCreateGesture(name, session ? { session } : undefined);
        labelsByName.set(name, gesture.labelIndex);
        knownNumericLabels.add(gesture.labelIndex);
        createdGestureNames.push(gesture.name);
      }
    }
  } catch (gestureError) {
    if (!session && createdGestureNames.length > 0) {
      await Gesture.deleteMany({ name: { $in: createdGestureNames } }).catch(() => {});
    }
    throw gestureError;
  }

  const resolvedSamples: Array<{
    features: number[];
    label: number;
    participantId?: string;
    sessionId?: string;
  }> = [];

  for (const sample of samples) {
    const label = typeof sample.label === 'number'
      ? sample.label
      : labelsByName.get(getGestureCanonicalName(sample.label));

    if (label === undefined || !knownNumericLabels.has(label)) {
      throw new ImportValidationError([
        { index: sample.index, reason: `Gesture label could not be resolved: ${String(sample.label)}.` },
      ]);
    }

    resolvedSamples.push({
      features: sample.features,
      label,
      ...(sample.participantId ? { participantId: sample.participantId } : {}),
      ...(sample.sessionId ? { sessionId: sample.sessionId } : {}),
    });
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
    const importBatchId = crypto.randomUUID();

    // 1. Attempt transaction if supported
    try {
      const activeSession = await db.startSession();
      session = activeSession;
      const transactionResult: { value: ResolvedImport | null } = { value: null };

      await activeSession.withTransaction(async () => {
        transactionResult.value = await resolveImportSamples(validation.accepted, activeSession);
        await Sample.insertMany(
          transactionResult.value.samples.map((sample) => ({
            ...sample,
            source: 'import',
            normalizationVersion: 'wrist-maxabs-v1',
            importBatchId,
          })),
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
        importBatchId,
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
          importBatchId,
        }))
      );
    } catch (insertError) {
      // Standalone compensation:
      // 1. Clean up any partially inserted samples from this batch
      await Sample.deleteMany({ importBatchId }).catch((cleanupErr) => {
        console.error('Failed to clean up partially inserted samples after import failure:', cleanupErr);
      });

      // 2. Safely compensate newly created gestures ONLY if no other samples in the system reference them
      if (resolved.createdGestureNames.length > 0) {
        try {
          const gesturesToCheck = await Gesture.find({ name: { $in: resolved.createdGestureNames } }).lean();
          const gestureLabelIds = gesturesToCheck.map((g) => g.labelIndex);
          const samplesUsingLabels = await Sample.distinct('label', { label: { $in: gestureLabelIds } });
          const labelsWithSamples = new Set(samplesUsingLabels);
          const gestureNamesToDelete = gesturesToCheck
            .filter((g) => !labelsWithSamples.has(g.labelIndex))
            .map((g) => g.name);

          if (gestureNamesToDelete.length > 0) {
            await Gesture.deleteMany({ name: { $in: gestureNamesToDelete } });
          }
        } catch (cleanupErr) {
          console.error('Failed to safely compensate gestures after import failure:', cleanupErr);
        }
      }
      throw insertError;
    }

    return NextResponse.json({
      success: true,
      message: `Imported ${resolved.samples.length} samples successfully.`,
      acceptedCount: resolved.samples.length,
      rejectedCount: 0,
      createdGestureNames: resolved.createdGestureNames,
      importBatchId,
    });
  } catch (error) {
    if (error instanceof ImportValidationError) return rejectedResponse(error.rejected);
    return internalServerError('ml:import', error);
  } finally {
    await session?.endSession();
  }
}
