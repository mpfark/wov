/**
 * combat2/mechanics.ts — the closed handler map.
 *
 * One typed handler per catalogue entry, each `(ctx, spec) => MechanicOutcome`.
 * Handlers are pure: they read the snapshot view they are given and return
 * proposed mutations. They never mutate the snapshot, never touch IO and never
 * branch on an ability identity — every number comes from the authored
 * `AbilityCalc` records carried by the spec (see `catalog.ts`).
 *
 * Magnitudes are evaluated by the retained `ability-calc` evaluator, with the
 * dice and the bounded-range randomness injected from the tick's seeded RNG, so
 * a re-resolved tick reproduces the same numbers exactly.
 */

import { getStatModifier } from '../formulas/stats.ts';
import { getClassCritRange } from '../formulas/classes.ts';
import {
  evaluateCalc,
  type AbilityCalc,
  type CalcContextKey,
  type CalcInputs,
  type CalcStat,
} from '../formulas/ability-calc.ts';
import {
  getAccuracyBonus,
  getAccuracyProficiency,
  getCombatInsightBonus,
  getHitQuality,
  HIT_QUALITY_MULT,
  GLANCING_WEAK_CAP,
  getWeaponDieForItem,
  getDexCritBonus,
  UNARMED_DIE,
  DEFAULT_WEAPON_PROGRESSION,
  type AccuracyStat,
  type WeaponProgressionConfig,
} from '../formulas/combat.ts';
import { applyMitigationPipeline, readMitigationParams } from './mitigation.ts';
import type {
  MechanicKey,
  ProposedEffectInsert,
  SnapshotCreature,
  SnapshotEquipment,
  SnapshotFighter,
  TickEvent,
} from './types.ts';
import type { TickRandom } from './rng.ts';

export type AbilityTargetType = 'self' | 'ally' | 'party' | 'enemy' | 'node';
export type AbilityActivation = 'queued' | 'instant' | 'stance';

/**
 * Authored ability definition, flattened from `abilities` + `base_abilities` +
 * the class assignment. Built ONLY by `catalog.ts`; never hand-written in
 * production code.
 */
export interface AbilitySpec {
  abilityKey: string;
  classKey: string;
  classAbilityKey: string;
  label: string;
  mechanic: MechanicKey;
  /**
   * The mechanic exactly as authored, before mechanic-level normalization onto
   * the closed registry (see `MECHANIC_NORMALIZATION` in `catalog.ts`). Kept so
   * a normalized mechanic is never silently indistinguishable from a native one.
   */
  authoredMechanic: string;
  targetType: AbilityTargetType;
  activation: AbilityActivation;
  damageType: string | null;
  accuracyStat: AccuracyStat;
  /** Primary scaling attribute, as authored (`stat` / `magnitude_stat`). */
  scalingStat: CalcStat;
  cpCost: number;
  /** Fraction of max CP reserved while a stance is active. */
  cpReservePct: number | null;
  amountCalc: AbilityCalc | null;
  durationCalc: AbilityCalc | null;
  mechanicCalcs: Record<string, AbilityCalc>;
  intervalMs: number | null;
  /** Authored: the magnitude includes the actor's weapon die. */
  weaponBased: boolean;
  /** Authored unarmed die override; falls back to the retained `UNARMED_DIE`. */
  unarmedDie: number | null;
  requiresShield: boolean;
  effectType: string | null;
  stackType: string | null;
  config: Record<string, unknown>;
}

export interface MechanicContext {
  rng: TickRandom;
  nowMs: number;
  tick: number;
  actor: SnapshotFighter;
  /** Creature target, when the mechanic is offensive. */
  creature?: SnapshotCreature;
  /** Character target, when the mechanic is supportive. */
  ally?: SnapshotFighter;
  /** Effective absorb pool on the target, if any. */
  targetAbsorb?: number;
  /** Existing stacks of the relevant stack type on the target. */
  existingStacks?: number;
  /** Sum of authored damage amplification on the target. */
  amplification?: number;
  /** Sunder-style AC reduction on the creature. */
  creatureAcReduction?: number;
  /** Installed weapon progression configuration, when known. */
  weaponProgression?: WeaponProgressionConfig;
}

export interface MechanicOutcome {
  /** Damage to apply to the creature target. */
  creatureDamage?: number;
  /** Damage to apply to the character target. */
  characterDamage?: number;
  /** Healing applied to the character target. */
  healing?: number;
  /** HP the actor sacrifices (`hp_transfer`). */
  actorHpCost?: number;
  /** CP the actor spends. */
  cpCost?: number;
  effects: ProposedEffectInsert[];
  /** Effect ids the outcome consumes (finishers). */
  consumeEffectIds: string[];
  events: Array<Omit<TickEvent, 'seq'>>;
  missed?: boolean;
  /** How many stacks a finisher burned (`stack_consume`). */
  meta_stacks_consumed?: number;
  /**
   * Set when the mechanic could not be resolved from authoritative data
   * (missing weapon contract, missing shield, absent target). The resolver
   * turns this into an `action_rejected` event and applies nothing.
   */
  rejected?: string;
}

const emptyOutcome = (): MechanicOutcome => ({ effects: [], consumeEffectIds: [], events: [] });

const iso = (ms: number): string => new Date(ms).toISOString();

// ── Equipment ───────────────────────────────────────────────────

export type WeaponDieResolution =
  | { kind: 'unarmed'; die: number }
  | { kind: 'weapon'; die: number }
  | { kind: 'incomplete'; missing: string[] };

/**
 * Resolve the actor's main-hand damage die from the authoritative equipment
 * projection.
 *
 * When a main hand IS equipped but the projection lacks the fields the retained
 * weapon formula needs, this returns `incomplete` — the resolver then rejects
 * the action instead of rolling an unjustifiable die.
 */
export function resolveMainHandDie(
  equipment: readonly SnapshotEquipment[],
  /** Unused: the die scales with the ITEM level, never the wielder's level. */
  _level: number,
  unarmedOverride: number | null = null,
  progression: WeaponProgressionConfig = DEFAULT_WEAPON_PROGRESSION,
): WeaponDieResolution {
  const main = equipment.find((row) => row.slot === 'main_hand');
  if (!main) return { kind: 'unarmed', die: unarmedOverride ?? UNARMED_DIE };

  // A main hand IS equipped: every field the retained formula reads must be
  // authored. A missing OR null value is incomplete, never defaulted.
  const missing: string[] = [];
  if (!main.item_present) missing.push('item');
  if (main.weapon_tag == null) missing.push('weapon_tag');
  if (main.hands == null) missing.push('hands');
  if (main.item_level == null && main.crafted_level == null) missing.push('item_level');
  if (main.rarity == null) missing.push('rarity');
  if (missing.length > 0) return { kind: 'incomplete', missing };

  const hands = main.hands === 2 ? 2 : 1;
  const itemLevel = main.item_level ?? main.crafted_level ?? 1;
  return {
    kind: 'weapon',
    die: getWeaponDieForItem(main.weapon_tag ?? null, hands, itemLevel, progression, main.rarity ?? null),
  };

}

/** True when the authoritative projection shows a shield in the off hand. */
export function hasShield(equipment: readonly SnapshotEquipment[]): boolean {
  return equipment.some(
    (row) => row.slot === 'off_hand' && (row.item_type ?? 'shield') === 'shield',
  );
}

// ── Authored magnitude evaluation ───────────────────────────────

function modsOf(actor: SnapshotFighter): Record<CalcStat, number> {
  return {
    str: getStatModifier(actor.str),
    dex: getStatModifier(actor.dex),
    con: getStatModifier(actor.con),
    int: getStatModifier(actor.int),
    wis: getStatModifier(actor.wis),
    cha: getStatModifier(actor.cha),
  };
}

function calcInputs(
  ctx: MechanicContext,
  spec: AbilitySpec,
  stream: string,
  weaponDie: number | null,
  context?: Partial<Record<CalcContextKey, number>>,
): CalcInputs {
  let draw = 0;
  return {
    level: ctx.actor.level,
    mods: modsOf(ctx.actor),
    context,
    weaponDie,
    roll: (sides) =>
      ctx.rng.roll(stream, sides, ctx.actor.character_id, spec.abilityKey, ctx.tick, draw++),
    random: () =>
      ctx.rng.sample(`${stream}:range`, ctx.actor.character_id, spec.abilityKey, ctx.tick, draw++),
  };
}

/** Evaluate the authored `amount_calc`. Returns null when none is authored. */
export function resolveAmount(
  ctx: MechanicContext,
  spec: AbilitySpec,
  stream: string,
  weaponDie: number | null,
  context?: Partial<Record<CalcContextKey, number>>,
): number | null {
  if (!spec.amountCalc) return null;
  return Math.max(0, Math.floor(evaluateCalc(spec.amountCalc, calcInputs(ctx, spec, stream, weaponDie, context))));
}

/** Evaluate the authored `duration_calc` in milliseconds. */
export function resolveDurationMs(ctx: MechanicContext, spec: AbilitySpec): number | null {
  if (!spec.durationCalc) return null;
  return Math.max(
    0,
    Math.floor(evaluateCalc(spec.durationCalc, calcInputs(ctx, spec, 'duration', null))),
  );
}

/** Evaluate one named mechanic calc. */
export function resolveMechanicCalc(
  ctx: MechanicContext,
  spec: AbilitySpec,
  name: string,
  context?: Partial<Record<CalcContextKey, number>>,
  weaponDie: number | null = null,
): number | null {
  const calc = spec.mechanicCalcs[name];
  if (!calc) return null;
  return evaluateCalc(calc, calcInputs(ctx, spec, `mechanic:${name}`, weaponDie, context));
}

/** Weapon die for this actor + spec, or a rejection when the contract is short. */
function weaponDieFor(
  ctx: MechanicContext,
  spec: AbilitySpec,
): { die: number | null } | { rejected: string } {
  if (!spec.weaponBased) return { die: null };
  const resolution = resolveMainHandDie(
    ctx.actor.equipment,
    ctx.actor.level,
    spec.unarmedDie,
    ctx.weaponProgression,
  );
  if (resolution.kind === 'incomplete') {
    return { rejected: `equipment_contract_incomplete:${resolution.missing.join(',')}` };
  }
  return { die: resolution.die };
}

export interface AttackDecision {
  hit: boolean;
  isCrit: boolean;
  isNat1: boolean;
  roll: number;
  total: number;
  margin: number;
  quality: string;
}

/** Deterministic to-hit decision. Identical inputs always give the same result. */
export function decideAttack(
  ctx: MechanicContext,
  spec: AbilitySpec,
  targetAc: number,
  stream: string,
  critEdge = 0,
): AttackDecision {
  const accStat = spec.accuracyStat;
  const accValue = ctx.actor[accStat as keyof SnapshotFighter] as number;
  const bonus =
    getAccuracyProficiency(ctx.actor.level) +
    getAccuracyBonus(getStatModifier(accValue)) +
    getCombatInsightBonus(accStat, ctx.actor.int);

  const roll = ctx.rng.d20(stream, ctx.actor.character_id, spec.abilityKey, ctx.tick);
  const critRange =
    getClassCritRange(ctx.actor.class ?? '') - getDexCritBonus(ctx.actor.dex) - critEdge;
  const total = roll + bonus;
  const effectiveAc = Math.max(0, targetAc - (ctx.creatureAcReduction ?? 0));
  const margin = total - effectiveAc;
  const isNat1 = roll === 1;
  const isCrit = roll >= critRange;
  const quality = getHitQuality(margin, isNat1, isCrit);
  return { hit: quality !== 'miss', isCrit, isNat1, roll, total, margin, quality };
}

function gradedCapFor(quality: string, margin: number): number | undefined {
  if (quality === 'glancing') return GLANCING_WEAK_CAP;
  if (quality === 'weak' && margin < -2) return GLANCING_WEAK_CAP;
  return undefined;
}

// ── Shared building blocks ──────────────────────────────────────

interface OffensiveOptions {
  /** Authored multiplier applied to the evaluated magnitude (per-stack riders). */
  multiplier?: number;
  /** Authored crit-range widening (`crit_edge`). */
  critEdge?: number;
  context?: Partial<Record<CalcContextKey, number>>;
}

function offensiveHit(
  ctx: MechanicContext,
  spec: AbilitySpec,
  stream: string,
  options: OffensiveOptions = {},
): MechanicOutcome {
  const outcome = emptyOutcome();
  outcome.cpCost = spec.cpCost;
  const creature = ctx.creature;
  if (!creature) {
    outcome.rejected = 'no_target';
    return outcome;
  }

  const weapon = weaponDieFor(ctx, spec);
  if ('rejected' in weapon) {
    outcome.rejected = weapon.rejected;
    return outcome;
  }

  const decision = decideAttack(ctx, spec, creature.ac, `${stream}:hit`, options.critEdge ?? 0);
  if (!decision.hit) {
    outcome.missed = true;
    outcome.events.push({
      kind: 'attack',
      abilityKey: spec.abilityKey,
      actor: { type: 'character', id: ctx.actor.character_id, name: ctx.actor.name },
      target: { type: 'creature', id: creature.creature_id, name: creature.name },
      hitQuality: 'miss',
      outcomeReason: decision.isNat1 ? 'critical_miss' : 'missed',
      amount: 0,
    });
    return outcome;
  }

  const authored = resolveAmount(ctx, spec, `${stream}:dmg`, weapon.die, options.context) ?? 0;
  const base = authored * (options.multiplier ?? 1);
  const qualityMult = HIT_QUALITY_MULT[decision.quality as keyof typeof HIT_QUALITY_MULT] ?? 1;
  const normal = Math.max(1, Math.floor(base * qualityMult));
  const critBonus = decision.isCrit ? Math.floor(normal * 0.5) : 0;

  const breakdown = applyMitigationPipeline({
    normalDamage: normal,
    critBonus,
    amplification: ctx.amplification,
    gradedCap: gradedCapFor(decision.quality, decision.margin),
    minimumDamage: 1,
  });

  outcome.creatureDamage = breakdown.applied;
  outcome.events.push({
    kind: 'attack',
    abilityKey: spec.abilityKey,
    actor: { type: 'character', id: ctx.actor.character_id, name: ctx.actor.name },
    target: { type: 'creature', id: creature.creature_id, name: creature.name },
    hitQuality: decision.quality,
    amount: breakdown.applied,
    meta: {
      isCrit: decision.isCrit,
      roll: decision.roll,
      total: decision.total,
      damageType: spec.damageType,
      weaponDie: weapon.die,
    },
  });
  return outcome;
}

function buffEffect(
  ctx: MechanicContext,
  spec: AbilitySpec,
  kind: string,
  targetCharacterId: string,
  magnitude: number,
  extraConfig: Record<string, unknown> = {},
): ProposedEffectInsert {
  const durationMs = resolveDurationMs(ctx, spec);
  const isStance = spec.activation === 'stance';
  return {
    kind,
    effect_type: spec.effectType ?? spec.abilityKey,
    ability_key: spec.abilityKey,
    target_character_id: targetCharacterId,
    source_character_id: ctx.actor.character_id,
    stacks: 1,
    magnitude,
    config: { ...spec.config, ...extraConfig },
    // A stance has no wall-clock expiry: its lifetime is the stance itself.
    expires_at: isStance || !durationMs ? null : iso(ctx.nowMs + durationMs),
    next_due_at: spec.intervalMs ? iso(ctx.nowMs + spec.intervalMs) : null,
    interval_ms: spec.intervalMs,
    is_reservation: false,
  };
}

function characterBuff(ctx: MechanicContext, spec: AbilitySpec, kind: string): MechanicOutcome {
  const outcome = emptyOutcome();
  outcome.cpCost = spec.cpCost;
  const magnitude = resolveAmount(ctx, spec, `${kind}:mag`, null) ?? 0;
  const targets: SnapshotFighter[] =
    spec.targetType === 'ally' && ctx.ally ? [ctx.ally] : [ctx.actor];
  for (const target of targets) {
    outcome.effects.push(buffEffect(ctx, spec, kind, target.character_id, magnitude));
    outcome.events.push({
      kind: 'buff_applied',
      abilityKey: spec.abilityKey,
      actor: { type: 'character', id: ctx.actor.character_id, name: ctx.actor.name },
      target: { type: 'character', id: target.character_id, name: target.name },
      amount: magnitude,
      meta: { effectKind: kind, durationMs: resolveDurationMs(ctx, spec), stance: spec.activation === 'stance' },
    });
  }
  return outcome;
}

function creatureDebuff(ctx: MechanicContext, spec: AbilitySpec, kind: string): MechanicOutcome {
  const outcome = emptyOutcome();
  outcome.cpCost = spec.cpCost;
  const creature = ctx.creature;
  if (!creature) {
    outcome.rejected = 'no_target';
    return outcome;
  }
  const weapon = weaponDieFor(ctx, spec);
  if ('rejected' in weapon) {
    outcome.rejected = weapon.rejected;
    return outcome;
  }
  const magnitude = resolveAmount(ctx, spec, `${kind}:mag`, weapon.die) ?? 0;
  const durationMs = resolveDurationMs(ctx, spec);
  outcome.effects.push({
    kind,
    effect_type: spec.effectType ?? spec.abilityKey,
    ability_key: spec.abilityKey,
    target_creature_id: creature.creature_id,
    source_character_id: ctx.actor.character_id,
    stacks: 1,
    magnitude,
    config: spec.config,
    expires_at: durationMs ? iso(ctx.nowMs + durationMs) : null,
    next_due_at: spec.intervalMs ? iso(ctx.nowMs + spec.intervalMs) : null,
    interval_ms: spec.intervalMs,
    is_reservation: false,
  });
  outcome.events.push({
    kind: kind === 'dot' ? 'dot_applied' : 'debuff_applied',
    abilityKey: spec.abilityKey,
    actor: { type: 'character', id: ctx.actor.character_id, name: ctx.actor.name },
    target: { type: 'creature', id: creature.creature_id, name: creature.name },
    amount: magnitude,
    meta: { effectKind: kind, durationMs, intervalMs: spec.intervalMs },
  });
  return outcome;
}

// ── The closed map ──────────────────────────────────────────────

export type MechanicHandler = (ctx: MechanicContext, spec: AbilitySpec) => MechanicOutcome;

export const MECHANIC_HANDLERS: Record<MechanicKey, MechanicHandler> = {
  weapon_attack: (ctx, spec) => offensiveHit(ctx, spec, 'weapon_attack'),

  spell_attack: (ctx, spec) => offensiveHit(ctx, spec, 'spell_attack'),

  multi_attack: (ctx, spec) => {
    const merged = emptyOutcome();
    merged.cpCost = spec.cpCost;
    // Authored attack count (Barrage: `arrow_count`), never a hard-coded number.
    const count = Math.max(1, Math.floor(resolveMechanicCalc(ctx, spec, 'arrow_count') ?? 1));
    let total = 0;
    for (let i = 0; i < count; i++) {
      const single = offensiveHit(ctx, spec, `multi_attack:${i}`);
      if (single.rejected) return single;
      total += single.creatureDamage ?? 0;
      merged.events.push(...single.events);
    }
    merged.creatureDamage = total;
    merged.events.push({
      kind: 'multi_attack_summary',
      abilityKey: spec.abilityKey,
      actor: { type: 'character', id: ctx.actor.character_id, name: ctx.actor.name },
      amount: total,
      meta: { attacks: count },
    });
    return merged;
  },

  burst_damage: (ctx, spec) =>
    offensiveHit(ctx, spec, 'burst_damage', {
      // Authored crit widening (Grand Finale `crit_edge`).
      critEdge: Math.max(0, Math.floor(resolveMechanicCalc(ctx, spec, 'crit_edge') ?? 0)),
    }),

  dot_debuff: (ctx, spec) => creatureDebuff(ctx, spec, 'dot'),

  heal: (ctx, spec) => {
    const outcome = emptyOutcome();
    outcome.cpCost = spec.cpCost;
    const target = spec.targetType === 'ally' && ctx.ally ? ctx.ally : ctx.actor;
    const amount = resolveAmount(ctx, spec, 'heal', null) ?? 0;
    outcome.healing = amount;
    outcome.events.push({
      kind: 'heal',
      abilityKey: spec.abilityKey,
      actor: { type: 'character', id: ctx.actor.character_id, name: ctx.actor.name },
      target: { type: 'character', id: target.character_id, name: target.name },
      amount,
    });
    return outcome;
  },

  hp_transfer: (ctx, spec) => {
    const outcome = emptyOutcome();
    outcome.cpCost = spec.cpCost;
    const target = ctx.ally;
    if (!target) {
      outcome.rejected = 'no_target';
      return outcome;
    }
    const requested = resolveAmount(ctx, spec, 'hp_transfer', null) ?? 0;
    // Authored floor: the caster may never fall below the reserved HP.
    const reserve = Math.max(0, Math.floor(resolveMechanicCalc(ctx, spec, 'reserve_hp') ?? 0));
    const spendable = Math.max(0, ctx.actor.hp - reserve);
    const amount = Math.min(requested, spendable);
    if (amount <= 0) {
      outcome.rejected = 'insufficient_hp';
      return outcome;
    }
    outcome.healing = amount;
    outcome.actorHpCost = amount;
    outcome.events.push({
      kind: 'hp_transfer',
      abilityKey: spec.abilityKey,
      actor: { type: 'character', id: ctx.actor.character_id, name: ctx.actor.name },
      target: { type: 'character', id: target.character_id, name: target.name },
      amount,
      meta: { reserveHp: reserve },
    });
    return outcome;
  },

  party_regen: (ctx, spec) => characterBuff(ctx, spec, 'party_regen'),
  absorb_buff: (ctx, spec) => characterBuff(ctx, spec, 'absorb'),
  evasion_buff: (ctx, spec) => characterBuff(ctx, spec, 'evasion'),
  offense_buff: (ctx, spec) => characterBuff(ctx, spec, 'offense'),
  regen_buff: (ctx, spec) => characterBuff(ctx, spec, 'regen'),
  stealth_buff: (ctx, spec) => characterBuff(ctx, spec, 'stealth'),

  block_buff: (ctx, spec) => {
    const outcome = emptyOutcome();
    outcome.cpCost = spec.cpCost;
    if (spec.requiresShield && !hasShield(ctx.actor.equipment)) {
      outcome.rejected = 'requires_shield';
      return outcome;
    }
    const amount = Math.max(0, Math.floor(resolveMechanicCalc(ctx, spec, 'block_amount') ?? 0));
    const chance = resolveMechanicCalc(ctx, spec, 'block_chance') ?? 0;
    const cap = typeof spec.config.block_chance_cap === 'number'
      ? (spec.config.block_chance_cap as number)
      : 1;
    outcome.effects.push(
      buffEffect(ctx, spec, 'block', ctx.actor.character_id, amount, {
        block_chance: Math.min(cap, Math.max(0, chance)),
      }),
    );
    outcome.events.push({
      kind: 'buff_applied',
      abilityKey: spec.abilityKey,
      actor: { type: 'character', id: ctx.actor.character_id, name: ctx.actor.name },
      target: { type: 'character', id: ctx.actor.character_id, name: ctx.actor.name },
      amount,
      meta: { effectKind: 'block', blockChance: Math.min(cap, Math.max(0, chance)) },
    });
    return outcome;
  },

  mitigation_buff: (ctx, spec) => {
    const outcome = emptyOutcome();
    outcome.cpCost = spec.cpCost;
    const params = readMitigationParams(spec.config);
    // Percent effects store a fraction, not integer damage. Preserve the
    // authored evaluator's precision until the incoming-damage pipeline rounds
    // the reduction. Flat mitigation keeps its existing amount semantics.
    const magnitude = params.mode === 'percent' && spec.amountCalc
      ? Math.max(0, evaluateCalc(spec.amountCalc, calcInputs(ctx, spec, 'mitigation', null)))
      : resolveAmount(ctx, spec, 'mitigation', null) ?? 0;
    const target = spec.targetType === 'ally' && ctx.ally ? ctx.ally : ctx.actor;
    outcome.effects.push(
      buffEffect(ctx, spec, 'mitigation', target.character_id, magnitude, {
        mitigation_mode: params.mode,
        shield_dr_bonus: params.shieldDrBonus,
        // Authored only: a missing magnitude means no softening, never a default.
        ...(params.critSofteningPct === null ? {} : { crit_softening_pct: params.critSofteningPct }),
        ...(params.mitigationCeilingPct === null
          ? {}
          : { mitigation_ceiling_pct: params.mitigationCeilingPct }),
        is_taunt: params.isTaunt,
      }),
    );
    outcome.events.push({
      kind: 'buff_applied',
      abilityKey: spec.abilityKey,
      actor: { type: 'character', id: ctx.actor.character_id, name: ctx.actor.name },
      target: { type: 'character', id: target.character_id, name: target.name },
      amount: magnitude,
      meta: { effectKind: 'mitigation', mode: params.mode, isTaunt: params.isTaunt },
    });
    return outcome;
  },

  control_debuff: (ctx, spec) => creatureDebuff(ctx, spec, 'control'),

  stack_apply: (ctx, spec) => {
    const outcome = emptyOutcome();
    outcome.cpCost = spec.cpCost;
    const creature = ctx.creature;
    if (!creature) {
      outcome.rejected = 'no_target';
      return outcome;
    }
    const existing = Math.max(0, ctx.existingStacks ?? 0);
    const maxStacks = Math.max(1, Math.floor(resolveMechanicCalc(ctx, spec, 'max_stacks') ?? 1));
    if (existing >= maxStacks) {
      outcome.rejected = 'max_stacks';
      return outcome;
    }
    const durationMs = resolveDurationMs(ctx, spec)
      ?? (typeof spec.config.dot_duration_ms === 'number' ? (spec.config.dot_duration_ms as number) : null);
    outcome.effects.push({
      kind: 'stack',
      effect_type: spec.stackType ?? spec.effectType ?? spec.abilityKey,
      ability_key: spec.abilityKey,
      target_creature_id: creature.creature_id,
      source_character_id: ctx.actor.character_id,
      stacks: 1,
      magnitude: resolveAmount(ctx, spec, 'stack_apply', null) ?? 0,
      config: spec.config,
      expires_at: durationMs ? iso(ctx.nowMs + durationMs) : null,
      is_reservation: false,
    });
    outcome.events.push({
      kind: 'stack_applied',
      abilityKey: spec.abilityKey,
      actor: { type: 'character', id: ctx.actor.character_id, name: ctx.actor.name },
      target: { type: 'creature', id: creature.creature_id, name: creature.name },
      amount: existing + 1,
      meta: { stacks: existing + 1, maxStacks, stackNoun: spec.config.stack_noun },
    });
    return outcome;
  },

  stack_consume: (ctx, spec) => {
    const stacks = Math.max(0, ctx.existingStacks ?? 0);
    // Authored per-stack rider, evaluated with the consumed stacks in context.
    const multiplier = resolveMechanicCalc(
      ctx,
      spec,
      'per_stack_multiplier',
      { consumed_stacks: stacks, active_stacks: stacks },
    ) ?? 1;
    const outcome = offensiveHit(ctx, spec, 'stack_consume', {
      multiplier: multiplier > 0 ? multiplier : 1,
      context: { consumed_stacks: stacks, active_stacks: stacks },
    });
    outcome.meta_stacks_consumed = stacks;
    return outcome;
  },

  aura_pulse: (ctx, spec) => {
    const outcome = emptyOutcome();
    outcome.cpCost = spec.cpCost;
    const durationMs = resolveDurationMs(ctx, spec);
    const magnitude = resolveAmount(ctx, spec, 'aura_pulse', null) ?? 0;
    // A node aura is anchored on its caster: the pulse resolves against whoever
    // is present when it fires, so it is not bound to one creature target.
    outcome.effects.push({
      kind: 'aura',
      effect_type: spec.effectType ?? spec.abilityKey,
      ability_key: spec.abilityKey,
      target_character_id: ctx.actor.character_id,
      source_character_id: ctx.actor.character_id,
      stacks: 1,
      magnitude,
      config: spec.config,
      expires_at: durationMs ? iso(ctx.nowMs + durationMs) : null,
      next_due_at: spec.intervalMs ? iso(ctx.nowMs + spec.intervalMs) : null,
      interval_ms: spec.intervalMs,
      is_reservation: false,
    });
    outcome.events.push({
      kind: 'aura_started',
      abilityKey: spec.abilityKey,
      actor: { type: 'character', id: ctx.actor.character_id, name: ctx.actor.name },
      amount: magnitude,
      meta: { durationMs, intervalMs: spec.intervalMs },
    });
    return outcome;
  },

  /**
   * Reactive retaliation. The authored catalogue currently spells Holy Shield's
   * The authored `reactive_holy` mechanic is normalized onto this key by
   * `catalog.ts` at the MECHANIC level (same lifecycle, holy damage type), so
   * Holy Shield resolves here with its authored damage type, magnitude
   * (`retaliation_damage`), trigger configuration and source attribution intact.
   * The effect is owned by, and attributed to, the character that activated it.
   */
  reactive_damage: (ctx, spec) => {
    const outcome = emptyOutcome();
    outcome.cpCost = spec.cpCost;
    const magnitude = Math.max(
      0,
      Math.floor(resolveMechanicCalc(ctx, spec, 'retaliation_damage') ?? 0),
    );
    outcome.effects.push(
      buffEffect(ctx, spec, 'reactive', ctx.actor.character_id, magnitude, {
        once_per_attacker_per_tick: spec.config.once_per_attacker_per_tick === true,
        damage_type: spec.damageType,
      }),
    );
    outcome.events.push({
      kind: 'buff_applied',
      abilityKey: spec.abilityKey,
      actor: { type: 'character', id: ctx.actor.character_id, name: ctx.actor.name },
      target: { type: 'character', id: ctx.actor.character_id, name: ctx.actor.name },
      amount: magnitude,
      meta: { effectKind: 'reactive' },
    });
    return outcome;
  },
};
