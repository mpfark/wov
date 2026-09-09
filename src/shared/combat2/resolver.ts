/**
 * combat2/resolver.ts — the pure authoritative tick resolver.
 *
 * `resolveNodeTick(snapshot, deps)` is a total function of its inputs: the same
 * snapshot and the same candidate tick always produce a byte-identical
 * `ProposedTick`. It performs no IO, reads no clock (`snapshot.encounter.now` is
 * the authoritative wall clock) and never calls `Math.random()`.
 */

import { getCreatureXp, getXpPenalty } from '../formulas/xp';
import { getChaGoldMultiplier } from '../formulas/economy';
import { getPartyXpBonus } from '../combat/pure/party-xp';
import { getCreatureDamageDie, getCreatureAttackBonus, CREATURE_CRIT_MULT, getEffectiveAC, type WeaponProgressionConfig } from '../formulas/combat';
import { getStatModifier } from '../formulas/stats';
import { effectiveItemStats } from '../formulas/items';
import { getEffectiveMaxCp, getEffectiveMaxHp, getEffectiveMaxMp } from '../formulas/resources';
import { applyMitigationPipeline, readMitigationParams } from './mitigation';
import { TickRandom } from './rng';
import { combat2PulseDue, combat2TickTiming, combat2TicksForMs, readCombat2TickTiming } from './time';
import {
  MECHANIC_HANDLERS,
  COMBAT2_HEARTBEAT_MS,
  resolveBasicAttack,
  type AbilitySpec,
  type AbilityStatusSpec,
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
  const claimedEquipment = snapshot.fighters.flatMap(fighter => fighter.equipment.map(item => ({
    ...item, fighter_id: fighter.id, entry_seq: fighter.entry_seq,
  }))).sort((a, b) => a.inventory_id.localeCompare(b.inventory_id));
  // Character columns are the persisted/base boundary. Equipment is applied
  // exactly once here from the immutable claimed instances; broken gear grants
  // no stats, shield tag, weapon die, or proc.
  snapshot = { ...snapshot, fighters: snapshot.fighters.map((fighter) => {
    // Persisted maxima/AC are authoritative for an unequipped fighter and are
    // already maintained by sync_character_resources. Re-derive only when an
    // equipment loadout is actually present, avoiding a second base-stat path.
    if (fighter.equipment.length === 0) return fighter;
    const usable = fighter.equipment.filter(item => (item.durability ?? 0) > 0);
    const bonuses: Record<string, number> = {};
    for (const item of usable) for (const [key, value] of Object.entries(effectiveItemStats({
      baseStats: item.base_stats, statOverride: item.stat_override, appliedGems: item.applied_gems,
    }))) bonuses[key] = (bonuses[key] ?? 0) + value;
    const hasShield = usable.some(item => item.slot === 'off_hand' && item.weapon_tag === 'shield');
    return { ...fighter, equipment: usable,
      str: fighter.str + (bonuses.str ?? 0), dex: fighter.dex + (bonuses.dex ?? 0),
      con: fighter.con + (bonuses.con ?? 0), int: fighter.int + (bonuses.int ?? 0),
      wis: fighter.wis + (bonuses.wis ?? 0), cha: fighter.cha + (bonuses.cha ?? 0),
      ac: getEffectiveAC(fighter.class ?? '', fighter.dex, bonuses, hasShield),
      max_hp: getEffectiveMaxHp(fighter.class ?? '', fighter.con, fighter.level, bonuses),
      max_cp: getEffectiveMaxCp(fighter.level, fighter.wis, bonuses),
      max_mp: getEffectiveMaxMp(fighter.level, fighter.dex, bonuses),
    };
  }) };
  const { encounter } = snapshot;
  const tick = encounter.candidate_tick;
  const nowMs = encounter.tick_origin
    ? ms(encounter.tick_origin) + tick * COMBAT2_HEARTBEAT_MS
    : ms(encounter.now);
  const rng = new TickRandom({ encounterId: encounter.id, candidateTick: tick });
  const proposed = emptyProposedTick(tick);
  proposed.equipment_fence.push(...claimedEquipment);
  let seq = 0;
  const emit = (event: Omit<TickEvent, 'seq'>): void => {
    proposed.events.push({ ...event, seq: seq++ });
  };
  const expiredIds = new Set(
    snapshot.effects
      .filter((effect) => {
        if (effect.is_reservation) return false;
        const timing = readCombat2TickTiming(effect.config);
        return timing ? tick > timing.expires_after_tick : Boolean(effect.expires_at && ms(effect.expires_at) <= nowMs);
      })
      .map((effect) => effect.id),
  );

  // ── working state ─────────────────────────────────────────────
  const chars = new Map<string, WorkingCharacter>();
  for (const fighter of snapshot.fighters) {
    if (chars.has(fighter.character_id)) continue;
    const absorbEffects = effectsFor(snapshot.effects, fighter.character_id, 'absorb')
      .filter((effect) => !expiredIds.has(effect.id)
        && (effect.ability_key !== 'divine_aegis'
          || (effect.config?.target_fighter_id === fighter.id && effect.config?.target_entry_seq === fighter.entry_seq)))
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
  const weaponHitCharacters = new Set<string>();
  const departingCharacters = new Set((snapshot.pending_events ?? [])
    .filter(event => ['fighter_exit_requested', 'fighter_depart_requested', 'fighter_fled'].includes(event.event_type))
    .map(event => event.actor_character_id).filter((id): id is string => id !== null));
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

  const applyItemProc = (actor: WorkingCharacter, target: WorkingCreature, ordinal: number): void => {
    weaponHitCharacters.add(actor.fighter.character_id);
    const choices = actor.fighter.equipment.flatMap(item => item.procs.map((proc, index) => ({ item, proc, index })))
      .sort((a, b) => a.item.inventory_id.localeCompare(b.item.inventory_id) || a.index - b.index);
    const selected = rng.weightedPick(choices, row => row.proc.weight, 'item_proc_select', actor.fighter.id, target.row.id, ordinal);
    if (!selected || rng.sample('item_proc_chance', selected.item.inventory_id, selected.index, target.row.id, ordinal) >= selected.proc.chance) return;
    if (selected.proc.type === 'lifesteal') {
      const healed = Math.min(actor.fighter.max_hp - actor.hp, Math.floor(selected.proc.value));
      actor.hp += healed; if (healed > 0) actor.dirty = true;
      emit({ kind: 'item_proc_heal', actor: { type: 'character', id: actor.fighter.character_id, name: actor.fighter.name },
        amount: healed, meta: { inventoryId: selected.item.inventory_id, itemId: selected.item.item_id, text: selected.proc.text } });
    } else if (target.hp > 0) {
      const dealt = Math.min(target.hp, Math.floor(selected.proc.value));
      target.hp -= dealt; target.damaged = true; target.dirty = true;
      if (target.hp === 0 && target.killedBy === null) target.killedBy = actor.fighter.character_id;
      qualify(target, actor.fighter.character_id, 'damage');
      emit({ kind: 'item_proc_damage', actor: { type: 'character', id: actor.fighter.character_id, name: actor.fighter.name },
        target: { type: 'creature', id: target.row.creature_id, name: target.row.name }, amount: dealt,
        meta: { inventoryId: selected.item.inventory_id, itemId: selected.item.item_id,
          damageType: selected.proc.damage_type, text: selected.proc.text, nodeCreatureId: target.row.id, spawnSeq: target.row.spawn_seq } });
    }
  };

  type AmplifiedSource = 'weapon' | 'ability' | 'stance' | 'dot' | 'proc';
  const effectAppliesToSpawn = (
    effect: { target_creature_id?: string | null; config?: Record<string, unknown> },
    target: WorkingCreature,
  ): boolean => {
    if (effect.target_creature_id !== target.row.creature_id) return false;
    const nodeCreatureId = effect.config?.node_creature_id;
    const spawnSeq = effect.config?.spawn_seq;
    // Compatibility for effects captured before the fencing fields existed.
    // Every newly accepted player ability writes both fields below.
    if (nodeCreatureId === undefined && spawnSeq === undefined) return true;
    return nodeCreatureId === target.row.id && spawnSeq === target.row.spawn_seq;
  };
  const amplificationFor = (target: WorkingCreature, source: AmplifiedSource): number => {
    const strongest = new Map<string, number>();
    const rows = [
      ...snapshot.effects.filter(effect => !expiredIds.has(effect.id)
        && !proposed.effects_delete.includes(effect.id)),
      ...proposed.effects_insert,
    ];
    for (const effect of rows) {
      if (effect.kind !== 'amplification' || !effectAppliesToSpawn(effect, target)) continue;
      const eligible = effect.config?.eligible_sources;
      if (!Array.isArray(eligible) || !eligible.includes(source)) continue;
      const pct = Number(effect.config?.damage_taken_pct ?? 0);
      if (!Number.isFinite(pct) || pct <= 0) continue;
      strongest.set(effect.effect_type, Math.max(strongest.get(effect.effect_type) ?? 0, pct));
    }
    return 1 + [...strongest.values()].reduce((sum, pct) => sum + pct, 0) / 100;
  };
  const statusDurationMs = (status: AbilityStatusSpec): number => {
    const baseMs = Number(status.duration.base_ms ?? 0);
    if (Number.isFinite(baseMs) && baseMs > 0) return Math.floor(baseMs);
    const ticks = Number(status.duration.duration_ticks ?? 0);
    return Number.isFinite(ticks) && ticks > 0
      ? Math.floor(ticks) * COMBAT2_HEARTBEAT_MS
      : 0;
  };
  const statusMaxStacks = (status: AbilityStatusSpec): number => {
    const calc = status.stacks.max_stacks_calc;
    const base = calc && typeof calc === 'object' && !Array.isArray(calc)
      ? Number((calc as Record<string, unknown>).base ?? 1)
      : 1;
    return Number.isFinite(base) ? Math.max(1, Math.floor(base)) : 1;
  };
  const applyLandedAbilityStatus = (
    actor: WorkingCharacter,
    target: WorkingCreature,
    spec: AbilitySpec,
    ordinal: number,
    outcome: MechanicOutcome,
  ): void => {
    const status = spec.appliedStatus;
    if (!status || target.hp <= 0 || status.trigger !== 'ability_hit'
        || spec.mechanic === 'dot_debuff' || spec.mechanic === 'stack_apply') return;
    const chance = Math.min(100, Math.max(0, status.chancePct ?? 0)) / 100;
    const landed = chance >= 1 || rng.sample('ability_status_chance', actor.fighter.character_id,
      spec.abilityKey, target.row.id, target.row.spawn_seq, tick, ordinal) < chance;
    if (!landed) {
      outcome.events.push({ kind: 'status_missed', abilityKey: spec.abilityKey,
        actor: { type: 'character', id: actor.fighter.character_id, name: actor.fighter.name },
        target: { type: 'creature', id: target.row.creature_id, name: target.row.name },
        amount: 0, meta: { status: status.key, chancePct: status.chancePct } });
      return;
    }
    const durationMs = statusDurationMs(status);
    const intervalMs = status.classification === 'dot' ? status.tickIntervalMs : null;
    const timing = combat2TickTiming(tick, durationMs, intervalMs ?? COMBAT2_HEARTBEAT_MS);
    const magnitude = status.classification === 'dot' ? Number(status.magnitude.flat ?? 0) : 0;
    const modifierPct = Number(status.modifier.value ?? 0);
    const eligibleSources = Array.isArray(status.modifier.eligible_sources)
      ? status.modifier.eligible_sources.filter((value): value is string => typeof value === 'string')
      : [];
    outcome.effects.push({
      kind: status.classification === 'dot' ? 'dot' : 'amplification',
      effect_type: status.effectType,
      ability_key: spec.abilityKey,
      target_creature_id: target.row.creature_id,
      source_character_id: actor.fighter.character_id,
      stacks: 1,
      magnitude,
      config: { node_creature_id: target.row.id, spawn_seq: target.row.spawn_seq,
        source_fighter_id: actor.fighter.id, source_entry_seq: actor.fighter.entry_seq,
        max_stacks: statusMaxStacks(status), damage_type: status.damageType,
        ...timing, ...(status.classification === 'damage_amp'
          ? { modifier_kind: status.modifier.kind, damage_taken_pct: modifierPct,
            eligible_sources: eligibleSources }
          : {}) },
      expires_at: new Date(nowMs + durationMs).toISOString(),
      next_due_at: intervalMs ? new Date(nowMs + intervalMs).toISOString() : null,
      interval_ms: intervalMs,
      last_pulse_tick: null,
      is_reservation: false,
    });
    outcome.events.push({ kind: 'status_applied', abilityKey: spec.abilityKey,
      actor: { type: 'character', id: actor.fighter.character_id, name: actor.fighter.name },
      target: { type: 'creature', id: target.row.creature_id, name: target.row.name },
      amount: 1, meta: { status: status.key, stacks: 1, maxStacks: statusMaxStacks(status),
        durationMs, chancePct: status.chancePct } });
  };
  const eligibleParty = (source: WorkingCharacter): WorkingCharacter[] => [...chars.values()]
    .filter(target => target.present && target.hp > 0
      && (target.fighter.character_id === source.fighter.character_id
        || (source.fighter.party_id !== null && target.fighter.party_id === source.fighter.party_id
          && source.fighter.party_id === source.fighter.party_id_at_entry
          && target.fighter.party_id === target.fighter.party_id_at_entry)))
    .sort((a, b) => a.fighter.id.localeCompare(b.fighter.id));
  const activeEffectsFor = (characterId: string): SnapshotEffect[] => snapshot.effects.filter(
    (effect) => effect.target_character_id === characterId
      && !expiredIds.has(effect.id)
      && !proposed.effects_delete.includes(effect.id),
  );
  type StackState = { effect: SnapshotEffect | null; insert: ProposedTick['effects_insert'][number] | null; stacks: number };
  const stackState = new Map<string, StackState>();
  for (const effect of snapshot.effects) {
    if (effect.kind !== 'stack' || expiredIds.has(effect.id) || !effect.source_character_id
        || !effect.target_creature_id || !effect.ability_key) continue;
    const creature = creatures.get(effect.target_creature_id);
    if (!creature || effect.config?.node_creature_id !== creature.row.id
        || effect.config?.spawn_seq !== creature.row.spawn_seq) continue;
    stackState.set(`${effect.source_character_id}:${creature.row.id}:${creature.row.spawn_seq}:${effect.effect_type}:${effect.ability_key}`,
      { effect, insert: null, stacks: Math.max(0, Math.floor(effect.stacks)) });
  }

  const applyStackSource = (
    source: SnapshotEffect,
    target: WorkingCreature,
    trigger: 'weapon_hit' | 'successful_pulse_hit',
    ordinal: number,
  ): void => {
    if (source.config?.stack_trigger !== trigger || target.hp <= 0 || !target.row.is_alive
        || !source.source_character_id || !source.ability_key) return;
    const actor = chars.get(source.source_character_id);
    if (!actor || !actor.present || actor.hp <= 0
        || source.config?.source_fighter_id !== actor.fighter.id
        || source.config?.source_entry_seq !== actor.fighter.entry_seq) return;
    const chance = Math.min(1, Math.max(0, source.magnitude ?? 0));
    const landed = chance >= 1 || rng.sample('stack_apply_chance', source.ability_key,
      source.source_character_id, target.row.id, target.row.spawn_seq, tick, ordinal) < chance;
    if (!landed) {
      if (trigger === 'successful_pulse_hit') emit({ kind: 'orb_attack', abilityKey: source.ability_key,
        actor: { type: 'character', id: actor.fighter.character_id, name: actor.fighter.name },
        target: { type: 'creature', id: target.row.creature_id, name: target.row.name },
        hitQuality: 'miss', amount: 0 });
      return;
    }
    if (trigger === 'successful_pulse_hit') {
      const rawAttempted = Math.max(1, Math.floor(Number(source.config?.pulse_damage ?? 0)));
      const attempted = Math.max(1, Math.floor(rawAttempted * amplificationFor(target, 'proc')));
      const applied = Math.min(target.hp, attempted);
      target.hp -= applied; target.damaged = true; target.dirty = true;
      qualify(target, actor.fighter.character_id, 'damage');
      if (target.hp === 0 && target.killedBy === null) target.killedBy = actor.fighter.character_id;
      emit({ kind: 'orb_attack', abilityKey: source.ability_key,
        actor: { type: 'character', id: actor.fighter.character_id, name: actor.fighter.name },
        target: { type: 'creature', id: target.row.creature_id, name: target.row.name },
        hitQuality: 'normal', amount: applied, meta: { damageType: source.config?.damage_type ?? 'fire' } });
      if (target.hp <= 0) return;
    }
    const effectType = String(source.config?.stack_effect_type ?? source.effect_type);
    const cap = Math.max(1, Math.floor(Number(source.config?.max_stacks ?? 1)));
    const duration = Math.max(COMBAT2_HEARTBEAT_MS, Math.floor(Number(source.config?.stack_duration_ms ?? 0)));
    const interval = Math.max(COMBAT2_HEARTBEAT_MS, Math.floor(Number(source.config?.stack_interval_ms ?? COMBAT2_HEARTBEAT_MS)));
    const timing = combat2TickTiming(tick, duration, interval);
    const key = `${actor.fighter.character_id}:${target.row.id}:${target.row.spawn_seq}:${effectType}:${source.ability_key}`;
    const current = stackState.get(key) ?? { effect: null, insert: null, stacks: 0 };
    const refreshedAtCap = current.stacks >= cap;
    current.stacks = Math.min(cap, current.stacks + 1);
    const expiresAt = new Date(nowMs + duration).toISOString();
    const nextDueAt = new Date(nowMs + interval).toISOString();
    if (current.effect) {
      const update = { id: current.effect.id, stacks: current.stacks,
        magnitude: Math.max(0, Math.floor(Number(source.config?.dot_per_tick ?? 0))),
        config: { ...current.effect.config, ...timing }, expires_at: expiresAt, next_due_at: nextDueAt };
      const existing = proposed.effects_update.find(row => row.id === current.effect!.id);
      if (existing) Object.assign(existing, update); else proposed.effects_update.push(update);
    } else if (current.insert) {
      current.insert.stacks = current.stacks;
      current.insert.expires_at = expiresAt;
      current.insert.next_due_at = nextDueAt;
    } else {
      current.insert = {
        kind: 'stack', effect_type: effectType, ability_key: source.ability_key,
        target_creature_id: target.row.creature_id, source_character_id: actor.fighter.character_id,
        stacks: current.stacks, magnitude: Math.max(0, Math.floor(Number(source.config?.dot_per_tick ?? 0))),
        config: { node_creature_id: target.row.id, creature_id: target.row.creature_id,
          spawn_seq: target.row.spawn_seq, source_fighter_id: actor.fighter.id,
          source_entry_seq: actor.fighter.entry_seq, max_stacks: cap,
          damage_type: source.config?.damage_type ?? null, ...timing },
        expires_at: expiresAt, next_due_at: nextDueAt, interval_ms: interval,
        last_pulse_tick: null, is_reservation: false,
      };
      proposed.effects_insert.push(current.insert);
    }
    stackState.set(key, current);
    qualify(target, actor.fighter.character_id, 'debuff');
    emit({ kind: 'stack_applied', abilityKey: source.ability_key,
      actor: { type: 'character', id: actor.fighter.character_id, name: actor.fighter.name },
      target: { type: 'creature', id: target.row.creature_id, name: target.row.name },
      amount: current.stacks, meta: { stacks: current.stacks, maxStacks: cap,
        stackNoun: source.config?.stack_noun ?? effectType, refreshed: refreshedAtCap } });
  };

  // ── 1. effect lifetimes: expire first, then pulse at most once ─
  for (const effect of snapshot.effects) {
    if (effect.kind !== 'autoattack' && effect.target_character_id && effect.source_character_id
        && (effect.config?.target_fighter_id !== undefined || effect.config?.target_entry_seq !== undefined)) {
      const target = chars.get(effect.target_character_id);
      if (!target || !target.present || target.hp <= 0
          || effect.config?.target_fighter_id !== target.fighter.id
          || effect.config?.target_entry_seq !== target.fighter.entry_seq) {
        expiredIds.add(effect.id);
        proposed.effects_delete.push(effect.id);
        emit({ kind: 'effect_invalidated', abilityKey: effect.ability_key ?? undefined,
          meta: { effectKind: effect.kind, effectType: effect.effect_type, reason: 'stale_fighter' } });
        continue;
      }
    }
    if (effect.is_reservation) continue; // lifetime owned by activation/drop/death
    if ((effect.kind === 'dot' || effect.kind === 'amplification') && effect.target_creature_id) {
      const target = creatures.get(effect.target_creature_id);
      if (!target || !effectAppliesToSpawn(effect, target)) {
        expiredIds.add(effect.id);
        proposed.effects_delete.push(effect.id);
        emit({ kind: 'effect_invalidated', abilityKey: effect.ability_key ?? undefined,
          meta: { effectKind: effect.kind, effectType: effect.effect_type, reason: 'stale_spawn' } });
        continue;
      }
    }
    const timing = readCombat2TickTiming(effect.config);
    if (timing ? tick > timing.expires_after_tick : Boolean(effect.expires_at && ms(effect.expires_at) <= nowMs)) {
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
    const timing = readCombat2TickTiming(effect.config);
    const due = timing
      ? combat2PulseDue(timing, tick, effect.last_pulse_tick)
      : ms(effect.next_due_at) <= nowMs && (effect.last_pulse_tick ?? -1) < tick;
    if (!due) continue;

    // skip-not-stack: missed pulses are discarded, never accumulated.
    const nextDue = ms(effect.next_due_at) + combat2TicksForMs(effect.interval_ms) * COMBAT2_HEARTBEAT_MS;
    proposed.effects_update.push({
      id: effect.id,
      next_due_at: new Date(nextDue).toISOString(),
      last_pulse_tick: tick,
    });

    const magnitude = Math.max(0, Math.floor(effect.magnitude ?? 0));
    if (effect.config?.presence_effect === true || effect.kind === 'aura' || effect.kind === 'party_regen') {
      const source = effect.source_character_id ? chars.get(effect.source_character_id) : undefined;
      if (!source || !source.present || source.hp <= 0
          || departingCharacters.has(source.fighter.character_id)
          || effect.config?.source_fighter_id !== source.fighter.id
          || effect.config?.source_entry_seq !== source.fighter.entry_seq) {
        if (!proposed.effects_delete.includes(effect.id)) proposed.effects_delete.push(effect.id);
        continue;
      }
      if (effect.kind === 'party_regen' || effect.kind === 'aura') {
        for (const target of eligibleParty(source)) {
          const healed = Math.min(target.fighter.max_hp - target.hp, magnitude);
          const cpRequested = Math.max(0, Math.floor(Number(effect.config?.cp_per_tick ?? 0)));
          const cpRestored = Math.min(target.fighter.max_cp - target.cp, cpRequested);
          target.hp += healed;
          target.cp += cpRestored;
          if (healed > 0 || cpRestored > 0) target.dirty = true;
          emit({ kind: effect.kind === 'aura' ? 'consecrate_heal' : 'party_restore',
            abilityKey: effect.ability_key ?? undefined,
            actor: { type: 'character', id: source.fighter.character_id, name: source.fighter.name },
            target: { type: 'character', id: target.fighter.character_id, name: target.fighter.name },
            amount: healed, meta: { requested: magnitude, applied: healed, wasted: magnitude - healed,
              cpRequested, cpApplied: cpRestored, cpWasted: cpRequested - cpRestored,
              effectKind: effect.kind } });
        }
      }
      if (effect.kind === 'aura') {
        for (const target of [...creatures.values()].sort((a, b) => a.row.id.localeCompare(b.row.id)
          || a.row.spawn_seq - b.row.spawn_seq)) {
          if (target.hp <= 0 || !target.row.is_alive) continue;
          const attempted = Math.max(0, Math.floor(magnitude * amplificationFor(target, 'stance')));
          const applied = Math.min(target.hp, attempted);
          target.hp -= applied; target.damaged = true; target.dirty = true;
          qualify(target, source.fighter.character_id, 'damage');
          if (target.hp === 0 && target.killedBy === null) target.killedBy = source.fighter.character_id;
          emit({ kind: 'consecrate_pulse', abilityKey: effect.ability_key ?? undefined,
            actor: { type: 'character', id: source.fighter.character_id, name: source.fighter.name },
            target: { type: 'creature', id: target.row.creature_id, name: target.row.name }, amount: applied,
            meta: { damageType: effect.config?.damage_type ?? 'holy', nodeCreatureId: target.row.id,
              spawnSeq: target.row.spawn_seq } });
        }
      }
      continue;
    }
    if (effect.target_creature_id) {
      const target = creatures.get(effect.target_creature_id);
      if (target && !effectAppliesToSpawn(effect, target)) {
        if (!proposed.effects_delete.includes(effect.id)) proposed.effects_delete.push(effect.id);
        continue;
      }
      if (target && target.hp > 0 && magnitude > 0) {
        const attempted = Math.max(0, Math.floor(magnitude * Math.max(1, effect.stacks)
          * amplificationFor(target, 'dot')));
        const applied = Math.min(target.hp, attempted);
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
    if (pending.event_type !== 'fighter_entered' && pending.event_type !== 'fighter_exit_requested'
        && pending.event_type !== 'fighter_depart_requested') continue;
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
    if (pending.event_type === 'fighter_exit_requested' || pending.event_type === 'fighter_depart_requested') {
      proposed.fighters.push({ id: target.id, present: false });
      const died = chars.get(target.character_id)?.hp === 0;
      const workingTarget = chars.get(target.character_id);
      if (workingTarget) workingTarget.present = false;
      if (pending.event_type === 'fighter_depart_requested') {
        const destination = typeof pending.payload.destination_node_id === 'string' ? pending.payload.destination_node_id : null;
        const origin = typeof pending.payload.origin_node_id === 'string' ? pending.payload.origin_node_id : null;
        const requestId = typeof pending.payload.departure_request_id === 'string' ? pending.payload.departure_request_id : null;
        const cost = typeof pending.payload.cost === 'number' && Number.isSafeInteger(pending.payload.cost)
          ? pending.payload.cost : null;
        if (destination && origin && requestId && cost !== null) {
          proposed.departures.push({
            request_id: requestId,
            origin_node_id: origin,
            destination_node_id: destination,
            fighter_id: target.id,
            fighter_entry_seq: target.entry_seq,
            cost,
            outcome: died ? 'dead' : 'moved',
          });
        }
      }
      emit({
        kind: died ? 'fighter_exit_failed' : pending.event_type === 'fighter_depart_requested' ? 'fighter_moved' : 'fighter_fled',
        actor: { type: 'character', id: target.character_id, name: target.name },
        outcomeReason: died ? 'dead' : undefined,
        meta: { transitionEventId: pending.id, entrySeq: target.entry_seq,
          ...(pending.event_type === 'fighter_depart_requested' && typeof pending.payload.destination_node_id === 'string'
            ? { destinationNodeId: pending.payload.destination_node_id } : {}) },
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
      const outcome = resolveBasicAttack({ rng, nowMs, tick, actor: actor.fighter, creature: target.row,
        activeEffects: activeEffectsFor(actor.fighter.character_id), weaponProgression: deps.weaponProgression });
      if (outcome.rejected) emit({ kind: 'action_rejected', outcomeReason: outcome.rejected });
      else {
        qualify(target, actor.fighter.character_id, 'damage');
        if (outcome.creatureDamage) { const applied = Math.min(target.hp, outcome.creatureDamage); target.hp -= applied; target.damaged = true; target.dirty = true; if (!target.hp) target.killedBy = actor.fighter.character_id; }
        if (!outcome.missed) {
          applyItemProc(actor, target, 0);
        }
        if (!outcome.missed && target.hp > 0) {
          for (const source of activeEffectsFor(actor.fighter.character_id).filter(effect => effect.kind === 'stack_source')) {
            applyStackSource(source, target, 'weapon_hit', 0);
          }
        }
        for (const id of outcome.consumeEffectIds) if (!proposed.effects_delete.includes(id)) proposed.effects_delete.push(id);
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

    // Existing unsupported stances may still be dropped safely, but no new
    // activation or ordinary action may pass the release gate.
    if (!spec.support.supported) {
      emit({ kind: 'action_rejected', outcomeReason: 'ability_unavailable', abilityKey: spec.abilityKey });
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
        config: { reserve_pct: spec.cpReservePct, target_fighter_id: actor.fighter.id,
          target_entry_seq: actor.fighter.entry_seq },
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
    const intentTargetCharacter = intent.target_character_id ?? null;
    const ally = intentTargetCharacter ? chars.get(intentTargetCharacter) : undefined;
    if (spec.targetType === 'ally') {
      const sameParty = ally && actor.fighter.party_id !== null
        && ally.fighter.party_id === actor.fighter.party_id
        && actor.fighter.party_id === actor.fighter.party_id_at_entry
        && ally.fighter.party_id === ally.fighter.party_id_at_entry;
      const selfAllowed = spec.mechanic === 'absorb_buff'
        && intentTargetCharacter === actor.fighter.character_id;
      if (!ally || !ally.present || ally.hp <= 0 || (!sameParty && !selfAllowed)
          || (spec.mechanic === 'hp_transfer' && ally === actor)
          || intent.target_fighter_id !== ally.fighter.id
          || intent.target_entry_seq !== ally.fighter.entry_seq) {
        emit({ kind: 'action_rejected', outcomeReason: 'invalid_ally_target', abilityKey: spec.abilityKey });
        continue;
      }
    } else if (intentTargetCharacter !== null) {
      emit({ kind: 'action_rejected', outcomeReason: 'unexpected_ally_target', abilityKey: spec.abilityKey });
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
            e.config?.node_creature_id === targetCreature.row.id &&
            e.config?.spawn_seq === targetCreature.row.spawn_seq &&
            e.config?.source_fighter_id === actor.fighter.id &&
            e.config?.source_entry_seq === actor.fighter.entry_seq &&
            !expiredIds.has(e.id),
        )
      : [];

    const ctx: MechanicContext = {
      rng,
      nowMs,
      tick,
      actor: actor.fighter,
      ally: ally?.fighter,
      creature: targetCreature?.row,
      targetAbsorb: 0,
      weaponProgression: deps.weaponProgression,
      existingStacks: stackEffects.reduce((sum, e) => sum + Math.max(1, e.stacks), 0),
      amplification: targetCreature ? amplificationFor(targetCreature, 'ability') : 0,
      creatureAcReduction: targetCreature
        ? snapshot.effects
            .filter(
              (e) =>
                e.kind === 'control' &&
                e.target_creature_id === targetCreature.row.creature_id &&
                effectAppliesToSpawn(e, targetCreature) &&
                !expiredIds.has(e.id) &&
                e.config?.control_mode === 'ac_reduction',
            )
            .reduce((sum, e) => sum + Math.max(0, e.magnitude ?? 0), 0)
        : 0,
      activeEffects: activeEffectsFor(actor.fighter.character_id),
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
      actor.hp = Math.max(0, actor.hp - outcome.actorHpCost);
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
    if (targetCreature && targetCreature.hp > 0 && spec.mechanic !== 'stack_consume' && spec.weaponBased) {
      outcome.events.forEach((event, index) => {
        if (event.kind !== 'attack' || event.hitQuality === 'miss') return;
        for (const source of activeEffectsFor(actor.fighter.character_id).filter(effect => effect.kind === 'stack_source')) {
          applyStackSource(source, targetCreature, 'weapon_hit', index);
        }
      });
    }
    const isWeaponAction = spec.weaponBased || spec.mechanic === 'weapon_attack' || spec.mechanic === 'multi_attack';
    const landedWeaponEvents = isWeaponAction
      ? outcome.events.filter(event => event.kind === 'attack' && event.hitQuality !== 'miss')
      : [];
    if (targetCreature) landedWeaponEvents.forEach((_, ordinal) => applyItemProc(actor, targetCreature, ordinal));
    if (targetCreature && (outcome.landedHits ?? 0) > 0) {
      for (let ordinal = 0; ordinal < (outcome.landedHits ?? 0); ordinal++) {
        applyLandedAbilityStatus(actor, targetCreature, spec, ordinal, outcome);
      }
    }
    if (outcome.healing) {
      const healTargetId = ctx.ally?.character_id ?? actor.fighter.character_id;
      const healTarget = chars.get(healTargetId);
      if (healTarget && healTarget.hp > 0) {
        const applied = Math.min(healTarget.fighter.max_hp - healTarget.hp, outcome.healing);
        healTarget.hp += applied;
        healTarget.dirty = true;
        const healingEvent = outcome.events.find(event => event.kind === 'heal' || event.kind === 'hp_transfer');
        if (healingEvent) {
          healingEvent.amount = applied;
          healingEvent.meta = { ...(healingEvent.meta ?? {}), requested: outcome.healing,
            applied, wasted: outcome.healing - applied, removedFromCaster: outcome.actorHpCost ?? 0 };
        }
      }
    }
    if (outcome.partyRestoration) {
      for (const target of eligibleParty(actor)) {
        const hpApplied = Math.min(target.fighter.max_hp - target.hp, outcome.partyRestoration.hp);
        const cpApplied = Math.min(target.fighter.max_cp - target.cp, outcome.partyRestoration.cp);
        target.hp += hpApplied; target.cp += cpApplied;
        if (hpApplied > 0 || cpApplied > 0) target.dirty = true;
        emit({ kind: 'party_restore', abilityKey: spec.abilityKey,
          actor: { type: 'character', id: actor.fighter.character_id, name: actor.fighter.name },
          target: { type: 'character', id: target.fighter.character_id, name: target.fighter.name },
          amount: hpApplied, meta: { hpRequested: outcome.partyRestoration.hp, hpApplied,
            hpWasted: outcome.partyRestoration.hp - hpApplied, cpRequested: outcome.partyRestoration.cp,
            cpApplied, cpWasted: outcome.partyRestoration.cp - cpApplied } });
      }
    }
    for (const effect of outcome.effects) {
      const prior = snapshot.effects.filter(existing => existing.kind === effect.kind
        && existing.ability_key === effect.ability_key
        && existing.source_character_id === effect.source_character_id
        && (existing.target_character_id ?? null) === (effect.target_character_id ?? null)
        && (existing.target_creature_id ?? null) === (effect.target_creature_id ?? null)
        && (effect.target_creature_id == null
          || (existing.config?.node_creature_id === effect.config?.node_creature_id
            && existing.config?.spawn_seq === effect.config?.spawn_seq))
        && !expiredIds.has(existing.id))
        .sort((a, b) => a.id.localeCompare(b.id))[0];
      if (prior) {
        if (!proposed.effects_delete.includes(prior.id)) proposed.effects_delete.push(prior.id);
        if (effect.kind === 'absorb') effect.magnitude = Math.max(effect.magnitude ?? 0, prior.magnitude ?? 0);
        if (effect.kind === 'party_regen' && effect.config?.refresh_policy === 'best_of') {
          effect.magnitude = Math.max(effect.magnitude ?? 0, prior.magnitude ?? 0);
          effect.config = { ...(effect.config ?? {}), cp_per_tick: Math.max(
            Number(effect.config?.cp_per_tick ?? 0), Number(prior.config?.cp_per_tick ?? 0),
          ) };
        }
        if (effect.kind === 'dot') {
          const cap = Math.max(1, Math.floor(Number(effect.config?.max_stacks ?? 1)));
          effect.stacks = Math.min(cap, Math.max(1, prior.stacks) + Math.max(1, effect.stacks ?? 1));
        }
      }
      proposed.effects_insert.push(effect);
    }
    for (const id of outcome.consumeEffectIds) proposed.effects_delete.push(id);
    if (spec.mechanic === 'stack_consume') {
      for (const e of stackEffects) proposed.effects_delete.push(e.id);
    }
    for (const event of outcome.events) emit(event);
  }


  const autoattackInsert = (actor: WorkingCharacter, target: WorkingCreature): void => {
    proposed.effects_insert.push({
      kind: 'autoattack', effect_type: 'basic_attack', ability_key: null,
      target_character_id: actor.fighter.character_id, target_creature_id: target.row.creature_id,
      source_character_id: actor.fighter.character_id, stacks: 1, magnitude: 0,
      config: { node_creature_id: target.row.id, spawn_seq: target.row.spawn_seq }, is_reservation: false,
    });
  };
  const orderedEngagedTargets = (): WorkingCreature[] => [...creatures.values()]
    .filter(candidate => candidate.hp > 0 && candidate.row.is_alive && candidate.engaged)
    .sort((a, b) => a.row.id.localeCompare(b.row.id)
      || a.row.spawn_seq - b.row.spawn_seq
      || a.row.creature_id.localeCompare(b.row.creature_id));

  // Server-owned continued attacks. A present living fighter defaults to the
  // first living engaged spawn ordered by runtime row id, then spawn sequence,
  // then creature definition id. Those fields are all claim-fenced authority;
  // browser ordering, selection, clocks, and Realtime arrival never participate.
  for (const actor of [...chars.values()].sort((a, b) => a.fighter.id.localeCompare(b.fighter.id))) {
    const state = snapshot.effects.find(e => e.kind === 'autoattack' && e.target_character_id === actor.fighter.character_id);
    if (!actor.present || actor.hp <= 0) {
      if (state && !proposed.effects_delete.includes(state.id)) proposed.effects_delete.push(state.id);
      continue;
    }
    const persisted = state?.target_creature_id ? creatures.get(state.target_creature_id) : undefined;
    const validPersisted = persisted && persisted.hp > 0 && persisted.row.is_alive && persisted.engaged
      && state?.config?.node_creature_id === persisted.row.id && state.config?.spawn_seq === persisted.row.spawn_seq
      ? persisted : undefined;
    const target = validPersisted ?? orderedEngagedTargets()[0];
    if (!target) {
      if (state && !proposed.effects_delete.includes(state.id)) proposed.effects_delete.push(state.id);
      continue;
    }
    if (!validPersisted) {
      if (state && !proposed.effects_delete.includes(state.id)) proposed.effects_delete.push(state.id);
      autoattackInsert(actor, target);
    }
    // Any captured player intent owns this tick's single action slot. Target
    // maintenance still occurs so automatic attacks resume on the next tick.
    if (occupiedActionSlots.has(actor.fighter.character_id)) continue;
    const outcome = resolveBasicAttack({ rng, nowMs, tick, actor: actor.fighter, creature: target.row,
      amplification: amplificationFor(target, 'weapon'),
      activeEffects: activeEffectsFor(actor.fighter.character_id), weaponProgression: deps.weaponProgression });
    if (outcome.rejected) emit({ kind: 'action_rejected', outcomeReason: outcome.rejected });
    else {
      qualify(target, actor.fighter.character_id, 'damage');
      if (outcome.creatureDamage) { const applied = Math.min(target.hp, outcome.creatureDamage); target.hp -= applied; target.damaged = true; target.dirty = true; if (!target.hp) target.killedBy = actor.fighter.character_id; }
      if (!outcome.missed) {
        applyItemProc(actor, target, 0);
      }
      if (!outcome.missed && target.hp > 0) {
        for (const source of activeEffectsFor(actor.fighter.character_id).filter(effect => effect.kind === 'stack_source')) {
          applyStackSource(source, target, 'weapon_hit', 0);
        }
      }
      for (const id of outcome.consumeEffectIds) if (!proposed.effects_delete.includes(id)) proposed.effects_delete.push(id);
      for (const event of outcome.events) emit(event);
      if (target.hp <= 0) {
        if (state && !proposed.effects_delete.includes(state.id)) proposed.effects_delete.push(state.id);
        proposed.effects_insert = proposed.effects_insert.filter(effect =>
          effect.kind !== 'autoattack' || effect.target_character_id !== actor.fighter.character_id);
        const next = orderedEngagedTargets()[0];
        if (next) autoattackInsert(actor, next);
      }
    }
  }

  // Ignite is an independent stance-owned heartbeat, not another player action
  // and not a rider on ordinary attacks. It resolves after the player's action
  // slot and before creature actions, using only spawn-fenced server state.
  for (const actor of [...chars.values()].sort((a, b) => a.fighter.id.localeCompare(b.fighter.id))) {
    if (!actor.present || actor.hp <= 0) continue;
    const sources = activeEffectsFor(actor.fighter.character_id)
      .filter(effect => effect.kind === 'stack_source'
        && effect.config?.stack_trigger === 'successful_pulse_hit')
      .sort((a, b) => a.id.localeCompare(b.id));
    if (sources.length === 0) continue;
    const state = snapshot.effects.find(effect => effect.kind === 'autoattack'
      && effect.target_character_id === actor.fighter.character_id);
    const persisted = state?.target_creature_id ? creatures.get(state.target_creature_id) : undefined;
    const target = persisted && persisted.hp > 0 && persisted.row.is_alive && persisted.engaged
      && state?.config?.node_creature_id === persisted.row.id && state.config?.spawn_seq === persisted.row.spawn_seq
      ? persisted : orderedEngagedTargets()[0];
    if (!target) continue;
    sources.forEach((source, index) => applyStackSource(source, target, 'successful_pulse_hit', index));
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

    // Only an otherwise-landed attack can exercise evasion. Natural/AC misses
    // therefore never consume Disengage's guaranteed next-hit charge.
    const evasion = effectsFor(snapshot.effects, targetFighter.character_id, 'evasion')
      .filter(effect => !expiredIds.has(effect.id) && !proposed.effects_delete.includes(effect.id))
      .sort((a, b) => a.id.localeCompare(b.id))
      .find(effect => {
        const chance = effect.config?.dodge_chance === 1
          ? 1
          : Math.min(1, Math.max(0, effect.magnitude ?? 0));
        return rng.sample(`${stream}:evasion`, effect.id, targetFighter.character_id, tick) < chance;
      });
    if (evasion) {
      if (evasion.config?.evasion_source === 'disengage') proposed.effects_delete.push(evasion.id);
      emit({
        kind: 'attack_evaded', abilityKey: evasion.ability_key ?? undefined,
        actor: { type: 'creature', id: creature.row.creature_id, name: creature.row.name },
        target: { type: 'character', id: targetFighter.character_id, name: targetFighter.name },
        hitQuality: 'miss', amount: 0,
        meta: { effectKind: 'evasion', evasionSource: evasion.config?.evasion_source ?? null },
      });
      return;
    }

    const die = getCreatureDamageDie(creature.row.level, creature.row.rarity ?? 'common');
    const strMod = getStatModifier(creature.row.stats?.str ?? 10);
    const unreducedBase = flatMagnitude > 0
      ? flatMagnitude
      : Math.max(1, rng.roll(`${stream}:dmg`, die, targetFighter.character_id, tick) + strMod);
    const outgoingReduction = snapshot.effects
      .filter(effect => effect.kind === 'control'
        && effect.target_creature_id === creature.row.creature_id
        && effectAppliesToSpawn(effect, creature)
        && !expiredIds.has(effect.id)
        && effect.config?.control_mode === 'damage_reduction')
      .reduce((sum, effect) => sum + Math.max(0, effect.magnitude ?? 0), 0);
    const base = Math.max(0, Math.floor(unreducedBase * (1 - Math.min(1, outgoingReduction))));
    const outgoingPrevented = unreducedBase - base;
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
    const shieldEquipped = targetFighter.equipment.some(
      (row) => row.slot === 'off_hand' && row.weapon_tag === 'shield',
    );
    const block = shieldEquipped
      ? effectsFor(snapshot.effects, targetFighter.character_id, 'block')
          .filter((effect) => !expiredIds.has(effect.id) && !proposed.effects_delete.includes(effect.id))
          .sort((a, b) => a.id.localeCompare(b.id))
          .find((effect) => {
            const chance = Math.min(0.95, Math.max(0, Number(effect.config?.block_chance ?? 0)));
            return chance >= 1 || rng.sample(`${stream}:block`, effect.id, targetFighter.character_id, tick) < chance;
          })
      : undefined;
    const blockAmount = block?.magnitude ?? 0;

    const breakdown = applyMitigationPipeline({
      normalDamage: base,
      critBonus,
      percentMitigation,
      shieldDrBonus,
      shieldEquipped,
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
      if (consumed > 0) {
        const row = snapshot.effects.find(candidate => candidate.id === effect.id);
        emit({ kind: 'absorb', abilityKey: row?.ability_key ?? undefined,
          target: { type: 'character', id: targetFighter.character_id, name: targetFighter.name },
          amount: consumed, meta: { remaining: effect.remaining, depleted: effect.remaining === 0 } });
      }
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
        ...(block ? { blockAbilityKey: block.ability_key } : {}),
        absorbed: breakdown.absorbed,
        ...(outgoingPrevented > 0 ? { outgoingReduced: outgoingPrevented } : {}),
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

      const dealt = Math.min(creature.hp, Math.max(0, Math.floor(magnitude
        * amplificationFor(creature, 'proc'))));
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
      const orderedRecipients = snapshot.encounter.test_arena_id == null ? [...recipients].sort() : [];
      const partyBonus = getPartyXpBonus(orderedRecipients.length);
      const goldEntry = creature.row.loot_table.find((entry) => entry.type === 'gold');
      let totalGold = 0;
      if (goldEntry && rng.sample('gold_chance', creature.row.id, creature.row.spawn_seq) <= (goldEntry.chance || 0.5)) {
        const min = Math.floor(goldEntry.min ?? 0);
        const max = Math.max(min, Math.floor(goldEntry.max ?? min));
        totalGold = min + Math.floor(rng.sample('gold_amount', creature.row.id, creature.row.spawn_seq) * (max - min + 1));
        if (creature.row.is_humanoid) {
          const bestCha = Math.max(0, ...orderedRecipients.map((id) => chars.get(id)?.fighter.cha ?? 0));
          if (bestCha > 0) totalGold = Math.floor(totalGold * getChaGoldMultiplier(bestCha));
        }
      }
      const goldEach = orderedRecipients.length ? Math.floor(totalGold / orderedRecipients.length) : 0;
      for (const characterId of orderedRecipients) {
        const level = levelOf.get(characterId);
        // XP scaling needs the recipient's level; an unknown level means the
        // fighter row is not in this snapshot, so the payout waits for a
        // snapshot that carries it rather than being computed from a guess.
        if (level === undefined) continue;
        const penalty = getXpPenalty(level, creature.row.level);
        proposed.rewards.push({
          node_creature_id: creature.row.id,
          creature_id: creature.row.creature_id,
          spawn_seq: creature.row.spawn_seq,
          character_id: characterId,
          xp_awarded: Math.max(1, Math.floor((baseXp / orderedRecipients.length) * penalty * partyBonus * snapshot.reward_config.xp_boost_multiplier)),
          gold_awarded: goldEach,
          is_killer: characterId === creature.killedBy,
        });
        emit({ kind: 'xp_reward', actor: { type: 'character', id: characterId, name: chars.get(characterId)?.fighter.name ?? '' },
          target: { type: 'creature', id: creature.row.creature_id, name: creature.row.name }, amount: proposed.rewards.at(-1)!.xp_awarded });
        if (goldEach > 0) emit({ kind: 'gold_reward', actor: { type: 'character', id: characterId, name: chars.get(characterId)?.fighter.name ?? '' },
          target: { type: 'creature', id: creature.row.creature_id, name: creature.row.name }, amount: goldEach });
      }

      const recordLoot = (lootKey: string, itemId: string | null, mode: 'item_pool' | 'legacy_table' | 'inline' | 'salvage_only', outcome: 'dropped' | 'no_drop' | 'unique_rejected' | 'no_eligible_item') => {
        proposed.loot.push({ node_creature_id: creature.row.id, creature_id: creature.row.creature_id,
          spawn_seq: creature.row.spawn_seq, loot_key: lootKey, item_id: itemId, creature_name: creature.row.name, mode, outcome });
        emit({ kind: outcome === 'dropped' ? 'loot_drop' : 'loot_result', target: { type: 'creature', id: creature.row.creature_id, name: creature.row.name },
          outcomeReason: outcome, meta: { itemId, lootKey, mode } });
      };
      if (snapshot.encounter.test_arena_id == null) {
        const itemById = new Map(snapshot.loot_items.map((item) => [item.id, item]));
        const accept = (key: string, itemId: string | null, mode: 'item_pool' | 'legacy_table' | 'inline') => {
          const item = itemId ? itemById.get(itemId) : undefined;
          if (!item) return recordLoot(key, null, mode, 'no_eligible_item');
          if (item.rarity === 'unique') return recordLoot(key, null, mode, 'unique_rejected');
          recordLoot(key, item.id, mode, 'dropped');
        };
        if (creature.row.loot_mode === 'salvage_only') recordLoot('salvage', null, 'salvage_only', 'no_drop');
        else if (creature.row.loot_mode === 'item_pool') {
          const cfg = snapshot.reward_config;
          const dropChance = creature.row.drop_chance ?? (creature.row.rarity === 'boss' ? cfg.drop_chance_boss : creature.row.rarity === 'rare' ? cfg.drop_chance_rare : cfg.drop_chance_regular);
          if (rng.sample('loot_pool_chance', creature.row.id, creature.row.spawn_seq) > dropChance) recordLoot('equipment', null, 'item_pool', 'no_drop');
          else {
            const rarity = rng.sample('loot_pool_rarity', creature.row.id, creature.row.spawn_seq) * Math.max(1, cfg.common_pct + cfg.uncommon_pct) < cfg.common_pct ? 'common' : 'uncommon';
            let pool: NodeSnapshot['loot_items'] = [];
            const alternate = rarity === 'common' ? 'uncommon' : 'common';
            for (let widen = 0; widen <= 10 && !pool.length; widen++) {
              for (const candidateRarity of [rarity, alternate]) {
                pool = snapshot.loot_items.filter((item) => item.world_drop && !item.is_soulbound && item.item_type === 'equipment' && item.rarity === candidateRarity
                  && item.level >= creature.row.level + cfg.equip_level_min_offset - widen
                  && item.level <= creature.row.level + cfg.equip_level_max_offset + widen);
                if (pool.length) break;
              }
            }
            accept('equipment', rng.weightedPick(pool, (item) => item.drop_weight, 'loot_pool_item', creature.row.id, creature.row.spawn_seq)?.id ?? null, 'item_pool');
          }
          if (rng.sample('loot_consumable_chance', creature.row.id, creature.row.spawn_seq) <= cfg.consumable_drop_chance) {
            let pool: NodeSnapshot['loot_items'] = [];
            for (let widen = 0; widen <= 10 && !pool.length; widen++) pool = snapshot.loot_items.filter((item) => item.world_drop && !item.is_soulbound && item.item_type === 'consumable'
              && item.level >= creature.row.level + cfg.consumable_level_min_offset - widen
              && item.level <= creature.row.level + cfg.consumable_level_max_offset + widen);
            accept('consumable', rng.weightedPick(pool, (item) => item.drop_weight, 'loot_consumable_item', creature.row.id, creature.row.spawn_seq)?.id ?? null, 'item_pool');
          }
        } else if (creature.row.loot_table_id) {
          const entries = snapshot.loot_table_entries.filter((entry) => entry.loot_table_id === creature.row.loot_table_id);
          const chance = creature.row.drop_chance ?? 0.5;
          if (rng.sample('loot_table_chance', creature.row.id, creature.row.spawn_seq) > chance) recordLoot('table', null, 'legacy_table', 'no_drop');
          else accept('table', rng.weightedPick(entries, (entry) => entry.weight, 'loot_table_item', creature.row.id, creature.row.spawn_seq)?.item_id ?? null, 'legacy_table');
        } else {
          creature.row.loot_table.filter((entry) => entry.type !== 'gold').forEach((entry, index) => {
            if (rng.sample('loot_inline', creature.row.id, creature.row.spawn_seq, index) <= (entry.chance || 0.1)) accept(`inline:${index}`, entry.item_id, 'inline');
            else recordLoot(`inline:${index}`, null, 'inline', 'no_drop');
          });
        }
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

  // Legacy timing: once per participant that landed at least one weapon hit in
  // this tick, choose one currently usable equipped instance and wear it by 1.
  // The commit validates every frozen field before applying this proposal.
  for (const characterId of snapshot.encounter.test_arena_id == null ? [...weaponHitCharacters].sort() : []) {
    const character = chars.get(characterId);
    if (!character) continue;
    const candidates = [...character.fighter.equipment].sort((a, b) => a.inventory_id.localeCompare(b.inventory_id));
    const item = rng.pick(candidates, 'durability_slot', character.fighter.id);
    if (!item || item.durability === null || item.durability <= 0) continue;
    proposed.durability.push({ inventory_id: item.inventory_id, character_id: characterId,
      fighter_id: character.fighter.id, entry_seq: character.fighter.entry_seq,
      item_id: item.item_id, rarity: item.rarity ?? '', slot: item.slot, durability_before: item.durability,
      durability_after: Math.max(0, item.durability - 1), broke: item.durability === 1 });
    emit({ kind: item.durability === 1 ? 'equipment_broken' : 'durability_lost',
      actor: { type: 'character', id: characterId, name: character.fighter.name }, amount: 1,
      meta: { inventoryId: item.inventory_id, itemId: item.item_id, slot: item.slot,
        durabilityAfter: Math.max(0, item.durability - 1) } });
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
      for (const effect of snapshot.effects) {
        if (effect.target_character_id === character.fighter.character_id
            && effect.source_character_id !== null
            && !proposed.effects_delete.includes(effect.id)) proposed.effects_delete.push(effect.id);
      }
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
    snapshot.effects.some((e) => !['autoattack', 'stack_source'].includes(e.kind)
      && e.config?.persistent_stance !== true && !expiredIds.has(e.id) && !e.is_reservation);
  if (!anythingPending) proposed.status = 'ended';

  return proposed;
}
