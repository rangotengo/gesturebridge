import crypto from 'crypto';
import TrainingJob, { type ITrainingJob, type ITrainingResult } from '@/models/TrainingJob';

const GLOBAL_JOB_ID = 'global';
const DEFAULT_TRAINING_LEASE_MS = 5 * 60 * 1_000;
const MIN_TRAINING_LEASE_MS = 60 * 1_000;
const MAX_TRAINING_LEASE_MS = 24 * 60 * 60 * 1_000;

export type TrainResult = ITrainingResult;

export interface TrainingStatus {
  state: 'idle' | 'running' | 'succeeded' | 'failed';
  jobId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  lastResult: TrainResult | null;
  errorCode: string | null;
}

export interface TrainingLease {
  ownerId: string;
  jobId: string;
  startedAt: string;
  previousResult: TrainResult | null;
}

function getLeaseDurationMs(): number {
  const configured = Number(process.env.TRAINING_LEASE_MS);
  if (!Number.isInteger(configured)) return DEFAULT_TRAINING_LEASE_MS;
  return Math.max(MIN_TRAINING_LEASE_MS, Math.min(configured, MAX_TRAINING_LEASE_MS));
}

function toStatus(job: ITrainingJob | null): TrainingStatus {
  if (!job) {
    return {
      state: 'idle',
      jobId: null,
      startedAt: null,
      completedAt: null,
      lastResult: null,
      errorCode: null,
    };
  }
  return {
    state: job.state,
    jobId: job.jobId ?? null,
    startedAt: job.startedAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
    lastResult: job.lastResult
      ? {
          success: true,
          message: job.lastResult.message,
          samplesCount: job.lastResult.samplesCount,
          modelVersion: job.lastResult.modelVersion,
          trainingAccuracy: job.lastResult.trainingAccuracy,
          validationAccuracy: job.lastResult.validationAccuracy,
        }
      : null,
    errorCode: job.errorCode,
  };
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 11_000
  );
}

/** Mark an abandoned lease failed so a restart cannot leave status stuck at running. */
async function recoverExpiredLease(now: Date): Promise<void> {
  await TrainingJob.updateOne(
    { _id: GLOBAL_JOB_ID, state: 'running', leaseExpiresAt: { $lte: now } },
    {
      $set: {
        state: 'failed',
        completedAt: now,
        errorCode: 'TRAINING_LEASE_EXPIRED',
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    }
  ).exec();
}

export async function readTrainingStatus(requestedJobId?: string): Promise<TrainingStatus> {
  const now = new Date();
  await recoverExpiredLease(now);
  const job = await TrainingJob.findById(GLOBAL_JOB_ID).lean<ITrainingJob | null>().exec();
  const status = toStatus(job);
  if (requestedJobId && job && job.jobId !== requestedJobId) {
    // Client requested a specific job, but global is running/finished another job
    return {
      ...status,
      state: 'idle', // Treat as stale for this specific job request
    };
  }
  return status;
}

/** Acquire a Mongo-backed, expiring singleton lease for one training process. */
export async function acquireTrainingLease(targetJobId?: string): Promise<TrainingLease | null> {
  const now = new Date();
  await recoverExpiredLease(now);
  const ownerId = crypto.randomUUID();
  const jobId = targetJobId ?? crypto.randomUUID();
  const startedAt = now.toISOString();
  const leaseExpiresAt = new Date(now.getTime() + getLeaseDurationMs());

  try {
    const job = await TrainingJob.findOneAndUpdate(
      {
        _id: GLOBAL_JOB_ID,
        $or: [{ state: { $ne: 'running' } }, { leaseExpiresAt: { $lte: now } }],
      },
      {
        $set: {
          jobId,
          state: 'running',
          startedAt: now,
          completedAt: null,
          errorCode: null,
          leaseOwner: ownerId,
          leaseExpiresAt,
        },
        $setOnInsert: { _id: GLOBAL_JOB_ID, lastResult: null },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).exec();

    if (!job || job.leaseOwner !== ownerId) return null;
    return { ownerId, jobId, startedAt, previousResult: job.lastResult ?? null };
  } catch (error) {
    if (isDuplicateKeyError(error)) return null;
    throw error;
  }
}

/** Renew the lock while long TensorFlow work runs. False means ownership was lost. */
export async function renewTrainingLease(ownerId: string): Promise<boolean> {
  const result = await TrainingJob.updateOne(
    { _id: GLOBAL_JOB_ID, state: 'running', leaseOwner: ownerId },
    { $set: { leaseExpiresAt: new Date(Date.now() + getLeaseDurationMs()) } }
  ).exec();
  return result.modifiedCount === 1;
}

export async function completeTrainingLease(ownerId: string, result: TrainResult): Promise<boolean> {
  const update = await TrainingJob.updateOne(
    { _id: GLOBAL_JOB_ID, state: 'running', leaseOwner: ownerId },
    {
      $set: {
        state: 'succeeded',
        completedAt: new Date(),
        lastResult: result,
        errorCode: null,
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    }
  ).exec();
  return update.modifiedCount === 1;
}

export async function failTrainingLease(ownerId: string, errorCode: string): Promise<void> {
  await TrainingJob.updateOne(
    { _id: GLOBAL_JOB_ID, state: 'running', leaseOwner: ownerId },
    {
      $set: {
        state: 'failed',
        completedAt: new Date(),
        errorCode,
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    }
  ).exec();
}

export function getTrainingLeaseRenewalIntervalMs(): number {
  return Math.max(30_000, Math.floor(getLeaseDurationMs() / 3));
}
