import type { ControlMode } from '@/features/control/modes';

export interface GestureLogEntry {
  _id: string;
  gesture: string;
  confidence: number;
  platform: 'browser' | 'desktop';
  mode: ControlMode;
  timestamp: string;
}

export const logQueryKeys = {
  recent: ['logs', 'recent'] as const,
};

export async function fetchRecentLogs(): Promise<GestureLogEntry[]> {
  const response = await fetch('/api/logs');
  const data = await response.json() as unknown;

  if (!response.ok) {
    const error = typeof data === 'object' && data !== null && 'error' in data
      ? (data as { error?: unknown }).error
      : undefined;
    throw new Error(typeof error === 'string' ? error : 'Failed to fetch gesture history.');
  }
  if (!Array.isArray(data)) throw new Error('Invalid gesture history response.');
  return data as GestureLogEntry[];
}
