import { describe, it, expect } from 'vitest';
import {
  getEffectiveCombatMod,
  PROFILES,
  type EffectiveProfile,
} from '../effective';

const PROFILE_NAMES: EffectiveProfile[] = ['damage', 'burst', 'dot', 'utility', 'stacking'];
const TEST_MODS = [0, 5, 10, 15, 20, 25, 40, 60, 75, 100];

describe('getEffectiveCombatMod — soft scaling (no hard caps)', () => {
  it('passes through zero and negative modifiers unchanged for every profile', () => {
    for (const profile of PROFILE_NAMES) {
      expect(getEffectiveCombatMod(0, profile)).toBe(0);
      expect(getEffectiveCombatMod(-1, profile)).toBe(-1);
      expect(getEffectiveCombatMod(-5, profile)).toBe(-5);
    }
  });

  for (const profile of PROFILE_NAMES) {
    describe(`profile: ${profile}`, () => {
      const { softCap, postCapRate } = PROFILES[profile];

      it('returns raw mod at or below softCap', () => {
        for (const m of TEST_MODS.filter((m) => m > 0 && m <= softCap)) {
          expect(getEffectiveCombatMod(m, profile)).toBe(m);
        }
      });

      it('returns less than raw mod above softCap (no hard cap, never clamped)', () => {
        for (const m of TEST_MODS.filter((m) => m > softCap)) {
          const eff = getEffectiveCombatMod(m, profile);
          expect(eff).toBeLessThan(m);
          expect(eff).toBeGreaterThan(softCap); // still continues to grow
        }
      });

      it('is strictly monotonic across the test grid', () => {
        let prev = -Infinity;
        for (const m of TEST_MODS) {
          const eff = getEffectiveCombatMod(m, profile);
          expect(eff).toBeGreaterThan(prev);
          prev = eff;
        }
      });

      it('marginal gain above softCap equals postCapRate (reduced marginal gain)', () => {
        const a = getEffectiveCombatMod(softCap + 10, profile);
        const b = getEffectiveCombatMod(softCap + 11, profile);
        expect(b - a).toBeCloseTo(postCapRate, 10);
      });
    });
  }

  it('parity snapshot: representative value per profile', () => {
    // Locks the curve shape so accidental tuning drift fails CI.
    expect(getEffectiveCombatMod(40, 'damage')).toBeCloseTo(20 + 20 * 0.45, 10);
    expect(getEffectiveCombatMod(40, 'burst')).toBeCloseTo(18 + 22 * 0.40, 10);
    expect(getEffectiveCombatMod(40, 'dot')).toBeCloseTo(20 + 20 * 0.50, 10);
    expect(getEffectiveCombatMod(40, 'utility')).toBeCloseTo(12 + 28 * 0.30, 10);
    expect(getEffectiveCombatMod(40, 'stacking')).toBeCloseTo(10 + 30 * 0.25, 10);
  });
});
