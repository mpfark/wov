/**
 * Guards the gear-adjusted "effective max" formulas against drift.
 *
 * The same numbers must come out of:
 *   - getMaxHp / getMaxCp / getMaxMp                 (@/shared/formulas/resources)
 *   - sync_character_resources()                     (SQL RPC)
 *   - calcMaxHp / calcMaxCp / calcMaxMp              (combat-tick edge function)
 *
 * If you change a formula here, the matching SQL RPC and edge-function mirrors
 * must be updated too.
 *
 * NOTE: As of the WIS-only CP refactor, getMaxCp(level, wis) ignores INT/CHA.
 * Pool scales with WIS only; INT now drives regen via getCpRegen.
 */
import { describe, it, expect } from 'vitest';
import {
  getMaxHp, getMaxCp, getMaxMp,
  getEffectiveMaxHp, getEffectiveMaxCp, getEffectiveMaxMp,
} from '@/shared/formulas';

describe('Base max formulas — fixed snapshots (drift guard)', () => {
  it('warrior L1 con=10 → 24 HP', () => {
    expect(getMaxHp('warrior', 10, 1)).toBe(24);
  });
  it('warrior L10 con=14 → 24 + 4 + 45 = 73 HP', () => {
    expect(getMaxHp('warrior', 14, 10)).toBe(73);
  });
  it('wizard L20 con=10 → 16 + 0 + 95 = 111 HP', () => {
    expect(getMaxHp('wizard', 10, 20)).toBe(111);
  });
  it('CP L1 wis=10 → 30', () => {
    expect(getMaxCp(1, 10)).toBe(30);
  });
  it('CP L10 wis=14 → 30 + 27 + 12 = 69 (wisMod=2 ×6)', () => {
    expect(getMaxCp(10, 14)).toBe(69);
  });
  it('MP L1 dex=10 → 100', () => {
    expect(getMaxMp(1, 10)).toBe(100);
  });
  it('MP L10 dex=16 → 100 + 30 + 18 = 148', () => {
    expect(getMaxMp(10, 16)).toBe(148);
  });
});

describe('Gear-effective caps add bonuses correctly', () => {
  it('+5 hp gear raises max by exactly 5', () => {
    const base = getMaxHp('warrior', 10, 5);
    expect(getEffectiveMaxHp('warrior', 10, 5, { hp: 5 })).toBe(base + 5);
  });
  it('+4 con gear raises HP by con-mod delta (+4)', () => {
    const base = getMaxHp('warrior', 10, 5);
    const eff = getEffectiveMaxHp('warrior', 10, 5, { con: 4 });
    expect(eff).toBe(base + 4);
  });
  it('+4 wis raises CP by wisMod_delta * 6 = 12', () => {
    const base = getMaxCp(5, 10);
    expect(getEffectiveMaxCp(5, 10, { wis: 4 })).toBe(base + 12);
  });
  it('INT/CHA gear no longer affect CP pool', () => {
    const base = getMaxCp(5, 10);
    expect(getEffectiveMaxCp(5, 10, { int: 4, cha: 4 })).toBe(base);
  });
  it('+4 dex raises MP by 20', () => {
    const base = getMaxMp(5, 10);
    expect(getEffectiveMaxMp(5, 10, { dex: 4 })).toBe(base + 20);
  });
  it('empty bonuses returns base value', () => {
    expect(getEffectiveMaxHp('assassin', 12, 8, {})).toBe(getMaxHp('assassin', 12, 8));
    expect(getEffectiveMaxCp(8, 12, {})).toBe(getMaxCp(8, 12));
    expect(getEffectiveMaxMp(8, 14, {})).toBe(getMaxMp(8, 14));
  });
});
