import { useState, useEffect, useRef, useCallback } from 'react';
import * as tf from '@tensorflow/tfjs';
import { normalizeLandmarks, type Landmark } from '@/ml/gestureUtils';

interface PredictionResult {
  gesture: string;
  confidence: number;
  allScores: number[];
}

interface ModelManifestLabel {
  labelIndex: number;
  name: string;
}

interface ModelManifest {
  version?: string;
  featureCount: number;
  denseLabelMap?: ModelManifestLabel[];
  labels: ModelManifestLabel[];
  modelJsonSha256?: string;
}

function isModelManifest(value: unknown): value is ModelManifest {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { featureCount?: unknown; labels?: unknown; denseLabelMap?: unknown };
  const rawLabels = Array.isArray(candidate.denseLabelMap) ? candidate.denseLabelMap : candidate.labels;
  return (
    candidate.featureCount === 63 &&
    Array.isArray(rawLabels) &&
    rawLabels.length >= 2 &&
    rawLabels.every(
      (label) =>
        typeof label === 'object' &&
        label !== null &&
        'labelIndex' in label &&
        typeof label.labelIndex === 'number' &&
        'name' in label &&
        typeof label.name === 'string' &&
        label.name.length > 0
    )
  );
}

const SAFE_VERSION_REGEX = /^[a-zA-Z0-9_.-]+$/;

async function computeSha256(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function useGestureModel(): {
  predict: (landmarks: Landmark[]) => PredictionResult | null;
  isReady: boolean;
  error: string | null;
  reloadModel: () => Promise<boolean>;
} {
  const modelRef = useRef<tf.LayersModel | null>(null);
  const modelLabelsRef = useRef<string[] | null>(null);
  const loadGenerationRef = useRef(0);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reloadModel = useCallback(async (): Promise<boolean> => {
    const loadGeneration = ++loadGenerationRef.current;
    setError(null);
    let nextModel: tf.LayersModel | null = null;
    try {
      const cacheKey = Date.now();
      let activeVersion: string | null = null;
      try {
        const activeRes = await fetch(`/ml/active_version.json?t=${cacheKey}`);
        if (activeRes.ok) {
          const activeData = (await activeRes.json()) as { activeVersion?: string };
          if (typeof activeData?.activeVersion === 'string' && SAFE_VERSION_REGEX.test(activeData.activeVersion)) {
            activeVersion = activeData.activeVersion;
          }
        }
      } catch {
        // Ignore and fall back to standard path
      }

      const basePath = activeVersion ? `/ml/models/${activeVersion}` : `/ml/model`;
      const modelUrl = `${basePath}/model.json?t=${cacheKey}`;
      const manifestUrl = `${basePath}/manifest.json?t=${cacheKey}`;

      // Pre-flight check to verify model existence
      try {
        const checkRes = await fetch(modelUrl, { method: 'HEAD' });
        if (!checkRes.ok) {
          setError('No trained model found on the server. Please train the model to enable recognition.');
          return false;
        }
      } catch {
        setError('Network error checking model status.');
        return false;
      }

      const manifestResponse = await fetch(manifestUrl);
      if (!manifestResponse.ok) {
        throw new Error('Model manifest missing. Please train the model.');
      }
      const candidate = (await manifestResponse.json()) as unknown;
      if (!isModelManifest(candidate)) {
        throw new Error('Model manifest is invalid or uses an unsupported schema.');
      }
      const manifest: ModelManifest = candidate;
      const manifestLabels = manifest.denseLabelMap ?? manifest.labels;

      if (manifest.modelJsonSha256) {
        const modelFetch = await fetch(modelUrl);
        if (!modelFetch.ok) throw new Error('Failed to fetch model topology for integrity check.');
        const modelBuffer = await modelFetch.arrayBuffer();
        const computedSha = await computeSha256(modelBuffer);
        if (computedSha !== manifest.modelJsonSha256) {
          throw new Error('Model verification failed: SHA-256 mismatch between model.json and manifest.');
        }
      }

      nextModel = await tf.loadLayersModel(modelUrl);
      if (loadGeneration !== loadGenerationRef.current) return false;
      const outputShape = nextModel.outputs[0]?.shape;
      const outputClasses = outputShape?.[outputShape.length - 1];
      if (outputClasses !== manifestLabels.length) {
        throw new Error(
          `Model output units (${outputClasses}) and manifest classes (${manifestLabels.length}) do not match. Please retrain the model.`
        );
      }
      const previousModel = modelRef.current;
      modelRef.current = nextModel;
      modelLabelsRef.current = manifestLabels.map((l) => l.name);
      nextModel = null;
      setIsReady(true);
      previousModel?.dispose();
      console.log('TF.js model loaded successfully with dense labels:', modelLabelsRef.current);
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load model';
      console.error('Failed to load TF.js model:', err);
      setError(msg);
      return false;
    } finally {
      nextModel?.dispose();
    }
  }, []);

  useEffect(() => {
    const loadTimer = window.setTimeout(() => void reloadModel(), 0);
    return () => {
      window.clearTimeout(loadTimer);
      loadGenerationRef.current += 1;
      modelRef.current?.dispose();
      modelRef.current = null;
      modelLabelsRef.current = null;
    };
  }, [reloadModel]);

  const predict = useCallback(
    (landmarks: Landmark[]): PredictionResult | null => {
      if (!modelRef.current || !landmarks || !isReady || !modelLabelsRef.current) return null;

      try {
        const normalized = normalizeLandmarks(landmarks);

        return tf.tidy(() => {
          const input = tf.tensor2d([normalized]); // shape: [1, 63]
          const output = modelRef.current!.predict(input) as tf.Tensor;
          const probabilities = Array.from(output.dataSync());

          const maxIndex = probabilities.indexOf(Math.max(...probabilities));
          const gestureName = modelLabelsRef.current![maxIndex] ?? `Unknown (${maxIndex})`;

          return {
            gesture: gestureName,
            confidence: probabilities[maxIndex] ?? 0,
            allScores: probabilities,
          };
        });
      } catch (err) {
        console.error('Prediction error:', err);
        return null;
      }
    },
    [isReady]
  );

  return { predict, isReady, error, reloadModel };
}
