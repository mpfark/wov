import { describe, expect, it } from 'vitest';
import { shouldShowAttackControl } from './attack-control';

describe('Combat2 Attack control visibility', () => {
  it('is visible only for a living idle target while authoritative', () => {
    const show = (engaged: boolean, living = true, pending = false) => shouldShowAttackControl({
      authoritative: true, living, engaged, pending, legacyAvailable: false,
    });
    expect(show(false)).toBe(true);
    expect(show(true)).toBe(false);
    expect(show(false, true, true)).toBe(false);
    expect(show(false, false)).toBe(false);
  });

  it('preserves the existing legacy visibility decision', () => {
    expect(shouldShowAttackControl({ authoritative: false, living: true, engaged: true, pending: false, legacyAvailable: false })).toBe(false);
    expect(shouldShowAttackControl({ authoritative: false, living: true, engaged: false, pending: false, legacyAvailable: true })).toBe(true);
  });
});
