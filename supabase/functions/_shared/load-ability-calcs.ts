/**
 * load-ability-calcs.ts — Server-side loader for configurable ability
 * magnitudes **and canonical ability identity**.
 *
 * The client reads `amount_calc` / `duration_calc` / `interval_ms` from the
 * `abilities` table via `features/combat/utils/ability-calcs.ts`. Some ability
 * magnitudes are resolved on the server instead (stance seeding, persistent
 * DoT rows), so the tick functions need the same configuration.
 *
 * Key is `${class_key}:${ability_key}` — `ability_key` is the canonical queued
 * identity carried from the client, so **every active assignment is loaded**,
 * not only the `is_default` row. Otherwise a character who selected an
 * alternative in their loadout would silently resolve the default's numbers.
 *
 * Safety: legacy inline formulas are gone, so configuration must always be able
 * to answer. Two guarantees:
 *   1. The registry is **primed from the compiled `ABILITY_SEED`** at module
 *      load, so a database outage degrades to seeded (parity-proven) values,
 *      never to zero.
 *   2. A live refresh is **atomic**: every active row is validated against the
 *      shared publish contract first, and a single invalid row aborts the whole
 *      swap, keeping the previous fully valid registry.
 */
import { type AbilityCalc, type CalcInputs, type CalcStat } from './formulas/ability-calc.ts';
import { getStatModifier } from './formulas/stats.ts';
import { ABILITY_SEED, ABILITY_ROLE_SEED } from './config/ability-seed.ts';
import { validateAbilityForPublish } from './config/mechanic-templates.ts';

export interface ServerAbilityCalcEntry {
  abilityKey: string;
  mechanicKey: string;
  amountCalc: AbilityCalc | null;
  durationCalc: AbilityCalc | null;
  intervalMs: number | null;
  effectConfig: Record<string, unknown>;
  /** Named typed mechanic calcs from `abilities.mechanic_calcs`. */
  mechanicCalcs: Record<string, AbilityCalc>;
  // ── Identity / authorization ──────────────────────────────────
  classKey: string;
  /** `abilities.id` — null when the entry came from the compiled seed. */
  abilityId: string | null;
  /** `class_ability_roles.id` — null when the entry came from the compiled seed. */
  roleId: string | null;
  /** Config slot of the owning role (0-based). */
  roleSlot: number;
  isDefault: boolean;
  unlockLevel: number;
}

const TTL_MS = 60_000;
let loadedAt = 0;
let inflight: Promise<void> | null = null;
let lastRefreshRejected: string[] = [];
let liveRowsLoaded = false;

const REGISTRY: Record<string, ServerAbilityCalcEntry> = {};

const key = (classKey: string, abilityKey: string) => `${classKey}:${abilityKey}`;

const SEED_UNLOCK_BY_SLOT: Record<number, number> = Object.fromEntries(
  ABILITY_ROLE_SEED.map(r => [r.slot, r.unlock_level]),
);

function seedRegistry(): Record<string, ServerAbilityCalcEntry> {
  const out: Record<string, ServerAbilityCalcEntry> = {};
  for (const a of ABILITY_SEED) {
    out[key(a.class_key, a.ability_key)] = {
      abilityKey: a.ability_key,
      mechanicKey: a.mechanic_key,
      amountCalc: a.amount_calc,
      durationCalc: a.duration_calc,
      intervalMs: a.interval_ms,
      effectConfig: (a.effect_config as Record<string, unknown>) ?? {},
      mechanicCalcs: a.mechanic_calcs ?? {},
      classKey: a.class_key,
      abilityId: null,
      roleId: null,
      roleSlot: a.slot,
      isDefault: true,
      unlockLevel: SEED_UNLOCK_BY_SLOT[a.slot] ?? 1,
    };
  }
  return out;
}

/** Compiled fallback: the seed is the same data the tables were seeded from. */
Object.assign(REGISTRY, seedRegistry());

function asCalc(value: unknown): AbilityCalc | null {
  if (!value || typeof value !== 'object') return null;
  const calc = value as AbilityCalc;
  if (!Array.isArray(calc.terms) || typeof calc.base !== 'number') return null;
  return calc;
}

/** Coerce the stored `mechanic_calcs` object into calc records (shape only). */
function asMechanicCalcs(value: unknown): Record<string, AbilityCalc> {
  if (!value || typeof value !== 'object') return {};
  const out: Record<string, AbilityCalc> = {};
  for (const [param, raw] of Object.entries(value as Record<string, unknown>)) {
    const calc = asCalc(raw);
    if (calc) out[param] = calc;
  }
  return out;
}

export interface RegistrySwapResult {
  applied: boolean;
  entries: number;
  errors: string[];
}

/**
 * Replace the registry contents from joined assignment rows.
 *
 * Atomic: the swap either applies in full or not at all. Any active row that
 * fails the shared publish contract aborts the swap so live combat keeps
 * resolving the previous, fully valid configuration instead of running on a
 * half-valid registry.
 */
export function setServerAbilityCalcs(rows: any[]): RegistrySwapResult {
  const next: Record<string, ServerAbilityCalcEntry> = {};
  const errors: string[] = [];

  for (const row of rows ?? []) {
    const ability = row?.ability;
    if (!ability) continue;
    if (row.status !== 'active' || ability.status !== 'active') continue;

    const label = `${row.class_key}:${ability.ability_key}`;
    const amountCalc = asCalc(ability.amount_calc);
    const durationCalc = asCalc(ability.duration_calc);
    const mechanicCalcs = asMechanicCalcs(ability.mechanic_calcs);

    // Shape coercion must not silently drop a configured calc.
    if (ability.amount_calc && !amountCalc) errors.push(`${label}: amount_calc is malformed`);
    if (ability.duration_calc && !durationCalc) errors.push(`${label}: duration_calc is malformed`);
    const rawParams = Object.keys(
      (ability.mechanic_calcs && typeof ability.mechanic_calcs === 'object')
        ? ability.mechanic_calcs as Record<string, unknown>
        : {},
    );
    for (const param of rawParams) {
      if (!(param in mechanicCalcs)) errors.push(`${label}: mechanic_calcs.${param} is malformed`);
    }

    for (const err of validateAbilityForPublish({
      mechanic_key: ability.mechanic_key,
      amount_calc: amountCalc,
      duration_calc: durationCalc,
      interval_ms: ability.interval_ms ?? null,
      mechanic_calcs: mechanicCalcs,
      status: 'active',
    })) {
      errors.push(`${label}: ${err}`);
    }

    next[key(row.class_key, ability.ability_key)] = {
      abilityKey: ability.ability_key,
      mechanicKey: ability.mechanic_key,
      amountCalc,
      durationCalc,
      intervalMs: ability.interval_ms ?? null,
      effectConfig: (ability.effect_config as Record<string, unknown>) ?? {},
      mechanicCalcs,
      classKey: row.class_key,
      abilityId: row.ability_id ?? ability.id ?? null,
      roleId: row.role_id ?? row.role?.id ?? null,
      roleSlot: row.role?.slot ?? 0,
      isDefault: Boolean(row.is_default),
      unlockLevel: Number(row.unlock_level ?? 1),
    };
  }

  const entries = Object.keys(next).length;
  lastRefreshRejected = errors;

  if (entries === 0) {
    return { applied: false, entries, errors: errors.length ? errors : ['no active assignments returned'] };
  }
  if (errors.length > 0) {
    // Keep the previous fully valid registry — never run combat on a
    // half-valid configuration.
    return { applied: false, entries, errors };
  }

  for (const k of Object.keys(REGISTRY)) delete REGISTRY[k];
  Object.assign(REGISTRY, next);
  liveRowsLoaded = true;
  return { applied: true, entries, errors };
}

export async function loadAbilityCalcs(db: any, force = false): Promise<void> {
  if (!force && Date.now() - loadedAt < TTL_MS && Object.keys(REGISTRY).length > 0) return;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const { data, error } = await db
        .from('class_ability_assignments')
        .select('class_key,ability_id,role_id,is_default,status,unlock_level,role:class_ability_roles(id,slot),ability:abilities(id,ability_key,mechanic_key,status,amount_calc,duration_calc,interval_ms,effect_config,mechanic_calcs)');
      if (error) throw error;
      if (data && data.length > 0) {
        const result = setServerAbilityCalcs(data);
        if (result.applied) {
          loadedAt = Date.now();
        } else {
          console.error(
            '[ability-calcs] refresh rejected, keeping previous registry:',
            result.errors.slice(0, 10),
          );
        }
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

/** Every active assignment for `classKey` (identity + calcs). */
export function getServerClassAbilities(classKey: string): ServerAbilityCalcEntry[] {
  return Object.values(REGISTRY).filter(e => e.classKey === classKey);
}

/**
 * Legacy compat: queued payloads that predate `ability_key` only carry the
 * mechanic dispatch hint. Map the shared mechanic names back onto the ability
 * that owns the configuration. New clients always send `ability_key`.
 */
const LEGACY_ABILITY_KEY_BY_TYPE: Record<string, string> = {
  multi_attack: 'barrage', execute_attack: 'eviscerate',
  ignite_consume: 'conflagrate', burst_damage: 'grand_finale',
  dot_debuff: 'rend',
};

export interface AbilityAuthorization {
  /** Resolved registry entry, or null when the cast is rejected. */
  entry: ServerAbilityCalcEntry | null;
  /** Canonical ability key used for configuration lookups. */
  abilityKey: string;
  /** Authoritative role/bar slot, derived server-side (never from the client). */
  roleSlot: number;
  /** Rejection reason, or null when authorized. */
  error: string | null;
}

/**
 * Server-side authorization for one queued cast.
 *
 * The client's `ability_key` is a claim, not a permission: the cast is only
 * allowed when that key is an active assignment for the character's own class
 * and the character has reached its unlock level. The role/bar slot is derived
 * from the registry, so a client cannot mint a slot it does not own.
 *
 * Rejection must happen before any resource mutation (CP spend, cooldown).
 */
export function authorizeQueuedAbility(args: {
  classKey: string;
  level: number;
  abilityKey?: string | null;
  abilityType?: string | null;
}): AbilityAuthorization {
  const classKey = args.classKey || '';
  const claimed = (args.abilityKey || '').trim();
  const abilityKey = claimed
    || LEGACY_ABILITY_KEY_BY_TYPE[args.abilityType || '']
    || (args.abilityType || '');

  if (!abilityKey) {
    return { entry: null, abilityKey: '', roleSlot: -1, error: 'no ability specified' };
  }

  let entry = getServerAbilityCalcs(classKey, abilityKey);
  // Legacy compat: an old client sent only the mechanic hint and this class
  // renames that mechanic's ability (templar `smite` → `judgment`). Resolve by
  // mechanic within the character's own class — never across classes.
  if (!entry && !claimed && args.abilityType) {
    entry = getServerClassAbilities(classKey)
      .find(e => e.mechanicKey === args.abilityType) ?? null;
  }
  if (!entry) {
    return {
      entry: null, abilityKey, roleSlot: -1,
      error: `"${abilityKey}" is not an available technique for ${classKey || 'this class'}`,
    };
  }
  if ((args.level || 1) < entry.unlockLevel) {
    return {
      entry: null, abilityKey, roleSlot: entry.roleSlot,
      error: `"${abilityKey}" unlocks at level ${entry.unlockLevel}`,
    };
  }
  return { entry, abilityKey: entry.abilityKey, roleSlot: entry.roleSlot, error: null };
}


/** Errors from the most recent rejected refresh (empty when healthy). */
export function getLastRegistryRejection(): string[] {
  return lastRefreshRejected;
}

/** True once live database rows have replaced the compiled seed. */
export function isLiveAbilityRegistryLoaded(): boolean {
  return liveRowsLoaded;
}

/** Reset to the compiled seed (tests only). */
export function resetServerAbilityCalcs(): void {
  for (const k of Object.keys(REGISTRY)) delete REGISTRY[k];
  Object.assign(REGISTRY, seedRegistry());
  loadedAt = 0;
  liveRowsLoaded = false;
  lastRefreshRejected = [];
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
