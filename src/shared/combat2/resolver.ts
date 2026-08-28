/**
 * combat2/resolver.ts — the pure authoritative tick resolver.
 *
 * `resolveNodeTick(snapshot, deps)` is a total function of its inputs: the same
 * snapshot and the same candidate tick always produce a byte-identical
 * `ProposedTick`. It performs no IO, reads no clock (`snapshot.encounter.now` is
 * the authoritative wall clock) and never calls `Math.random()`.
 */

import { getCreatureXp, getXpPenalty } from '../formulas/xp';
import { getCreatureDamageDie, getCreatureAttackBonus, CREATURE_CRIT_MULT } from '../formulas/combat';
import { getStatModifier } from '../formulas/stats';
import { applyMitigationPipeline, readMitigationParams } from './mitigation';
import { TickRandom } from './rng';
import {
  MECHANIC_HANDLERS,
  type AbilitySpec,
  type MechanicContext,
  type MechanicOutcome,
} from './mechanics';
import {
  emptyProposedTick,
  type NodeSnapshot,
  type ProposedTick,
  type SnapshotCreature,
  type SnapshotEffect,
  type SnapshotFighter,
  type TickEvent,
} from './types';

export interface ResolveDeps {
  /** Authored ability catalogue, keyed by ability key. Closed: misses are rejected. */
  abilities: ReadonlyMap<string, AbilitySpec>;
}

interface WorkingCharacter {
  fighter: SnapshotFighter;
  hp: number;
  cp: number;
  mp: number;
  absorb: number;
  dirty: boolean;
  died: boolean;
}

interface WorkingCreature {
  row: SnapshotCreature;
  hp: number;
  damaged: boolean;
  killedBy: string | null;
  dirty: boolean;
  pendingAction: SnapshotCreature['pending_action'];
  tankFighterId: string | null;
}

const ms = (iso: string): number => Date.parse(iso);

function effectsFor(effects: SnapshotEffect[], characterId: string, kind: string): SnapshotEffect[] {
  return effects.filter((e) => e.target_character_id === characterId && e.kind === kind);
}

/** Newest present fighter tanks. Evaluated at resolution time, per creature. */
export function selectTank(fighters: SnapshotFighter[], living: ReadonlySet<string>): SnapshotFighter | null {
  const eligible = fighters
    .filter((f) => f.present && living.has(f.character_id))
    .sort((a, b) => b.entry_seq - a.entry_seq);
  return eligible[0] ?? null;
}

export function resolveNodeTick(snapshot: NodeSnapshot, deps: ResolveDeps): ProposedTick {
  const { encounter } = snapshot;
  const tick = encounter.candidate_tick;
  const nowMs = ms(encounter.now);
  const rng = new TickRandom({ encounterId: encounter.id, candidateTick: tick });
  const proposed = emptyProposedTick(tick);
  let seq = 0;
  const emit = (event: Omit<TickEvent, 'seq'>): void => {
    proposed.events.push({ ...event, seq: seq++ });
  };

  // ── working state ─────────────────────────────────────────────
  const chars = new Map<string, WorkingCharacter>();
  for (const fighter of snapshot.fighters) {
    if (chars.has(fighter.character_id)) continue;
    const absorb = effectsFor(snapshot.effects, fighter.character_id, 'absorb')
      .reduce((sum, e) => sum + (e.magnitude ?? 0), 0);
    chars.set(fighter.character_id, {
      fighter,
      hp: fighter.hp,
      cp: fighter.cp,
      mp: fighter.mp,
      absorb,
      dirty: false,
      died: false,
    });
  }

  const creatures = new Map<string, WorkingCreature>();
  for (const row of snapshot.creatures) {
    creatures.set(row.creature_id, {
      row,
      hp: row.hp,
      damaged: false,
      killedBy: null,
      dirty: false,
      pendingAction: row.pending_action,
      tankFighterId: row.tank_fighter_id,
    });
  }

  const livingCharacters = (): Set<string> => {
    const set = new Set<string>();
    for (const [id, c] of chars) if (c.hp > 0) set.add(id);
    return set;
  };

  // ── 1. effect lifetimes: expire first, then pulse at most once ─
  const expiredIds = new Set<string>();
  for (const effect of snapshot.effects) {
    if (effect.is_reservation) continue; // lifetime owned by activation/drop/death
    if (effect.expires_at && ms(effect.expires_at) <= nowMs) {
      expiredIds.add(effect.id);
      proposed.effects_delete.push(effect.id);
      emit({
        kind: 'effect_expired',
        abilityKey: effect.ability_key ?? undefined,
        meta: { effectKind: effect.kind, effectType: effect.effect_type },
      });
    }
  }

  for (const effect of snapshot.effects) {
    if (expiredIds.has(effect.id)) continue;
    if (!effect.interval_ms || !effect.next_due_at) continue;
    const due = ms(effect.next_due_at) <= nowMs;
    const alreadyPulsed = (effect.last_pulse_tick ?? -1) >= tick;
    if (!due || alreadyPulsed) continue;

    // skip-not-stack: missed pulses are discarded, never accumulated.
    const nextDue = Math.max(nowMs, ms(effect.next_due_at)) + effect.interval_ms;
    proposed.effects_update.push({
      id: effect.id,
      next_due_at: new Date(nextDue).toISOString(),
      last_pulse_tick: tick,
    });

    const magnitude = Math.max(0, Math.floor(effect.magnitude ?? 0));
    if (effect.target_creature_id) {
      const target = creatures.get(effect.target_creature_id);
      if (target && target.hp > 0 && magnitude > 0) {
        const applied = Math.min(target.hp, magnitude * Math.max(1, effect.stacks));
        target.hp -= applied;
        target.damaged = true;
        target.dirty = true;
        if (target.hp === 0 && target.killedBy === null) {
          target.killedBy = effect.source_character_id;
        }
        emit({
          kind: 'effect_pulse',
          abilityKey: effect.ability_key ?? undefined,
          target: { type: 'creature', id: target.row.creature_id, name: target.row.name },
          amount: applied,
          meta: { effectKind: effect.kind, stacks: effect.stacks },
        });
      }
    } else if (effect.target_character_id) {
      const target = chars.get(effect.target_character_id);
      if (target && target.hp > 0 && magnitude > 0) {
        if (effect.kind === 'regen' || effect.kind === 'party_regen') {
          const healed = Math.min(target.fighter.max_hp - target.hp, magnitude);
          target.hp += healed;
          target.dirty = true;
          emit({
            kind: 'effect_pulse',
            abilityKey: effect.ability_key ?? undefined,
            target: { type: 'character', id: target.fighter.character_id, name: target.fighter.name },
            amount: healed,
            meta: { effectKind: effect.kind, healing: true },
          });
        } else {
          const applied = Math.min(target.hp, magnitude * Math.max(1, effect.stacks));
          target.hp -= applied;
          target.dirty = true;
          if (target.hp === 0) target.died = true;
          emit({
            kind: 'effect_pulse',
            abilityKey: effect.ability_key ?? undefined,
            target: { type: 'character', id: target.fighter.character_id, name: target.fighter.name },
            amount: applied,
            meta: { effectKind: effect.kind },
          });
        }
      }
    }
  }

  // ── 2. player intents (exactly the ones inside the cutoff) ─────
  for (const intent of snapshot.intents) {
    proposed.intent_ids.push(intent.id);
    const actor = chars.get(intent.character_id);
    if (!actor || actor.hp <= 0 || !actor.fighter.present) {
      emit({ kind: 'action_rejected', outcomeReason: 'not_present_or_dead', abilityKey: intent.ability_key ?? undefined });
      continue;
    }
    const spec = intent.ability_key ? deps.abilities.get(intent.ability_key) : undefined;
    if (!spec) {
      emit({ kind: 'action_rejected', outcomeReason: 'unknown_ability', abilityKey: intent.ability_key ?? undefined });
      continue;
    }
    if (actor.cp < spec.cpCost) {
      emit({ kind: 'action_rejected', outcomeReason: 'insufficient_cp', abilityKey: spec.abilityKey });
      continue;
    }

    const targetCreature = intent.target_creature_id
      ? creatures.get(intent.target_creature_id)
      : undefined;
    if (targetCreature && targetCreature.hp <= 0) {
      emit({ kind: 'action_rejected', outcomeReason: 'target_dead', abilityKey: spec.abilityKey });
      continue;
    }

    const stackEffects = targetCreature
      ? snapshot.effects.filter(
          (e) =>
            e.kind === 'stack' &&
            e.target_creature_id === targetCreature.row.creature_id &&
            e.source_character_id === actor.fighter.character_id &&
            !expiredIds.has(e.id),
        )
      : [];

    const ctx: MechanicContext = {
      rng,
      nowMs,
      tick,
      actor: actor.fighter,
      creature: targetCreature?.row,
      targetAbsorb: 0,
      existingStacks: stackEffects.reduce((sum, e) => sum + Math.max(1, e.stacks), 0),
      creatureAcReduction: targetCreature
        ? snapshot.effects
            .filter(
              (e) =>
                e.kind === 'control' &&
                e.target_creature_id === targetCreature.row.creature_id &&
                !expiredIds.has(e.id) &&
                typeof e.config?.ac_reduction === 'number',
            )
            .reduce((sum, e) => sum + Number(e.config.ac_reduction), 0)
        : 0,
    };

    const outcome: MechanicOutcome = MECHANIC_HANDLERS[spec.mechanic](ctx, spec);

    if (outcome.cpCost) {
      actor.cp = Math.max(0, actor.cp - outcome.cpCost);
      actor.dirty = true;
    }
    if (outcome.actorHpCost) {
      actor.hp = Math.max(1, actor.hp - outcome.actorHpCost);
      actor.dirty = true;
    }
    if (outcome.creatureDamage && targetCreature) {
      const applied = Math.min(targetCreature.hp, outcome.creatureDamage);
      targetCreature.hp -= applied;
      targetCreature.damaged = true;
      targetCreature.dirty = true;
      if (targetCreature.hp === 0 && targetCreature.killedBy === null) {
        targetCreature.killedBy = actor.fighter.character_id;
      }
    }
    if (outcome.healing) {
      const healTargetId = ctx.ally?.character_id ?? actor.fighter.character_id;
      const healTarget = chars.get(healTargetId);
      if (healTarget && healTarget.hp > 0) {
        healTarget.hp = Math.min(healTarget.fighter.max_hp, healTarget.hp + outcome.healing);
        healTarget.dirty = true;
      }
    }
    for (const effect of outcome.effects) proposed.effects_insert.push(effect);
    for (const id of outcome.consumeEffectIds) proposed.effects_delete.push(id);
    if (spec.mechanic === 'stack_consume') {
      for (const e of stackEffects) proposed.effects_delete.push(e.id);
    }
    for (const event of outcome.events) emit(event);
  }

  // ── 3. creature actions ───────────────────────────────────────
  for (const creature of creatures.values()) {
    if (creature.hp <= 0) continue;
    const living = livingCharacters();
    const tank = selectTank(snapshot.fighters, living);
    creature.tankFighterId = tank?.id ?? null;
    if (creature.tankFighterId !== creature.row.tank_fighter_id) creature.dirty = true;

    // 3a. a telegraphed action that is due resolves now, and the creature does
    //     nothing else this tick (one action per tick).
    if (creature.pendingAction) {
      if (creature.pendingAction.resolve_at_tick > tick) continue;
      const ability = snapshot.boss_abilities.find(
        (b) => b.creature_id === creature.row.creature_id && b.ability_key === creature.pendingAction!.ability_key,
      );
      creature.pendingAction = null;
      creature.dirty = true;
      if (!ability) {
        emit({ kind: 'boss_cast_evaded', outcomeReason: 'ability_missing' });
        continue;
      }
      const targets =
        ability.targeting === 'aoe'
          ? snapshot.fighters.filter((f) => f.present && living.has(f.character_id))
          : tank
            ? [tank]
            : [];
      if (targets.length === 0) {
        emit({
          kind: 'boss_cast_evaded',
          abilityKey: ability.ability_key,
          actor: { type: 'creature', id: creature.row.creature_id, name: creature.row.name },
          outcomeReason: 'no_target',
        });
        continue;
      }
      for (const target of targets) {
        applyCreatureDamage(creature, target, ability.ability_key, Math.floor(ability.magnitude ?? 0));
      }
      continue;
    }

    // 3b. select an ability; a wind-up writes a pending action and announces it.
    const pool = snapshot.boss_abilities.filter((b) => b.creature_id === creature.row.creature_id);
    const chosen = rng.weightedPick(pool, (b) => b.weight, 'boss_select', creature.row.creature_id, tick);
    if (chosen && chosen.windup_ticks > 0) {
      creature.pendingAction = {
        ability_key: chosen.ability_key,
        resolve_at_tick: tick + chosen.windup_ticks,
      };
      creature.dirty = true;
      emit({
        kind: 'boss_telegraph',
        abilityKey: chosen.ability_key,
        actor: { type: 'creature', id: creature.row.creature_id, name: creature.row.name },
        meta: { resolveAtTick: creature.pendingAction.resolve_at_tick, text: chosen.telegraph_text },
      });
      continue; // no autoattack during wind-up
    }

    if (chosen) {
      const targets =
        chosen.targeting === 'aoe'
          ? snapshot.fighters.filter((f) => f.present && living.has(f.character_id))
          : tank
            ? [tank]
            : [];
      for (const target of targets) {
        applyCreatureDamage(creature, target, chosen.ability_key, Math.floor(chosen.magnitude ?? 0));
      }
      if (targets.length > 0) continue;
    }

    // 3c. ordinary autoattack against the current tank.
    if (!tank) continue;
    applyCreatureDamage(creature, tank, null, 0);
  }

  function applyCreatureDamage(
    creature: WorkingCreature,
    targetFighter: SnapshotFighter,
    abilityKey: string | null,
    flatMagnitude: number,
  ): void {
    const target = chars.get(targetFighter.character_id);
    if (!target || target.hp <= 0) return;

    const stream = `creature_attack:${creature.row.creature_id}:${abilityKey ?? 'auto'}`;
    const roll = rng.d20(stream, targetFighter.character_id, tick);
    const bonus = getCreatureAttackBonus(creature.row.level);
    const total = roll + bonus;
    const isNat1 = roll === 1;
    const isCrit = roll === 20;
    if (isNat1 || (total < targetFighter.ac && !isCrit)) {
      emit({
        kind: 'creature_attack',
        abilityKey: abilityKey ?? undefined,
        actor: { type: 'creature', id: creature.row.creature_id, name: creature.row.name },
        target: { type: 'character', id: targetFighter.character_id, name: targetFighter.name },
        hitQuality: 'miss',
        amount: 0,
        outcomeReason: isNat1 ? 'critical_miss' : 'missed',
      });
      return;
    }

    const die = getCreatureDamageDie(creature.row.level, creature.row.rarity ?? 'common');
    const strMod = getStatModifier(creature.row.stats?.str ?? 10);
    const base = flatMagnitude > 0
      ? flatMagnitude
      : Math.max(1, rng.roll(`${stream}:dmg`, die, targetFighter.character_id, tick) + strMod);
    const critBonus = isCrit ? Math.floor(base * (CREATURE_CRIT_MULT - 1)) : 0;

    // Authored mitigation on the target (percent, flat, block, absorb, crit softening).
    let percentMitigation = 0;
    let flatMitigation = 0;
    let shieldDrBonus = 0;
    let critSofteningPct = 0;
    let mitigationCeilingPct: number | undefined;
    for (const effect of effectsFor(snapshot.effects, targetFighter.character_id, 'mitigation')) {
      if (expiredIds.has(effect.id)) continue;
      const params = readMitigationParams(effect.config);
      if (params.mode === 'flat') flatMitigation += effect.magnitude ?? 0;
      else percentMitigation += effect.magnitude ?? 0;
      shieldDrBonus = Math.max(shieldDrBonus, params.shieldDrBonus);
      if (params.critSofteningPct !== null) {
        critSofteningPct = Math.max(critSofteningPct, params.critSofteningPct);
      }
      if (params.mitigationCeilingPct !== null) {
        mitigationCeilingPct = params.mitigationCeilingPct;
      }
    }
    const blockAmount = effectsFor(snapshot.effects, targetFighter.character_id, 'block')
      .filter((e) => !expiredIds.has(e.id))
      .reduce((sum, e) => sum + (e.magnitude ?? 0), 0);

    const breakdown = applyMitigationPipeline({
      normalDamage: base,
      critBonus,
      percentMitigation,
      shieldDrBonus,
      shieldEquipped: targetFighter.equipment.some((row) => row.slot === 'off_hand'),
      mitigationCeilingPct,
      critSofteningPct,
      flatMitigation,
      blockAmount,
      absorbPool: target.absorb,
    });

    target.absorb = breakdown.absorbPoolAfter;
    const applied = Math.min(target.hp, breakdown.applied);
    target.hp -= applied;
    target.dirty = true;
    if (target.hp === 0) target.died = true;

    emit({
      kind: 'creature_attack',
      abilityKey: abilityKey ?? undefined,
      actor: { type: 'creature', id: creature.row.creature_id, name: creature.row.name },
      target: { type: 'character', id: targetFighter.character_id, name: targetFighter.name },
      hitQuality: isCrit ? 'strong' : 'normal',
      amount: applied,
      meta: {
        isCrit,
        percentMitigated: breakdown.percentMitigated,
        shieldBonusApplied: breakdown.shieldBonusApplied,
        critSoftened: breakdown.critSoftened,
        flatMitigated: breakdown.flatMitigated,
        blocked: breakdown.blocked,
        absorbed: breakdown.absorbed,
      },
    });
  }

  // ── 4. deaths and rewards ─────────────────────────────────────
  for (const creature of creatures.values()) {
    const died = creature.row.is_alive && creature.hp === 0;
    if (died) {
      emit({
        kind: 'creature_died',
        actor: { type: 'creature', id: creature.row.creature_id, name: creature.row.name },
        meta: { deathCry: creature.row.boss_death_cry, killedBy: creature.killedBy },
      });

      const killer = creature.killedBy ? chars.get(creature.killedBy) : undefined;
      const killerParty = killer?.fighter.party_id ?? null;
      const baseXp = getCreatureXp(creature.row.level, creature.row.rarity ?? 'common');
      const eligible = snapshot.fighters.filter((f) => {
        if (f.character_id === creature.killedBy) return true;
        if (!killerParty || f.party_id !== killerParty) return false;
        return true;
      });
      const seen = new Set<string>();
      for (const fighter of eligible) {
        if (seen.has(fighter.character_id)) continue;
        seen.add(fighter.character_id);
        const penalty = getXpPenalty(fighter.level, creature.row.level);
        proposed.rewards.push({
          creature_id: creature.row.creature_id,
          spawn_seq: creature.row.spawn_seq,
          character_id: fighter.character_id,
          xp_awarded: Math.max(0, Math.floor(baseXp * penalty)),
          gold_awarded: 0,
          is_killer: fighter.character_id === creature.killedBy,
        });
      }
    }

    if (creature.dirty || died) {
      proposed.creatures.push({
        id: creature.row.id,
        creature_id: creature.row.creature_id,
        spawn_seq: creature.row.spawn_seq,
        hp: creature.hp,
        is_alive: creature.hp > 0,
        damaged: creature.damaged,
        pending_action: creature.pendingAction ?? null,
        tank_fighter_id: creature.tankFighterId,
      });
    }
  }

  for (const character of chars.values()) {
    if (!character.dirty) continue;
    proposed.characters.push({
      id: character.fighter.character_id,
      hp: character.hp,
      cp: character.cp,
      mp: character.mp,
      died: character.died,
    });
    if (character.died) {
      emit({
        kind: 'character_died',
        target: { type: 'character', id: character.fighter.character_id, name: character.fighter.name },
      });
    }
  }

  // ── 5. encounter lifecycle ────────────────────────────────────
  const anythingPending =
    [...creatures.values()].some((c) => c.hp > 0 && c.row.is_alive) ||
    snapshot.effects.some((e) => !expiredIds.has(e.id) && !e.is_reservation);
  if (!anythingPending) proposed.status = 'ended';

  return proposed;
}
