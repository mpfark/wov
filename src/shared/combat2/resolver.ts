/**
 * combat2/resolver.ts — the pure authoritative tick resolver.
 *
 * `resolveNodeTick(snapshot, deps)` is a total function of its inputs: the same
 * snapshot and the same candidate tick always produce a byte-identical
 * `ProposedTick`. It performs no IO, reads no clock (`snapshot.encounter.now` is
 * the authoritative wall clock) and never calls `Math.random()`.
 */

import { getCreatureXp, getXpPenalty } from '../formulas/xp';
import { getCreatureDamageDie, getCreatureAttackBonus, CREATURE_CRIT_MULT, type WeaponProgressionConfig } from '../formulas/combat';
import { getStatModifier } from '../formulas/stats';
import { applyMitigationPipeline, readMitigationParams } from './mitigation';
import { TickRandom } from './rng';
import {
  MECHANIC_HANDLERS,
  resolveBasicAttack,
  type AbilitySpec,
  type MechanicContext,
  type MechanicOutcome,
} from './mechanics';
import {
  emptyProposedTick,
  type NodeSnapshot,
  type ProposedParticipation,
  type ProposedTick,
  type SnapshotCreature,
  type SnapshotEffect,
  type SnapshotFighter,
  type TickEvent,
} from './types';

export interface ResolveDeps {
  /**
   * Authored ability catalogue. Keys are `"<classKey>:<abilityKey>"` and the
   * bare ability key, exactly as `buildAbilityCatalog` produces them. Closed:
   * a miss is rejected, never guessed.
   */
  abilities: ReadonlyMap<string, AbilitySpec>;
  /** Installed weapon progression configuration, when known. */
  weaponProgression?: WeaponProgressionConfig;
}

interface WorkingCharacter {
  fighter: SnapshotFighter;
  hp: number;
  cp: number;
  mp: number;
  present: boolean;
  absorbEffects: Array<{ id: string; initial: number; remaining: number }>;
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
  engaged: boolean;
}

const ms = (iso: string): number => Date.parse(iso);

function effectsFor(effects: SnapshotEffect[], characterId: string, kind: string): SnapshotEffect[] {
  return effects.filter((e) => e.target_character_id === characterId && e.kind === kind);
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
  const expiredIds = new Set(
    snapshot.effects
      .filter((effect) => !effect.is_reservation && effect.expires_at && ms(effect.expires_at) <= nowMs)
      .map((effect) => effect.id),
  );

  // ── working state ─────────────────────────────────────────────
  const chars = new Map<string, WorkingCharacter>();
  for (const fighter of snapshot.fighters) {
    if (chars.has(fighter.character_id)) continue;
    const absorbEffects = effectsFor(snapshot.effects, fighter.character_id, 'absorb')
      .filter((effect) => !expiredIds.has(effect.id))
      .map((effect) => {
        const magnitude = Math.max(0, Math.floor(effect.magnitude ?? 0));
        return { id: effect.id, initial: magnitude, remaining: magnitude };
      });
    chars.set(fighter.character_id, {
      fighter,
      hp: fighter.hp,
      cp: fighter.cp,
      mp: fighter.mp,
      present: fighter.present,
      absorbEffects,
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
      engaged: row.engaged,
    });
  }

  // ── durable reward qualification ──────────────────────────────
  // A qualification is an explicit INTERACTION with one creature spawn. It is
  // scoped by `spawn_seq`, so qualifying against an earlier spawn can never pay
  // out for a respawn. Rows already present in the snapshot are not re-proposed
  // unless this tick refreshes them.
  const alreadyQualified = new Set(
    (snapshot.participation ?? [])
      .filter((p) => p.qualification === 'qualified')
      .map((p) => `${p.creature_id}:${p.spawn_seq}:${p.character_id}`),
  );
  const proposedQualified = new Set<string>();
  const reactedThisTick = new Set<string>();
  const skipOrdinaryThisTick = new Set<string>();
  const occupiedActionSlots = new Set(snapshot.intents.map(intent => intent.character_id));
  const qualify = (
    creature: WorkingCreature,
    characterId: string,
    reason: ProposedParticipation['qualified_by'],
  ): void => {
    const key = `${creature.row.creature_id}:${creature.row.spawn_seq}:${characterId}`;
    if (proposedQualified.has(key)) return;
    proposedQualified.add(key);
    proposed.participation.push({
      creature_id: creature.row.creature_id,
      spawn_seq: creature.row.spawn_seq,
      character_id: characterId,
      qualification: 'qualified',
      qualified_by: reason,
      party_id_at_qualification: chars.get(characterId)?.fighter.party_id ?? null,
    });
  };

  // ── out-of-tick events ────────────────────────────────────────
  // The commit folds these into THIS tick's batch and marks them consumed in the
  // same transaction, so delivery is exactly once. The resolver only names them.
  for (const pending of snapshot.pending_events ?? []) {
    proposed.pending_event_ids.push(pending.id);
  }

  /** Class-scoped catalogue lookup; falls back to the bare ability key. */
  const specFor = (classKey: string | null, abilityKey: string): AbilitySpec | undefined =>
    deps.abilities.get(`${classKey ?? ''}:${abilityKey}`) ?? deps.abilities.get(abilityKey);



  const livingCharacters = (): Set<string> => {
    const set = new Set<string>();
    for (const [id, c] of chars) if (c.present && c.hp > 0) set.add(id);
    return set;
  };

  // ── 1. effect lifetimes: expire first, then pulse at most once ─
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
        // A DoT tick is an interaction: it qualifies its source for this spawn
        // even when the source has since left the node.
        if (effect.source_character_id) qualify(target, effect.source_character_id, 'damage');
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

  // Authoritative entry/exit transitions are claimed exactly once and use the
  // same damage, mitigation and reactive pipeline as ordinary attacks.
  for (const pending of snapshot.pending_events ?? []) {
    if (pending.event_type !== 'fighter_entered' && pending.event_type !== 'fighter_exit_requested') continue;
    const fighterId = typeof pending.payload.fighter_id === 'string' ? pending.payload.fighter_id : null;
    const entrySeq = typeof pending.payload.entry_seq === 'number' ? pending.payload.entry_seq : null;
    const target = fighterId === null ? undefined : snapshot.fighters.find((fighter) =>
      fighter.id === fighterId && (entrySeq === null || fighter.entry_seq === entrySeq));
    if (!target || !target.present || !livingCharacters().has(target.character_id)) continue;
    const opportunityKind = pending.event_type === 'fighter_entered' ? 'entry' : 'exit';
    for (const creature of [...creatures.values()].sort((a, b) => a.row.id.localeCompare(b.row.id))) {
      if (!creature.engaged || creature.hp <= 0 || !creature.row.is_alive) continue;
      applyCreatureDamage(creature, target, null, 0, opportunityKind, pending.id);
      if (!livingCharacters().has(target.character_id)) break;
    }
    if (pending.event_type === 'fighter_exit_requested') {
      proposed.fighters.push({ id: target.id, present: false });
      const died = chars.get(target.character_id)?.hp === 0;
      const workingTarget = chars.get(target.character_id);
      if (workingTarget) workingTarget.present = false;
      emit({
        kind: died ? 'fighter_exit_failed' : 'fighter_fled',
        actor: { type: 'character', id: target.character_id, name: target.name },
        outcomeReason: died ? 'dead' : undefined,
        meta: { transitionEventId: pending.id, entrySeq: target.entry_seq },
      });
    }
  }

  // ── 2. player intents (exactly the ones inside the cutoff) ─────
  //
  // Every intent inside the cutoff is consumed exactly once, whether it
  // resolves or is rejected — a rejected intent must never be retried silently
  // on a later tick.
  //
  // Reserved CP is modelled as a `is_reservation` effect whose magnitude is the
  // reserved amount. Only a committed tick may create or remove one; the
  // browser may only queue the intent. Dropping never refunds the spent CP
  // (see `mem://game/stance-lifecycle`).
  const reservations = snapshot.effects.filter((e) => e.is_reservation);
  const droppedReservationIds = new Set<string>();
  const activatedStances = new Set<string>();

  const reservedFor = (characterId: string): number =>
    reservations
      .filter((e) => e.target_character_id === characterId && !droppedReservationIds.has(e.id))
      .reduce((sum, e) => sum + Math.max(0, e.magnitude ?? 0), 0);

  for (const intent of snapshot.intents) {
    proposed.intent_ids.push(intent.id);
    const intentKey = intent.ability_key ?? intent.stance_key ?? undefined;
    const actor = chars.get(intent.character_id);
    if (!actor || actor.hp <= 0 || !actor.present) {
      emit({ kind: 'action_rejected', outcomeReason: 'not_present_or_dead', abilityKey: intentKey });
      continue;
    }

    if (intent.intent_kind === 'basic_attack') {
      const state = snapshot.effects.find(e => e.kind === 'autoattack' && e.target_character_id === actor.fighter.character_id);
      const target = state?.target_creature_id ? creatures.get(state.target_creature_id) : undefined;
      if (!state || !target || target.hp <= 0 || state.config?.node_creature_id !== target.row.id
          || state.config?.spawn_seq !== target.row.spawn_seq) {
        emit({ kind: 'action_rejected', outcomeReason: 'invalid_basic_attack_target' });
        if (state) proposed.effects_delete.push(state.id);
        continue;
      }
      if (!target.engaged) {
        target.engaged = true; target.dirty = true; skipOrdinaryThisTick.add(target.row.id);
        emit({ kind: 'creature_engaged', actor: { type: 'character', id: actor.fighter.character_id, name: actor.fighter.name },
          target: { type: 'creature', id: target.row.creature_id, name: target.row.name }, meta: { nodeCreatureId: target.row.id, spawnSeq: target.row.spawn_seq } });
        for (const present of snapshot.fighters
          .filter(fighter => chars.get(fighter.character_id)?.present === true && livingCharacters().has(fighter.character_id))
          .sort((a, b) => a.id.localeCompare(b.id))) {
          if (target.hp <= 0) break;
          applyCreatureDamage(target, present, null, 0, 'engagement_opening', intent.id);
        }
        if (actor.hp <= 0) {
          emit({ kind: 'action_rejected', outcomeReason: 'actor_died_during_engagement' });
          continue;
        }
      }
      const outcome = resolveBasicAttack({ rng, nowMs, tick, actor: actor.fighter, creature: target.row, weaponProgression: deps.weaponProgression });
      if (outcome.rejected) emit({ kind: 'action_rejected', outcomeReason: outcome.rejected });
      else {
        qualify(target, actor.fighter.character_id, 'damage');
        if (outcome.creatureDamage) { const applied = Math.min(target.hp, outcome.creatureDamage); target.hp -= applied; target.damaged = true; target.dirty = true; if (!target.hp) target.killedBy = actor.fighter.character_id; }
        for (const event of outcome.events) emit(event);
      }
      continue;
    }
    const spec = intentKey ? specFor(actor.fighter.class, intentKey) : undefined;
    if (!spec) {
      emit({ kind: 'action_rejected', outcomeReason: 'unknown_ability', abilityKey: intentKey });
      continue;
    }

    // ── 2a. stance drop: authoritative, no refund ────────────────
    if (intent.intent_kind === 'stance_drop') {
      const owned = snapshot.effects.filter(
        (e) =>
          e.ability_key === spec.abilityKey &&
          e.target_character_id === actor.fighter.character_id &&
          !expiredIds.has(e.id),
      );
      if (owned.length === 0) {
        emit({ kind: 'action_rejected', outcomeReason: 'stance_not_active', abilityKey: spec.abilityKey });
        continue;
      }
      for (const effect of owned) {
        proposed.effects_delete.push(effect.id);
        if (effect.is_reservation) droppedReservationIds.add(effect.id);
        const absorbEffect = actor.absorbEffects.find((candidate) => candidate.id === effect.id);
        if (absorbEffect) absorbEffect.remaining = 0;
      }
      emit({
        kind: 'stance_dropped',
        abilityKey: spec.abilityKey,
        actor: { type: 'character', id: actor.fighter.character_id, name: actor.fighter.name },
        meta: { refunded: false },
      });
      continue;
    }

    // ── 2b. stance activation ────────────────────────────────────
    if (intent.intent_kind === 'stance_activate') {
      if (spec.activation !== 'stance' || !spec.cpReservePct) {
        emit({ kind: 'action_rejected', outcomeReason: 'not_a_stance', abilityKey: spec.abilityKey });
        continue;
      }
      const alreadyActive = reservations.some(
        (e) =>
          e.ability_key === spec.abilityKey &&
          e.target_character_id === actor.fighter.character_id &&
          !droppedReservationIds.has(e.id),
      );
      if (alreadyActive || activatedStances.has(spec.abilityKey)) {
        emit({ kind: 'action_rejected', outcomeReason: 'stance_already_active', abilityKey: spec.abilityKey });
        continue;
      }

      // Authored mutual exclusion (Ignite / Envenom).
      const exclusive = Array.isArray(spec.config.mutually_exclusive_with)
        ? (spec.config.mutually_exclusive_with as unknown[]).filter((v): v is string => typeof v === 'string')
        : [];
      const conflict = reservations.find(
        (e) =>
          e.target_character_id === actor.fighter.character_id &&
          !droppedReservationIds.has(e.id) &&
          e.ability_key !== null &&
          exclusive.includes(e.ability_key),
      );
      if (conflict) {
        emit({
          kind: 'action_rejected',
          outcomeReason: 'stance_mutually_exclusive',
          abilityKey: spec.abilityKey,
          meta: { conflictsWith: conflict.ability_key },
        });
        continue;
      }

      const reserveAmount = Math.floor(actor.fighter.max_cp * spec.cpReservePct);
      const availableCp = actor.cp - reservedFor(actor.fighter.character_id);
      if (availableCp < spec.cpCost + reserveAmount) {
        emit({ kind: 'action_rejected', outcomeReason: 'insufficient_cp', abilityKey: spec.abilityKey });
        continue;
      }

      const ctx: MechanicContext = {
        rng,
        nowMs,
        tick,
        actor: actor.fighter,
        weaponProgression: deps.weaponProgression,
      };
      const outcome = MECHANIC_HANDLERS[spec.mechanic](ctx, spec);
      if (outcome.rejected) {
        emit({ kind: 'action_rejected', outcomeReason: outcome.rejected, abilityKey: spec.abilityKey });
        continue;
      }

      activatedStances.add(spec.abilityKey);
      actor.cp = Math.max(0, actor.cp - spec.cpCost);
      actor.dirty = true;
      proposed.effects_insert.push({
        kind: 'reservation',
        effect_type: 'cp_reservation',
        ability_key: spec.abilityKey,
        target_character_id: actor.fighter.character_id,
        source_character_id: actor.fighter.character_id,
        stacks: 1,
        magnitude: reserveAmount,
        config: { reserve_pct: spec.cpReservePct },
        expires_at: null,
        is_reservation: true,
      });
      // The stance's own effect(s) carry no wall-clock expiry (see `buffEffect`).
      for (const effect of outcome.effects) proposed.effects_insert.push(effect);
      emit({
        kind: 'stance_activated',
        abilityKey: spec.abilityKey,
        actor: { type: 'character', id: actor.fighter.character_id, name: actor.fighter.name },
        amount: reserveAmount,
        meta: { reservePct: spec.cpReservePct },
      });
      for (const event of outcome.events) emit(event);
      continue;
    }

    // ── 2c. ordinary ability ─────────────────────────────────────
    const availableCp = actor.cp - reservedFor(actor.fighter.character_id);
    if (availableCp < spec.cpCost) {
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
    if (spec.targetType === 'enemy' && !targetCreature) {
      emit({ kind: 'action_rejected', outcomeReason: 'no_target', abilityKey: spec.abilityKey });
      continue;
    }

    // Enemy-targeted abilities are the only hostile intents. The first one
    // engages this exact spawn and opens against every present fighter.
    if (spec.targetType === 'enemy' && targetCreature && !targetCreature.engaged) {
      targetCreature.engaged = true;
      targetCreature.dirty = true;
      skipOrdinaryThisTick.add(targetCreature.row.id);
      qualify(targetCreature, actor.fighter.character_id, 'damage');
      emit({
        kind: 'creature_engaged',
        actor: { type: 'character', id: actor.fighter.character_id, name: actor.fighter.name },
        target: { type: 'creature', id: targetCreature.row.creature_id, name: targetCreature.row.name },
        meta: { nodeCreatureId: targetCreature.row.id, spawnSeq: targetCreature.row.spawn_seq },
      });
      for (const present of snapshot.fighters
        .filter((fighter) => chars.get(fighter.character_id)?.present === true && livingCharacters().has(fighter.character_id))
        .sort((a, b) => a.id.localeCompare(b.id))) {
        if (targetCreature.hp <= 0) break;
        applyCreatureDamage(targetCreature, present, null, 0, 'engagement_opening', intent.id);
      }
      if (actor.hp <= 0) {
        emit({ kind: 'action_rejected', outcomeReason: 'actor_died_during_engagement', abilityKey: spec.abilityKey });
        continue;
      }
    }

    const stackEffects = targetCreature
      ? snapshot.effects.filter(
          (e) =>
            e.kind === 'stack' &&
            e.target_creature_id === targetCreature.row.creature_id &&
            e.source_character_id === actor.fighter.character_id &&
            (spec.stackType === null || e.effect_type === spec.stackType) &&
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
      weaponProgression: deps.weaponProgression,
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
    if (outcome.rejected) {
      emit({ kind: 'action_rejected', outcomeReason: outcome.rejected, abilityKey: spec.abilityKey });
      continue;
    }

    if (outcome.cpCost) {
      actor.cp = Math.max(0, actor.cp - outcome.cpCost);
      actor.dirty = true;
    }
    if (outcome.actorHpCost) {
      actor.hp = Math.max(1, actor.hp - outcome.actorHpCost);
      actor.dirty = true;
    }
    if (targetCreature) {
      // Interaction-based qualification: an attempt that reached the creature
      // qualifies, including a miss (it engaged that spawn) — but only when the
      // mechanic actually addressed the creature.
      if (outcome.creatureDamage !== undefined || outcome.missed) {
        qualify(targetCreature, actor.fighter.character_id, 'damage');
      } else if (outcome.effects.some((e) => e.target_creature_id)) {
        qualify(targetCreature, actor.fighter.character_id, 'debuff');
      }
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


  // Server-owned continued attacks: exactly one slot, only when no accepted intent occupied it.
  for (const actor of [...chars.values()].sort((a, b) => a.fighter.id.localeCompare(b.fighter.id))) {
    if (occupiedActionSlots.has(actor.fighter.character_id) || !actor.present || actor.hp <= 0) continue;
    const state = snapshot.effects.find(e => e.kind === 'autoattack' && e.target_character_id === actor.fighter.character_id);
    if (!state) continue;
    const target = state.target_creature_id ? creatures.get(state.target_creature_id) : undefined;
    if (!target || target.hp <= 0 || state.config?.node_creature_id !== target.row.id || state.config?.spawn_seq !== target.row.spawn_seq) {
      proposed.effects_delete.push(state.id); continue;
    }
    const outcome = resolveBasicAttack({ rng, nowMs, tick, actor: actor.fighter, creature: target.row, weaponProgression: deps.weaponProgression });
    if (outcome.rejected) emit({ kind: 'action_rejected', outcomeReason: outcome.rejected });
    else {
      qualify(target, actor.fighter.character_id, 'damage');
      if (outcome.creatureDamage) { const applied = Math.min(target.hp, outcome.creatureDamage); target.hp -= applied; target.damaged = true; target.dirty = true; if (!target.hp) target.killedBy = actor.fighter.character_id; }
      for (const event of outcome.events) emit(event);
    }
  }

  // ── 3. creature actions ───────────────────────────────────────
  const currentTank = (): SnapshotFighter | null => {
    for (const candidate of snapshot.tank_candidates) {
      const fighter = snapshot.fighters.find((row) => row.id === candidate.fighter_id);
      const character = chars.get(candidate.character_id);
      if (fighter?.character_id === candidate.character_id && fighter.entry_seq === candidate.entry_seq &&
          character?.present === true && character.hp > 0) return fighter;
    }
    return null;
  };

  for (const creature of creatures.values()) {
    if (creature.hp <= 0 || !creature.row.is_alive) {
      if (creature.pendingAction) {
        creature.pendingAction = null;
        creature.dirty = true;
      }
      continue;
    }
    const living = livingCharacters();
    const tank = currentTank();
    if (creature.tankFighterId !== (tank?.id ?? null)) {
      creature.tankFighterId = tank?.id ?? null;
      creature.dirty = true;
    }
    if (!creature.engaged || skipOrdinaryThisTick.has(creature.row.id)) continue;

    // 3a. a telegraphed action that is due resolves now, and the creature does
    //     nothing else this tick (one action per tick).
    if (creature.pendingAction) {
      if (creature.pendingAction.resolve_at_tick > tick) continue;
      const pendingAction = creature.pendingAction;
      const ability = snapshot.boss_abilities.find(
        (b) => b.creature_id === creature.row.creature_id &&
          (b.spawn_seq === undefined || b.spawn_seq === creature.row.spawn_seq) &&
          b.ability_key === pendingAction.ability_key,
      );
      creature.pendingAction = null;
      creature.dirty = true;
      if (!ability) {
        emit({ kind: 'boss_cast_evaded', outcomeReason: 'ability_missing' });
        continue;
      }
      const capturedFighter = snapshot.fighters.find(
        (fighter) => fighter.id === pendingAction.target_fighter_id,
      );
      const capturedTarget = capturedFighter
        && capturedFighter.character_id === pendingAction.target_character_id
        && capturedFighter.entry_seq === pendingAction.target_entry_seq
        && capturedFighter.present
        && living.has(capturedFighter.character_id)
        ? capturedFighter
        : null;
      if (!capturedTarget) {
        emit({
          kind: 'boss_cast_evaded',
          abilityKey: ability.ability_key,
          actor: { type: 'creature', id: creature.row.creature_id, name: creature.row.name },
          outcomeReason: 'no_target',
        });
        continue;
      }
      applyCreatureDamage(creature, capturedTarget, ability.ability_key, Math.floor(ability.magnitude ?? 0));
      continue;
    }

    // 3b. select an ability; a wind-up writes a pending action and announces it.
    const pool = snapshot.boss_abilities.filter((b) =>
      b.creature_id === creature.row.creature_id &&
      (b.spawn_seq === undefined || b.spawn_seq === creature.row.spawn_seq));
    const chosen = rng.weightedPick(pool, (b) => b.weight, 'boss_select', creature.row.creature_id, tick);
    if (chosen && chosen.windup_ticks > 0) {
      if (!tank) {
        emit({
          kind: 'boss_cast_evaded',
          abilityKey: chosen.ability_key,
          actor: { type: 'creature', id: creature.row.creature_id, name: creature.row.name },
          outcomeReason: 'no_target',
        });
        continue;
      }
      creature.pendingAction = {
        ability_key: chosen.ability_key,
        ability_label: chosen.label,
        started_at_tick: tick,
        resolve_at_tick: tick + chosen.windup_ticks,
        target_fighter_id: tank.id,
        target_character_id: tank.character_id,
        target_entry_seq: tank.entry_seq,
      };
      creature.dirty = true;
      emit({
        kind: 'boss_telegraph',
        abilityKey: chosen.ability_key,
        actor: { type: 'creature', id: creature.row.creature_id, name: creature.row.name },
        target: { type: 'character', id: tank.character_id, name: tank.name },
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
    opportunityKind?: 'entry' | 'exit' | 'engagement_opening',
    transitionEventId?: string,
  ): void {
    const target = chars.get(targetFighter.character_id);
    if (!target || target.hp <= 0) return;

    const stream = `creature_attack:${opportunityKind ?? 'ordinary'}:${transitionEventId ?? tick}:${creature.row.id}:${creature.row.spawn_seq}:${abilityKey ?? 'auto'}`;
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
        meta: opportunityKind ? { opportunityKind, transitionEventId, spawnSeq: creature.row.spawn_seq } : undefined,
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
      absorbPool: target.absorbEffects.reduce((sum, effect) => sum + effect.remaining, 0),
    });

    let absorbToConsume = breakdown.absorbed;
    for (const effect of target.absorbEffects) {
      if (absorbToConsume === 0) break;
      const consumed = Math.min(effect.remaining, absorbToConsume);
      effect.remaining -= consumed;
      absorbToConsume -= consumed;
    }
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
        ...(opportunityKind ? { opportunityKind, transitionEventId, spawnSeq: creature.row.spawn_seq } : {}),
        isCrit,
        percentMitigated: breakdown.percentMitigated,
        shieldBonusApplied: breakdown.shieldBonusApplied,
        critSoftened: breakdown.critSoftened,
        flatMitigated: breakdown.flatMitigated,
        blocked: breakdown.blocked,
        absorbed: breakdown.absorbed,
      },
    });

    // ── reactive retaliation ────────────────────────────────────
    // Authored trigger only: a landed attack against the effect's owner. The
    // damage belongs to the effect's SOURCE character (who may be offscreen),
    // uses the same creature-damage bookkeeping as any other source, and can
    // never produce a second death: a creature already at zero HP is skipped,
    // so no extra death, reward, XP or loot can follow from it.
    for (const effect of effectsFor(snapshot.effects, targetFighter.character_id, 'reactive')) {
      if (expiredIds.has(effect.id)) continue;
      if (proposed.effects_delete.includes(effect.id)) continue;
      if (creature.hp <= 0 || !creature.row.is_alive) continue;

      const reactionKey = `${effect.id}:${creature.row.creature_id}:${creature.row.spawn_seq}`;
      if (effect.config?.once_per_attacker_per_tick === true) {
        if (reactedThisTick.has(reactionKey)) continue;
        reactedThisTick.add(reactionKey);
      }

      const magnitude = Math.max(0, Math.floor(effect.magnitude ?? 0));
      if (magnitude === 0) continue;

      const dealt = Math.min(creature.hp, magnitude);
      creature.hp -= dealt;
      creature.damaged = true;
      creature.dirty = true;
      const source = effect.source_character_id;
      if (source) qualify(creature, source, 'damage');
      if (creature.hp === 0 && creature.killedBy === null) creature.killedBy = source;

      emit({
        kind: 'effect_pulse',
        abilityKey: effect.ability_key ?? undefined,
        actor: source
          ? { type: 'character', id: source, name: chars.get(source)?.fighter.name ?? '' }
          : undefined,
        target: { type: 'creature', id: creature.row.creature_id, name: creature.row.name },
        amount: dealt,
        meta: {
          effectKind: 'reactive',
          reactive: true,
          damageType: (effect.config?.damage_type as string | undefined) ?? null,
        },
      });
    }
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

      // Reward eligibility is DURABLE QUALIFICATION for exactly this spawn, not
      // presence and not party membership: a player who tagged the creature and
      // then walked away is still paid, and a bystander who never interacted is
      // not. Party members are paid only through their own qualification.
      const baseXp = getCreatureXp(creature.row.level, creature.row.rarity ?? 'common');
      const levelOf = new Map(snapshot.fighters.map((f) => [f.character_id, f.level]));
      const recipients = new Set<string>();
      for (const key of [...alreadyQualified, ...proposedQualified]) {
        const [creatureId, spawnSeq, characterId] = key.split(':');
        if (creatureId !== creature.row.creature_id) continue;
        if (Number(spawnSeq) !== creature.row.spawn_seq) continue;
        recipients.add(characterId);
      }
      for (const characterId of [...recipients].sort()) {
        const level = levelOf.get(characterId);
        // XP scaling needs the recipient's level; an unknown level means the
        // fighter row is not in this snapshot, so the payout waits for a
        // snapshot that carries it rather than being computed from a guess.
        if (level === undefined) continue;
        const penalty = getXpPenalty(level, creature.row.level);
        proposed.rewards.push({
          creature_id: creature.row.creature_id,
          spawn_seq: creature.row.spawn_seq,
          character_id: characterId,
          xp_awarded: Math.max(0, Math.floor(baseXp * penalty)),
          gold_awarded: 0,
          is_killer: characterId === creature.killedBy,
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
    for (const effect of character.absorbEffects) {
      if (effect.remaining === effect.initial) continue;
      if (effect.remaining === 0) {
        if (!proposed.effects_delete.includes(effect.id)) proposed.effects_delete.push(effect.id);
      } else {
        proposed.effects_update.push({ id: effect.id, magnitude: effect.remaining });
      }
    }
  }

  for (const state of snapshot.effects.filter(e => e.kind === 'autoattack')) {
    const actor = state.target_character_id ? chars.get(state.target_character_id) : undefined;
    const target = state.target_creature_id ? creatures.get(state.target_creature_id) : undefined;
    if (!actor || !actor.present || actor.hp <= 0 || !target || target.hp <= 0
        || state.config?.node_creature_id !== target.row.id || state.config?.spawn_seq !== target.row.spawn_seq) {
      if (!proposed.effects_delete.includes(state.id)) proposed.effects_delete.push(state.id);
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
      if (!proposed.fighters.some((fighter) => fighter.id === character.fighter.id)) {
        proposed.fighters.push({ id: character.fighter.id, present: false });
      }
      emit({
        kind: 'character_died',
        target: { type: 'character', id: character.fighter.character_id, name: character.fighter.name },
      });
    }
  }

  // ── 5. encounter lifecycle ────────────────────────────────────
  const anythingPending =
    [...creatures.values()].some((c) => c.hp > 0 && c.row.is_alive) ||
    snapshot.effects.some((e) => e.kind !== 'autoattack' && !expiredIds.has(e.id) && !e.is_reservation);
  if (!anythingPending) proposed.status = 'ended';

  return proposed;
}
