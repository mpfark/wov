import { describe, it, expect } from 'vitest';
import { bondMultiplier, bondGainForKill } from '@/shared/formulas/bond';

describe('bondMultiplier', () => {
  it('returns 1.00 at 0 bond', () => {
    expect(bondMultiplier(0)).toBe(1);
  });
  it('returns 1.15 at 100 bond', () => {
    expect(bondMultiplier(100)).toBeCloseTo(1.15, 5);
  });
  it('clamps negative and overshoot', () => {
    expect(bondMultiplier(-50)).toBe(1);
    expect(bondMultiplier(500)).toBeCloseTo(1.15, 5);
    expect(bondMultiplier(null)).toBe(1);
    expect(bondMultiplier(undefined)).toBe(1);
  });
  it('scales linearly between 0 and 100', () => {
    expect(bondMultiplier(50)).toBeCloseTo(1.075, 5);
  });
});

describe('bondGainForKill', () => {
  it('floors at 1', () => {
    expect(bondGainForKill(1, false)).toBe(1);
  });
  it('bosses get +5', () => {
    expect(bondGainForKill(10, true)).toBe(10); // round(5 + 5) = 10
  });
  it('caps at 25', () => {
    expect(bondGainForKill(100, true)).toBe(25);
  });
});
