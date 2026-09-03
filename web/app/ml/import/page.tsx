'use client';

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';

import ProtectedRoute from '@/components/ProtectedRoute';
import { useGestures } from '@/context/GestureContext';
import {
  parseImportDataset,
  type CsvLabelColumn,
  type ParsedImportSample,
} from '@/features/datasets/importParser';
import {
  importDataset,
  DatasetImportError,
  seedDataset,
  trainDatasetModel,
  type ImportDatasetResult,
} from '@/features/datasets/queries';

type Message = { type: 'error' | 'info' | 'success'; text: string };

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function ImportPageContent(): React.ReactElement {
  const { gestures, gestureLabels, refreshGestures } = useGestures();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [fileName, setFileName] = useState('');
  const [parsedSamples, setParsedSamples] = useState<ParsedImportSample[]>([]);
  const [invalidCount, setInvalidCount] = useState(0);
  const [unresolvedNames, setUnresolvedNames] = useState<string[]>([]);
  const [labelColumn, setLabelColumn] = useState<CsvLabelColumn>('last');
  const [message, setMessage] = useState<Message | null>(null);

  const saveMutation = useMutation({
    mutationFn: importDataset,
    onSuccess: async (result: ImportDatasetResult) => {
      await refreshGestures();
      setMessage({
        type: 'success',
        text: result.message ?? `Imported ${parsedSamples.length} samples atomically.`,
      });
    },
    onError: (error) => {
      if (error instanceof DatasetImportError && error.result.rejected?.[0]) {
        const firstRejected = error.result.rejected[0];
        setMessage({
          type: 'error',
          text: `${error.message} ${error.result.rejectedCount ?? 1} row(s) need attention. First: row ${firstRejected.index + 1}: ${firstRejected.reason}`,
        });
        return;
      }
      setMessage({ type: 'error', text: errorMessage(error, 'Dataset import failed.') });
    },
  });
  const seedMutation = useMutation({
    mutationFn: seedDataset,
    onSuccess: (result) => setMessage({
      type: 'success',
      text: result.message ?? `Seeded ${result.seededCount ?? 0} template samples.`,
    }),
    onError: (error) => setMessage({ type: 'error', text: errorMessage(error, 'Seeding failed.') }),
  });
  const trainMutation = useMutation({
    mutationFn: trainDatasetModel,
    onMutate: () => setMessage({ type: 'info', text: 'Training model on the server. This can take a minute.' }),
    onSuccess: (result) => setMessage({
      type: 'success',
      text: result.message ?? `Model trained on ${result.samplesCount ?? 'the available'} samples.`,
    }),
    onError: (error) => setMessage({ type: 'error', text: errorMessage(error, 'Training could not start.') }),
  });

  const labelCounts = useMemo(() => {
    const counts = new Map<number, number>();
    for (const sample of parsedSamples) {
      if (sample.label >= 0) counts.set(sample.label, (counts.get(sample.label) ?? 0) + 1);
    }
    return counts;
  }, [parsedSamples]);

  const clearFile = useCallback(() => {
    setFileName('');
    setParsedSamples([]);
    setInvalidCount(0);
    setUnresolvedNames([]);
    setMessage(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const processFile = useCallback((file: File) => {
    setFileName(file.name);
    setParsedSamples([]);
    setInvalidCount(0);
    setUnresolvedNames([]);
    setMessage(null);
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') return;
      try {
        const parsed = parseImportDataset(reader.result, file.name, gestures, labelColumn);
        setParsedSamples(parsed.samples);
        setInvalidCount(parsed.invalidCount);
        setUnresolvedNames(parsed.unresolvedNames);
        setMessage({
          type: parsed.unresolvedNames.length > 0 ? 'info' : 'success',
          text: parsed.unresolvedNames.length > 0
            ? `Parsed ${parsed.samples.length} samples. Confirm the new named labels before importing.`
            : `Parsed ${parsed.samples.length} valid samples. Skipped ${parsed.invalidCount} invalid rows.`,
        });
      } catch (error) {
        setMessage({ type: 'error', text: `Could not parse ${file.name}: ${errorMessage(error, 'Unknown error')}` });
      }
    };
    reader.onerror = () => setMessage({ type: 'error', text: `Could not read ${file.name}.` });
    reader.readAsText(file);
  }, [gestures, labelColumn]);

  const handleDrop = (event: React.DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setDragActive(false);
    const [file] = event.dataTransfer.files;
    if (file) processFile(file);
  };

  const handleSave = (): void => {
    if (parsedSamples.length === 0 || saveMutation.isPending) return;
    setMessage(null);
    saveMutation.mutate(parsedSamples);
  };

  return (
    <main className="import-page">
      <header className="import-header">
        <p className="import-eyebrow">Training data</p>
        <h1 className="import-title">Import gesture dataset</h1>
        <p className="import-subtitle">Load 63-coordinate hand-landmark samples into the active training corpus.</p>
      </header>

      <section className="import-seed-card" aria-label="Seed default gesture data">
        <div>
          <h2>Quick start: seed default gestures</h2>
          <p>Populate the local database with 180 synthetic examples, then train a first model.</p>
        </div>
        <button
          type="button"
          className="btn btn-accent"
          disabled={seedMutation.isPending || trainMutation.isPending}
          onClick={() => seedMutation.mutate()}
        >
          {seedMutation.isPending ? 'Seeding…' : 'Seed template data'}
        </button>
      </section>

      <section
        className={`import-drop-zone${dragActive ? ' is-active' : ''}`}
        onDragEnter={(event) => { event.preventDefault(); setDragActive(true); }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
      >
        <input
          ref={fileInputRef}
          className="sr-only"
          id="dataset-file"
          type="file"
          accept=".json,.csv"
          onChange={(event) => {
            const [file] = event.target.files ?? [];
            if (file) processFile(file);
          }}
        />
        {!fileName ? (
          <label className="import-drop-label" htmlFor="dataset-file">
            <span aria-hidden="true" className="import-drop-icon">📂</span>
            <span className="import-drop-title">Drop a JSON or CSV dataset here</span>
            <span className="import-drop-detail">or choose a file from your computer</span>
          </label>
        ) : (
          <div className="import-file-summary">
            <span aria-hidden="true" className="import-drop-icon">✓</span>
            <strong>{fileName}</strong>
            <span>{parsedSamples.length} valid samples parsed</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={clearFile}>Choose another file</button>
          </div>
        )}
      </section>

      {!fileName && (
        <section className="import-csv-options" aria-label="CSV label column">
          <div>
            <h2>CSV label column</h2>
            <p>Choose where each row stores its gesture label.</p>
          </div>
          <div className="import-option-list">
            {(['last', 'first', 'auto'] as const).map((option) => (
              <button
                type="button"
                key={option}
                className={`import-option${labelColumn === option ? ' is-selected' : ''}`}
                aria-pressed={labelColumn === option}
                onClick={() => setLabelColumn(option)}
              >
                {option === 'last' ? 'Last column' : option === 'first' ? 'First column' : 'Auto detect'}
              </button>
            ))}
          </div>
        </section>
      )}

      {message && (
        <div className={`alert import-message alert-${message.type}`} role="status">
          {message.text}
        </div>
      )}

      {unresolvedNames.length > 0 && (
        <section className="import-unresolved" aria-label="New labels to confirm">
          <h2>New labels need confirmation</h2>
          <p>Parsing did not change the database. Saving resolves or creates these exact names and imports every sample in one transaction.</p>
          <p className="import-unresolved-names">{unresolvedNames.join(', ')}</p>
        </section>
      )}

      {parsedSamples.length > 0 && (
        <div className="import-results">
          <section className="import-action-card">
            <div>
              <h2>Import workspace</h2>
              <p>Save this dataset, then retrain the active model.</p>
            </div>
            <div className="import-actions">
              <button type="button" className="btn btn-primary" disabled={saveMutation.isPending} onClick={handleSave}>
                {saveMutation.isPending ? 'Saving…' : unresolvedNames.length > 0 ? 'Confirm labels & save' : 'Save to database'}
              </button>
              <button type="button" className="btn btn-success" disabled={trainMutation.isPending} onClick={() => trainMutation.mutate()}>
                {trainMutation.isPending ? 'Training…' : 'Train AI model'}
              </button>
            </div>
          </section>

          <section>
            <h2 className="import-section-title">Class distribution</h2>
            <div className="stat-grid">
              {gestureLabels.map((label, index) => {
                const count = labelCounts.get(index) ?? 0;
                const percentage = ((count / parsedSamples.length) * 100).toFixed(1);
                return (
                  <div className="stat-card" key={`${index}-${label}`}>
                    <span className="stat-card-label">{label}</span>
                    <strong className="stat-card-value">{count}</strong>
                    <span className="import-stat-detail">{percentage}% of data</span>
                  </div>
                );
              })}
              {unresolvedNames.map((name) => {
                const count = parsedSamples.filter((sample) => sample.rawStringLabel === name).length;
                return (
                  <div className="stat-card" key={name}>
                    <span className="stat-card-label">{name}</span>
                    <strong className="stat-card-value">{count}</strong>
                    <span className="import-stat-detail">new label</span>
                  </div>
                );
              })}
            </div>
          </section>

          {invalidCount > 0 && (
            <div className="alert alert-warning" role="status">
              {invalidCount} row{invalidCount === 1 ? '' : 's'} were skipped because coordinates or labels were invalid.
            </div>
          )}

          <section>
            <h2 className="import-section-title">Preview</h2>
            <div className="import-table-wrap">
              <table className="import-table">
                <thead><tr><th>Row</th><th>First five coordinates</th><th>Label</th></tr></thead>
                <tbody>
                  {parsedSamples.slice(0, 5).map((sample, index) => (
                    <tr key={`${sample.label}-${index}`}>
                      <td>{index + 1}</td>
                      <td><code>[{sample.features.slice(0, 5).map((value) => value.toFixed(4)).join(', ')}, …]</code></td>
                      <td><span className="import-label-chip">{sample.rawStringLabel ?? gestureLabels[sample.label] ?? `Label ${sample.label}`}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

export default function ImportPage(): React.ReactElement {
  return <ProtectedRoute requireAdmin><ImportPageContent /></ProtectedRoute>;
}
