import crypto from 'crypto';
import { connectDB } from '@/lib/db';
import { logError, logInfo } from '@/lib/logger';
import { trainModel, TrainingError, type TrainResult } from '@/ml/trainer';
import { acquireTrainingLease, readTrainingStatus, type TrainingStatus } from '@/ml/trainingState';

export interface BackgroundTrainingJob {
  jobId: string;
  status: 'running' | 'succeeded' | 'failed';
  startedAt: string;
  completedAt?: string;
  result?: TrainResult;
  error?: string;
}

let activeJobPromise: Promise<TrainResult> | null = null;
let currentJob: BackgroundTrainingJob | null = null;

export async function getActiveJobStatus(requestedJobId?: string): Promise<TrainingStatus> {
  await connectDB();
  return readTrainingStatus(requestedJobId);
}

export async function enqueueTrainingJob(): Promise<{
  jobId: string;
  status: 'running';
  message: string;
}> {
  await connectDB();
  const jobId = crypto.randomUUID();

  // Atomically lock the MongoDB singleton lease BEFORE returning 202
  const lease = await acquireTrainingLease(jobId);
  if (!lease) {
    throw new TrainingError('A training job is already in progress.', 'TRAINING_IN_PROGRESS', 409);
  }

  const startedAt = new Date().toISOString();
  currentJob = {
    jobId,
    status: 'running',
    startedAt,
  };

  logInfo('ml.training_job_queued', { jobId });

  // Execute in background with pre-acquired lease
  activeJobPromise = (async (): Promise<TrainResult> => {
    try {
      const result = await trainModel({ lease });
      if (currentJob && currentJob.jobId === jobId) {
        currentJob.status = 'succeeded';
        currentJob.completedAt = new Date().toISOString();
        currentJob.result = result;
      }
      logInfo('ml.training_job_succeeded', { jobId, version: result.modelVersion });
      return result;
    } catch (error) {
      if (currentJob && currentJob.jobId === jobId) {
        currentJob.status = 'failed';
        currentJob.completedAt = new Date().toISOString();
        currentJob.error = error instanceof Error ? error.message : 'Training failed';
      }
      logError('ml.training_job_failed', error, { jobId });
      throw error;
    } finally {
      activeJobPromise = null;
    }
  })();

  // Catch unhandled rejection for background promise
  activeJobPromise.catch(() => {
    // Logged inside the wrapper
  });

  return {
    jobId,
    status: 'running',
    message: 'Training job started in background.',
  };
}
