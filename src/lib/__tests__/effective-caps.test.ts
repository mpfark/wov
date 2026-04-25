/**
 * Guards the gear-adjusted "effective max" formulas against drift.
 *
 * The same numbers must come out of:
 *   - getMaxHp / getMaxCp / getMaxMp                 (src/lib/game-data.ts)
 *   - getMaxHp                                       (src/features/combat/utils/combat-math.ts mirror)
 *   - sync_character_resources()                     (SQL RPC)
 *   - calcMaxHp / calcMaxCp / calcMaxMp              (combat-tick edge function)
 *
 * If you change a formula in any of those files, this test must continue to pass
 * for the canonical formula in `game-data.ts` AND a matching update is required
 * in every mirror.
 */
import { describe, it, expect } from 'vitest';
import {
  getMaxHp, getMaxCp, getMaxMp,
  getEffectiveMaxHp, getEffectiveMaxCp, getEffectiveMaxMp,
} from '@/lib/game-data';
import { getMaxHp as getMaxHpMirror } from '@/features/combat/utils/combat-math';

describe('Base max formulas — fixed snapshots (drift guard)', () => {
  it('warrior L1 con=10 → 24 HP', () => {
    expect(getMaxHp('warrior', 10, 1)).toBe(24);
  });
  it('warrior L10 con=14 → 24 + 2 + 45 = 71 HP', () => {
    expect(getMaxHp('warrior', 14, 10)).toBe(71);
  });
  it('wizard L20 con=10 → 16 + 0 + 95 = 111 HP', () => {
    expect(getMaxHp('wizard', 10, 20)).toBe(111);
  });
  it('CP L1 int=10 wis=10 → 30', () => {
    expect(getMaxCp(1, 10, 10, 10)).toBe(30);
  });
  it('CP L10 int=14 wis=14 → 30 + 27 + 12 = 69', () => {
    expect(getMaxCp(10, 14, 14, 10)).toBe(69);
  });
  it('MP L1 dex=10 → 100', () => {
    expect(getMaxMp(1, 10)).toBe(100);
  });
  it('MP L10 dex=16 → 100 + 30 + 18 = 148', () => {
    expect(getMaxMp(10, 16)).toBe(148);
  });
});

describe('combat-math.ts mirror matches game-data.ts', () => {
  for (const cls of ['warrior', 'wizard', 'ranger', 'rogue', 'healer', 'bard']) {
    for (const lvl of [1, 5, 20, 42]) {
      for (const con of [8, 10, 16, 20]) {
        it(`${cls} L${lvl} con=${con}`, () => {
          expect(getMaxHpMirror(cls, con, lvl)).toBe(getMaxHp(cls, con, lvl));
        });
      }
    }
  }
});

describe('Gear-effective caps add bonuses correctly', () => {
  it('+5 hp gear raises max by exactly 5', () => {
    const base = getMaxHp('warrior', 10, 5);
    expect(getEffectiveMaxHp('warrior', 10, 5, { hp: 5 })).toBe(base + 5);
  });
  it('+4 con gear raises HP by con-mod delta (+2 floor)', () => {
    const base = getMaxHp('warrior', 10, 5);
    const eff = getEffectiveMaxHp('warrior', 10, 5, { con: 4 });
    expect(eff).toBe(base + 2);
  });
  it('+4 int / +4 wis raises CP by (2+2)*3 = 12', () => {
    const base = getMaxCp(5, 10, 10, 10);
    expect(getEffectiveMaxCp(5, 10, 10, 10, { int: 4, wis: 4 })).toBe(base + 12);
  });
  it('+4 dex raises MP by 20', () => {
    const base = getMaxMp(5, 10);
    expect(getEffectiveMaxMp(5, 10, { dex: 4 })).toBe(base + 20);
  });
  it('empty bonuses returns base value', () => {
    expect(getEffectiveMaxHp('rogue', 12, 8, {})).toBe(getMaxHp('rogue', 12, 8));
    expect(getEffectiveMaxCp(8, 12, 12, 10, {})).toBe(getMaxCp(8, 12, 12, 10));
    expect(getEffectiveMaxMp(8, 14, {})).toBe(getMaxMp(8, 14));
  });
});
