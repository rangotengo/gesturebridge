'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import ProtectedRoute from '@/components/ProtectedRoute';
import WebcamView from '@/components/WebcamView';
import { useGestures } from '@/context/GestureContext';
import { normalizeLandmarks, type HandData } from '@/ml/gestureUtils';
import { saveCollectedSamples, trainDatasetModel, type CollectedSample } from '@/features/datasets/queries';

type Message = { type: 'error' | 'info' | 'success'; text: string };

function toMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function CollectPageContent(): React.ReactElement {
  const { gestureLabels, isLoading: isGesturesLoading } = useGestures();

  const [hands, setHands] = useState<HandData[]>([]);
  const [selectedHand, setSelectedHand] = useState<'Left' | 'Right' | 'First'>('First');
  const [selectedGesture, setSelectedGesture] = useState('Pointing');
  const [samples, setSamples] = useState<CollectedSample[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [message, setMessage] = useState<Message | null>(null);

  const saveMutation = useMutation({
    mutationFn: saveCollectedSamples,
    onSuccess: (result) => {
      const accepted = result.acceptedCount ?? samples.length;
      const rejected = result.rejectedCount ?? 0;
      if (rejected > 0) {
        setMessage({
          type: 'info',
          text: `Saved ${accepted} samples. ${rejected} invalid samples retained for review.`,
        });
        const rejectedIndices = new Set(
          result.rejectedIndices ?? result.rejected?.map((r) => r.index) ?? []
        );
        setSamples((prev) => {
          const retained = prev.filter((_, idx) => rejectedIndices.has(idx));
          const newCounts: Record<string, number> = {};
          for (const s of retained) {
            const name = gestureLabels[s.label] ?? `Gesture ${s.label}`;
            newCounts[name] = (newCounts[name] || 0) + 1;
          }
          setCounts(newCounts);
          return retained;
        });
      } else {
        setMessage({ type: 'success', text: result.message ?? `Saved ${accepted} samples successfully.` });
        setSamples([]);
        setCounts({});
      }
    },
    onError: (error) => setMessage({ type: 'error', text: toMessage(error, 'Could not save samples.') }),
  });
  const trainMutation = useMutation({
    mutationFn: trainDatasetModel,
    onMutate: () => setMessage({ type: 'info', text: 'Training model on the server. This may take a minute.' }),
    onSuccess: (result) => setMessage({ type: 'success', text: result.message ?? 'Model training completed successfully.' }),
    onError: (error) => setMessage({ type: 'error', text: toMessage(error, 'Could not train the model.') }),
  });

  const activeSelectedGesture = gestureLabels.includes(selectedGesture)
    ? selectedGesture
    : (gestureLabels[0] ?? '');

  const recordSample = useCallback((): void => {
    if (hands.length === 0 || !gestureLabels) return;

    let targetHand: HandData | undefined;
    if (selectedHand === 'First') {
      targetHand = hands[0];
    } else {
      targetHand = hands.find(h => h.handedness === selectedHand);
    }

    if (!targetHand) {
      setMessage({
        type: 'error',
        text: `No ${selectedHand === 'First' ? 'hand' : selectedHand + ' hand'} detected in frame!`
      });
      return;
    }

    const normalized = normalizeLandmarks(targetHand.landmarks);
    const labelIndex = gestureLabels.indexOf(activeSelectedGesture);
    if (labelIndex === -1) return;

    setSamples(prev => [...prev, { features: normalized, label: labelIndex }]);
    setCounts(prev => ({ ...prev, [activeSelectedGesture]: (prev[activeSelectedGesture] || 0) + 1 }));
    setMessage({
      type: 'success',
      text: `Captured landmark sample for "${activeSelectedGesture}" using ${targetHand.handedness} hand! Count: ${(counts[activeSelectedGesture] || 0) + 1}`,
    });
  }, [hands, selectedHand, gestureLabels, activeSelectedGesture, counts]);

  // Ref to always hold the latest recordSample function for keyboard capture
  const recordSampleRef = useRef(recordSample);
  useEffect(() => {
    recordSampleRef.current = recordSample;
  }, [recordSample]);

  // Support Spacebar for capturing sample
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Support spacebar only if not typing in inputs
      if (e.code === 'Space') {
        const activeEl = document.activeElement;
        if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'SELECT')) {
          return;
        }
        e.preventDefault();
        recordSampleRef.current();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  return (
    <div className="collector-page">
      <header className="collector-header">
        <h1 className="collector-title">Gesture Data Collector</h1>
        <p className="collector-subtitle">
          Record hand landmark samples, save them to the dataset, then train the model.
        </p>
      </header>

      <div className="collector-workspace">
        <div className="collector-camera relative aspect-video min-h-0">
          <WebcamView onLandmarksUpdate={setHands} layout="embedded" />
        </div>

        <aside className="collector-panel" aria-label="Collection controls">
          <header className="collector-panel-header">
            <h2 className="collector-panel-title">Collect samples</h2>
            <p className="collector-panel-subtitle">
              Hold a pose, then record. Press Space to capture.
            </p>
          </header>

          <div className="collector-panel-body">
            <div className="collector-section">
              <label className="collector-label" htmlFor="collect-hand">
                Capture hand
              </label>
              <select
                id="collect-hand"
                value={selectedHand}
                onChange={(e) => setSelectedHand(e.target.value as 'Left' | 'Right' | 'First')}
                className="collector-select"
              >
                <option value="First">First Detected Hand</option>
                <option value="Left">Left Hand Only</option>
                <option value="Right">Right Hand Only</option>
              </select>
            </div>

            <div className="collector-section">
              <label className="collector-label" htmlFor="collect-gesture">
                Select gesture
                {isGesturesLoading && <span className="normal-case font-medium tracking-normal"> · loading…</span>}
              </label>
              <select
                id="collect-gesture"
                value={activeSelectedGesture}
                onChange={(e) => setSelectedGesture(e.target.value)}
                className="collector-select"
              >
                {gestureLabels.map((label) => (
                  <option key={label} value={label}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            {(() => {
              const isHandActive =
                selectedHand === 'First'
                  ? hands.length > 0
                  : hands.some((h) => h.handedness === selectedHand);
              return (
                <button
                  type="button"
                  onClick={recordSample}
                  disabled={!isHandActive}
                  className={`collector-record ${isHandActive ? 'is-ready' : 'is-idle'}`}
                >
                  Record Sample
                </button>
              );
            })()}

            <div className="collector-section">
              <p className="collector-label">Session samples</p>
              <div className="collector-counts">
                {gestureLabels.map((label) => (
                  <div
                    key={label}
                    className={`collector-count-item${activeSelectedGesture === label ? ' is-active' : ''}`}
                  >
                    <span className="collector-count-name">{label}</span>
                    <span className="collector-count-badge">{counts[label] || 0}</span>
                  </div>
                ))}
              </div>
            </div>

            {message && (
              <div
                className={[
                  'alert collector-message',
                  message.type === 'error' ? 'alert-error'
                    : message.type === 'success' ? 'alert-success'
                    : 'alert-info',
                ].join(' ')}
                role="status"
              >
                {message.text}
              </div>
            )}
          </div>

          <footer className="collector-panel-footer">
            <div className="collector-actions">
              <button
                type="button"
                onClick={() => { setMessage(null); saveMutation.mutate(samples); }}
                disabled={saveMutation.isPending || samples.length === 0}
                className="collector-btn-save"
              >
                {saveMutation.isPending ? 'Saving…' : `Save ${samples.length} Samples`}
              </button>
              <button
                type="button"
                onClick={() => trainMutation.mutate()}
                disabled={trainMutation.isPending}
                className="collector-btn-train"
              >
                {trainMutation.isPending ? 'Training…' : 'Train AI Model'}
              </button>
            </div>
          </footer>
        </aside>
      </div>

      <section className="collector-guide" aria-label="How to collect data">
        <h3 className="collector-guide-title">How to collect data</h3>
        <div className="collector-steps">
          <div className="collector-step">
            <span className="collector-step-num">1</span>
            <span className="collector-step-text">Pick the gesture you want to record.</span>
          </div>
          <div className="collector-step">
            <span className="collector-step-num">2</span>
            <span className="collector-step-text">Hold the pose clearly in front of the camera.</span>
          </div>
          <div className="collector-step">
            <span className="collector-step-num">3</span>
            <span className="collector-step-text">Wait for the hand skeleton overlay to lock on.</span>
          </div>
          <div className="collector-step">
            <span className="collector-step-num">4</span>
            <span className="collector-step-text">
              Click Record Sample or press <strong>Space</strong>.
            </span>
          </div>
          <div className="collector-step">
            <span className="collector-step-num">5</span>
            <span className="collector-step-text">Aim for 200+ samples per gesture, then save and train.</span>
          </div>
        </div>
      </section>
    </div>
  );
}

export default function CollectPage(): React.ReactElement {
  return (
    <ProtectedRoute requireAdmin>
      <CollectPageContent />
    </ProtectedRoute>
  );
}
