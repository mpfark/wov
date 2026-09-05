/**
 * combat2/types.ts — the immutable snapshot and proposed-transition contract
 * of the replacement combat system.
 *
 * The resolver is PURE: it receives a `NodeSnapshot` (produced by
 * `public.node_tick_claim`) plus a deterministic seed, and returns a
 * `ProposedTick` (consumed by `public.node_tick_commit`). It performs no IO,
 * reads no clock and calls no `Math.random()`.
 */

export type MechanicKey =
  | 'weapon_attack'
  | 'spell_attack'
  | 'multi_attack'
  | 'burst_damage'
  | 'dot_debuff'
  | 'heal'
  | 'hp_transfer'
  | 'party_regen'
  | 'absorb_buff'
  | 'mitigation_buff'
  | 'block_buff'
  | 'evasion_buff'
  | 'offense_buff'
  | 'regen_buff'
  | 'stealth_buff'
  | 'control_debuff'
  | 'stack_apply'
  | 'stack_consume'
  | 'aura_pulse'
  | 'reactive_damage';

/** The closed catalogue. Anything outside this list is rejected, never guessed. */
export const MECHANIC_KEYS: readonly MechanicKey[] = [
  'weapon_attack', 'spell_attack', 'multi_attack', 'burst_damage', 'dot_debuff',
  'heal', 'hp_transfer', 'party_regen', 'absorb_buff', 'mitigation_buff',
  'block_buff', 'evasion_buff', 'offense_buff', 'regen_buff', 'stealth_buff',
  'control_debuff', 'stack_apply', 'stack_consume', 'aura_pulse', 'reactive_damage',
] as const;

export function isMechanicKey(value: unknown): value is MechanicKey {
  return typeof value === 'string' && (MECHANIC_KEYS as readonly string[]).includes(value);
}

// ── Snapshot ────────────────────────────────────────────────────

export interface SnapshotEncounter {
  id: string;
  node_id: string;
  /** Last committed tick. */
  tick: number;
  /** The tick this resolution proposes. */
  candidate_tick: number;
  state_version: number;
  /** Authoritative wall clock captured at claim time (ISO string). */
  now: string;
}

/**
 * One equipped item as projected by the authoritative claim
 * (`character_inventory` x `items`, scoped to the owning character).
 *
 * `item_present` is false when the inventory row points at an item that no
 * longer exists; the resolver then fails closed instead of treating the
 * character as unarmed. The weapon fields are what the retained weapon formula
 * needs and are projected verbatim: a NULL is a real "not authored" and is
 * never defaulted here. When a main hand is equipped without them the resolver
 * refuses the action (`equipment_contract_incomplete`) rather than rolling a die
 * it cannot justify.
 */
export interface SnapshotEquipment {
  slot: string;
  item_id: string;
  inventory_id: string;
  /** Owner of the inventory row. Always the fighter this equipment belongs to. */
  character_id: string;
  durability: number | null;
  applied_gems: unknown;
  stat_override: unknown;
  crafted_level: number | null;
  item_present: boolean;
  item_type: string | null;
  weapon_tag: string | null;
  hands: number | null;
  item_level: number | null;
  rarity: string | null;
}



export interface SnapshotFighter {
  id: string;
  character_id: string;
  entry_seq: number;
  present: boolean;
  party_id_at_entry: string | null;
  party_id: string | null;
  name: string;
  class: string | null;
  race: string | null;
  level: number;
  hp: number;
  max_hp: number;
  cp: number;
  max_cp: number;
  mp: number;
  max_mp: number;
  ac: number;
  str: number;
  dex: number;
  con: number;
  int: number;
  wis: number;
  cha: number;
  equipment: SnapshotEquipment[];
}

export interface SnapshotPendingAction {
  ability_key: string;
  ability_label: string | null;
  started_at_tick: number;
  resolve_at_tick: number;
  target_fighter_id: string;
  target_character_id: string;
  target_entry_seq: number;
}

export interface SnapshotCreature {
  /** `node_creature.id` — the runtime row. */
  id: string;
  creature_id: string;
  spawn_seq: number;
  hp: number;
  is_alive: boolean;
  /** Hostility for this exact node-creature life; monotonic until death/reset. */
  engaged: boolean;
  pending_action: SnapshotPendingAction | null;
  tank_fighter_id: string | null;
  name: string;
  level: number;
  max_hp: number;
  ac: number;
  stats: Record<string, number> | null;
  rarity: string | null;
  is_humanoid: boolean | null;
  is_aggressive: boolean | null;
  boss_crit_flavors: unknown;
  boss_death_cry: string | null;
}

export interface SnapshotEffect {
  id: string;
  kind: string;
  effect_type: string;
  ability_key: string | null;
  target_character_id: string | null;
  target_creature_id: string | null;
  source_character_id: string | null;
  source_creature_id: string | null;
  stacks: number;
  magnitude: number | null;
  config: Record<string, unknown>;
  expires_at: string | null;
  next_due_at: string | null;
  interval_ms: number | null;
  last_pulse_tick: number | null;
  is_reservation: boolean;
}

/** Queued intent kinds, mirroring `node_intent_kind_chk`. */
export type IntentKind = 'ability' | 'stance_activate' | 'stance_drop' | 'basic_attack';

export interface SnapshotIntent {
  id: string;
  seq: number;
  character_id: string;
  intent_kind: IntentKind;
  ability_key: string | null;
  stance_key: string | null;
  target_creature_id: string | null;
}

/** Durable per-spawn reward qualification (`node_participation`). */
export interface SnapshotParticipation {
  creature_id: string;
  spawn_seq: number;
  character_id: string;
  qualification: 'qualified' | 'disqualified';
  qualified_by: string;
  party_id_at_qualification: string | null;
}

/** An authoritative event produced OUTSIDE a tick, awaiting delivery. */
export interface SnapshotPendingEvent {
  id: string;
  event_type: string;
  actor_character_id: string | null;
  actor_creature_id: string | null;
  target_character_id: string | null;
  target_creature_id: string | null;
  payload: Record<string, unknown>;
  occurred_at: string;
}

export interface SnapshotBossAbility {
  id: string;
  creature_id: string;
  /** Present for claim-captured authored casts; fences the creature life. */
  spawn_seq?: number;
  ability_key: string;
  label: string | null;
  weight: number;
  windup_ticks: number;
  targeting: 'tank' | 'aoe' | 'random';
  magnitude: number | null;
  amount_calc: unknown;
  damage_type: string | null;
  effect: Record<string, unknown> | null;
  telegraph_text: string | null;
  resolution_text: string | null;
}

/** Authored boss configuration captured atomically by `node_tick_claim`. */
export interface SnapshotBossConfiguration {
  encounter_id: string;
  node_creature_id: string;
  creature_id: string;
  spawn_seq: number;
  boss_cast: import('./boss-catalog').AuthoredBossCast | null;
}

/** Authoritative tank fallbacks ordered by arrival-group priority at claim time. */
export interface SnapshotTankCandidate {
  fighter_id: string;
  character_id: string;
  entry_seq: number;
}

export interface NodeSnapshot {
  encounter: SnapshotEncounter;
  creatures: SnapshotCreature[];
  fighters: SnapshotFighter[];
  effects: SnapshotEffect[];
  intents: SnapshotIntent[];
  /** Resolver-ready abilities produced only from `boss_configurations`. */
  boss_abilities: SnapshotBossAbility[];
  /** Immutable-for-this-claim authored boss configuration. */
  boss_configurations?: SnapshotBossConfiguration[];
  /** Durable qualification rows for the creature spawns of this encounter. */
  participation?: SnapshotParticipation[];
  /** Unconsumed out-of-tick events surfaced by the claim. */
  pending_events?: SnapshotPendingEvent[];
  /** Ordered representatives captured with this encounter version. */
  tank_candidates: SnapshotTankCandidate[];
}


// ── Proposed transition ─────────────────────────────────────────

export interface ProposedCharacterState {
  id: string;
  hp?: number;
  cp?: number;
  mp?: number;
  died?: boolean;
}

export interface ProposedCreatureState {
  /** `node_creature.id`. */
  id: string;
  creature_id: string;
  spawn_seq: number;
  hp?: number;
  is_alive?: boolean;
  damaged?: boolean;
  pending_action?: SnapshotPendingAction | null;
  tank_fighter_id?: string | null;
}

export interface ProposedEffectInsert {
  kind: string;
  effect_type: string;
  ability_key?: string | null;
  target_character_id?: string | null;
  target_creature_id?: string | null;
  source_character_id?: string | null;
  source_creature_id?: string | null;
  stacks?: number;
  magnitude?: number | null;
  config?: Record<string, unknown>;
  expires_at?: string | null;
  next_due_at?: string | null;
  interval_ms?: number | null;
  last_pulse_tick?: number | null;
  is_reservation?: boolean;
}

export interface ProposedEffectUpdate {
  id: string;
  stacks?: number;
  magnitude?: number | null;
  expires_at?: string | null;
  next_due_at?: string | null;
  last_pulse_tick?: number | null;
}

export interface ProposedFighterState {
  id: string;
  present: boolean;
}

export interface ProposedReward {
  creature_id: string;
  spawn_seq: number;
  character_id: string;
  xp_awarded: number;
  gold_awarded: number;
  is_killer: boolean;
}

/** Ordered, structured presentation event. No prose is assembled here. */
export interface TickEvent {
  /** Ordering index inside the tick; assigned by the resolver. */
  seq: number;
  kind: string;
  actor?: { type: 'character' | 'creature'; id: string; name: string };
  target?: { type: 'character' | 'creature'; id: string; name: string };
  abilityKey?: string;
  amount?: number;
  hitQuality?: string;
  outcomeReason?: string;
  meta?: Record<string, unknown>;
}

/** A qualification upsert the commit may apply (`node_participation`). */
export interface ProposedParticipation {
  creature_id: string;
  spawn_seq: number;
  character_id: string;
  qualification?: 'qualified' | 'disqualified';
  qualified_by: 'damage' | 'heal' | 'absorb' | 'debuff' | 'buff' | 'summon' | 'revive';
  party_id_at_qualification?: string | null;
}

export interface ProposedTick {
  tick: number;
  status?: 'active' | 'ended';
  characters: ProposedCharacterState[];
  creatures: ProposedCreatureState[];
  effects_insert: ProposedEffectInsert[];
  effects_update: ProposedEffectUpdate[];
  effects_delete: string[];
  fighters: ProposedFighterState[];
  rewards: ProposedReward[];
  events: TickEvent[];
  /** Exact intent ids the commit may mark consumed. */
  intent_ids: string[];
  /** Durable qualification upserts derived from this tick's interactions. */
  participation: ProposedParticipation[];
  /** Pending-event ids this tick folds into its committed batch, exactly once. */
  pending_event_ids: string[];
}

export function emptyProposedTick(tick: number): ProposedTick {
  return {
    tick,
    characters: [],
    creatures: [],
    effects_insert: [],
    effects_update: [],
    effects_delete: [],
    fighters: [],
    rewards: [],
    events: [],
    intent_ids: [],
    participation: [],
    pending_event_ids: [],

  };
}
