import { describe, expect, it } from 'vitest';
import { isControlMode } from '../features/control/modes';

describe('control modes', () => {
  it('accepts the supported first-class modes', () => {
    expect(isControlMode('recognition')).toBe(true);
    expect(isControlMode('mouse-control')).toBe(true);
    expect(isControlMode('mirror')).toBe(true);
  });

  it('rejects unsupported values', () => {
    expect(isControlMode('mouse')).toBe(false);
    expect(isControlMode(null)).toBe(false);
  });
});
