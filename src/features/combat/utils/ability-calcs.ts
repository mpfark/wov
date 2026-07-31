/**
 * ability-calcs.ts — Phase 2c: configurable ability *magnitudes*.
 *
 * Phase 2b made ability presentation (label, emoji, text, CP cost, unlock
 * level) configurable. This module does the same for the numbers: the
 * structured `amount_calc` / `duration_calc` / `interval_ms` records stored on
 * the `abilities` table are loaded into a runtime registry and evaluated by
 * `@/shared/formulas/ability-calc`.
 *
 * Registry key is `${classKey}:${tier}` — the same 0-based bar index the
 * ability list uses — because two classes can share a mechanic with different
 * scaling (Healer's Purifying Light scales WIS/CON, Bard's Crescendo CHA/INT).
 *
 * Fallback: `ABILITY_SEED` is the balance-identical seed data, pinned against
 * the original hardcoded math by `ability-calc-parity.test.ts`. Until a fetch
 * lands (or when `USE_CONFIG_ABILITY_CALCS` is off) the caller's legacy inline
 * value is used, so nothing can regress if the config load fails.
 */
import { ABILITY_SEED } from '@/shared/config/ability-seed';
import {
  evaluateCalc, type AbilityCalc, type CalcInputs, type CalcStat,
} from '@/shared/formulas/ability-calc';
import { getStatModifier } from '@/shared/formulas/stats';
import { USE_CONFIG_ABILITY_CALCS } from '@/shared/config/feature-flags';

export interface AbilityCalcEntry {
  abilityKey: string;
  mechanicKey: string;
  amountCalc: AbilityCalc | null;
  durationCalc: AbilityCalc | null;
  intervalMs: number | null;
  effectConfig: Record<string, unknown>;
}

const calcKey = (classKey: string, tier: number) => `${classKey}:${tier}`;

/** Seeded fallback, keyed by class + bar tier. */
const FALLBACK_CALCS: Record<string, AbilityCalcEntry> = Object.fromEntries(
  ABILITY_SEED.map(a => [calcKey(a.class_key, a.slot), {
    abilityKey: a.ability_key,
    mechanicKey: a.mechanic_key,
    amountCalc: a.amount_calc,
    durationCalc: a.duration_calc,
    intervalMs: a.interval_ms,
    effectConfig: a.effect_config ?? {},
  } satisfies AbilityCalcEntry]),
);

/** Live registry — mutated in place by `setAbilityCalcRegistry`. */
export const ABILITY_CALCS: Record<string, AbilityCalcEntry> = { ...FALLBACK_CALCS };

let calcRegistryLoaded = false;

export function isAbilityCalcRegistryLoaded(): boolean {
  return calcRegistryLoaded;
}

/** Shape of one joined `class_ability_assignments` row carrying calc data. */
export interface AbilityCalcConfigRow {
  class_key: string;
  is_default: boolean;
  status: string;
  role: { slot: number } | null;
  ability: {
    ability_key: string;
    mechanic_key: string;
    status: string;
    amount_calc: unknown;
    duration_calc: unknown;
    interval_ms: number | null;
    effect_config: unknown;
  } | null;
}

function asCalc(value: unknown): AbilityCalc | null {
  if (!value || typeof value !== 'object') return null;
  const calc = value as AbilityCalc;
  if (!Array.isArray(calc.terms) || typeof calc.base !== 'number') return null;
  return calc;
}

/**
 * Apply configured calc rows. Slots may be 1-based in config, so each class's
 * rows are sorted and re-indexed to the 0-based bar tier — identical to the
 * normalization in `setAbilityRegistry`.
 */
export function setAbilityCalcRegistry(rows: AbilityCalcConfigRow[]): void {
  if (!rows || rows.length === 0) return;

  const byClass = new Map<string, { slot: number; entry: AbilityCalcEntry }[]>();
  for (const row of rows) {
    if (!row.ability || !row.role) continue;
    if (row.status !== 'active' || row.ability.status !== 'active') continue;
    if (!row.is_default) continue;
    const list = byClass.get(row.class_key) ?? [];
    list.push({
      slot: row.role.slot,
      entry: {
        abilityKey: row.ability.ability_key,
        mechanicKey: row.ability.mechanic_key,
        amountCalc: asCalc(row.ability.amount_calc),
        durationCalc: asCalc(row.ability.duration_calc),
        intervalMs: row.ability.interval_ms ?? null,
        effectConfig: (row.ability.effect_config as Record<string, unknown>) ?? {},
      },
    });
    byClass.set(row.class_key, list);
  }

  for (const [classKey, list] of byClass) {
    if (list.length === 0) continue;
    list.sort((a, b) => a.slot - b.slot);
    list.forEach((row, tier) => { ABILITY_CALCS[calcKey(classKey, tier)] = row.entry; });
  }
  calcRegistryLoaded = true;
}

/** Restore the seeded fallback entries (used by tests and reloads). */
export function resetAbilityCalcRegistry(): void {
  for (const key of Object.keys(ABILITY_CALCS)) delete ABILITY_CALCS[key];
  Object.assign(ABILITY_CALCS, FALLBACK_CALCS);
  calcRegistryLoaded = false;
}

export function getAbilityCalcs(classKey: string, tier: number): AbilityCalcEntry | null {
  return ABILITY_CALCS[calcKey(classKey, tier)] ?? null;
}

// ── Runtime evaluation ────────────────────────────────────────────

export interface StatBlockLike {
  level: number;
  str: number; dex: number; con: number; int: number; wis: number; cha: number;
}

export type EquipmentBonusLike = Partial<Record<CalcStat, number>> | null | undefined;

/**
 * Build evaluator inputs from a character + gear bonuses.
 * Modifiers are the canonical "base + renown + gear" values shown in the
 * character panel, so every configured calc scales off the same numbers.
 */
export function buildCalcInputs(
  character: StatBlockLike,
  equipmentBonuses?: EquipmentBonusLike,
): CalcInputs {
  const mod = (stat: CalcStat) =>
    getStatModifier((character[stat] ?? 0) + (equipmentBonuses?.[stat] ?? 0));
  return {
    level: character.level,
    mods: {
      str: mod('str'), dex: mod('dex'), con: mod('con'),
      int: mod('int'), wis: mod('wis'), cha: mod('cha'),
    },
  };
}

function resolve(
  which: 'amountCalc' | 'durationCalc',
  classKey: string,
  tier: number,
  inputs: CalcInputs,
  legacy: number,
): number {
  if (!USE_CONFIG_ABILITY_CALCS) return legacy;
  const calc = getAbilityCalcs(classKey, tier)?.[which];
  if (!calc) return legacy;
  return evaluateCalc(calc, inputs);
}

/** Configured magnitude for a class/tier ability, or `legacy` when unconfigured. */
export function resolveAmount(
  classKey: string, tier: number, inputs: CalcInputs, legacy: number,
): number {
  return resolve('amountCalc', classKey, tier, inputs, legacy);
}

/** Configured duration (ms) for a class/tier ability, or `legacy` when unconfigured. */
export function resolveDuration(
  classKey: string, tier: number, inputs: CalcInputs, legacy: number,
): number {
  return resolve('durationCalc', classKey, tier, inputs, legacy);
}

/** Configured tick interval (ms), or `legacy` when unconfigured. */
export function resolveInterval(classKey: string, tier: number, legacy: number): number {
  if (!USE_CONFIG_ABILITY_CALCS) return legacy;
  return getAbilityCalcs(classKey, tier)?.intervalMs ?? legacy;
}
