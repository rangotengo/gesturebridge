'use client';

import React, { useState, useEffect } from 'react';
import ProtectedRoute from '@/components/ProtectedRoute';

interface PerGestureMetric {
  labelIndex: number;
  name: string;
  precision: number;
  recall: number;
  f1Score: number;
  support: number;
}

interface ManifestData {
  version: string;
  modelVersion?: string;
  createdAt?: string;
  trainedAt?: string;
  datasetRevision: string;
  samplesCount?: number;
  sampleCount?: number;
  featureCount: number;
  normalizationVersion: string;
  metrics: {
    trainingAccuracy: number | null;
    validationAccuracy: number | null;
    macroF1?: number | null;
    macroPrecision?: number | null;
    macroRecall?: number | null;
    weightedF1?: number | null;
    splitStrategy?: string;
    confusionMatrix?: number[][];
    perGestureMetrics?: PerGestureMetric[];
  };
  denseLabelMap: Array<{ labelIndex: number; name: string }>;
  labels: Array<{ labelIndex: number; name: string }>;
  modelJsonSha256: string;
  weightsSha256?: Record<string, string> | string;
}

interface HistoryRun {
  _id: string;
  modelVersion: string;
  datasetRevision: string;
  samplesCount: number;
  classCount: number;
  splitStrategy: string;
  metrics: {
    trainingAccuracy: number;
    validationAccuracy: number;
    macroF1: number;
    macroPrecision: number;
    macroRecall: number;
    weightedF1: number;
    perGestureMetrics: PerGestureMetric[];
    confusionMatrix: number[][];
  };
  labels: Array<{ labelIndex: number; name: string }>;
  createdAt: string;
}

interface EvaluationApiResponse {
  success: boolean;
  activeManifest: ManifestData | null;
  history: HistoryRun[];
  classCounts: Array<{ label: number; count: number; name: string }>;
}

export default function EvaluationPage(): React.ReactElement {
  const [data, setData] = useState<EvaluationApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedHash, setCopiedHash] = useState(false);

  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        const res = await fetch('/api/ml/evaluation');
        if (!res.ok) throw new Error(`HTTP error ${res.status}`);
        const json = (await res.json()) as EvaluationApiResponse;
        setData(json);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load evaluation data');
      } finally {
        setLoading(false);
      }
    }
    void loadData();
  }, []);

  const manifest = data?.activeManifest;
  const metrics = manifest?.metrics;
  const labels = manifest?.denseLabelMap ?? manifest?.labels ?? [];
  const confusionMatrix = metrics?.confusionMatrix ?? [];
  const perGesture = metrics?.perGestureMetrics ?? [];

  const copyRevision = () => {
    if (manifest?.datasetRevision) {
      navigator.clipboard.writeText(manifest.datasetRevision);
      setCopiedHash(true);
      setTimeout(() => setCopiedHash(false), 2000);
    }
  };

  const exportJSON = () => {
    if (!data) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gesturebridge-evaluation-report-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportCSV = () => {
    if (!perGesture.length) return;
    let csv = 'Class Index,Gesture Name,Precision,Recall,F1-Score,Support\n';
    for (const g of perGesture) {
      csv += `${g.labelIndex},"${g.name}",${g.precision},${g.recall},${g.f1Score},${g.support}\n`;
    }
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gesturebridge-classification-report-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <ProtectedRoute requireAdmin>
      <main className="mx-auto max-w-6xl px-4 py-6 space-y-8">
        {/* Title Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-5">
          <div>
            <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2.5">
              <span className="w-3 h-3 rounded-full bg-cyan-400"></span>
              ML Evaluation & Reproducibility Dashboard
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              Verifiable model evaluation evidence with group-aware cross-validation, confusion matrices, and per-gesture F1 metrics.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={exportCSV}
              disabled={!perGesture.length}
              className="px-3.5 py-1.5 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 transition disabled:opacity-50"
            >
              Export CSV
            </button>
            <button
              onClick={exportJSON}
              disabled={!data}
              className="px-3.5 py-1.5 rounded-lg border border-cyan-500/50 bg-cyan-950/40 hover:bg-cyan-900/50 text-xs font-semibold text-cyan-200 transition disabled:opacity-50"
            >
              Export Full Report (JSON)
            </button>
          </div>
        </div>

        {loading ? (
          <div className="py-20 text-center text-slate-400 text-sm">
            <div className="animate-spin w-8 h-8 border-2 border-cyan-400 border-t-transparent rounded-full mx-auto mb-3" />
            Loading benchmark telemetry and model metadata...
          </div>
        ) : error ? (
          <div className="p-4 bg-rose-950/50 border border-rose-500/40 rounded-xl text-rose-300 text-sm">
            <div className="font-semibold mb-1">Failed to load evaluation metrics</div>
            <div>{error}</div>
          </div>
        ) : !manifest ? (
          <div className="p-8 text-center bg-slate-900 border border-slate-800 rounded-2xl text-slate-400 space-y-3">
            <div className="text-3xl">📊</div>
            <div className="text-slate-200 font-semibold">No active model evaluation manifest found</div>
            <p className="text-xs text-slate-400 max-w-md mx-auto">
              Train or evaluate a model first to generate reproducible benchmark evidence, confusion matrix heatmaps, and per-gesture scores.
            </p>
          </div>
        ) : (
          <>
            {/* Top Stat Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-sm">
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Validation Accuracy</span>
                <div className="text-2xl font-black text-cyan-400 mt-1 font-mono">
                  {metrics?.validationAccuracy != null
                    ? `${(metrics.validationAccuracy * 100).toFixed(1)}%`
                    : 'N/A'}
                </div>
                <span className="text-[11px] text-slate-500 mt-1 block">Group-stratified evaluation</span>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-sm">
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Macro F1 Score</span>
                <div className="text-2xl font-black text-emerald-400 mt-1 font-mono">
                  {metrics?.macroF1 != null
                    ? `${(metrics.macroF1 * 100).toFixed(1)}%`
                    : 'N/A'}
                </div>
                <span className="text-[11px] text-slate-500 mt-1 block">Unweighted class average</span>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-sm">
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Split Strategy</span>
                <div className="text-lg font-bold text-slate-200 mt-1 capitalize truncate">
                  {metrics?.splitStrategy ?? 'N/A'}
                </div>
                <span className="text-[11px] text-slate-500 mt-1 block">Partitioned by participant</span>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-sm">
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Model Version</span>
                <div className="text-lg font-bold text-slate-200 mt-1 font-mono truncate">
                  {manifest.version}
                </div>
                <span className="text-[11px] text-slate-500 mt-1 block">
                  {manifest.createdAt ? new Date(manifest.createdAt).toLocaleDateString() : 'Active'}
                </span>
              </div>
            </div>

            {/* Verifiable Dataset Hash Card */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs">
              <div className="space-y-1">
                <div className="font-semibold text-slate-300 flex items-center gap-1.5">
                  <span className="text-cyan-400">🔒</span>
                  <span>Verifiable Dataset Hash (Canonical SHA-256):</span>
                </div>
                <div className="font-mono text-cyan-300/90 break-all select-all">
                  {manifest.datasetRevision}
                </div>
              </div>
              <button
                onClick={copyRevision}
                className="px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200 transition font-medium self-start sm:self-auto shrink-0"
              >
                {copiedHash ? '✓ Copied' : 'Copy Hash'}
              </button>
            </div>

            {/* Grid: Confusion Matrix & Per-Gesture Metrics */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Confusion Matrix Heatmap */}
              <div className="lg:col-span-6 bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-bold text-slate-200">Confusion Matrix</h2>
                  <span className="text-[11px] text-slate-500 font-mono">
                    Rows: Actual · Cols: Predicted
                  </span>
                </div>

                {confusionMatrix.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-center border-collapse text-xs font-mono">
                      <thead>
                        <tr>
                          <th className="p-1.5 text-left text-slate-500 font-sans font-semibold">
                            Actual \ Pred
                          </th>
                          {labels.map((l) => (
                            <th key={l.labelIndex} className="p-1.5 text-slate-400 truncate max-w-16" title={l.name}>
                              {l.name.slice(0, 5)}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {confusionMatrix.map((row, rIdx) => {
                          const rowLabel = labels.find((l) => l.labelIndex === rIdx)?.name ?? `Class ${rIdx}`;
                          return (
                            <tr key={rIdx} className="border-t border-slate-800/80">
                              <td className="p-1.5 text-left font-sans text-slate-300 font-medium truncate max-w-24" title={rowLabel}>
                                {rowLabel}
                              </td>
                              {row.map((val, cIdx) => {
                                const isDiagonal = rIdx === cIdx;
                                const isError = !isDiagonal && val > 0;
                                return (
                                  <td
                                    key={cIdx}
                                    className={`p-2 rounded transition-colors ${
                                      isDiagonal && val > 0
                                        ? 'bg-cyan-500/20 text-cyan-200 font-bold'
                                        : isError
                                        ? 'bg-rose-500/25 text-rose-300 font-bold'
                                        : 'text-slate-600'
                                    }`}
                                  >
                                    {val}
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">No confusion matrix recorded in current manifest.</p>
                )}
              </div>

              {/* Per-Gesture Breakdown Table */}
              <div className="lg:col-span-6 bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-bold text-slate-200">Per-Gesture Performance</h2>
                  <span className="text-[11px] text-slate-500 font-mono">F1 & Support</span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400 font-semibold">
                        <th className="pb-2">Gesture</th>
                        <th className="pb-2 text-right">Precision</th>
                        <th className="pb-2 text-right">Recall</th>
                        <th className="pb-2 text-right">F1-Score</th>
                        <th className="pb-2 text-right">Support</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-mono">
                      {perGesture.map((g) => (
                        <tr key={g.labelIndex} className="hover:bg-slate-800/50">
                          <td className="py-2.5 font-sans font-medium text-slate-300">
                            {g.name}
                          </td>
                          <td className="py-2.5 text-right text-slate-200">
                            {(g.precision * 100).toFixed(1)}%
                          </td>
                          <td className="py-2.5 text-right text-slate-200">
                            {(g.recall * 100).toFixed(1)}%
                          </td>
                          <td className="py-2.5 text-right text-cyan-300 font-semibold">
                            {(g.f1Score * 100).toFixed(1)}%
                          </td>
                          <td className="py-2.5 text-right text-slate-500 font-sans">
                            {g.support}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Historical Evaluation Runs */}
            {data?.history && data.history.length > 0 && (
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-bold text-slate-200">Experiment Run History</h2>
                  <span className="text-[11px] text-slate-500 font-mono">MongoDB EvaluationRun Audit</span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs font-mono">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400 font-semibold">
                        <th className="pb-2">Model Version</th>
                        <th className="pb-2">Date</th>
                        <th className="pb-2">Strategy</th>
                        <th className="pb-2 text-right">Samples</th>
                        <th className="pb-2 text-right">Val Acc</th>
                        <th className="pb-2 text-right">Macro F1</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {data.history.map((run) => (
                        <tr key={run._id} className="hover:bg-slate-800/50">
                          <td className="py-2.5 text-slate-300 font-semibold truncate max-w-32">
                            {run.modelVersion}
                          </td>
                          <td className="py-2.5 text-slate-500">
                            {new Date(run.createdAt).toLocaleString()}
                          </td>
                          <td className="py-2.5 text-indigo-300">
                            {run.splitStrategy}
                          </td>
                          <td className="py-2.5 text-right text-slate-300">
                            {run.samplesCount}
                          </td>
                          <td className="py-2.5 text-right text-emerald-400 font-bold">
                            {(run.metrics.validationAccuracy * 100).toFixed(1)}%
                          </td>
                          <td className="py-2.5 text-right text-cyan-300 font-bold">
                            {(run.metrics.macroF1 * 100).toFixed(1)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </ProtectedRoute>
  );
}
