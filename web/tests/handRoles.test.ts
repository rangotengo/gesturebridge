import { describe, expect, it } from 'vitest';

import { assignHandRoles } from '../hooks/useHandRoles';

describe('assignHandRoles', () => {
  it('returns no roles when no hand is detected', () => {
    expect(assignHandRoles([])).toEqual({ dominantHand: null, modifierHand: null });
  });

  it.each(['Left', 'Right'] as const)('treats one %s hand as dominant', (hand) => {
    expect(assignHandRoles([hand])).toEqual({ dominantHand: 0, modifierHand: null });
  });

  it('uses already mirror-corrected user-perspective handedness', () => {
    expect(assignHandRoles(['Left', 'Right'])).toEqual({ dominantHand: 1, modifierHand: 0 });
    expect(assignHandRoles(['Right', 'Left'])).toEqual({ dominantHand: 0, modifierHand: 1 });
  });

  it('falls back to one dominant hand when both labels are Left', () => {
    expect(assignHandRoles(['Left', 'Left'])).toEqual({ dominantHand: 1, modifierHand: null });
  });

  it('does not invent a modifier when both labels are Right', () => {
    expect(assignHandRoles(['Right', 'Right'])).toEqual({ dominantHand: 1, modifierHand: null });
  });
});
