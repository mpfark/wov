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
 * Safety (checkpoint 7): legacy inline formulas are gone, so configuration must
 * always be able to answer. The registry is therefore **primed from the
 * compiled `ABILITY_SEED`** at module load and only ever replaced by live rows.
 * A database outage degrades to the seeded (parity-proven) values, never to
 * zero.
 */
import { type AbilityCalc, type CalcInputs, type CalcStat } from './formulas/ability-calc.ts';
import { getStatModifier } from './formulas/stats.ts';
import { ABILITY_SEED } from './config/ability-seed.ts';

export interface ServerAbilityCalcEntry {
  abilityKey: string;
  mechanicKey: string;
  amountCalc: AbilityCalc | null;
  durationCalc: AbilityCalc | null;
  intervalMs: number | null;
  effectConfig: Record<string, unknown>;
  /** Named typed mechanic calcs from `abilities.mechanic_calcs`. */
  mechanicCalcs: Record<string, AbilityCalc>;
}

const TTL_MS = 60_000;
let loadedAt = 0;
let inflight: Promise<void> | null = null;

const REGISTRY: Record<string, ServerAbilityCalcEntry> = {};

const key = (classKey: string, abilityKey: string) => `${classKey}:${abilityKey}`;

/** Compiled fallback: the seed is the same data the tables were seeded from. */
for (const a of ABILITY_SEED) {
  REGISTRY[key(a.class_key, a.ability_key)] = {
    abilityKey: a.ability_key,
    mechanicKey: a.mechanic_key,
    amountCalc: a.amount_calc,
    durationCalc: a.duration_calc,
    intervalMs: a.interval_ms,
    effectConfig: (a.effect_config as Record<string, unknown>) ?? {},
    mechanicCalcs: a.mechanic_calcs ?? {},
  };
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
      mechanicCalcs: asMechanicCalcs(ability.mechanic_calcs),
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
        .select('class_key,is_default,status,ability:abilities(ability_key,mechanic_key,status,amount_calc,duration_calc,interval_ms,effect_config,mechanic_calcs)');
      if (error) throw error;
      if (data && data.length > 0) {
        setServerAbilityCalcs(data);
        loadedAt = Date.now();
      }
    } catch (err) {
      // Non-fatal: the seeded registry keeps serving parity-proven values.
      console.error('[ability-calcs] load failed, using seeded calcs:', err);
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

/**
 * Is any configuration available at all? Always true in practice — the compiled
 * seed primes the registry — but the resolver keeps the check so a future
 * seed-less deployment reports an actionable failure instead of silent zeroes.
 */
export function isAbilityRegistryLoaded(): boolean {
  return Object.keys(REGISTRY).length > 0;
}

