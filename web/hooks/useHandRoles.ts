import { Handedness } from '@/ml/gestureUtils';

/**
 * Assigns dominant and modifier hand roles from detected multiHandedness list.
 * Handedness labels passed here are already corrected to the user's perspective
 * by useMediaPipe.
 * Treats a single detected hand as dominant regardless of raw label.
 * When multiple hands are detected, honors preferredDominantHand ('Left' | 'Right' | 'Auto').
 */
export function assignHandRoles(
  multiHandedness: Handedness[],
  preferredDominantHand: 'Left' | 'Right' | 'Auto' = 'Right'
): { dominantHand: number | null; modifierHand: number | null } {
  if (multiHandedness.length === 0) {
    return { dominantHand: null, modifierHand: null };
  }

  if (multiHandedness.length === 1) {
    // If only one hand is detected, treat it as the dominant hand
    return { dominantHand: 0, modifierHand: null };
  }

  const targetDominant = preferredDominantHand === 'Left' ? 'Left' : 'Right';
  let dominantHand: number | null = null;
  let modifierHand: number | null = null;

  for (let i = 0; i < multiHandedness.length; i++) {
    const handedness = multiHandedness[i];
    const isDominant = handedness === targetDominant;

    if (isDominant) {
      dominantHand = i;
    } else {
      modifierHand = i;
    }
  }

  // Fallbacks in case assignment was ambiguous or both had same label
  if (dominantHand === null && modifierHand !== null) {
    dominantHand = modifierHand;
    modifierHand = null;
  }

  return { dominantHand, modifierHand };
}
