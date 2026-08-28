/**
 * combat2/mechanics.ts — the closed handler map.
 *
 * One typed handler per catalogue entry, each `(ctx, spec) => MechanicOutcome`.
 * Handlers are pure: they read the snapshot view they are given and return
 * proposed mutations. They never mutate the snapshot, never touch IO and never
 * branch on an ability identity — all behaviour comes from authored parameters.
 */

import { getStatModifier } from '../formulas/stats';
import {
  getAccuracyBonus,
  getAccuracyProficiency,
  getCombatInsightBonus,
  getHitQuality,
  HIT_QUALITY_MULT,
  GLANCING_WEAK_CAP,
  getWeaponDieForItem,
  getClassCritRange,
  getDexCritBonus,
  type AccuracyStat,
} from '../formulas/combat';
import { applyMitigationPipeline, readMitigationParams } from './mitigation';
import type {
  MechanicKey,
  ProposedEffectInsert,
  SnapshotCreature,
  SnapshotFighter,
  TickEvent,
} from './types';
import type { TickRandom } from './rng';

/** Authored ability definition, flattened from `abilities` + `base_abilities`. */
export interface AbilitySpec {
  abilityKey: string;
  label: string;
  mechanic: MechanicKey;
  damageType: string | null;
  accuracyStat: AccuracyStat;
  /** Primary scaling stat for magnitude. */
  scalingStat: 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';
  cpCost: number;
  /** Flat magnitude contribution before stat scaling. */
  baseAmount: number;
  /** Magnitude added per point of the scaling stat's modifier. */
  perModifier: number;
  /** Wall-clock lifetime, ms (buffs/debuffs). */
  durationMs: number | null;
  /** Pulse interval, ms (periodic effects). */
  intervalMs: number | null;
  /** Whether the magnitude also rolls the actor's weapon die. */
  weaponBased: boolean;
  /** Number of separate attacks (`multi_attack`). */
  attackCount: number;
  effectType: string | null;
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
  /** Percentage mitigation already resolved on the target. */
  targetPercentMitigation?: number;
  targetFlatMitigation?: number;
  /** Existing stacks of the relevant stack type on the target. */
  existingStacks?: number;
  /** Sum of authored damage amplification on the target. */
  amplification?: number;
  /** Sunder-style AC reduction on the creature. */
  creatureAcReduction?: number;
  /** Authored weapon die inputs for the actor's main hand. */
  weaponDie?: number;
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

}

const emptyOutcome = (): MechanicOutcome => ({ effects: [], consumeEffectIds: [], events: [] });

const iso = (ms: number): string => new Date(ms).toISOString();

function statOf(actor: SnapshotFighter, stat: AbilitySpec['scalingStat']): number {
  return actor[stat];
}

/** Authored magnitude: base + perModifier * modifier(stat), optionally + weapon die. */
export function resolveMagnitude(
  ctx: MechanicContext,
  spec: AbilitySpec,
  stream: string,
): number {
  const mod = getStatModifier(statOf(ctx.actor, spec.scalingStat));
  let amount = spec.baseAmount + spec.perModifier * mod;
  if (spec.weaponBased) {
    const die = ctx.weaponDie ?? resolveWeaponDie(ctx.actor);
    amount += ctx.rng.roll(stream, die, ctx.actor.character_id, spec.abilityKey);
  }
  return Math.max(0, Math.floor(amount));
}

export function resolveWeaponDie(actor: SnapshotFighter): number {
  const main = actor.equipment.find((row) => row.slot === 'main_hand');
  if (!main) return 4; // unarmed
  return getWeaponDieForItem(null, 1, actor.level, undefined, null);
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
): AttackDecision {
  const accStat = spec.accuracyStat;
  const accValue = ctx.actor[accStat as keyof SnapshotFighter] as number;
  const bonus =
    getAccuracyProficiency(ctx.actor.level) +
    getAccuracyBonus(getStatModifier(accValue)) +
    getCombatInsightBonus(accStat, ctx.actor.int);

  const roll = ctx.rng.d20(stream, ctx.actor.character_id, spec.abilityKey, ctx.tick);
  const critRange =
    getClassCritRange(ctx.actor.class ?? '') - getDexCritBonus(ctx.actor.dex);
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

function offensiveHit(
  ctx: MechanicContext,
  spec: AbilitySpec,
  stream: string,
  magnitudeMult = 1,
): MechanicOutcome {
  const outcome = emptyOutcome();
  outcome.cpCost = spec.cpCost;
  const creature = ctx.creature;
  if (!creature) return outcome;

  const decision = decideAttack(ctx, spec, creature.ac, `${stream}:hit`);
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

  const base = resolveMagnitude(ctx, spec, `${stream}:dmg`) * magnitudeMult;
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
  return {
    kind,
    effect_type: spec.effectType ?? spec.abilityKey,
    ability_key: spec.abilityKey,
    target_character_id: targetCharacterId,
    source_character_id: ctx.actor.character_id,
    stacks: 1,
    magnitude,
    config: { ...spec.config, ...extraConfig },
    expires_at: spec.durationMs ? iso(ctx.nowMs + spec.durationMs) : null,
    next_due_at: spec.intervalMs ? iso(ctx.nowMs + spec.intervalMs) : null,
    interval_ms: spec.intervalMs,
    is_reservation: false,
  };
}

function selfBuff(ctx: MechanicContext, spec: AbilitySpec, kind: string): MechanicOutcome {
  const outcome = emptyOutcome();
  outcome.cpCost = spec.cpCost;
  const magnitude = resolveMagnitude(ctx, spec, `${kind}:mag`);
  const target = ctx.ally?.character_id ?? ctx.actor.character_id;
  outcome.effects.push(buffEffect(ctx, spec, kind, target, magnitude));
  outcome.events.push({
    kind: 'buff_applied',
    abilityKey: spec.abilityKey,
    actor: { type: 'character', id: ctx.actor.character_id, name: ctx.actor.name },
    target: { type: 'character', id: target, name: ctx.ally?.name ?? ctx.actor.name },
    amount: magnitude,
    meta: { effectKind: kind, durationMs: spec.durationMs },
  });
  return outcome;
}

function debuffOnCreature(ctx: MechanicContext, spec: AbilitySpec, kind: string): MechanicOutcome {
  const outcome = emptyOutcome();
  outcome.cpCost = spec.cpCost;
  const creature = ctx.creature;
  if (!creature) return outcome;
  const magnitude = resolveMagnitude(ctx, spec, `${kind}:mag`);
  outcome.effects.push({
    kind,
    effect_type: spec.effectType ?? spec.abilityKey,
    ability_key: spec.abilityKey,
    target_creature_id: creature.creature_id,
    source_character_id: ctx.actor.character_id,
    stacks: 1,
    magnitude,
    config: spec.config,
    expires_at: spec.durationMs ? iso(ctx.nowMs + spec.durationMs) : null,
    next_due_at: spec.intervalMs ? iso(ctx.nowMs + spec.intervalMs) : null,
    interval_ms: spec.intervalMs,
    is_reservation: false,
  });
  outcome.events.push({
    kind: 'debuff_applied',
    abilityKey: spec.abilityKey,
    actor: { type: 'character', id: ctx.actor.character_id, name: ctx.actor.name },
    target: { type: 'creature', id: creature.creature_id, name: creature.name },
    amount: magnitude,
    meta: { effectKind: kind, durationMs: spec.durationMs },
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
    let total = 0;
    const count = Math.max(1, spec.attackCount);
    for (let i = 0; i < count; i++) {
      const single = offensiveHit({ ...ctx }, spec, `multi_attack:${i}`);
      total += single.creatureDamage ?? 0;
      merged.events.push(...single.events);
    }
    merged.creatureDamage = total;
    return merged;
  },

  burst_damage: (ctx, spec) => offensiveHit(ctx, spec, 'burst_damage', 1.5),

  dot_debuff: (ctx, spec) => debuffOnCreature(ctx, spec, 'dot'),

  heal: (ctx, spec) => {
    const outcome = emptyOutcome();
    outcome.cpCost = spec.cpCost;
    const target = ctx.ally ?? ctx.actor;
    const amount = resolveMagnitude(ctx, spec, 'heal');
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
    if (!target) return outcome;
    const amount = resolveMagnitude(ctx, spec, 'hp_transfer');
    outcome.healing = amount;
    outcome.actorHpCost = amount;
    outcome.events.push({
      kind: 'hp_transfer',
      abilityKey: spec.abilityKey,
      actor: { type: 'character', id: ctx.actor.character_id, name: ctx.actor.name },
      target: { type: 'character', id: target.character_id, name: target.name },
      amount,
    });
    return outcome;
  },

  party_regen: (ctx, spec) => selfBuff(ctx, spec, 'party_regen'),
  absorb_buff: (ctx, spec) => selfBuff(ctx, spec, 'absorb'),
  block_buff: (ctx, spec) => selfBuff(ctx, spec, 'block'),
  evasion_buff: (ctx, spec) => selfBuff(ctx, spec, 'evasion'),
  offense_buff: (ctx, spec) => selfBuff(ctx, spec, 'offense'),
  regen_buff: (ctx, spec) => selfBuff(ctx, spec, 'regen'),
  stealth_buff: (ctx, spec) => selfBuff(ctx, spec, 'stealth'),

  mitigation_buff: (ctx, spec) => {
    const outcome = emptyOutcome();
    outcome.cpCost = spec.cpCost;
    const params = readMitigationParams(spec.config);
    const magnitude = resolveMagnitude(ctx, spec, 'mitigation');
    const target = ctx.ally?.character_id ?? ctx.actor.character_id;
    outcome.effects.push(
      buffEffect(ctx, spec, 'mitigation', target, magnitude, {
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
      target: { type: 'character', id: target, name: ctx.ally?.name ?? ctx.actor.name },
      amount: magnitude,
      meta: { effectKind: 'mitigation', mode: params.mode, isTaunt: params.isTaunt },
    });
    return outcome;
  },

  control_debuff: (ctx, spec) => debuffOnCreature(ctx, spec, 'control'),

  stack_apply: (ctx, spec) => {
    const outcome = emptyOutcome();
    outcome.cpCost = spec.cpCost;
    const creature = ctx.creature;
    if (!creature) return outcome;
    outcome.effects.push({
      kind: 'stack',
      effect_type: spec.effectType ?? spec.abilityKey,
      ability_key: spec.abilityKey,
      target_creature_id: creature.creature_id,
      source_character_id: ctx.actor.character_id,
      stacks: 1,
      magnitude: resolveMagnitude(ctx, spec, 'stack_apply'),
      config: spec.config,
      expires_at: spec.durationMs ? iso(ctx.nowMs + spec.durationMs) : null,
      is_reservation: false,
    });
    outcome.events.push({
      kind: 'stack_applied',
      abilityKey: spec.abilityKey,
      actor: { type: 'character', id: ctx.actor.character_id, name: ctx.actor.name },
      target: { type: 'creature', id: creature.creature_id, name: creature.name },
      amount: (ctx.existingStacks ?? 0) + 1,
      meta: { stacks: (ctx.existingStacks ?? 0) + 1 },
    });
    return outcome;
  },

  stack_consume: (ctx, spec) => {
    const stacks = Math.max(0, ctx.existingStacks ?? 0);
    const outcome = offensiveHit(ctx, spec, 'stack_consume', 1 + stacks * 0.25);
    outcome.meta_stacks_consumed = stacks;
    return outcome;
  },

  aura_pulse: (ctx, spec) => {
    const outcome = emptyOutcome();
    outcome.cpCost = spec.cpCost;
    const creature = ctx.creature;
    if (!creature) return outcome;
    outcome.effects.push({
      kind: 'aura',
      effect_type: spec.effectType ?? spec.abilityKey,
      ability_key: spec.abilityKey,
      target_creature_id: creature.creature_id,
      source_character_id: ctx.actor.character_id,
      stacks: 1,
      magnitude: resolveMagnitude(ctx, spec, 'aura_pulse'),
      config: spec.config,
      expires_at: spec.durationMs ? iso(ctx.nowMs + spec.durationMs) : null,
      next_due_at: spec.intervalMs ? iso(ctx.nowMs + spec.intervalMs) : null,
      interval_ms: spec.intervalMs,
      is_reservation: false,
    });
    outcome.events.push({
      kind: 'aura_started',
      abilityKey: spec.abilityKey,
      actor: { type: 'character', id: ctx.actor.character_id, name: ctx.actor.name },
      target: { type: 'creature', id: creature.creature_id, name: creature.name },
    });
    return outcome;
  },

  reactive_damage: (ctx, spec) => selfBuff(ctx, spec, 'reactive'),
};

// `stack_consume` reports how many stacks it burned; declared here so the
// outcome shape stays typed without widening the shared interface.
declare module './mechanics' {
  interface MechanicOutcome {
    meta_stacks_consumed?: number;
  }
}
