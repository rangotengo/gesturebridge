import type { ParsedImportSample } from '@/features/datasets/importParser';

async function readResponse<T>(response: Response, fallback: string): Promise<T> {
  const data = await response.json().catch(() => null) as T | null;
  if (!response.ok) {
    const error = typeof data === 'object' && data !== null && 'error' in data && typeof data.error === 'string'
      ? data.error
      : fallback;
    throw new Error(error);
  }
  if (!data) throw new Error(fallback);
  return data;
}

export interface ImportDatasetResult {
  success?: boolean;
  message?: string;
  error?: string;
  rejectedCount?: number;
  rejected?: Array<{ index: number; reason: string }>;
}

export class DatasetImportError extends Error {
  constructor(public readonly result: ImportDatasetResult, fallback: string) {
    super(result.error ?? fallback);
    this.name = 'DatasetImportError';
  }
}

export async function importDataset(samples: ParsedImportSample[]): Promise<ImportDatasetResult> {
  const response = await fetch('/api/ml/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      samples: samples.map((sample) => ({
        features: sample.features,
        label: sample.label === -1 ? sample.rawStringLabel : sample.label,
      })),
    }),
  });
  const data = await response.json().catch(() => null) as ImportDatasetResult | null;
  if (!response.ok || !data?.success) {
    throw new DatasetImportError(data ?? {}, 'Failed to import the dataset.');
  }
  return data;
}

export interface MutationResult {
  success?: boolean;
  message?: string;
  error?: string;
  seededCount?: number;
  samplesCount?: number;
  acceptedCount?: number;
  rejectedCount?: number;
  rejected?: Array<{ index: number; reason: string }>;
  rejectedIndices?: number[];
  jobId?: string;
  status?: string;
}

export interface CollectedSample {
  features: number[];
  label: number;
}

export async function saveCollectedSamples(samples: CollectedSample[]): Promise<MutationResult> {
  const response = await fetch('/api/ml/collect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ samples }),
  });
  return readResponse<MutationResult>(response, 'Failed to save collected samples.');
}

async function postDatasetAction(path: string, fallback: string): Promise<MutationResult> {
  return readResponse<MutationResult>(await fetch(path, { method: 'POST' }), fallback);
}

export function seedDataset(): Promise<MutationResult> {
  return postDatasetAction('/api/ml/seed', 'Failed to seed the default dataset.');
}

export async function pollTrainingStatus(
  jobId?: string,
  maxWaitMs = 180_000,
  intervalMs = 1_000
): Promise<MutationResult> {
  const start = Date.now();
  const url = jobId ? `/api/ml/status?jobId=${encodeURIComponent(jobId)}` : `/api/ml/status?t=${Date.now()}`;
  while (Date.now() - start < maxWaitMs) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json() as {
        training?: {
          state: 'idle' | 'running' | 'succeeded' | 'failed';
          jobId?: string | null;
          lastResult?: {
            message?: string;
            modelVersion?: string;
            samplesCount?: number;
            trainingAccuracy?: number;
            validationAccuracy?: number;
          };
          errorCode?: string;
        };
      };
      if (data.training?.state === 'succeeded') {
        const result = data.training.lastResult;
        return {
          success: true,
          message: result?.message ?? `Training completed successfully (version ${result?.modelVersion ?? 'latest'}).`,
          samplesCount: result?.samplesCount,
        };
      }
      if (data.training?.state === 'failed') {
        throw new Error(data.training.errorCode ?? 'Model training failed on the server.');
      }
    }
  }
  throw new Error('Training job timed out.');
}

export async function trainDatasetModel(): Promise<MutationResult> {
  const initRes = await postDatasetAction('/api/ml/train', 'Failed to start model training.');
  if (initRes.success && initRes.status !== 'running') {
    return initRes;
  }
  return pollTrainingStatus(initRes.jobId);
}
