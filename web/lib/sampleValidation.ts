import { validateFeatureContract } from '../ml/featureContract';

export interface TrainingSample {
  features: number[];
  label: number;
  participantId?: string;
  sessionId?: string;
}

/**
 * The import endpoint accepts either an existing numeric label index or an
 * explicit gesture name. Names are resolved by the server inside the import
 * transaction; the browser must never invent a numeric label for one.
 */
export interface ImportSample {
  features: number[];
  label: number | string;
  participantId?: string;
  sessionId?: string;
}

export interface ValidatedImportSample extends ImportSample {
  index: number;
}

export interface RejectedSample {
  index: number;
  reason: string;
}

export interface SampleBatchValidation {
  accepted: TrainingSample[];
  rejected: RejectedSample[];
}

export interface ImportSampleBatchValidation {
  accepted: ValidatedImportSample[];
  rejected: RejectedSample[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseOptionalId(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length > 0 && trimmed.length <= 64) {
      return trimmed;
    }
  }
  return undefined;
}

function validateTrainingSample(
  sample: unknown,
  index: number,
  knownLabels: Set<number>
): { ok: true; sample: TrainingSample } | { ok: false; rejected: RejectedSample } {
  if (!isRecord(sample)) {
    return { ok: false, rejected: { index, reason: 'Sample must be an object.' } };
  }

  const { features, label, participantId, sessionId } = sample;
  const featureCheck = validateFeatureContract(features);
  if (!featureCheck.valid) {
    return {
      ok: false,
      rejected: { index, reason: featureCheck.reason ?? 'Features do not satisfy the wrist-maxabs-v1 contract.' },
    };
  }

  if (typeof label !== 'number' || !Number.isInteger(label)) {
    return { ok: false, rejected: { index, reason: 'Label must be an integer.' } };
  }

  if (!knownLabels.has(label)) {
    return { ok: false, rejected: { index, reason: `Unknown gesture label: ${label}.` } };
  }

  const parsedParticipantId = parseOptionalId(participantId);
  const parsedSessionId = parseOptionalId(sessionId);

  return {
    ok: true,
    sample: {
      features: features as number[],
      label,
      ...(parsedParticipantId ? { participantId: parsedParticipantId } : {}),
      ...(parsedSessionId ? { sessionId: parsedSessionId } : {}),
    },
  };
}

function validateImportSample(
  sample: unknown,
  index: number
): { ok: true; sample: ValidatedImportSample } | { ok: false; rejected: RejectedSample } {
  if (!isRecord(sample)) {
    return { ok: false, rejected: { index, reason: 'Sample must be an object.' } };
  }

  const { features, label, participantId, sessionId } = sample;
  const featureCheck = validateFeatureContract(features);
  if (!featureCheck.valid) {
    return {
      ok: false,
      rejected: { index, reason: featureCheck.reason ?? 'Features do not satisfy the wrist-maxabs-v1 contract.' },
    };
  }

  const parsedParticipantId = parseOptionalId(participantId);
  const parsedSessionId = parseOptionalId(sessionId);

  if (typeof label === 'number') {
    if (!Number.isInteger(label) || label < 0) {
      return { ok: false, rejected: { index, reason: 'Numeric labels must be non-negative integers.' } };
    }
    return {
      ok: true,
      sample: {
        features: features as number[],
        label,
        index,
        ...(parsedParticipantId ? { participantId: parsedParticipantId } : {}),
        ...(parsedSessionId ? { sessionId: parsedSessionId } : {}),
      },
    };
  }

  if (typeof label !== 'string' || !label.trim() || label.trim().length > 64) {
    return {
      ok: false,
      rejected: { index, reason: 'Gesture names must contain 1 to 64 characters.' },
    };
  }

  return {
    ok: true,
    sample: {
      features: features as number[],
      label: label.trim(),
      index,
      ...(parsedParticipantId ? { participantId: parsedParticipantId } : {}),
      ...(parsedSessionId ? { sessionId: parsedSessionId } : {}),
    },
  };
}

export function validateSampleBatch(
  samples: unknown,
  knownLabels: Set<number>,
  maxBatchSize: number
): SampleBatchValidation {
  if (!Array.isArray(samples)) {
    return { accepted: [], rejected: [{ index: -1, reason: 'Samples array is required.' }] };
  }

  if (samples.length === 0) {
    return { accepted: [], rejected: [{ index: -1, reason: 'Samples array cannot be empty.' }] };
  }

  if (samples.length > maxBatchSize) {
    return {
      accepted: [],
      rejected: [{ index: -1, reason: `Batch exceeds the ${maxBatchSize} sample limit.` }],
    };
  }

  return samples.reduce<SampleBatchValidation>(
    (acc, sample, index) => {
      const result = validateTrainingSample(sample, index, knownLabels);
      if (result.ok) {
        acc.accepted.push(result.sample);
      } else {
        acc.rejected.push(result.rejected);
      }
      return acc;
    },
    { accepted: [], rejected: [] }
  );
}

/**
 * Performs syntax-only validation before an atomic import transaction starts.
 * Whether a numeric label exists is checked against the authoritative gesture
 * collection inside that transaction.
 */
export function validateImportSampleBatch(
  samples: unknown,
  maxBatchSize: number
): ImportSampleBatchValidation {
  if (!Array.isArray(samples)) {
    return { accepted: [], rejected: [{ index: -1, reason: 'Samples array is required.' }] };
  }

  if (samples.length === 0) {
    return { accepted: [], rejected: [{ index: -1, reason: 'Samples array cannot be empty.' }] };
  }

  if (samples.length > maxBatchSize) {
    return {
      accepted: [],
      rejected: [{ index: -1, reason: `Batch exceeds the ${maxBatchSize} sample limit.` }],
    };
  }

  return samples.reduce<ImportSampleBatchValidation>(
    (acc, sample, index) => {
      const result = validateImportSample(sample, index);
      if (result.ok) {
        acc.accepted.push(result.sample);
      } else {
        acc.rejected.push(result.rejected);
      }
      return acc;
    },
    { accepted: [], rejected: [] }
  );
}
