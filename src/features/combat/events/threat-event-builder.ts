/**
 * threat-event-builder.ts — Stage 9 of the structured-event migration.
 *
 * Owns the events that describe WHO IS ON WHOM and WHERE THEY STAND:
 *
 *   - threat / aggro  — a creature noticing, charging or joining the fight,
 *                       and the player deliberately picking a fight.
 *   - taunts          — the player forcing or holding a creature's attention.
 *   - positioning     — outcomes that exist only because of where the actor
 *                       is standing: fleeing, wimp panic escapes, a cast
 *                       fizzling because we walked out of the node, being
 *                       movement-locked, or having no path to retreat down.
 *
 * As with every other stage, orientation (who acted) is declared here and
 * decides presentation — nothing downstream reads the prose. Emitted strings
 * carry no leading control glyph.
 */

import { createLogEvent, type GameLogEvent, type LogActor } from './log-event';

// ── Threat / aggro ─────────────────────────────────────────────

export type AggroKind = 'initial' | 'reengage' | 'join';

const AGGRO_PHRASES: Record<AggroKind, ((n: string) => string)[]> = {
  initial: [
    (n) => `${n} lunges at you!`,
    (n) => `${n} turns on you!`,
    (n) => `${n} snarls and charges!`,
    (n) => `${n} locks eyes on you!`,
  ],
  reengage: [
    (n) => `${n} charges at you!`,
    (n) => `${n} rushes toward you!`,
    (n) => `${n} closes in on you!`,
  ],
  join: [(n) => `${n} joins the fight!`],
};

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export interface AggroCreature {
  id?: string;
  name: string;
}

/**
 * A creature taking the player as its target. Creature-sourced, so it renders
 * in the `threat` family, and notable — losing track of a new attacker is the
 * single most punishing thing the log can hide.
 */
export function buildAggroEvent(
  kind: AggroKind,
  creature: AggroCreature,
  player?: LogActor,
): GameLogEvent {
  const message = pickRandom(AGGRO_PHRASES[kind])(creature.name);
  return createLogEvent({
    type: 'aggro',
    message,
    source: { kind: 'creature', id: creature.id, name: creature.name },
    target: player,
    effectType: kind,
    severity: 'notable',
    scope: 'self',
  });
}

/** The player choosing a target — player-sourced, routine `action` line. */
export function buildEngageEvent(creature: AggroCreature, player?: LogActor): GameLogEvent {
  return createLogEvent({
    type: 'aggro',
    message: `You start attacking ${creature.name}.`,
    remoteMessage: `${player?.name ?? 'A wayfarer'} starts attacking ${creature.name}.`,
    source: player ?? { kind: 'player' },
    target: { kind: 'creature', id: creature.id, name: creature.name },
    effectType: 'engage',
    scope: 'self',
  });
}

// ── Taunts ─────────────────────────────────────────────────────

/**
 * The player forcing or holding a creature's attention (Divine Challenge and
 * friends). Player-sourced by definition; magnitude, when the ability has one,
 * arrives as the canonical `[N]` suffix already in the authored prose.
 */
export function buildTauntEvent(
  message: string,
  player?: LogActor,
  creature?: AggroCreature,
): GameLogEvent {
  return createLogEvent({
    type: 'taunt',
    message,
    source: player ?? { kind: 'player' },
    target: creature ? { kind: 'creature', id: creature.id, name: creature.name } : undefined,
    effectType: 'taunt',
    scope: 'node',
  });
}

// ── Positioning ────────────────────────────────────────────────

export type PositioningKind =
  /** Deliberate retreat out of the node. */
  | 'flee'
  /** Wimp threshold crossed — automatic panic escape. */
  | 'wimp_flee'
  /** A queued cast lost because we left the node before it resolved. */
  | 'fizzle'
  /** Movement denied while staggered / locked. */
  | 'movement_locked'
  /** Wimp wanted to flee but the chosen direction has no usable exit. */
  | 'no_escape';

/** Positioning failures the player must notice sit above routine noise. */
const POSITIONING_NOTABLE = new Set<PositioningKind>(['wimp_flee', 'movement_locked', 'no_escape']);

/**
 * A position-dependent outcome. Always player-sourced — these lines describe
 * what the player's own location did for (or to) them, so they render in the
 * `action` family rather than as incoming threat.
 */
export function buildPositioningEvent(
  kind: PositioningKind,
  message: string,
  player?: LogActor,
): GameLogEvent {
  return createLogEvent({
    type: 'positioning',
    message,
    source: player ?? { kind: 'player' },
    effectType: kind,
    severity: POSITIONING_NOTABLE.has(kind) ? 'notable' : undefined,
    scope: 'self',
  });
}
