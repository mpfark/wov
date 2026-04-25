/**
 * formula-parity.test.ts — Snapshot guard against drift between the canonical
 * formula modules and any future re-introduction of duplicated math.
 *
 * If a value here changes, you have made a balance change — update the
 * expected number deliberately, and check that:
 *   1. `public.sync_character_resources()` SQL mirror still matches HP/CP/MP,
 *   2. The reward/combat edge functions still produce the intended numbers.
 *
 * Coverage:
 *   - HP / CP / MP base caps and gear-effective caps
 *   - AC and gear-effective AC
 *   - Anti-crit, shield block, hit quality
 *   - Both XP penalty curves (solo + party) and creature XP base
 *   - Item stat budget at representative rarities/levels
 *   - Creature stat generation at representative rarities/levels
 *   - Cross-check that the legacy barrels (`@/lib/game-data` and
 *     `@/features/combat/utils/combat-math`) re-export identical values to
 *     the canonical modules — guards against a future drift if anyone
 *     accidentally re-defines a formula in one of the barrels.
 */
import { describe, it, expect } from 'vitest';

// Canonical sources
import {
  getMaxHp, getMaxCp, getMaxMp,
  getEffectiveMaxHp, getEffectiveMaxCp, getEffectiveMaxMp,
} from '@/shared/formulas/resources';
import {
  calculateAC, getEffectiveAC,
  getWisAntiCrit, getShieldBlockChance, getShieldBlockAmount,
  getHitQuality, HIT_QUALITY_MULT,
} from '@/shared/formulas/combat';
import {
  getXpPenaltySolo, getXpPenaltyParty, getXpPenalty,
  getCreatureXp, getXpForLevel,
} from '@/shared/formulas/xp';
import { getItemStatBudget } from '@/shared/formulas/items';
import { generateCreatureStats } from '@/shared/formulas/creatures';

// Barrels (must match canonical)
import * as gameData from '@/lib/game-data';
import * as clientCombat from '@/features/combat/utils/combat-math';

describe('Resource caps — fixed snapshots', () => {
  it('HP', () => {
    expect(getMaxHp('warrior', 10, 1)).toBe(24);
    expect(getMaxHp('warrior', 14, 10)).toBe(71);
    expect(getMaxHp('wizard', 10, 20)).toBe(111);
    expect(getMaxHp('rogue', 12, 5)).toBe(37);
  });
  it('CP', () => {
    expect(getMaxCp(1, 10, 10, 10)).toBe(30);
    expect(getMaxCp(10, 14, 14, 10)).toBe(69);
    expect(getMaxCp(20, 16, 16, 10)).toBe(105);
  });
  it('MP', () => {
    expect(getMaxMp(1, 10)).toBe(100);
    expect(getMaxMp(10, 16)).toBe(148);
    expect(getMaxMp(20, 18)).toBe(178);
  });
  it('Gear-effective caps add bonuses', () => {
    expect(getEffectiveMaxHp('warrior', 10, 5, { hp: 5 })).toBe(getMaxHp('warrior', 10, 5) + 5);
    expect(getEffectiveMaxCp(5, 10, 10, 10, { int: 4, wis: 4 })).toBe(getMaxCp(5, 10, 10, 10) + 12);
    expect(getEffectiveMaxMp(5, 10, { dex: 4 })).toBe(getMaxMp(5, 10) + 20);
  });
});

describe('AC — fixed snapshots', () => {
  it('Base', () => {
    expect(calculateAC('warrior', 10)).toBe(12);
    expect(calculateAC('wizard', 14)).toBe(11);
    expect(calculateAC('rogue', 16)).toBe(13);
  });
  it('Effective with shield', () => {
    expect(getEffectiveAC('warrior', 10, { ac: 2 }, true)).toBe(15); // 12 + 2 + 1
    expect(getEffectiveAC('wizard', 14, {}, false)).toBe(11);
  });
});

describe('Anti-crit & shield block — fixed snapshots', () => {
  it('Anti-crit caps at 15%', () => {
    expect(getWisAntiCrit(10)).toBe(0);
    expect(getWisAntiCrit(20)).toBeCloseTo(0.0671, 3); // sqrt(5)*0.03
    expect(getWisAntiCrit(999)).toBeCloseTo(0.15, 3);
  });
  it('Shield block chance baseline 5%', () => {
    expect(getShieldBlockChance(10)).toBe(0.05);
    expect(getShieldBlockChance(20)).toBeCloseTo(0.1506, 3); // 0.05 + sqrt(5)*0.045
  });
  it('Shield block amount', () => {
    expect(getShieldBlockAmount(10)).toBe(11);
    expect(getShieldBlockAmount(20)).toBe(17); // round(11 + 2.5*sqrt(5)) = 17
  });
  it('Hit quality table', () => {
    expect(getHitQuality(0, false, false)).toBe('weak');
    expect(getHitQuality(7, false, false)).toBe('strong');
    expect(getHitQuality(-3, false, false)).toBe('glancing');
    expect(getHitQuality(0, true, false)).toBe('miss');
    expect(getHitQuality(0, false, true)).toBe('normal');
    expect(getHitQuality(7, false, true)).toBe('strong');
    expect(HIT_QUALITY_MULT.normal).toBe(1.0);
  });
});

describe('XP — fixed snapshots', () => {
  it('Solo penalty (lenient)', () => {
    // playerLevel ≤ 5 → 6%/level, floor 10%
    expect(getXpPenaltySolo(3, 1)).toBeCloseTo(1 - 2 * 0.06, 5);
    expect(getXpPenaltySolo(5, 5)).toBe(1);
    // playerLevel 6–10 → 9%
    expect(getXpPenaltySolo(8, 5)).toBeCloseTo(1 - 3 * 0.09, 5);
    // playerLevel 11+ → 12%
    expect(getXpPenaltySolo(15, 12)).toBeCloseTo(1 - 3 * 0.12, 5);
    expect(getXpPenaltySolo(42, 1)).toBe(0.10); // floor
  });
  it('Party penalty (harsher)', () => {
    expect(getXpPenaltyParty(3, 1)).toBeCloseTo(1 - 2 * 0.10, 5);
    expect(getXpPenaltyParty(8, 5)).toBeCloseTo(1 - 3 * 0.15, 5);
    expect(getXpPenaltyParty(13, 11)).toBeCloseTo(1 - 2 * 0.20, 5);
    expect(getXpPenaltyParty(42, 1)).toBe(0.10);
  });
  it('Legacy alias = solo', () => {
    expect(getXpPenalty(8, 5)).toBe(getXpPenaltySolo(8, 5));
  });
  it('Creature XP base', () => {
    expect(getCreatureXp(10, 'regular')).toBe(100);
    expect(getCreatureXp(10, 'rare')).toBe(150);
    expect(getCreatureXp(10, 'boss')).toBe(250);
  });
  it('XP curve', () => {
    expect(getXpForLevel(1)).toBe(50);
    expect(getXpForLevel(10)).toBe(5000);
    expect(getXpForLevel(42)).toBe(88200);
  });
});

describe('Item stat budget — fixed snapshots', () => {
  it('common L1', () => expect(getItemStatBudget(1, 'common')).toBe(1));
  it('uncommon L10', () => expect(getItemStatBudget(10, 'uncommon')).toBe(5));
  it('unique L20 2H', () => expect(getItemStatBudget(20, 'unique', 2)).toBe(26));
  it('consumable triples budget', () => {
    const eqp = getItemStatBudget(10, 'common', 1, 'equipment');
    const con = getItemStatBudget(10, 'common', 1, 'consumable');
    expect(con).toBe(eqp * 3);
  });
});

describe('Creature generation — fixed snapshots', () => {
  it('regular L10', () => {
    const r = generateCreatureStats(10, 'regular');
    expect(r.hp).toBe(95);  // round((15+80)*1)
    expect(r.ac).toBe(18);  // round(10 + 5.75 + 2)
    expect(r.stats.str).toBe(15);
  });
  it('boss L20 hits expected scaling', () => {
    const r = generateCreatureStats(20, 'boss');
    expect(r.hp).toBe(round((15 + 160) * 6));
    expect(r.ac).toBe(round(10 + 11.5 + 6));
  });
});

function round(n: number) { return Math.round(n); }

describe('Barrels re-export the canonical implementation', () => {
  it('@/lib/game-data forwards getMaxHp identically', () => {
    expect(gameData.getMaxHp('warrior', 14, 10)).toBe(getMaxHp('warrior', 14, 10));
  });
  it('@/lib/game-data forwards getXpPenalty as the SOLO curve', () => {
    expect(gameData.getXpPenalty(20, 10)).toBe(getXpPenaltySolo(20, 10));
  });
  it('@/features/combat/utils/combat-math forwards calculateAC identically', () => {
    expect(clientCombat.calculateAC('rogue', 16)).toBe(calculateAC('rogue', 16));
  });
  it('@/features/combat/utils/combat-math forwards getWisAntiCrit identically', () => {
    expect(clientCombat.getWisAntiCrit(20)).toBe(getWisAntiCrit(20));
  });
});
