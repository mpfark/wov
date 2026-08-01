/**
 * load-ability-calcs.ts — Server-side loader for configurable ability
 * magnitudes (Phase 2c, server half).
 *
 * The client reads `amount_calc` / `duration_calc` / `interval_ms` from the
 * `abilities` table via `features/combat/utils/ability-calcs.ts`. Some ability
 * magnitudes are resolved on the server instead (stance seeding, persistent
 * DoT rows), so the tick functions need the same configuration.
 *
 * Key is `${class_key}:${ability_key}` — server handlers know which ability
 * they are resolving by key, not by bar tier.
 *
 * Safety: every resolver takes the legacy inline expression as its fallback.
 * If the load fails, a row is missing, or a calc is absent (mechanic-owned
 * math such as weapon-die rolls), the original hardcoded value is used, so a
 * config outage can never change balance.
 */
import {
  evaluateCalc, type AbilityCalc, type CalcInputs, type CalcStat,
} from './formulas/ability-calc.ts';
import { getStatModifier } from './formulas/stats.ts';

export interface ServerAbilityCalcEntry {
  abilityKey: string;
  mechanicKey: string;
  amountCalc: AbilityCalc | null;
  durationCalc: AbilityCalc | null;
  intervalMs: number | null;
  effectConfig: Record<string, unknown>;
}

const TTL_MS = 60_000;
let loadedAt = 0;
let inflight: Promise<void> | null = null;

const REGISTRY: Record<string, ServerAbilityCalcEntry> = {};

const key = (classKey: string, abilityKey: string) => `${classKey}:${abilityKey}`;

function asCalc(value: unknown): AbilityCalc | null {
  if (!value || typeof value !== 'object') return null;
  const calc = value as AbilityCalc;
  if (!Array.isArray(calc.terms) || typeof calc.base !== 'number') return null;
  return calc;
}

/** Replace the registry contents from joined assignment rows. */
export function setServerAbilityCalcs(rows: any[]): void {
  const next: Record<string, ServerAbilityCalcEntry> = {};
  for (const row of rows ?? []) {
    const ability = row?.ability;
    if (!ability) continue;
    if (row.status !== 'active' || ability.status !== 'active') continue;
    if (!row.is_default) continue;
    next[key(row.class_key, ability.ability_key)] = {
      abilityKey: ability.ability_key,
      mechanicKey: ability.mechanic_key,
      amountCalc: asCalc(ability.amount_calc),
      durationCalc: asCalc(ability.duration_calc),
      intervalMs: ability.interval_ms ?? null,
      effectConfig: (ability.effect_config as Record<string, unknown>) ?? {},
    };
  }
  if (Object.keys(next).length === 0) return; // keep whatever we had
  for (const k of Object.keys(REGISTRY)) delete REGISTRY[k];
  Object.assign(REGISTRY, next);
}

export async function loadAbilityCalcs(db: any, force = false): Promise<void> {
  if (!force && Date.now() - loadedAt < TTL_MS && Object.keys(REGISTRY).length > 0) return;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const { data, error } = await db
        .from('class_ability_assignments')
        .select('class_key,is_default,status,ability:abilities(ability_key,mechanic_key,status,amount_calc,duration_calc,interval_ms,effect_config)');
      if (error) throw error;
      if (data && data.length > 0) {
        setServerAbilityCalcs(data);
        loadedAt = Date.now();
      }
    } catch (err) {
      // Non-fatal: handlers fall back to their legacy inline formulas.
      console.error('[ability-calcs] load failed, using legacy formulas:', err);
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

export function getServerAbilityCalcs(
  classKey: string, abilityKey: string,
): ServerAbilityCalcEntry | null {
  return REGISTRY[key(classKey, abilityKey)] ?? null;
}

/** Build evaluator inputs from raw stats already including gear bonuses. */
export function buildServerCalcInputs(
  level: number,
  stats: Partial<Record<CalcStat, number>>,
): CalcInputs {
  const mod = (stat: CalcStat) => getStatModifier(stats[stat] ?? 10);
  return {
    level,
    mods: {
      str: mod('str'), dex: mod('dex'), con: mod('con'),
      int: mod('int'), wis: mod('wis'), cha: mod('cha'),
    },
  };
}

function resolve(
  which: 'amountCalc' | 'durationCalc',
  classKey: string, abilityKey: string, inputs: CalcInputs, legacy: number,
): number {
  const calc = getServerAbilityCalcs(classKey, abilityKey)?.[which];
  if (!calc) return legacy;
  return evaluateCalc(calc, inputs);
}

/** Configured magnitude, or `legacy` when unconfigured / mechanic-owned. */
export function resolveServerAmount(
  classKey: string, abilityKey: string, inputs: CalcInputs, legacy: number,
): number {
  return resolve('amountCalc', classKey, abilityKey, inputs, legacy);
}

/** Configured duration in ms, or `legacy` when unconfigured. */
export function resolveServerDuration(
  classKey: string, abilityKey: string, inputs: CalcInputs, legacy: number,
): number {
  return resolve('durationCalc', classKey, abilityKey, inputs, legacy);
}

/** Configured tick interval in ms, or `legacy` when unconfigured. */
export function resolveServerInterval(
  classKey: string, abilityKey: string, legacy: number,
): number {
  return getServerAbilityCalcs(classKey, abilityKey)?.intervalMs ?? legacy;
}

/**
 * Did the registry load at least once? Used by the magnitude resolver to
 * distinguish "no calc configured for this ability" (expected, mechanic-owned)
 * from "the registry itself is unavailable" (actionable).
 */
export function isAbilityRegistryLoaded(): boolean {
  return Object.keys(REGISTRY).length > 0;
}
