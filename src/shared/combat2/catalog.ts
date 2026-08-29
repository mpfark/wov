/**
 * combat2/catalog.ts — the typed adapter from the game's REAL authored ability
 * configuration to the resolver's `AbilitySpec`.
 *
 * Input rows are the live composition of `class_ability_assignments x abilities
 * x base_abilities` (the shape `scripts/dump-active-ability-inventory.ts`
 * produces). Nothing here branches on an ability identity: every knob is read
 * from the authored record.
 *
 * The adapter is deliberately CLOSED and strict:
 *   - a mechanic outside `MECHANIC_KEYS` is rejected, never mapped by guesswork;
 *   - a record missing a calculation its mechanic needs is rejected, never
 *     silently resolved to zero;
 *   - a structurally invalid `AbilityCalc` is rejected with the evaluator's own
 *     validation messages.
 *
 * Rejections are returned, not thrown: the caller (a worker, later) decides
 * whether an unusable ability blocks a release. Rejected abilities simply do not
 * exist for the resolver, so they can never resolve to invented numbers.
 */

import { validateCalc, type AbilityCalc } from '../formulas/ability-calc';
import { isAccuracyStat, type AccuracyStat } from '../formulas/combat';
import { isMechanicKey, type MechanicKey } from './types';
import type { AbilitySpec, AbilityActivation, AbilityTargetType } from './mechanics';

/** One authored, active ability record. Field names mirror the inventory dump. */
export interface AuthoredAbilityRecord {
  classKey: string;
  classAbilityKey: string;
  abilityKey: string;
  label: string | null;
  unlockLevel?: number | null;
  mechanic: string | null;
  targetType: string | null;
  activationMode: string | null;
  damageType: string | null;
  cpCost: number | null;
  cpReservePct: number | null;
  intervalMs: number | null;
  amountCalc: unknown;
  durationCalc: unknown;
  mechanicCalcs: Record<string, unknown> | null;
  effectConfig: Record<string, unknown> | null;
}

export interface CatalogRejection {
  abilityKey: string;
  classKey: string;
  mechanic: string | null;
  reason:
    | 'unsupported_mechanic'
    | 'invalid_target_type'
    | 'invalid_activation'
    | 'missing_amount_calc'
    | 'missing_mechanic_calc'
    | 'missing_duration_calc'
    | 'missing_interval'
    | 'missing_cp_reserve'
    | 'invalid_calc';
  detail?: string;
}

export interface AbilityCatalog {
  /** Usable specs, keyed `"<classKey>:<abilityKey>"` and by bare ability key. */
  specs: ReadonlyMap<string, AbilitySpec>;
  rejected: readonly CatalogRejection[];
}

const TARGET_TYPES: readonly AbilityTargetType[] = ['self', 'ally', 'party', 'enemy', 'node'];
const ACTIVATIONS: readonly AbilityActivation[] = ['queued', 'instant', 'stance'];

/**
 * Mechanic-level normalization of authored mechanic spellings onto the closed
 * registry. This is a MECHANIC decision, never an ability-identity branch: the
 * authored `reactive_holy` mechanic is the reactive-retaliation lifecycle
 * (a self-owned effect that retaliates against an attacker, magnitude from
 * `retaliation_damage`, no independent pulse schedule) configured with a holy
 * damage type. Its damage type, magnitude calculation, duration, trigger
 * configuration and source attribution are all carried through unchanged from
 * the authored record; only the registry key is normalized, and the authored
 * spelling stays visible on the spec as `authoredMechanic`.
 */
const MECHANIC_NORMALIZATION: Readonly<Record<string, MechanicKey>> = {
  reactive_holy: 'reactive_damage',
};

/** Mechanics whose magnitude comes from `amount_calc`. */
const NEEDS_AMOUNT: readonly MechanicKey[] = [
  'weapon_attack', 'spell_attack', 'multi_attack', 'burst_damage', 'dot_debuff',
  'heal', 'hp_transfer', 'party_regen', 'absorb_buff', 'mitigation_buff',
  'evasion_buff', 'offense_buff', 'regen_buff', 'stealth_buff', 'control_debuff',
  'stack_apply', 'stack_consume', 'aura_pulse',
];

/** Named mechanic calcs each mechanic cannot work without. */
const NEEDS_MECHANIC_CALCS: Partial<Record<MechanicKey, readonly string[]>> = {
  multi_attack: ['arrow_count'],
  stack_consume: ['per_stack_multiplier'],
  block_buff: ['block_amount', 'block_chance'],
  reactive_damage: ['retaliation_damage'],
};


/** Mechanics that pulse on an interval and are meaningless without one. */
const NEEDS_INTERVAL: readonly MechanicKey[] = ['dot_debuff', 'party_regen', 'aura_pulse'];

/**
 * Mechanics whose effect is time-limited. A `stance` activation is exempt: its
 * lifetime is the stance itself (see `mem://game/stance-lifecycle`), which is
 * why Battle Cry authors no duration.
 */
const NEEDS_DURATION: readonly MechanicKey[] = [
  'dot_debuff', 'absorb_buff', 'mitigation_buff', 'evasion_buff', 'offense_buff',
  'regen_buff', 'stealth_buff', 'control_debuff', 'party_regen', 'aura_pulse',
];

function asCalc(value: unknown): AbilityCalc | null {
  if (!value || typeof value !== 'object') return null;
  const calc = value as AbilityCalc;
  return typeof calc.base === 'number' && Array.isArray(calc.terms) ? calc : null;
}

function readStat(config: Record<string, unknown>, key: string): AccuracyStat | null {
  const raw = config[key];
  return isAccuracyStat(raw) ? raw : null;
}

function readNumber(config: Record<string, unknown>, key: string): number | null {
  const raw = config[key];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

function readBool(config: Record<string, unknown>, key: string): boolean {
  return config[key] === true;
}

/** Build one spec, or explain precisely why the record is unusable. */
export function buildAbilitySpec(
  record: AuthoredAbilityRecord,
): { spec: AbilitySpec } | { rejection: CatalogRejection } {
  const reject = (
    reason: CatalogRejection['reason'],
    detail?: string,
  ): { rejection: CatalogRejection } => ({
    rejection: {
      abilityKey: record.abilityKey,
      classKey: record.classKey,
      mechanic: record.mechanic,
      reason,
      detail,
    },
  });

  if (!isMechanicKey(record.mechanic)) {
    return reject('unsupported_mechanic', record.mechanic ?? 'null');
  }
  const mechanic: MechanicKey = record.mechanic;

  const targetType = record.targetType as AbilityTargetType | null;
  if (!targetType || !TARGET_TYPES.includes(targetType)) {
    return reject('invalid_target_type', String(record.targetType));
  }
  const activation = record.activationMode as AbilityActivation | null;
  if (!activation || !ACTIVATIONS.includes(activation)) {
    return reject('invalid_activation', String(record.activationMode));
  }

  const config = record.effectConfig ?? {};
  const amountCalc = asCalc(record.amountCalc);
  const durationCalc = asCalc(record.durationCalc);

  const mechanicCalcs: Record<string, AbilityCalc> = {};
  for (const [key, raw] of Object.entries(record.mechanicCalcs ?? {})) {
    const calc = asCalc(raw);
    if (calc) mechanicCalcs[key] = calc;
  }

  if (NEEDS_AMOUNT.includes(mechanic) && !amountCalc) return reject('missing_amount_calc');

  for (const required of NEEDS_MECHANIC_CALCS[mechanic] ?? []) {
    if (!mechanicCalcs[required]) return reject('missing_mechanic_calc', required);
  }

  if (NEEDS_INTERVAL.includes(mechanic) && !(record.intervalMs && record.intervalMs > 0)) {
    return reject('missing_interval');
  }

  if (activation === 'stance' && !(record.cpReservePct && record.cpReservePct > 0)) {
    return reject('missing_cp_reserve');
  }

  if (NEEDS_DURATION.includes(mechanic) && activation !== 'stance' && !durationCalc) {
    return reject('missing_duration_calc');
  }

  for (const [label, calc] of [
    ['amount_calc', amountCalc],
    ['duration_calc', durationCalc],
    ...Object.entries(mechanicCalcs),
  ] as Array<[string, AbilityCalc | null]>) {
    if (!calc) continue;
    const problems = validateCalc(calc);
    if (problems.length > 0) return reject('invalid_calc', `${label}: ${problems.join('; ')}`);
  }

  const spec: AbilitySpec = {
    abilityKey: record.abilityKey,
    classKey: record.classKey,
    classAbilityKey: record.classAbilityKey,
    label: record.label ?? record.abilityKey,
    mechanic,
    targetType,
    activation,
    damageType: record.damageType ?? null,
    accuracyStat: readStat(config, 'accuracy_stat') ?? 'dex',
    scalingStat: readStat(config, 'stat') ?? readStat(config, 'magnitude_stat') ?? 'str',
    cpCost: Math.max(0, record.cpCost ?? 0),
    cpReservePct: record.cpReservePct ?? null,
    amountCalc,
    durationCalc,
    mechanicCalcs,
    intervalMs: record.intervalMs && record.intervalMs > 0 ? record.intervalMs : null,
    weaponBased: readBool(config, 'weapon_based') || readBool(config, 'weapon_scaled'),
    unarmedDie: readNumber(config, 'unarmed_die'),
    requiresShield: readBool(config, 'requires_shield'),
    effectType: typeof config.effect_type === 'string' ? config.effect_type : null,
    stackType: typeof config.stack_type === 'string' ? config.stack_type : null,
    config,
  };
  return { spec };
}

/** Build the whole catalogue. Unusable records are reported, never mapped. */
export function buildAbilityCatalog(records: readonly AuthoredAbilityRecord[]): AbilityCatalog {
  const specs = new Map<string, AbilitySpec>();
  const rejected: CatalogRejection[] = [];
  for (const record of records) {
    const result = buildAbilitySpec(record);
    if ('rejection' in result) {
      rejected.push(result.rejection);
      continue;
    }
    specs.set(`${result.spec.classKey}:${result.spec.abilityKey}`, result.spec);
    if (!specs.has(result.spec.abilityKey)) specs.set(result.spec.abilityKey, result.spec);
  }
  return { specs, rejected };
}

/** Resolve a spec for one actor, preferring the class-scoped entry. */
export function lookupSpec(
  catalog: AbilityCatalog,
  classKey: string | null,
  abilityKey: string,
): AbilitySpec | undefined {
  return catalog.specs.get(`${classKey ?? ''}:${abilityKey}`) ?? catalog.specs.get(abilityKey);
}
