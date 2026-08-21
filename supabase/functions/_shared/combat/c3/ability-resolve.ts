/**
 * c3/ability-resolve.ts — the ONE place a configured ability row becomes the
 * numbers the pure resolver consumes.
 *
 * Inputs are an already-composed ability configuration entry (base ability +
 * configured use + applied status, exactly the shape
 * `load-ability-calcs.ts` publishes) plus the caster's snapshotted level,
 * attribute modifiers and weapon die. Output is the closed
 * `ResolvedAbilityConfig`, which the snapshot decoder copies verbatim onto
 * `ActionSnapshot`.
 *
 * Rules:
 *  1. No database handle, no clock, no Realtime, no randomness. Dice inside
 *     calcs resolve in deterministic `average` mode: every roll that must be
 *     random happens INSIDE the pure resolver through seeded RNG.
 *  2. Configuration is the only source of numbers. A missing or malformed calc
 *     is an actionable failure surfaced through `failures`, never a silent 0.
 *  3. Mechanic parameters are mapped explicitly per mechanic. A mechanic with
 *     no parameters yields `undefined`, never a partially filled object.
 */

import { evaluateCalc, type AbilityCalc, type CalcInputs, type CalcStat } from '../../formulas/ability-calc.ts';
import { isResolverMechanic, type ResolverMechanic } from '../pure/mechanics.ts';
import type { ActionParamsSnapshot, Attributes } from '../pure/types.ts';

/** The composed-ability fields this module reads. */
export interface AbilityConfigEntry {
  readonly abilityKey: string;
  readonly classAbilityKey: string;
  readonly classKey: string;
  readonly mechanicKey: string;
  readonly amountCalc: AbilityCalc | null;
  readonly durationCalc: AbilityCalc | null;
  readonly intervalMs: number | null;
  readonly mechanicCalcs: Readonly<Record<string, AbilityCalc>>;
  readonly effectConfig: Readonly<Record<string, unknown>>;
  readonly cpCost: number;
  readonly damageType: string | null;
  readonly unlockLevel: number;
  readonly label: string;
}

/** Caster state the calcs are evaluated against (all from the DB snapshot). */
export interface AbilityCasterInputs {
  readonly level: number;
  readonly attrMods: Attributes;
  readonly weaponDie: number | null;
}

/** Everything `ActionSnapshot` needs, resolved from configuration. */
export interface ResolvedAbilityConfig {
  readonly mechanic: ResolverMechanic;
  readonly damageType: string | null;
  readonly cpCost: number;
  readonly amount: number;
  readonly durationMs: number;
  readonly intervalMs: number;
  readonly statusKey: string | null;
  readonly statusChancePct: number;
  readonly maxStacks: number;
  readonly weaponBased: boolean;
  readonly params?: ActionParamsSnapshot;
  /** Actionable configuration problems (empty on a healthy resolve). */
  readonly failures: readonly string[];
}

const STATS: readonly CalcStat[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

function calcInputs(caster: AbilityCasterInputs): CalcInputs {
  const mods = {} as Record<CalcStat, number>;
  for (const s of STATS) mods[s] = num((caster.attrMods as Record<string, unknown>)[s], 0);
  return {
    level: caster.level,
    mods,
    weaponDie: caster.weaponDie,
    // Deterministic: dice/range randomness belongs to the seeded resolver.
    diceMode: 'average',
    rangeMode: 'mid',
  };
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function bool(v: unknown): boolean {
  return v === true;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/**
 * Read a closed-vocabulary configuration field.
 *
 * A missing field falls back to the documented default; a *present but
 * unknown* value fails closed with an actionable failure instead of silently
 * selecting a materially different mechanic (e.g. percent instead of flat
 * mitigation).
 */
function enumParam<T extends string>(
  cfg: Record<string, unknown>,
  key: string,
  values: readonly T[],
  fallback: T,
  label: string,
  failures: string[],
): T {
  const raw = cfg[key];
  if (raw === undefined || raw === null || raw === '') return fallback;
  if (typeof raw === 'string' && (values as readonly string[]).includes(raw)) return raw as T;
  failures.push(
    `${label} effect_config.${key}: '${String(raw)}' is not one of ${values.join(' | ')}`,
  );
  return fallback;
}


/** Evaluate one calc, reporting an actionable failure instead of guessing. */
function evalCalc(
  calc: AbilityCalc | null | undefined,
  inputs: CalcInputs,
  label: string,
  required: boolean,
  failures: string[],
): number {
  if (!calc) {
    if (required) failures.push(`${label}: unconfigured`);
    return 0;
  }
  const value = evaluateCalc(calc, inputs);
  if (!Number.isFinite(value)) {
    failures.push(`${label}: did not evaluate to a finite number`);
    return 0;
  }
  return value;
}

/** Named mechanic parameter (`abilities.mechanic_calcs.<param>`). */
function evalParam(
  entry: AbilityConfigEntry,
  param: string,
  inputs: CalcInputs,
  required: boolean,
  failures: string[],
): number {
  return evalCalc(
    entry.mechanicCalcs[param],
    inputs,
    `${entry.classKey}:${entry.classAbilityKey} mechanic_calcs.${param}`,
    required,
    failures,
  );
}

/** Mechanics whose magnitude always rolls the weapon die. */
const WEAPON_MECHANICS = new Set<ResolverMechanic>(['weapon_attack', 'multi_attack']);

/**
 * Per-tick DoT magnitude of the applied status, resolved from the status
 * expansion the composer wrote into `effect_config` (`dot_*` keys).
 */
function dotPerTick(cfg: Record<string, unknown>, caster: AbilityCasterInputs): number {
  const flat = num(cfg.dot_flat_damage, 0);
  const statKey = str(cfg.dot_stat);
  const statMult = num(cfg.dot_stat_mult, 0);
  const globalMult = num(cfg.dot_global_mult, 1);
  const statMod = statKey ? num((caster.attrMods as Record<string, unknown>)[statKey], 0) : 0;
  return Math.max(0, Math.floor((flat + statMod * statMult) * globalMult));
}

/** Status duration from the status expansion, else the ability duration. */
function dotDurationMs(
  cfg: Record<string, unknown>,
  caster: AbilityCasterInputs,
  fallbackMs: number,
): number {
  const base = cfg.dot_duration_ms;
  if (typeof base !== 'number') return fallbackMs;
  const statKey = str(cfg.dot_duration_stat);
  const perPoint = num(cfg.dot_duration_per_point_ms, 0);
  const statMod = statKey ? num((caster.attrMods as Record<string, unknown>)[statKey], 0) : 0;
  const cap = num(cfg.dot_duration_cap_ms, Number.POSITIVE_INFINITY);
  return Math.min(cap, base + statMod * perPoint);
}

/**
 * Map the mechanic's configuration onto the closed `ActionParamsSnapshot`.
 * Every branch is explicit: a mechanic never inherits another's parameters.
 */
function resolveParams(
  mechanic: ResolverMechanic,
  entry: AbilityConfigEntry,
  caster: AbilityCasterInputs,
  inputs: CalcInputs,
  durationMs: number,
  failures: string[],
): ActionParamsSnapshot | undefined {
  const cfg = entry.effectConfig as Record<string, unknown>;
  switch (mechanic) {
    case 'multi_attack': {
      // The configured arrow count is authoritative and deterministic: the
      // per-arrow hit rolls are the random part and live in the resolver.
      const count = Math.max(1, Math.round(evalParam(entry, 'arrow_count', inputs, true, failures)));
      return { minHits: count, maxHits: count };
    }
    case 'burst_damage':
      return {
        // d20 threshold widening, not a probability.
        critEdge: Math.max(0, Math.round(evalParam(entry, 'crit_edge', inputs, true, failures))),
        critThresholdFloor: Math.max(2, Math.round(num(cfg.crit_threshold_floor, 17))),
      };


    case 'stack_consume':
      return {
        perStackMultiplier: evalParam(entry, 'per_stack_multiplier', inputs, true, failures),
        stackEffectType: str(cfg.stack_type) ?? str(cfg.effect_type) ?? 'poison',
      };
    case 'stack_apply': {
      // Authored vocabulary: `on_hit` (weapon hits) vs `pulse` (own heartbeat).
      // The legacy resolver name is accepted as an alias.
      const rawTrigger = str(cfg.trigger);
      const trigger = rawTrigger === 'pulse' || rawTrigger === 'successful_pulse_hit'
        ? 'successful_pulse_hit' as const
        : 'weapon_hit' as const;
      const pulseStat = str(cfg.pulse_damage_stat);
      const pulseStatMod = pulseStat
        ? num((caster.attrMods as Record<string, unknown>)[pulseStat], 0)
        : 0;
      return {
        // `amount_calc` is the proc chance for this base (0..1).
        procChance: Math.max(0, Math.min(1, evalCalc(entry.amountCalc, inputs, `${entry.classKey}:${entry.classAbilityKey} amount_calc`, true, failures))),
        stackTrigger: trigger,
        stackEffectType: str(cfg.effect_type) ?? 'poison',
        dotPerTick: dotPerTick(cfg, caster),
        // The LANDED stack keeps its own authored, finite lifetime — never the
        // stance's (which is reservation-backed and has no expiry).
        stackDurationMs: Math.max(0, Math.round(dotDurationMs(cfg, caster, durationMs))),
        pulseDamage: Math.max(
          0,
          Math.round(num(cfg.pulse_damage, num(cfg.pulse_damage_base, 0) + pulseStatMod)),
        ),
      };
    }

    case 'hp_transfer':
      return {
        reserveHp: Math.max(0, Math.round(evalParam(entry, 'reserve_hp', inputs, true, failures))),
        minReserveHp: Math.max(0, Math.round(num(cfg.min_reserve_hp, 0))),
      };
    case 'reactive_holy':
      return {
        retaliationDamage: Math.max(
          0,
          Math.round(evalParam(entry, 'retaliation_damage', inputs, true, failures)),
        ),
      };
    case 'block_buff':
      return {
        blockChance: evalParam(entry, 'block_chance', inputs, true, failures),
        blockAmount: Math.max(0, Math.round(evalParam(entry, 'block_amount', inputs, true, failures))),
        blockChanceCap: num(cfg.block_chance_cap, 1),
      };
    case 'evasion_buff': {
      const source = str(cfg.evasion_source) === 'disengage'
        ? 'disengage' as const
        : 'cloak' as const;
      const params: ActionParamsSnapshot = {
        dodgeChance: num(cfg.dodge_chance, 0),
        evasionSource: source,
        ...(typeof cfg.next_hit_window_ms === 'number'
          ? { nextHitWindowMs: cfg.next_hit_window_ms as number }
          : {}),
        ...(typeof cfg.next_hit_bonus_mult === 'number'
          ? { nextHitBonusMult: cfg.next_hit_bonus_mult as number }
          : {}),
      };
      return params;
    }
    case 'stealth_buff':
      // `amount_calc` is the ambush multiplier for this base.
      return {
        ambushMult: evalCalc(
          entry.amountCalc, inputs,
          `${entry.classKey}:${entry.classAbilityKey} amount_calc`, true, failures,
        ),
      };
    case 'regen_buff':
      return {
        hpPerTick: Math.max(0, Math.round(evalCalc(
          entry.amountCalc, inputs,
          `${entry.classKey}:${entry.classAbilityKey} amount_calc`, true, failures,
        ))),
        cpPerTick: Math.max(
          num(cfg.min_cp_per_tick, 0),
          Math.round(evalParam(entry, 'cp_per_tick', inputs, true, failures)),
        ),
        refreshPolicy: str(cfg.refresh_policy) === 'replace' ? 'replace' : 'best_of',
      };
    case 'party_regen':
      return {
        hpPerTick: Math.max(0, Math.round(evalCalc(
          entry.amountCalc, inputs,
          `${entry.classKey}:${entry.classAbilityKey} amount_calc`, true, failures,
        ))),
        healsAllies: true,
      };
    case 'aura_pulse':
      return {
        healsAllies: bool(cfg.heals_allies),
        damagesEnemies: bool(cfg.damages_enemies),
      };
    // Semantic modes: read explicitly, one branch per mechanic.
    case 'mitigation_buff':
      return {
        mode: enumParam(
          cfg, 'mitigation_mode', ['percent', 'flat'] as const, 'percent',
          `${entry.classKey}:${entry.classAbilityKey}`, failures,
        ),
      };
    case 'offense_buff':
      return {
        offenseMode: enumParam(
          cfg, 'offense_mode', ['damage_mult', 'crit_edge'] as const, 'damage_mult',
          `${entry.classKey}:${entry.classAbilityKey}`, failures,
        ),
      };
    case 'control_debuff':
      return {
        controlMode: enumParam(
          cfg, 'control_mode', ['ac_reduction', 'damage_reduction'] as const, 'damage_reduction',
          `${entry.classKey}:${entry.classAbilityKey}`, failures,
        ),
      };
    // Mechanics whose behaviour is fully described by the core fields.
    case 'weapon_attack':
    case 'spell_attack':
    case 'heal':
    case 'absorb_buff':
    case 'dot_debuff':
      void durationMs;
      return undefined;
  }

}

/**
 * Resolve one configured ability against one caster.
 *
 * The returned object is the complete authoritative description of the cast:
 * the handlers never re-derive magnitudes, and the client's queued numbers are
 * never read.
 */
export function resolveAbilityConfig(
  entry: AbilityConfigEntry,
  caster: AbilityCasterInputs,
): ResolvedAbilityConfig {
  const failures: string[] = [];
  const label = `${entry.classKey}:${entry.classAbilityKey}`;
  const inputs = calcInputs(caster);
  const cfg = entry.effectConfig as Record<string, unknown>;

  if (!isResolverMechanic(entry.mechanicKey)) {
    return {
      mechanic: 'weapon_attack',
      damageType: entry.damageType,
      cpCost: entry.cpCost,
      amount: 0, durationMs: 0, intervalMs: 0,
      statusKey: null, statusChancePct: 0, maxStacks: 0,
      weaponBased: false,
      failures: [`${label}: mechanic '${entry.mechanicKey}' is not implemented by the resolver`],
    };
  }
  const mechanic: ResolverMechanic = entry.mechanicKey;

  // Amount: required by every mechanic whose magnitude is not fully carried by
  // a named parameter. `stack_apply` / `stealth_buff` / `regen_buff` /
  // `party_regen` read `amount_calc` inside `resolveParams`, so the headline
  // amount is informational there and must not be double-reported.
  const amountInParams = mechanic === 'stack_apply' || mechanic === 'stealth_buff'
    || mechanic === 'regen_buff' || mechanic === 'party_regen';
  const amount = evalCalc(entry.amountCalc, inputs, `${label} amount_calc`, !amountInParams, failures);

  const configuredDuration = evalCalc(entry.durationCalc, inputs, `${label} duration_calc`, false, failures);
  const statusEnabled = bool(cfg.status_enabled);
  const statusKey = statusEnabled ? str(cfg.status_key) : null;
  const durationMs = Math.max(
    0,
    Math.round(statusKey ? dotDurationMs(cfg, caster, configuredDuration) : configuredDuration),
  );
  const intervalMs = Math.max(0, Math.round(num(cfg.tick_rate_ms, num(entry.intervalMs, 0))));

  const maxStacksCalc = entry.mechanicCalcs.max_stacks ?? (cfg.max_stacks_calc as AbilityCalc | undefined);
  const maxStacks = Math.max(
    0,
    Math.round(
      maxStacksCalc
        ? evalCalc(maxStacksCalc, inputs, `${label} max_stacks`, false, failures)
        : num(cfg.max_stacks, 0),
    ),
  );

  const params = resolveParams(mechanic, entry, caster, inputs, durationMs, failures);

  return {
    mechanic,
    damageType: entry.damageType,
    cpCost: Math.max(0, Math.round(entry.cpCost)),
    amount: Math.round(amount),
    durationMs,
    intervalMs,
    statusKey,
    statusChancePct: statusEnabled ? Math.max(0, Math.min(100, num(cfg.status_chance_pct, 100))) : 0,
    maxStacks,
    weaponBased: WEAPON_MECHANICS.has(mechanic) || bool(cfg.weapon_based),
    ...(params ? { params } : {}),
    failures,
  };
}
