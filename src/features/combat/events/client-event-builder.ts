/**
 * client-event-builder.ts — Stage 11 of the structured-event migration.
 *
 * The final batch: every remaining CLIENT-SIDE emitter (movement, travel,
 * search, vendors, forging, training, summons, consumables, stances and
 * ability feedback, plus plain system notices and error notices) now builds a
 * native `GameLogEvent` instead of pushing a decorated string.
 *
 * Rules for this module — identical to every earlier stage:
 *  - The caller declares MEANING (`type` + who acted). Nothing downstream
 *    reads the prose to decide colour, marker, urgency or routing.
 *  - Authored prose carries NO leading control glyph. Emoji may appear inside
 *    a sentence as decoration, and it is behaviourally inert.
 *  - `message` is self-facing; `remoteMessage` is authored explicitly when a
 *    party observer should read something different. No `You`→name regex.
 */
import {
  createLogEvent,
  type GameLogEvent,
  type LogActor,
  type LogAmountKind,
  type LogEventType,
  type LogScope,
  type LogSeverity,
} from './log-event';

export interface ClientEventOptions {
  /** The acting player, when the line describes something we did. */
  player?: LogActor | null;
  target?: LogActor;
  /** Observer-facing prose. Authored, never derived. */
  remoteMessage?: string;
  amount?: number;
  amountKind?: LogAmountKind;
  damageType?: string;
  effectType?: string;
  /** Canonical ability identity (additive metadata; never a classifier). */
  abilityKey?: string;
  severity?: LogSeverity;
  crit?: boolean;
  scope?: LogScope;
}

function playerActor(player?: LogActor | null): LogActor {
  return player ?? { kind: 'player' };
}

/** Generic escape hatch — prefer the named builders below. */
export function buildClientEvent(
  type: LogEventType,
  message: string,
  opts: ClientEventOptions = {},
): GameLogEvent {
  const { player, ...rest } = opts;
  return createLogEvent({
    type,
    message,
    source: playerActor(player),
    scope: 'self',
    ...rest,
  });
}

/**
 * Neutral world / interface information: repairs, purchases, waymarks,
 * summon bookkeeping, "nothing found" outcomes. Ambient by design.
 */
export function buildSystemEvent(message: string, opts: ClientEventOptions = {}): GameLogEvent {
  return buildClientEvent('system', message, opts);
}

/**
 * Something the player tried that could not happen: not enough gold / CP / MP,
 * an unusable ability, a failed server call. Always notable — a silent refusal
 * is the worst thing this log can do.
 */
export function buildErrorEvent(message: string, opts: ClientEventOptions = {}): GameLogEvent {
  return buildClientEvent('error', message, opts);
}

/** Travel, hidden paths, party follows, teleports and waymark returns. */
export function buildMovementEvent(message: string, opts: ClientEventOptions = {}): GameLogEvent {
  return buildClientEvent('movement', message, opts);
}

/** Player-sourced ability feedback authored on the client. */
export function buildAbilityEvent(message: string, opts: ClientEventOptions = {}): GameLogEvent {
  return buildClientEvent('ability', message, opts);
}

/** Self/ally buffs, stances, songs, wards. */
export function buildBuffEvent(message: string, opts: ClientEventOptions = {}): GameLogEvent {
  return buildClientEvent('buff', message, opts);
}

/** Restoration authored on the client (potions, second wind, party regen). */
export function buildHealEvent(message: string, opts: ClientEventOptions = {}): GameLogEvent {
  return buildClientEvent('heal', message, opts);
}

/** Debuffs the player applies to a creature from a client-driven ability. */
export function buildDebuffEvent(message: string, opts: ClientEventOptions = {}): GameLogEvent {
  return buildClientEvent('debuff', message, opts);
}

/** Items entering (or leaving) the player's hands outside the tick boundary. */
export function buildLootEvent(message: string, opts: ClientEventOptions = {}): GameLogEvent {
  return buildClientEvent('loot', message, opts);
}

/** Gold, salvage, XP and other currency movement authored on the client. */
export function buildRewardEvent(message: string, opts: ClientEventOptions = {}): GameLogEvent {
  return buildClientEvent('reward', message, opts);
}

/** Stat points, respecs, training results — permanent character progress. */
export function buildProgressionEvent(message: string, opts: ClientEventOptions = {}): GameLogEvent {
  return buildClientEvent('level_up', message, opts);
}

/** The player dying outside the tick boundary (e.g. struck down retreating). */
export function buildDeathEvent(message: string, opts: ClientEventOptions = {}): GameLogEvent {
  return buildClientEvent('death', message, opts);
}

/**
 * Danger the world is signalling at us — region level warnings, locked paths,
 * an item shattering. Creature/world sourced so it reads as incoming threat.
 */
export function buildWarningEvent(message: string, opts: ClientEventOptions = {}): GameLogEvent {
  const { player: _player, ...rest } = opts;
  return createLogEvent({
    type: 'system',
    message,
    source: { kind: 'world' },
    severity: 'notable',
    scope: 'self',
    ...rest,
  });
}
