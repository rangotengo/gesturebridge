export type GestureActionType =
  | 'pointer_move'
  | 'left_click'
  | 'right_click'
  | 'middle_click'
  | 'drag_hold'
  | 'scroll_up'
  | 'scroll_down'
  | 'zoom_in'
  | 'zoom_out'
  | 'freeze_cursor'
  | 'none';

export interface ActionDefinition {
  type: GestureActionType;
  label: string;
  description: string;
  category: 'mouse' | 'scroll' | 'zoom' | 'system';
}

export const AVAILABLE_ACTIONS: ActionDefinition[] = [
  { type: 'pointer_move', label: 'Move Cursor', description: 'Tracks dominant index fingertip to move OS cursor', category: 'mouse' },
  { type: 'left_click', label: 'Left Click', description: 'Primary single click', category: 'mouse' },
  { type: 'right_click', label: 'Right Click', description: 'Context menu click', category: 'mouse' },
  { type: 'middle_click', label: 'Middle Click', description: 'Middle wheel click', category: 'mouse' },
  { type: 'drag_hold', label: 'Drag & Drop (Hold)', description: 'Holds left mouse button while active', category: 'mouse' },
  { type: 'scroll_up', label: 'Scroll Up', description: 'Emits vertical scroll up pulses', category: 'scroll' },
  { type: 'scroll_down', label: 'Scroll Down', description: 'Emits vertical scroll down pulses', category: 'scroll' },
  { type: 'zoom_in', label: 'Zoom In', description: 'Magnifies viewport or document', category: 'zoom' },
  { type: 'zoom_out', label: 'Zoom Out', description: 'Reduces viewport magnification', category: 'zoom' },
  { type: 'freeze_cursor', label: 'Pause / Freeze Pointer', description: 'Temporarily locks cursor in place', category: 'system' },
  { type: 'none', label: 'Disabled', description: 'No action performed', category: 'system' },
];

export interface GestureProfile {
  id: string;
  name: string;
  description: string;
  mappings: Record<number, GestureActionType>;
}

export const PRESET_PROFILES: Record<string, GestureProfile> = {
  default: {
    id: 'default',
    name: 'Default Productivity',
    description: 'Standard desktop navigation with pointing, peace right-click, and rock/fist scrolling',
    mappings: {
      0: 'pointer_move',
      1: 'scroll_down',
      2: 'right_click',
      3: 'freeze_cursor',
      4: 'scroll_up',
      5: 'left_click',
    },
  },
  presentation: {
    id: 'presentation',
    name: 'Presentation & Media',
    description: 'Optimized for slides and media with zoom and scrolling controls',
    mappings: {
      0: 'pointer_move',
      1: 'none',
      2: 'zoom_in',
      3: 'freeze_cursor',
      4: 'scroll_up',
      5: 'left_click',
    },
  },
  accessibility: {
    id: 'accessibility',
    name: 'Single-Hand Accessibility',
    description: 'Enables single-handed drag-and-drop and full mouse navigation',
    mappings: {
      0: 'pointer_move',
      1: 'drag_hold',
      2: 'right_click',
      3: 'freeze_cursor',
      4: 'middle_click',
      5: 'left_click',
    },
  },
};

const PROFILE_STORAGE_KEY = 'gesturebridge_active_profile_v1';
const CUSTOM_PROFILE_STORAGE_KEY = 'gesturebridge_custom_profile_v1';

export function loadActiveProfile(): GestureProfile {
  if (typeof window === 'undefined') return { ...PRESET_PROFILES.default };
  try {
    const rawCustom = localStorage.getItem(CUSTOM_PROFILE_STORAGE_KEY);
    const customProfile: GestureProfile | null = rawCustom ? JSON.parse(rawCustom) : null;

    const activeId = localStorage.getItem(PROFILE_STORAGE_KEY) || 'default';
    if (activeId === 'custom' && customProfile) {
      return customProfile;
    }
    return PRESET_PROFILES[activeId] ?? { ...PRESET_PROFILES.default };
  } catch {
    return { ...PRESET_PROFILES.default };
  }
}

export function saveActiveProfile(profile: GestureProfile): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(PROFILE_STORAGE_KEY, profile.id);
    if (profile.id === 'custom') {
      localStorage.setItem(CUSTOM_PROFILE_STORAGE_KEY, JSON.stringify(profile));
    }
    window.dispatchEvent(new CustomEvent('gesturebridge:profile-updated', { detail: profile }));
  } catch (err) {
    console.error('Failed to save gesture profile:', err);
  }
}

export function validateProfileMappings(
  mappings: Record<number, GestureActionType>
): { isValid: boolean; warnings: string[] } {
  const warnings: string[] = [];
  const actionCounts = new Map<GestureActionType, number>();

  for (const action of Object.values(mappings)) {
    if (action === 'none') continue;
    actionCounts.set(action, (actionCounts.get(action) ?? 0) + 1);
  }

  if (!Object.values(mappings).includes('pointer_move')) {
    warnings.push('No gesture is mapped to "Move Cursor". Pointer movement will be disabled.');
  }

  if ((actionCounts.get('pointer_move') ?? 0) > 1) {
    warnings.push('Multiple gestures are mapped to "Move Cursor", which may cause conflicting pointer jumps.');
  }

  return {
    isValid: warnings.length === 0,
    warnings,
  };
}
