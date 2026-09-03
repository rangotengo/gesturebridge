export interface GestureRecord {
  _id: string;
  name: string;
  labelIndex: number;
  isCustom: boolean;
}

export const gestureKeys = {
  all: ['gestures'] as const,
};

async function readError(response: Response, fallback: string): Promise<Error> {
  try {
    const data = await response.json() as { error?: string };
    return new Error(data.error ?? fallback);
  } catch {
    return new Error(fallback);
  }
}

export async function fetchGestures(): Promise<GestureRecord[]> {
  const response = await fetch('/api/ml/gestures');
  if (!response.ok) throw await readError(response, 'Failed to load gestures from server');
  const data = await response.json() as unknown;
  if (!Array.isArray(data)) throw new Error('Invalid gestures response');
  return data as GestureRecord[];
}

export async function createGesture(name: string): Promise<GestureRecord> {
  const response = await fetch('/api/ml/gestures', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!response.ok) throw await readError(response, 'Failed to create gesture');
  return response.json() as Promise<GestureRecord>;
}

export async function createGesturesBatch(names: string[]): Promise<GestureRecord[]> {
  const response = await fetch('/api/ml/gestures/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ names }),
  });
  if (!response.ok) throw await readError(response, 'Failed to batch create gestures');
  return response.json() as Promise<GestureRecord[]>;
}
