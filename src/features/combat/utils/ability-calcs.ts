/**
 * ability-calcs.ts — configurable ability *magnitudes*.
 *
 * Phase 2b made ability presentation (label, emoji, text, CP cost, unlock
 * level) configurable. This module does the same for the numbers: the
 * structured `amount_calc` / `duration_calc` / `interval_ms` records stored on
 * the `abilities` table are loaded into a runtime registry and evaluated by
 * `@/shared/formulas/ability-calc`.
 *
 * Checkpoint 1 of the ability-calculation rework (see
 * `docs/design/ability-calculation-rework.md`): the registry is keyed by
 * **`ability_key`** — the single identity shared with the server registry
 * (`supabase/functions/_shared/load-ability-calcs.ts`). `ability_key` is unique
 * per ability, so classes sharing a mechanic with different scaling (Healer's
 * Purifying Light WIS/CON vs Bard's Crescendo CHA/INT) stay distinct entries.
 *
 * A compatibility map (`class_key:tier -> ability_key`) preserves the old
 * tier-based lookups used by the ability bar and combat driver until those call
 * sites migrate. Bar tier is presentation ordering only; it is no longer an
 * identity.
 *
 * Fallback: `ABILITY_SEED` is the compiled seed data. It primes the registry so
 * configuration can always answer, even before a fetch lands or if the config
 * load fails. Legacy inline formulas were removed at checkpoint 7.
 */
import { ABILITY_SEED } from '@/shared/config/ability-seed';
import {
  evaluateCalc, type AbilityCalc, type CalcInputs, type CalcStat,
} from '@/shared/formulas/ability-calc';
import { getStatModifier } from '@/shared/formulas/stats';

export interface AbilityCalcEntry {
  abilityKey: string;
  mechanicKey: string;
  amountCalc: AbilityCalc | null;
  durationCalc: AbilityCalc | null;
  intervalMs: number | null;
  effectConfig: Record<string, unknown>;
  /** Named typed mechanic calcs (`abilities.mechanic_calcs`). */
  mechanicCalcs: Record<string, AbilityCalc>;
}

/** Compat lookup key for the legacy `class:tier` addressing. */
const slotKey = (classKey: string, tier: number) => `${classKey}:${tier}`;

/** Seeded fallback entries, keyed by `ability_key`. */
const FALLBACK_CALCS: Record<string, AbilityCalcEntry> = Object.fromEntries(
  ABILITY_SEED.map(a => [a.ability_key, {
    abilityKey: a.ability_key,
    mechanicKey: a.mechanic_key,
    amountCalc: a.amount_calc,
    durationCalc: a.duration_calc,
    intervalMs: a.interval_ms,
    effectConfig: a.effect_config ?? {},
    mechanicCalcs: a.mechanic_calcs ?? {},
  } satisfies AbilityCalcEntry]),
);

/** Seeded `class:tier -> ability_key` compat map. */
const FALLBACK_SLOTS: Record<string, string> = Object.fromEntries(
  ABILITY_SEED.map(a => [slotKey(a.class_key, a.slot), a.ability_key]),
);

/** Live registry, keyed by `ability_key` — mutated by `setAbilityCalcRegistry`. */
export const ABILITY_CALCS: Record<string, AbilityCalcEntry> = { ...FALLBACK_CALCS };

/** Live `class:tier -> ability_key` compat map. */
const SLOT_KEYS: Record<string, string> = { ...FALLBACK_SLOTS };

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
    mechanic_calcs?: unknown;
  } | null;
}

function asCalc(value: unknown): AbilityCalc | null {
  if (!value || typeof value !== 'object') return null;
  const calc = value as AbilityCalc;
  if (!Array.isArray(calc.terms) || typeof calc.base !== 'number') return null;
  return calc;
}

/** Coerce the stored `mechanic_calcs` object into validated calc records. */
function asMechanicCalcs(value: unknown): Record<string, AbilityCalc> {
  if (!value || typeof value !== 'object') return {};
  const out: Record<string, AbilityCalc> = {};
  for (const [param, raw] of Object.entries(value as Record<string, unknown>)) {
    const calc = asCalc(raw);
    if (calc) out[param] = calc;
  }
  return out;
}

/** Named mechanic calc for one ability, or null when unconfigured. */
export function getMechanicCalc(abilityKey: string, param: string): AbilityCalc | null {
  return getAbilityCalcsByKey(abilityKey)?.mechanicCalcs?.[param] ?? null;
}

/**
 * Apply configured calc rows. Entries are stored by `ability_key`; slots may be
 * 1-based in config, so each class's rows are sorted and re-indexed to the
 * 0-based bar tier for the compat map — identical to the normalization in
 * `setAbilityRegistry`.
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
        mechanicCalcs: asMechanicCalcs(row.ability.mechanic_calcs),
      },
    });
    byClass.set(row.class_key, list);
  }

  for (const [classKey, list] of byClass) {
    if (list.length === 0) continue;
    list.sort((a, b) => a.slot - b.slot);
    list.forEach((row, tier) => {
      ABILITY_CALCS[row.entry.abilityKey] = row.entry;
      SLOT_KEYS[slotKey(classKey, tier)] = row.entry.abilityKey;
    });
  }
  calcRegistryLoaded = true;
}

/** Restore the seeded fallback entries (used by tests and reloads). */
export function resetAbilityCalcRegistry(): void {
  for (const key of Object.keys(ABILITY_CALCS)) delete ABILITY_CALCS[key];
  Object.assign(ABILITY_CALCS, FALLBACK_CALCS);
  for (const key of Object.keys(SLOT_KEYS)) delete SLOT_KEYS[key];
  Object.assign(SLOT_KEYS, FALLBACK_SLOTS);
  calcRegistryLoaded = false;
}

/** Canonical lookup: magnitudes for one `ability_key`. */
export function getAbilityCalcsByKey(abilityKey: string): AbilityCalcEntry | null {
  return ABILITY_CALCS[abilityKey] ?? null;
}

/** The ability currently occupying a class's bar tier, if any. */
export function getAbilityKeyForSlot(classKey: string, tier: number): string | null {
  return SLOT_KEYS[slotKey(classKey, tier)] ?? null;
}

/** Compat lookup by bar tier — resolves through the `class:tier` map. */
export function getAbilityCalcs(classKey: string, tier: number): AbilityCalcEntry | null {
  const key = getAbilityKeyForSlot(classKey, tier);
  return key ? getAbilityCalcsByKey(key) : null;
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

/**
 * Checkpoint 7: configuration is the only source of ability magnitudes. The
 * compiled `ABILITY_SEED` primes the registry, so a resolve can only come up
 * empty for an ability that genuinely has no calc configured — in which case
 * the caller's constant `fallback` (default 0) is returned.
 */
function resolveByKey(
  which: 'amountCalc' | 'durationCalc',
  abilityKey: string,
  inputs: CalcInputs,
  fallback: number,
): number {
  const calc = getAbilityCalcsByKey(abilityKey)?.[which];
  if (!calc) return fallback;
  return evaluateCalc(calc, inputs);
}

function resolve(
  which: 'amountCalc' | 'durationCalc',
  classKey: string,
  tier: number,
  inputs: CalcInputs,
  fallback: number,
): number {
  const key = getAbilityKeyForSlot(classKey, tier);
  if (!key) return fallback;
  return resolveByKey(which, key, inputs, fallback);
}

/** Canonical: configured magnitude for one `ability_key`. */
export function resolveAmountByKey(
  abilityKey: string, inputs: CalcInputs, fallback = 0,
): number {
  return resolveByKey('amountCalc', abilityKey, inputs, fallback);
}

/** Canonical: configured duration (ms) for one `ability_key`. */
export function resolveDurationByKey(
  abilityKey: string, inputs: CalcInputs, fallback = 0,
): number {
  return resolveByKey('durationCalc', abilityKey, inputs, fallback);
}

/** Canonical: configured tick interval (ms) for one `ability_key`. */
export function resolveIntervalByKey(abilityKey: string, fallback = 0): number {
  return getAbilityCalcsByKey(abilityKey)?.intervalMs ?? fallback;
}

/** Compat: configured magnitude for a class/tier ability. */
export function resolveAmount(
  classKey: string, tier: number, inputs: CalcInputs, fallback = 0,
): number {
  return resolve('amountCalc', classKey, tier, inputs, fallback);
}

/** Compat: configured duration (ms) for a class/tier ability. */
export function resolveDuration(
  classKey: string, tier: number, inputs: CalcInputs, fallback = 0,
): number {
  return resolve('durationCalc', classKey, tier, inputs, fallback);
}

/** Compat: configured tick interval (ms). */
export function resolveInterval(classKey: string, tier: number, fallback = 0): number {
  return getAbilityCalcs(classKey, tier)?.intervalMs ?? fallback;
}

// ── Loadout support (Phase 4) ─────────────────────────────────────

/** Build a calc entry from a joined assignment row (default or alternative). */
export function toAbilityCalcEntry(row: {
  ability: {
    ability_key?: string;
    mechanic_key: string;
    amount_calc?: unknown;
    duration_calc?: unknown;
    interval_ms?: number | null;
    effect_config?: unknown;
    mechanic_calcs?: unknown;
  } | null;
}): AbilityCalcEntry {
  return {
    abilityKey: row.ability?.ability_key ?? '',
    mechanicKey: row.ability?.mechanic_key ?? '',
    amountCalc: asCalc(row.ability?.amount_calc),
    durationCalc: asCalc(row.ability?.duration_calc),
    intervalMs: row.ability?.interval_ms ?? null,
    effectConfig: (row.ability?.effect_config as Record<string, unknown>) ?? {},
    mechanicCalcs: asMechanicCalcs(row.ability?.mechanic_calcs),
  };
}


/**
 * Point one class/tier at a specific ability's magnitudes (loadout choice).
 * Stores the entry under its `ability_key` and repoints the compat slot map.
 * Keyless entries (unloaded config) fall back to a synthetic slot identity so
 * the bar still resolves.
 */
export function setAbilityCalcEntry(
  classKey: string, tier: number, entry: AbilityCalcEntry,
): void {
  const key = entry.abilityKey || slotKey(classKey, tier);
  ABILITY_CALCS[key] = entry;
  SLOT_KEYS[slotKey(classKey, tier)] = key;
}

