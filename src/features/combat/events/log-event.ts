/**
 * log-event.ts — canonical structured game-log event (Phase 3).
 *
 * Owns: the event shape, the server-event-type mapping and event creation.
 * Pure, no React, no side effects.
 *
 * The event describes WHAT HAPPENED. It never carries visual information —
 * family / colour / marker / urgency are derived by `presentation.ts` from
 * `type` (+ `source.kind`, `severity`, `crit`). Authored prose is display
 * text only: no leading control emoji, and any emoji inside the prose has
 * zero behavioural meaning.
 */

// ── Vocabulary ─────────────────────────────────────────────────

export type LogEventType =
  | 'attack'
  | 'ability'
  | 'proc'
  | 'dot_tick'
  | 'debuff'
  | 'mitigation'
  | 'heal'
  | 'buff'
  | 'boss_telegraph'
  | 'boss_cast_hit'
  | 'kill'
  | 'death'
  | 'level_up'
  | 'loot'
  | 'reward'
  | 'quest'
  | 'speech'
  | 'whisper'
  | 'movement'
  | 'system'
  | 'error'
  /** Structured event whose type this client does not know. Never message-parsed. */
  | 'unknown'
  /** Genuinely unstructured historical / unmigrated string. Adapter-only. */
  | 'legacy';

export type LogSeverity = 'routine' | 'notable' | 'urgent';

export type LogActorKind = 'player' | 'creature' | 'npc' | 'world';

export interface LogActor {
  kind: LogActorKind;
  id?: string;
  name?: string;
}

export type LogAmountKind =
  | 'damage'
  | 'heal'
  | 'block'
  | 'absorb'
  | 'xp'
  | 'gold'
  | 'resource'
  /** Number of status stacks involved (applied, held or consumed). */
  | 'stacks';

export type LogScope = 'self' | 'party' | 'node' | 'global';

export interface GameLogEvent {
  /** Schema version — bump only on a breaking wire change. */
  v: 1;
  /**
   * Generated exactly once by the authoritative emitter and preserved
   * unchanged through local display, persistence, broadcast, self-echo
   * dedup and catch-up. A DB row may have its own primary key, but it must
   * not replace this id.
   */
  id: string;
  /** Emit time (ms). Ordering itself is unchanged — this is a tiebreak/debug aid. */
  ts: number;
  type: LogEventType;
  /** Clean local / self-facing prose. */
  message: string;
  /** Clean party-observer prose. No `You`→name rewriting on structured events. */
  remoteMessage?: string;
  source?: LogActor;
  target?: LogActor;
  amount?: number;
  amountKind?: LogAmountKind;
  damageType?: string;
  effectType?: string;
  /** Only set when it differs from the type's default severity. */
  severity?: LogSeverity;
  crit?: boolean;
  scope?: LogScope;
  /** True when the line describes another actor's deed as seen by us (party echo). */
  observed?: boolean;
  /**
   * LEGACY COMPATIBILITY ONLY — set by legacy-adapter.ts for unstructured
   * strings so the renderer can reproduce today's exact text output
   * (leading-glyph suppression + trailing number split + flavor stripping).
   * Removed together with the adapter. Structured emitters must never set it.
   */
  legacy?: { raw: string };
}

// ── Server event types ─────────────────────────────────────────

/**
 * Every event type currently emitted by combat-tick / combat-catchup /
 * kill-resolver. Keep in sync with the edge functions; the mapping below is
 * exhaustive at compile time and covered by a test.
 */
export const SERVER_EVENT_TYPES = [
  'ability_cast',
  'ability_fail',
  'ability_hit',
  'ability_miss',
  'absorb',
  'attack_hit',
  'attack_miss',
  'awareness_resist',
  'battle_cry_dr',
  'bleed',
  'bleed_applied',
  'boss_cast_hit',
  'boss_cast_start',
  'boss_death_cry',
  'broadcast',
  'buff_consumed',
  'buff_proc',
  'consecrate_burn',
  'consecrate_heal',
  'contract_complete',
  'cc_break',
  'cc_diminish',
  'cc_immune',
  'creature_immune',
  'creature_resist',
  'debuff_cleansed',
  'debuff_immune',
  'debuff_max_stacks',
  'debuff_refreshed',
  'debuff_stack',
  'stack_consumed',
  'debuff_applied',
  'debuff_expired',
  'debuff_resist',
  'movement_lock',
  'root_applied',
  'snare_applied',
  'stagger',
  'sunder_applied',
  'weaken_applied',
  'creature_crit',
  'creature_kill',
  'creature_hit',
  'creature_miss',
  'divine_challenge_dr',
  'evasion_dodge',
  'gem_drop',
  'holy_shield_return',
  'ignite',
  'ignite_proc',
  'ignite_pulse',
  'item_buff_dr',
  'level_bonus',
  'level_up',
  'member_death',
  'milestone_ember',
  'offhand_hit',
  'offhand_miss',
  'poison',
  'poison_proc',
  'proc',
  'respec',
  'shield_block',
  'stat_point',
  'tick_separator',
] as const;

export type ServerEventType = (typeof SERVER_EVENT_TYPES)[number];

/** Exhaustive server-type → structured-type mapping. */
export const SERVER_EVENT_TYPE_MAP: Record<ServerEventType, LogEventType> = {
  ability_cast: 'ability',
  ability_fail: 'error',
  ability_hit: 'ability',
  ability_miss: 'ability',
  absorb: 'mitigation',
  attack_hit: 'attack',
  attack_miss: 'attack',
  awareness_resist: 'mitigation',
  battle_cry_dr: 'mitigation',
  bleed: 'dot_tick',
  bleed_applied: 'debuff',
  boss_cast_hit: 'boss_cast_hit',
  boss_cast_start: 'boss_telegraph',
  boss_death_cry: 'system',
  broadcast: 'system',
  buff_consumed: 'buff',
  buff_proc: 'buff',
  consecrate_burn: 'dot_tick',
  consecrate_heal: 'heal',
  contract_complete: 'quest',
  cc_break: 'debuff',
  // Stage 8 — the player shrugging control off reads as mitigation; a
  // creature shrugging OUR control off is a setback, so it stays a debuff
  // line whose family follows the creature source.
  cc_diminish: 'mitigation',
  cc_immune: 'mitigation',
  debuff_cleansed: 'mitigation',
  debuff_immune: 'mitigation',
  creature_immune: 'debuff',
  creature_resist: 'debuff',
  debuff_max_stacks: 'debuff',
  debuff_refreshed: 'debuff',
  debuff_stack: 'debuff',
  stack_consumed: 'debuff',
  debuff_applied: 'debuff',
  debuff_expired: 'debuff',
  debuff_resist: 'mitigation',
  movement_lock: 'debuff',
  root_applied: 'debuff',
  snare_applied: 'debuff',
  stagger: 'debuff',
  sunder_applied: 'debuff',
  weaken_applied: 'debuff',
  creature_crit: 'attack',
  creature_kill: 'kill',
  creature_hit: 'attack',
  creature_miss: 'attack',
  divine_challenge_dr: 'mitigation',
  evasion_dodge: 'mitigation',
  gem_drop: 'loot',
  holy_shield_return: 'proc',
  ignite: 'dot_tick',
  ignite_proc: 'debuff',
  ignite_pulse: 'dot_tick',
  item_buff_dr: 'mitigation',
  level_bonus: 'level_up',
  level_up: 'level_up',
  member_death: 'death',
  milestone_ember: 'loot',
  offhand_hit: 'attack',
  offhand_miss: 'attack',
  poison: 'dot_tick',
  poison_proc: 'debuff',
  proc: 'proc',
  respec: 'system',
  shield_block: 'mitigation',
  stat_point: 'level_up',
  tick_separator: 'system',
};

const warnedUnknownServerTypes = new Set<string>();

/**
 * Map a server event type to a structured log type.
 *
 * An unrecognised type resolves to `unknown` (rendered as neutral system
 * information) and is reported once. It is deliberately NOT classified by
 * inspecting the message, and never becomes `legacy` — a forgotten server
 * type must be visible, not silently absorbed by the compatibility path.
 */
export function mapServerEventType(serverType: string): LogEventType {
  const mapped = (SERVER_EVENT_TYPE_MAP as Record<string, LogEventType | undefined>)[serverType];
  if (mapped) return mapped;
  if (!warnedUnknownServerTypes.has(serverType)) {
    warnedUnknownServerTypes.add(serverType);
    console.warn(`[log-event] Unmapped server event type: "${serverType}" — rendered as neutral info.`);
  }
  return 'unknown';
}

/** Test hook — clears the once-per-type warning memo. */
export function __resetUnknownTypeWarnings() {
  warnedUnknownServerTypes.clear();
}

// ── Construction ───────────────────────────────────────────────

export function newLogEventId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export type LogEventInit = Omit<GameLogEvent, 'v' | 'id' | 'ts'> &
  Partial<Pick<GameLogEvent, 'id' | 'ts'>>;

/**
 * Create a structured event. `id` is generated here unless the authoritative
 * emitter already assigned one — it must then be preserved across every
 * transport and persistence boundary.
 */
export function createLogEvent(init: LogEventInit): GameLogEvent {
  return {
    v: 1,
    id: init.id ?? newLogEventId(),
    ts: init.ts ?? Date.now(),
    ...init,
  } as GameLogEvent;
}

/** Narrowing guard for values arriving over realtime / from the DB. */
export function isGameLogEvent(value: unknown): value is GameLogEvent {
  if (!value || typeof value !== 'object') return false;
  const e = value as Partial<GameLogEvent>;
  return typeof e.id === 'string' && typeof e.type === 'string' && typeof e.message === 'string';
}
