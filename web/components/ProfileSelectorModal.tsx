'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  GestureProfile,
  PRESET_PROFILES,
  AVAILABLE_ACTIONS,
  GestureActionType,
  loadActiveProfile,
  saveActiveProfile,
  validateProfileMappings,
} from '@/lib/gestureProfiles';

const GESTURE_NAMES: Record<number, string> = {
  0: 'Pointing (Index Out)',
  1: 'Fist (Closed Hand)',
  2: 'Peace (V-Sign)',
  3: 'Open Palm (All Fingers)',
  4: 'Rock (Horns)',
  5: 'Thumb (Thumbs Up)',
};

interface ProfileSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentRecognizedLabel?: number | null;
  gestureLabels?: string[];
}

export default function ProfileSelectorModal({
  isOpen,
  onClose,
  currentRecognizedLabel = null,
  gestureLabels,
}: ProfileSelectorModalProps): React.JSX.Element | null {
  const [selectedPresetId, setSelectedPresetId] = useState<string>(() => loadActiveProfile().id);
  const [customMappings, setCustomMappings] = useState<Record<number, GestureActionType>>(() => ({
    ...loadActiveProfile().mappings,
  }));
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);

  // Sync state whenever modal opens
  useEffect(() => {
    if (isOpen) {
      const active = loadActiveProfile();
      setSelectedPresetId(active.id);
      setCustomMappings({ ...active.mappings });
      setFeedbackMessage(null);
    }
  }, [isOpen]);

  const handleCancel = useCallback(() => {
    const active = loadActiveProfile();
    setSelectedPresetId(active.id);
    setCustomMappings({ ...active.mappings });
    setFeedbackMessage(null);
    onClose();
  }, [onClose]);

  // Handle Escape key dismissal
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        handleCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleCancel]);

  const validationWarnings = useMemo(() => {
    return validateProfileMappings(customMappings).warnings;
  }, [customMappings]);

  const gestureEntries = useMemo(() => {
    if (gestureLabels && gestureLabels.length > 0) {
      return gestureLabels.map((name, index) => ({
        labelIndex: index,
        name: GESTURE_NAMES[index] ?? `${name} (Custom)`,
      }));
    }
    return Object.entries(GESTURE_NAMES).map(([rawLabel, name]) => ({
      labelIndex: Number(rawLabel),
      name,
    }));
  }, [gestureLabels]);

  if (!isOpen) return null;

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      handleCancel();
    }
  };

  const handleSelectPreset = (presetId: string) => {
    setSelectedPresetId(presetId);
    if (presetId !== 'custom') {
      const preset = PRESET_PROFILES[presetId];
      if (preset) {
        setCustomMappings({ ...preset.mappings });
      }
    }
  };

  const handleMappingChange = (labelIndex: number, newAction: GestureActionType) => {
    setSelectedPresetId('custom');
    setCustomMappings((prev) => ({
      ...prev,
      [labelIndex]: newAction,
    }));
  };

  const handleApply = () => {
    const profileToSave: GestureProfile =
      selectedPresetId !== 'custom' && PRESET_PROFILES[selectedPresetId]
        ? PRESET_PROFILES[selectedPresetId]
        : {
            id: 'custom',
            name: 'Custom Profile',
            description: 'User-configured gesture mappings',
            mappings: customMappings,
          };

    saveActiveProfile(profileToSave);
    setFeedbackMessage('Profile applied successfully!');
    setTimeout(() => {
      setFeedbackMessage(null);
      onClose();
    }, 700);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="profile-selector-title"
      onClick={handleBackdropClick}
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-fade-in"
    >
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/80">
          <div>
            <h2 id="profile-selector-title" className="text-xl font-bold text-slate-100 flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-indigo-400"></span>
              Gesture-to-Action Profiles
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Choose an action profile or customize gesture assignments with conflict prevention.
            </p>
          </div>
          <button
            type="button"
            onClick={handleCancel}
            aria-label="Close profile selector dialog"
            className="text-slate-400 hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-800 transition"
          >
            ✕
          </button>
        </div>

        {/* Preset Selector Bar */}
        <div className="p-6 pb-2 border-b border-slate-800 space-y-3">
          <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Select Preset Profile
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {[
              { id: 'default', label: 'Productivity' },
              { id: 'presentation', label: 'Presentation' },
              { id: 'accessibility', label: 'Single-Hand' },
              { id: 'custom', label: 'Custom' },
            ].map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => handleSelectPreset(preset.id)}
                className={`py-2 px-3 rounded-xl border text-xs font-semibold transition ${
                  selectedPresetId === preset.id
                    ? 'bg-indigo-950/70 border-indigo-500 text-indigo-200 shadow-sm'
                    : 'bg-slate-800 border-slate-700/80 text-slate-300 hover:bg-slate-700'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        {/* Conflict warnings banner */}
        {validationWarnings.length > 0 && (
          <div className="mx-6 mt-4 p-3 bg-amber-950/60 border border-amber-500/40 rounded-xl space-y-1 text-xs text-amber-200">
            <div className="font-semibold flex items-center gap-1.5">
              <span>⚠️</span> Configuration Warning:
            </div>
            {validationWarnings.map((w, i) => (
              <p key={i} className="pl-5 text-amber-300/90">• {w}</p>
            ))}
          </div>
        )}

        {/* Action Mapping Table */}
        <div className="p-6 overflow-y-auto space-y-3 flex-1">
          <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
            Gesture Assignment Mappings
          </label>

          <div className="space-y-2">
            {gestureEntries.map(({ labelIndex, name }) => {
              const mappedAction = customMappings[labelIndex] ?? 'none';
              const isCurrentlyActive = currentRecognizedLabel === labelIndex;

              return (
                <div
                  key={labelIndex}
                  className={`flex flex-col sm:flex-row sm:items-center justify-between p-3 rounded-xl border transition ${
                    isCurrentlyActive
                      ? 'bg-cyan-950/30 border-cyan-500/60 ring-1 ring-cyan-500/30'
                      : 'bg-slate-950/40 border-slate-800'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-2 sm:mb-0">
                    <span className="font-mono text-xs text-slate-500 w-5">#{labelIndex}</span>
                    <div>
                      <span className="text-sm font-medium text-slate-200">{name}</span>
                      {isCurrentlyActive && (
                        <span className="ml-2 px-1.5 py-0.5 text-[10px] font-semibold bg-cyan-500/20 text-cyan-300 rounded border border-cyan-500/30">
                          Active Live
                        </span>
                      )}
                    </div>
                  </div>

                  <select
                    value={mappedAction}
                    onChange={(e) =>
                      handleMappingChange(labelIndex, e.target.value as GestureActionType)
                    }
                    className="bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    {AVAILABLE_ACTIONS.map((action) => (
                      <option key={action.type} value={action.type}>
                        {action.label} ({action.category})
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>

          {feedbackMessage && (
            <div className="p-3 bg-emerald-950/50 border border-emerald-500/40 rounded-xl text-emerald-300 text-xs text-center animate-fade-in">
              ✓ {feedbackMessage}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-slate-800 bg-slate-900 flex items-center justify-between">
          <div className="text-xs text-slate-400">
            Selected: <span className="text-slate-200 font-semibold">{selectedPresetId}</span>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleCancel}
              className="px-4 py-2 rounded-xl text-xs font-medium text-slate-300 hover:bg-slate-800 transition"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleApply}
              className="px-5 py-2 rounded-xl text-xs font-semibold bg-indigo-500 hover:bg-indigo-400 text-white shadow-md shadow-indigo-500/20 transition"
            >
              Apply Profile
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
