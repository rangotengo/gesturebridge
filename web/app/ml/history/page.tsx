'use client';

import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import ProtectedRoute from '@/components/ProtectedRoute';
import { useGestures } from '@/context/GestureContext';
import { fetchRecentLogs, logQueryKeys } from '@/features/logs/queries';

function HistoryPageContent(): React.ReactElement {
  const { gestureLabels } = useGestures();
  const logsQuery = useQuery({
    queryKey: logQueryKeys.recent,
    queryFn: fetchRecentLogs,
  });
  const stats = useMemo(
    () => (logsQuery.data ?? []).reduce<Record<string, number>>((acc, log) => {
      acc[log.gesture] = (acc[log.gesture] ?? 0) + 1;
      return acc;
    }, {}),
    [logsQuery.data]
  );
  const logs = logsQuery.data ?? [];

  if (logsQuery.isLoading) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner" />
        <p>Loading history...</p>
      </div>
    );
  }

  const allLabels = Array.from(new Set([...gestureLabels, ...Object.keys(stats)])).filter(Boolean);
  const maxCount = Math.max(...Object.values(stats), 1);

  return (
    <main className="mx-auto max-w-5xl">
      <h1 className="mb-8">Gesture History</h1>

      {logsQuery.error && (
        <div className="alert alert-error mb-5" role="alert">
          {logsQuery.error.message}
        </div>
      )}

      {/* Frequency Chart */}
      <section className="card mb-8">
        <h2 className="mb-5 text-lg">Gesture Frequency</h2>
        <div className="flex h-45 items-end gap-3 pb-2.5">
          {allLabels.map((label) => {
            const count = stats[label] ?? 0;
            const height = (count / maxCount) * 140;
            return (
              <div key={label} className="flex flex-1 flex-col items-center gap-1.5">
                <div
                  aria-label={`${label}: ${count} recognitions`}
                  className="w-full max-w-12 rounded-t bg-blue-500 transition-[height] duration-500"
                  style={{ height: `${Math.max(count > 0 ? 4 : 0, height)}px` }}
                />
                <span className="text-center text-[11px] leading-tight text-(--color-text-muted)">{label}</span>
                <span className="text-xs font-bold text-(--color-text-heading)">{count}</span>
              </div>
            );
          })}
        </div>
      </section>

      {/* Log Table */}
      <section className="card">
        <h2 className="mb-4 text-lg">Recent Activity</h2>
        <div className="overflow-x-auto">
          <table className="history-table">
            <thead>
              <tr>
                <th>Gesture</th>
                <th>Confidence</th>
                <th>Platform</th>
                <th>Mode</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log._id}>
                  <td className="font-semibold text-(--color-accent)">{log.gesture}</td>
                  <td>{(log.confidence * 100).toFixed(0)}%</td>
                  <td className="capitalize">{log.platform}</td>
                  <td className="capitalize">{log.mode.replace('-', ' ')}</td>
                  <td className="text-[13px] text-(--color-text-muted)">
                    {new Date(log.timestamp).toLocaleString()}
                  </td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-6 text-center text-(--color-text-muted)">
                    No logs found. Start using GestureBridge to see your history!
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

export default function HistoryPage(): React.ReactElement {
  return (
    <ProtectedRoute requireAdmin>
      <HistoryPageContent />
    </ProtectedRoute>
  );
}
