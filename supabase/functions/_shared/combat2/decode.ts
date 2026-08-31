/**
 * combat2/decode.ts — the strict decoder for the snapshot returned by
 * `public.node_tick_claim`.
 *
 * The resolver is pure and total over `NodeSnapshot`, which only holds if the
 * snapshot it receives really has the shape the contract promises. This decoder
 * is the single place where untyped JSON becomes a `NodeSnapshot`, and it is
 * deliberately FAIL-CLOSED: a missing or mistyped field is reported as an error
 * path, never coerced, defaulted or dropped. Nothing here invents equipment,
 * weapon metadata or resources.
 */

import type {
  NodeSnapshot,
  SnapshotBossAbility,
  SnapshotBossConfiguration,
  SnapshotCreature,
  SnapshotEffect,
  SnapshotEquipment,
  SnapshotFighter,
  SnapshotIntent,
  SnapshotParticipation,
  SnapshotPendingEvent,
} from './types.ts';
import type { AuthoredBossCast } from './boss-catalog.ts';

export type DecodeResult =
  | { ok: true; snapshot: NodeSnapshot }
  | { ok: false; errors: string[] };

/**
 * Result of decoding a full claim envelope. Kept as an explicit union (not
 * `DecodeResult & { claimToken?: string }`) so `ok` remains a discriminant and
 * `!result.ok` narrows to the error branch.
 */
export type ClaimDecodeResult =
  | { ok: true; snapshot: NodeSnapshot; claimToken?: string }
  | { ok: false; errors: string[]; claimToken?: string };

class Reader {
  readonly errors: string[] = [];

  private obj(path: string, value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      this.errors.push(`${path}: expected object`);
      return {};
    }
    return value as Record<string, unknown>;
  }

  object(path: string, value: unknown): Record<string, unknown> {
    return this.obj(path, value);
  }

  array(path: string, value: unknown): unknown[] {
    if (value === null || value === undefined) return [];
    if (!Array.isArray(value)) {
      this.errors.push(`${path}: expected array`);
      return [];
    }
    return value;
  }

  str(path: string, value: unknown): string {
    if (typeof value !== 'string' || value.length === 0) {
      this.errors.push(`${path}: expected non-empty string`);
      return '';
    }
    return value;
  }

  strOrNull(path: string, value: unknown): string | null {
    if (value === null || value === undefined) return null;
    if (typeof value !== 'string') {
      this.errors.push(`${path}: expected string or null`);
      return null;
    }
    return value;
  }

  num(path: string, value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      this.errors.push(`${path}: expected finite number`);
      return 0;
    }
    return value;
  }

  numOrNull(path: string, value: unknown): number | null {
    if (value === null || value === undefined) return null;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      this.errors.push(`${path}: expected number or null`);
      return null;
    }
    return value;
  }

  bool(path: string, value: unknown): boolean {
    if (typeof value !== 'boolean') {
      this.errors.push(`${path}: expected boolean`);
      return false;
    }
    return value;
  }
}

function decodeEquipment(r: Reader, path: string, raw: unknown): SnapshotEquipment {
  const o = r.object(path, raw);
  return {
    slot: r.str(`${path}.slot`, o.slot),
    item_id: r.str(`${path}.item_id`, o.item_id),
    inventory_id: r.str(`${path}.inventory_id`, o.inventory_id),
    character_id: r.str(`${path}.character_id`, o.character_id),
    durability: r.numOrNull(`${path}.durability`, o.durability),
    applied_gems: o.applied_gems ?? null,
    stat_override: o.stat_override ?? null,
    crafted_level: r.numOrNull(`${path}.crafted_level`, o.crafted_level),
    item_present: r.bool(`${path}.item_present`, o.item_present),
    item_type: r.strOrNull(`${path}.item_type`, o.item_type),
    weapon_tag: r.strOrNull(`${path}.weapon_tag`, o.weapon_tag),
    hands: r.numOrNull(`${path}.hands`, o.hands),
    item_level: r.numOrNull(`${path}.item_level`, o.item_level),
    rarity: r.strOrNull(`${path}.rarity`, o.rarity),
  };
}

function decodeFighter(r: Reader, path: string, raw: unknown): SnapshotFighter {
  const o = r.object(path, raw);
  return {
    id: r.str(`${path}.id`, o.id),
    character_id: r.str(`${path}.character_id`, o.character_id),
    entry_seq: r.num(`${path}.entry_seq`, o.entry_seq),
    present: r.bool(`${path}.present`, o.present),
    party_id_at_entry: r.strOrNull(`${path}.party_id_at_entry`, o.party_id_at_entry),
    party_id: r.strOrNull(`${path}.party_id`, o.party_id),
    name: r.str(`${path}.name`, o.name),
    class: r.strOrNull(`${path}.class`, o.class),
    race: r.strOrNull(`${path}.race`, o.race),
    level: r.num(`${path}.level`, o.level),
    hp: r.num(`${path}.hp`, o.hp),
    max_hp: r.num(`${path}.max_hp`, o.max_hp),
    cp: r.num(`${path}.cp`, o.cp),
    max_cp: r.num(`${path}.max_cp`, o.max_cp),
    mp: r.num(`${path}.mp`, o.mp),
    max_mp: r.num(`${path}.max_mp`, o.max_mp),
    ac: r.num(`${path}.ac`, o.ac),
    str: r.num(`${path}.str`, o.str),
    dex: r.num(`${path}.dex`, o.dex),
    con: r.num(`${path}.con`, o.con),
    int: r.num(`${path}.int`, o.int),
    wis: r.num(`${path}.wis`, o.wis),
    cha: r.num(`${path}.cha`, o.cha),
    equipment: r
      .array(`${path}.equipment`, o.equipment)
      .map((row, i) => decodeEquipment(r, `${path}.equipment[${i}]`, row)),
  };
}

function decodeCreature(r: Reader, path: string, raw: unknown): SnapshotCreature {
  const o = r.object(path, raw);
  const pending = o.pending_action;
  let pendingAction: SnapshotCreature['pending_action'] = null;
  if (pending && typeof pending === 'object') {
    const p = pending as Record<string, unknown>;
    pendingAction = {
      ability_key: r.str(`${path}.pending_action.ability_key`, p.ability_key),
      resolve_at_tick: r.num(`${path}.pending_action.resolve_at_tick`, p.resolve_at_tick),
    };
  }
  return {
    id: r.str(`${path}.id`, o.id),
    creature_id: r.str(`${path}.creature_id`, o.creature_id),
    spawn_seq: r.num(`${path}.spawn_seq`, o.spawn_seq),
    hp: r.num(`${path}.hp`, o.hp),
    is_alive: r.bool(`${path}.is_alive`, o.is_alive),
    pending_action: pendingAction,
    tank_fighter_id: r.strOrNull(`${path}.tank_fighter_id`, o.tank_fighter_id),
    name: r.str(`${path}.name`, o.name),
    level: r.num(`${path}.level`, o.level),
    max_hp: r.num(`${path}.max_hp`, o.max_hp),
    ac: r.num(`${path}.ac`, o.ac),
    stats: (o.stats ?? {}) as SnapshotCreature['stats'],
    rarity: r.strOrNull(`${path}.rarity`, o.rarity),
    is_humanoid: r.bool(`${path}.is_humanoid`, o.is_humanoid),
    is_aggressive: r.bool(`${path}.is_aggressive`, o.is_aggressive),
    boss_crit_flavors: (o.boss_crit_flavors ?? null) as SnapshotCreature['boss_crit_flavors'],
    boss_death_cry: r.strOrNull(`${path}.boss_death_cry`, o.boss_death_cry),
  };
}

function decodeEffect(r: Reader, path: string, raw: unknown): SnapshotEffect {
  const o = r.object(path, raw);
  return {
    id: r.str(`${path}.id`, o.id),
    kind: r.str(`${path}.kind`, o.kind),
    effect_type: r.str(`${path}.effect_type`, o.effect_type),
    ability_key: r.strOrNull(`${path}.ability_key`, o.ability_key),
    target_character_id: r.strOrNull(`${path}.target_character_id`, o.target_character_id),
    target_creature_id: r.strOrNull(`${path}.target_creature_id`, o.target_creature_id),
    source_character_id: r.strOrNull(`${path}.source_character_id`, o.source_character_id),
    source_creature_id: r.strOrNull(`${path}.source_creature_id`, o.source_creature_id),
    stacks: r.num(`${path}.stacks`, o.stacks),
    magnitude: r.numOrNull(`${path}.magnitude`, o.magnitude),
    config: (o.config ?? {}) as Record<string, unknown>,
    expires_at: r.strOrNull(`${path}.expires_at`, o.expires_at),
    next_due_at: r.strOrNull(`${path}.next_due_at`, o.next_due_at),
    interval_ms: r.numOrNull(`${path}.interval_ms`, o.interval_ms),
    last_pulse_tick: r.numOrNull(`${path}.last_pulse_tick`, o.last_pulse_tick),
    is_reservation: r.bool(`${path}.is_reservation`, o.is_reservation),
  };
}

function decodeIntent(r: Reader, path: string, raw: unknown): SnapshotIntent {
  const o = r.object(path, raw);
  return {
    id: r.str(`${path}.id`, o.id),
    seq: r.num(`${path}.seq`, o.seq),
    character_id: r.str(`${path}.character_id`, o.character_id),
    intent_kind: r.str(`${path}.intent_kind`, o.intent_kind) as SnapshotIntent['intent_kind'],
    ability_key: r.strOrNull(`${path}.ability_key`, o.ability_key),
    stance_key: r.strOrNull(`${path}.stance_key`, o.stance_key),
    target_creature_id: r.strOrNull(`${path}.target_creature_id`, o.target_creature_id),
  };
}

function decodeParticipation(r: Reader, path: string, raw: unknown): SnapshotParticipation {
  const o = r.object(path, raw);
  return {
    creature_id: r.str(`${path}.creature_id`, o.creature_id),
    spawn_seq: r.num(`${path}.spawn_seq`, o.spawn_seq),
    character_id: r.str(`${path}.character_id`, o.character_id),
    qualification: r.str(`${path}.qualification`, o.qualification) as SnapshotParticipation['qualification'],
    qualified_by: r.str(`${path}.qualified_by`, o.qualified_by),
    party_id_at_qualification: r.strOrNull(
      `${path}.party_id_at_qualification`,
      o.party_id_at_qualification,
    ),
  };
}

function decodePendingEvent(r: Reader, path: string, raw: unknown): SnapshotPendingEvent {
  const o = r.object(path, raw);
  return {
    id: r.str(`${path}.id`, o.id),
    event_type: r.str(`${path}.event_type`, o.event_type),
    actor_character_id: r.strOrNull(`${path}.actor_character_id`, o.actor_character_id),
    actor_creature_id: r.strOrNull(`${path}.actor_creature_id`, o.actor_creature_id),
    target_character_id: r.strOrNull(`${path}.target_character_id`, o.target_character_id),
    target_creature_id: r.strOrNull(`${path}.target_creature_id`, o.target_creature_id),
    payload: (o.payload ?? {}) as Record<string, unknown>,
    occurred_at: r.str(`${path}.occurred_at`, o.occurred_at),
  };
}

function decodeBossAbility(r: Reader, path: string, raw: unknown): SnapshotBossAbility {
  const o = r.object(path, raw);
  return {
    id: r.str(`${path}.id`, o.id),
    creature_id: r.str(`${path}.creature_id`, o.creature_id),
    ability_key: r.str(`${path}.ability_key`, o.ability_key),
    label: r.strOrNull(`${path}.label`, o.label),
    weight: r.num(`${path}.weight`, o.weight),
    windup_ticks: r.num(`${path}.windup_ticks`, o.windup_ticks),
    targeting: r.str(`${path}.targeting`, o.targeting) as SnapshotBossAbility['targeting'],
    magnitude: r.numOrNull(`${path}.magnitude`, o.magnitude),
    amount_calc: (o.amount_calc ?? null) as SnapshotBossAbility['amount_calc'],
    damage_type: r.strOrNull(`${path}.damage_type`, o.damage_type),
    effect: (o.effect ?? null) as SnapshotBossAbility['effect'],
    telegraph_text: r.strOrNull(`${path}.telegraph_text`, o.telegraph_text),
    resolution_text: r.strOrNull(`${path}.resolution_text`, o.resolution_text),
  };
}

function optionalBool(r: Reader, path: string, value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  return r.bool(path, value);
}

function optionalNumber(r: Reader, path: string, value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  return r.numOrNull(path, value);
}

function optionalString(r: Reader, path: string, value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  return r.strOrNull(path, value);
}

function decodeBossCast(r: Reader, path: string, raw: unknown): AuthoredBossCast | null {
  if (raw === null || raw === undefined) return null;
  const o = r.object(path, raw);
  const accumulate = o.accumulate === null || o.accumulate === undefined
    ? o.accumulate as null | undefined
    : (() => {
        const value = r.object(`${path}.accumulate`, o.accumulate);
        return { enabled: optionalBool(r, `${path}.accumulate.enabled`, value.enabled) };
      })();
  let storedPower: Record<string, unknown> | null | undefined;
  if (o.stored_power === null || o.stored_power === undefined) storedPower = o.stored_power as null | undefined;
  else storedPower = r.object(`${path}.stored_power`, o.stored_power);
  return {
    enabled: optionalBool(r, `${path}.enabled`, o.enabled),
    ability_key: optionalString(r, `${path}.ability_key`, o.ability_key),
    label: optionalString(r, `${path}.label`, o.label),
    cast_ms: optionalNumber(r, `${path}.cast_ms`, o.cast_ms),
    lock_ms: optionalNumber(r, `${path}.lock_ms`, o.lock_ms),
    cooldown_ms: optionalNumber(r, `${path}.cooldown_ms`, o.cooldown_ms),
    chance: optionalNumber(r, `${path}.chance`, o.chance),
    damage_type: optionalString(r, `${path}.damage_type`, o.damage_type),
    amount: optionalNumber(r, `${path}.amount`, o.amount),
    base_amount: optionalNumber(r, `${path}.base_amount`, o.base_amount),
    base_aoe_amount: optionalNumber(r, `${path}.base_aoe_amount`, o.base_aoe_amount),
    target_mode: optionalString(r, `${path}.target_mode`, o.target_mode),
    cast_flavor: optionalString(r, `${path}.cast_flavor`, o.cast_flavor),
    hit_flavor: optionalString(r, `${path}.hit_flavor`, o.hit_flavor),
    accumulate,
    stored_power: storedPower,
  };
}

function decodeBossConfiguration(r: Reader, path: string, raw: unknown): SnapshotBossConfiguration {
  const o = r.object(path, raw);
  if (!Object.prototype.hasOwnProperty.call(o, 'boss_cast')) {
    r.errors.push(`${path}.boss_cast: expected object or null`);
  }
  return {
    encounter_id: r.str(`${path}.encounter_id`, o.encounter_id),
    node_creature_id: r.str(`${path}.node_creature_id`, o.node_creature_id),
    creature_id: r.str(`${path}.creature_id`, o.creature_id),
    spawn_seq: r.num(`${path}.spawn_seq`, o.spawn_seq),
    boss_cast: decodeBossCast(r, `${path}.boss_cast`, o.boss_cast),
  };
}

/** Decode the `snapshot` object of a successful claim. Fail-closed. */
export function decodeSnapshot(raw: unknown): DecodeResult {
  const r = new Reader();
  const root = r.object('snapshot', raw);
  const enc = r.object('snapshot.encounter', root.encounter);

  const snapshot: NodeSnapshot = {
    encounter: {
      id: r.str('snapshot.encounter.id', enc.id),
      node_id: r.str('snapshot.encounter.node_id', enc.node_id),
      tick: r.num('snapshot.encounter.tick', enc.tick),
      candidate_tick: r.num('snapshot.encounter.candidate_tick', enc.candidate_tick),
      state_version: r.num('snapshot.encounter.state_version', enc.state_version),
      now: r.str('snapshot.encounter.now', enc.now),
    },
    creatures: r
      .array('snapshot.creatures', root.creatures)
      .map((row, i) => decodeCreature(r, `snapshot.creatures[${i}]`, row)),
    fighters: r
      .array('snapshot.fighters', root.fighters)
      .map((row, i) => decodeFighter(r, `snapshot.fighters[${i}]`, row)),
    effects: r
      .array('snapshot.effects', root.effects)
      .map((row, i) => decodeEffect(r, `snapshot.effects[${i}]`, row)),
    intents: r
      .array('snapshot.intents', root.intents)
      .map((row, i) => decodeIntent(r, `snapshot.intents[${i}]`, row)),
    boss_abilities: root.boss_configurations === undefined
      ? r.array('snapshot.boss_abilities', root.boss_abilities)
          .map((row, i) => decodeBossAbility(r, `snapshot.boss_abilities[${i}]`, row))
      : [],
    boss_configurations: root.boss_configurations === undefined
      ? undefined
      : r.array('snapshot.boss_configurations', root.boss_configurations)
          .map((row, i) => decodeBossConfiguration(r, `snapshot.boss_configurations[${i}]`, row)),
    participation: r
      .array('snapshot.participation', root.participation)
      .map((row, i) => decodeParticipation(r, `snapshot.participation[${i}]`, row)),
    pending_events: r
      .array('snapshot.pending_events', root.pending_events)
      .map((row, i) => decodePendingEvent(r, `snapshot.pending_events[${i}]`, row)),
  };

  for (const [i, config] of (snapshot.boss_configurations ?? []).entries()) {
    const creature = snapshot.creatures.find((row) => row.id === config.node_creature_id);
    if (!creature || creature.creature_id !== config.creature_id || creature.spawn_seq !== config.spawn_seq ||
        snapshot.encounter.id !== config.encounter_id) {
      r.errors.push(`snapshot.boss_configurations[${i}]: binding does not match claimed creature spawn`);
    }
  }
  if (snapshot.boss_configurations !== undefined) {
    for (const creature of snapshot.creatures) {
      const matches = snapshot.boss_configurations.filter((config) =>
        config.node_creature_id === creature.id && config.creature_id === creature.creature_id &&
        config.spawn_seq === creature.spawn_seq);
      if (matches.length !== 1) {
        r.errors.push(`snapshot.boss_configurations: expected exactly one row for node creature ${creature.id}`);
      }
    }
  }
  if (r.errors.length > 0) return { ok: false, errors: r.errors };
  return { ok: true, snapshot };
}

/**
 * Decode a whole claim envelope. A non-claim result (`not_due`, `no_claim`) is
 * returned as an error path, so a caller can never resolve a tick it did not win.
 */
export function decodeClaim(raw: unknown): ClaimDecodeResult {
  if (!raw || typeof raw !== 'object') return { ok: false, errors: ['claim: expected object'] };
  const o = raw as Record<string, unknown>;
  if (o.ok !== true || o.kind !== 'claimed') {
    return { ok: false, errors: [`claim: not claimed (${String(o.kind)})`] };
  }
  const decoded = decodeSnapshot(o.snapshot);
  if (!decoded.ok) return decoded;
  if (typeof o.claim_token !== 'string') {
    return { ok: false, errors: ['claim.claim_token: expected string'] };
  }
  return { ...decoded, claimToken: o.claim_token };
}
