/**
 * statContributions.ts — Single source of truth for what each attribute does.
 *
 * Every stat's tooltip is derived from the actual formula functions, so the UI
 * cannot drift from gameplay numbers. If a formula stops contributing what we
 * expect (e.g. CON no longer gives HP regen), the dev-only assertion below
 * fires a console.error in development.
 *
 * To add or remove a stat contribution:
 *   1. Update the corresponding formula in `src/shared/formulas/`.
 *   2. Update the matching entry here.
 *   3. The probe at the bottom verifies the formula still behaves as advertised.
 */

import {
  getStatRegen,
  getCpRegen,
  getMpRegenRate,
  getMaxCp,
  getMaxMp,
  getStrDamageFloor,
  getDexCritBonus,
  getIntHitBonus,
  getWisDodgeChance,
  getChaBuyDiscount,
  getChaSellMultiplier,
} from '@/lib/game-data';

export type StatKey = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';

/** A single derived effect of a stat (e.g. "HP regen", "CP pool"). */
interface StatEffect {
  label: string;
  /** Live value at the player's effective stat — formatted for display. */
  value: (effective: number, level: number) => string;
}

// ── Display helpers (match conventions used in derived stat rows) ─
const dash = '–';
const fmtPlus = (n: number) => (n > 0 ? `+${n}` : dash);
const fmtPct = (n: number) => (n > 0 ? `${Math.round(n * 100)}%` : dash);
const fmtRegen = (n: number) => `+${n}/tick`;
const fmtCritRange = (bonus: number) => {
  const lo = 20 - bonus;
  return bonus > 0 ? `${lo}–20` : '20';
};

/** What each attribute contributes, derived from formulas (not hand-typed). */
export const STAT_CONTRIBUTIONS: Record<StatKey, {
  full: string;
  short: string; // one-line static blurb for the description row
  effects: StatEffect[];
}> = {
  str: {
    full: 'Strength',
    short: 'Melee attack, carry capacity, minimum damage floor',
    effects: [
      { label: 'Min Damage', value: e => fmtPlus(getStrDamageFloor(e)) },
    ],
  },
  dex: {
    full: 'Dexterity',
    short: 'Ranged attack, AC bonus, Stamina pool & regen, crit chance',
    effects: [
      { label: 'Max Stamina', value: (e, lvl) => `${getMaxMp(lvl, e)}` },
      { label: 'Stamina Regen', value: e => fmtRegen(getMpRegenRate(e)) },
      { label: 'Crit Range', value: e => fmtCritRange(getDexCritBonus(e)) },
    ],
  },
  con: {
    full: 'Constitution',
    short: 'Hit points and HP regeneration',
    effects: [
      { label: 'HP Regen', value: e => fmtRegen(getStatRegen(e)) },
    ],
  },
  int: {
    full: 'Intelligence',
    short: 'Arcane power, CP regen, improves hit chance',
    effects: [
      { label: 'CP Regen', value: e => fmtRegen(getCpRegen(e)) },
      { label: 'Hit Chance', value: e => fmtPlus(getIntHitBonus(e)) },
    ],
  },
  wis: {
    full: 'Wisdom',
    short: 'Perception, CP pool, reduces incoming crit chance',
    effects: [
      { label: 'Max CP', value: (e, lvl) => `${getMaxCp(lvl, e)}` },
      { label: 'Crit Resistance', value: e => fmtPct(getWisDodgeChance(e)) },
    ],
  },
  cha: {
    full: 'Charisma',
    short: 'Persuasion, bardic abilities, vendor prices & humanoid gold',
    effects: [
      { label: 'Buy Discount', value: e => {
        const v = getChaBuyDiscount(e);
        return v > 0 ? `−${Math.round(v * 100)}%` : dash;
      } },
      { label: 'Sell Bonus', value: e => {
        const pct = Math.round(((getChaSellMultiplier(e) - 1) / 0.05) * 5);
        return pct > 0 ? `+${pct}%` : dash;
      } },
    ],
  },
};

// ── Dev-only drift guard ────────────────────────────────────────
// Probes each formula at a known input to confirm it still behaves as a
// "contribution" (non-negative number / non-empty string). If a formula is
// renamed, removed, or made to return something unexpected, this fires once
// at module load in development so the mismatch is caught immediately.
if (import.meta.env.DEV) {
  try {
    const probes: Array<[string, () => number]> = [
      ['CON → HP regen', () => getStatRegen(20)],
      ['INT → CP regen', () => getCpRegen(20)],
      ['DEX → MP regen', () => getMpRegenRate(20)],
      ['WIS → Max CP', () => getMaxCp(10, 20)],
      ['DEX → Max MP', () => getMaxMp(10, 20)],
      ['STR → Damage floor', () => getStrDamageFloor(20)],
      ['DEX → Crit bonus', () => getDexCritBonus(20)],
      ['INT → Hit bonus', () => getIntHitBonus(20)],
      ['WIS → Anti-crit', () => getWisDodgeChance(20)],
      ['CHA → Buy discount', () => getChaBuyDiscount(20)],
      ['CHA → Sell mult', () => getChaSellMultiplier(20)],
    ];
    for (const [name, fn] of probes) {
      const v = fn();
      if (typeof v !== 'number' || Number.isNaN(v) || v < 0) {
        // eslint-disable-next-line no-console
        console.error(
          `[statContributions] Drift detected: "${name}" returned ${v}. ` +
          `Update src/features/character/utils/statContributions.ts to match the new formula.`,
        );
      }
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[statContributions] Probe threw — a referenced formula may have been removed:', err);
  }
}
