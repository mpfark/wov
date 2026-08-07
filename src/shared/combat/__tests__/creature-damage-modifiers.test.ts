/**
 * Chilled / target-side incoming-damage modifiers.
 *
 * Eligibility, percent and duration are owned by the reusable applied-status
 * definition; these tests pin the runtime rules that must never drift:
 * - same key never stacks, distinct keys add
 * - reflected/self/environment damage is never amplified
 * - duration is a COMBAT-TICK COUNT, with a half-tick jitter margin that can
 *   never grant an extra tick
 */
import { describe, it, expect } from 'vitest';
import {
  amplify,
  applyCreatureDamageModifiers,
  buildAmpSnapshot,
  expiryFromTicks,
  isDamageAmpStatus,
  isPeriodicStatus,
  resolveAmpPct,
  type DamageAmpStatusDef,
} from '../creature-damage-modifiers';

const TICK = 2000;

const chilled: DamageAmpStatusDef = {
  key: 'chilled',
  effect_type: 'chilled',
  classification: 'damage_amp',
  modifier: {
    kind: 'damage_taken_pct',
    value: 10,
    eligible_sources: ['weapon', 'ability', 'stance', 'dot', 'proc'],
  },
};

const poison: DamageAmpStatusDef = {
  key: 'poison',
  effect_type: 'poison',
  classification: 'dot',
  modifier: null,
};

const defs = { chilled: chilled, poison } as Record<string, DamageAmpStatusDef>;

describe('status classification', () => {
  it('recognises damage-amp and periodic statuses distinctly', () => {
    expect(isDamageAmpStatus(chilled)).toBe(true);
    expect(isPeriodicStatus(chilled)).toBe(false);
    expect(isDamageAmpStatus(poison)).toBe(false);
    expect(isPeriodicStatus(poison)).toBe(true);
  });
});

describe('expiryFromTicks', () => {
  it('covers exactly N ticks plus a half-tick jitter margin', () => {
    const started = 10_000;
    const expires = expiryFromTicks(started, 3, TICK);
    expect(expires).toBe(10_000 + 3 * TICK + TICK / 2);
    // Ticks 1..3 land inside the window; tick 4 does not.
    for (const n of [1, 2, 3]) expect(started + n * TICK < expires).toBe(true);
    expect(started + 4 * TICK < expires).toBe(false);
  });
});

describe('buildAmpSnapshot', () => {
  const eff = { target_id: 'cr1', effect_type: 'chilled', started_at: 10_000, expires_at: expiryFromTicks(10_000, 3, TICK) };

  it('excludes the application instant so the applying hit is never amplified twice', () => {
    // Snapshot frozen BEFORE application has no instance at all.
    expect(buildAmpSnapshot([], defs, 10_000)['cr1']).toBeUndefined();
    // From the next tick on it is active.
    expect(buildAmpSnapshot([eff], defs, 12_000)['cr1']).toHaveLength(1);
  });

  it('is inactive before started_at and at/after expires_at', () => {
    expect(buildAmpSnapshot([eff], defs, 9_999)['cr1']).toBeUndefined();
    expect(buildAmpSnapshot([eff], defs, eff.expires_at)['cr1']).toBeUndefined();
    expect(buildAmpSnapshot([eff], defs, eff.expires_at - 1)['cr1']).toHaveLength(1);
  });

  it('ignores non-amp statuses', () => {
    const dot = { target_id: 'cr1', effect_type: 'poison', started_at: 0, expires_at: 99_999 };
    expect(buildAmpSnapshot([dot], defs, 10_000)['cr1']).toBeUndefined();
  });
});

describe('resolveAmpPct', () => {
  const inst = (key: string, pct: number) => ({
    statusKey: key, pct,
    eligibleSources: ['weapon', 'ability', 'dot'] as any,
    startedAt: 0, expiresAt: 99_999,
  });

  it('never stacks the same status key (strongest wins)', () => {
    expect(resolveAmpPct([inst('chilled', 10), inst('chilled', 10)], 'weapon')).toBe(10);
    expect(resolveAmpPct([inst('chilled', 10), inst('chilled', 25)], 'weapon')).toBe(25);
  });

  it('adds distinct status keys', () => {
    expect(resolveAmpPct([inst('chilled', 10), inst('sundered', 5)], 'weapon')).toBe(15);
  });

  it('respects status-owned eligibility', () => {
    const stanceOnly = { ...inst('chilled', 10), eligibleSources: ['stance'] as any };
    expect(resolveAmpPct([stanceOnly], 'weapon')).toBe(0);
    expect(resolveAmpPct([stanceOnly], 'stance')).toBe(10);
  });

  it('returns 0 for never-amplified sources even when listed eligible', () => {
    const bad = { ...inst('chilled', 10), eligibleSources: ['reflect', 'weapon'] as any };
    expect(resolveAmpPct([bad], 'reflect')).toBe(0);
    expect(resolveAmpPct([bad], 'self')).toBe(0);
    expect(resolveAmpPct([bad], 'environment')).toBe(0);
  });
});

describe('applyCreatureDamageModifiers', () => {
  it('applies the percent with floor rounding', () => {
    expect(applyCreatureDamageModifiers({ amount: 10, source: 'weapon', ampPct: 10 })).toBe(11);
    expect(applyCreatureDamageModifiers({ amount: 7, source: 'weapon', ampPct: 10 })).toBe(7);
    expect(applyCreatureDamageModifiers({ amount: 15, source: 'weapon', ampPct: 10 })).toBe(16);
  });

  it('never turns zero or negative damage into damage', () => {
    expect(applyCreatureDamageModifiers({ amount: 0, source: 'weapon', ampPct: 10 })).toBe(0);
    expect(applyCreatureDamageModifiers({ amount: -3, source: 'weapon', ampPct: 10 })).toBe(-3);
  });

  it('is a no-op without an active amplification', () => {
    expect(amplify(10, 'weapon', undefined)).toBe(10);
    expect(amplify(10, 'weapon', [])).toBe(10);
  });
});
