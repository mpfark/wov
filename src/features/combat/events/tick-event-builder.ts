/**
 * tick-event-builder.ts — Stage 5 of the structured-event migration.
 *
 * Turns server tick events for ABILITIES, PROCS, DoTs, KILLS and DEATHS into
 * native `GameLogEvent`s at the tick boundary, so styling, severity and
 * routing come from `type` + `source.kind` instead of emoji prefixes or
 * keyword matching.
 *
 * Prose ownership: the server authors third-person prose ("Aldric strikes …").
 * That string is the observer-facing text (`remoteMessage`); the self-facing
 * `message` is the same string with the local character's name folded to
 * "You". This name folding is a pure pronoun rewrite — it never decides
 * category, family or severity, which is what the migration set out to remove.
 * When the server starts authoring both perspectives, `remoteMessage` simply
 * arrives pre-written and the fold drops out.
 */

import {
  createLogEvent,
  mapServerEventType,
  type GameLogEvent,
  type LogActor,
} from './log-event';

/** Server event types handled by this stage. */
const STAGE5_TYPES = new Set([
  // Abilities
  'ability_cast',
  'ability_hit',
  'ability_miss',
  'ability_fail',
  // Procs
  'proc',
  'buff_proc',
  'holy_shield_return',
  // DoT ticks + applications
  'ignite',
  'ignite_pulse',
  'poison',
  'bleed',
  'consecrate_burn',
  // Kills / drops / deaths
  'creature_kill',
  'gem_drop',
  'member_death',
]);

/**
 * Stage 6 — defensive and restorative outcomes: healing, buff consumption
 * and every form of damage mitigation (block, absorb, dodge, flat DR).
 * All resolve to `support` presentation regardless of who acted, so the
 * source is always the protected/healed player.
 */
const STAGE6_TYPES = new Set([
  // Heals / regen
  'consecrate_heal',
  // Buffs
  'buff_consumed',
  // Mitigation
  'absorb',
  'shield_block',
  'evasion_dodge',
  'awareness_resist',
  'battle_cry_dr',
  'divine_challenge_dr',
  'item_buff_dr',
]);

/**
 * Stage 7 — debuffs and crowd control: the application, refresh, resist,
 * break and expiry of negative status effects (DoT applications, armour
 * sunder, roots, snares, weakens, staggers and movement locks).
 *
 * These are *status* lines, not damage lines: the payload carries the
 * effect identity (`effectType`) and the afflicted actor as `target`, so
 * presentation and any future filtering key off structure instead of the
 * emoji or wording the server happened to author.
 */
const STAGE7_TYPES = new Set([
  // DoT / proc applications (moved off the stage-5 damage path)
  'bleed_applied',
  'poison_proc',
  'ignite_proc',
  // Generic + specific control effects
  'debuff_applied',
  'debuff_expired',
  'debuff_resist',
  'sunder_applied',
  'root_applied',
  'snare_applied',
  'weaken_applied',
  'stagger',
  'movement_lock',
  'cc_break',
]);

/** Effect identity per stage-7 server type — structured, never parsed from prose. */
const STAGE7_EFFECT_TYPE: Record<string, string> = {
  bleed_applied: 'bleed',
  poison_proc: 'poison',
  ignite_proc: 'ignite',
  debuff_applied: 'debuff',
  debuff_expired: 'debuff',
  debuff_resist: 'debuff',
  sunder_applied: 'sunder',
  root_applied: 'root',
  snare_applied: 'snare',
  weaken_applied: 'weaken',
  stagger: 'stagger',
  movement_lock: 'movement_lock',
  cc_break: 'cc_break',
};

/**
 * Control effects the CREATURE inflicts on the player. Everything else in
 * stage 7 is a player-applied debuff landing on a creature.
 */
const STAGE7_CREATURE_SOURCED = new Set(['stagger', 'movement_lock']);

/** Control landing on the player reads as notable; the rest stays routine. */
function stage7Severity(serverType: string): 'notable' | undefined {
  return STAGE7_CREATURE_SOURCED.has(serverType) ? 'notable' : undefined;
}

/** Amount semantics per stage-6 server type (used when the prose carries `[N]`). */
const STAGE6_AMOUNT_KIND: Record<string, 'heal' | 'block' | 'absorb'> = {
  consecrate_heal: 'heal',
  shield_block: 'block',
  absorb: 'absorb',
  battle_cry_dr: 'block',
  divine_challenge_dr: 'block',
  item_buff_dr: 'block',
};

/** Effect label per stage-6 server type — structured, never parsed from prose. */
const STAGE6_EFFECT_TYPE: Record<string, string> = {
  consecrate_heal: 'consecrate',
  buff_consumed: 'buff',
  absorb: 'absorb',
  shield_block: 'block',
  evasion_dodge: 'dodge',
  awareness_resist: 'resist',
  battle_cry_dr: 'battle_cry',
  divine_challenge_dr: 'divine_challenge',
  item_buff_dr: 'item_ward',
};

/** Pull the canonical `[N]` suffix the server appends to mitigation prose. */
function trailingAmount(message: string): number | undefined {
  const m = message.match(/\[(\d+)\]\s*$/);
  return m ? Number(m[1]) : undefined;
}

/** Types whose actor is the creature rather than the player. */
const CREATURE_SOURCE_TYPES = new Set(['member_death']);



export interface TickEventInput {
  type: string;
  message: string;
  character_id?: string;
  creature_id?: string;
  creature_name?: string;
  damage?: number;
  is_crit?: boolean;
}

/**
 * Fold the local character's name into second person.
 * Pure pronoun rewriting — carries no classification meaning.
 */
export function applySelfPerspective(message: string, characterName: string): string {
  if (!characterName || !message.includes(characterName)) return message;
  let msg = message;
  msg = msg.replace(new RegExp(`${characterName}'s`, 'g'), 'Your');
  msg = msg.replace(
    new RegExp(
      `(^|(?:[\\p{Emoji_Presentation}\\p{Extended_Pictographic}\\uFE0F\\u200D]+\\s*))${characterName} `,
      'u',
    ),
    '$1You ',
  );
  msg = msg.replace(new RegExp(` ${characterName} `, 'g'), ' you ');
  msg = msg.replace(new RegExp(` ${characterName}\\.`, 'g'), ' you.');
  msg = msg.replace(new RegExp(` ${characterName}!`, 'g'), ' you!');
  return msg;
}

/**
 * Build a structured event for a stage-5/6 server event, or null when the
 * event belongs to another stage (caller then falls back to the legacy path).
 */
export function buildTickLogEvent(
  ev: TickEventInput,
  localCharacterId: string,
  localCharacterName: string,
): GameLogEvent | null {
  const isStage6 = STAGE6_TYPES.has(ev.type);
  if (!STAGE5_TYPES.has(ev.type) && !isStage6) return null;

  const type = mapServerEventType(ev.type);
  const isLocal = !!ev.character_id && ev.character_id === localCharacterId;

  const remoteMessage = ev.message;
  const message = isLocal
    ? applySelfPerspective(remoteMessage, localCharacterName)
    : remoteMessage;

  const playerActor: LogActor | undefined = ev.character_id
    ? { kind: 'player', id: ev.character_id }
    : undefined;
  const creatureActor: LogActor | undefined =
    ev.creature_id || ev.creature_name
      ? { kind: 'creature', id: ev.creature_id, name: ev.creature_name }
      : undefined;

  const creatureIsSource = CREATURE_SOURCE_TYPES.has(ev.type);
  // Stage 6 lines describe what happened TO the protected/healed player, so
  // the player is always the subject; the creature (if any) is the other side.
  const source = creatureIsSource
    ? creatureActor
    : isStage6
      ? playerActor
      : playerActor ?? creatureActor;
  const target = creatureIsSource ? playerActor : isStage6 ? creatureActor : creatureActor;

  const hasDamage = typeof ev.damage === 'number' && ev.damage > 0;

  let amount: number | undefined = hasDamage ? ev.damage : undefined;
  let amountKind: GameLogEvent['amountKind'] = hasDamage ? 'damage' : undefined;
  if (isStage6) {
    const kind = STAGE6_AMOUNT_KIND[ev.type];
    const parsed = kind ? trailingAmount(remoteMessage) : undefined;
    if (kind && parsed !== undefined) {
      amount = parsed;
      amountKind = kind;
    } else {
      amount = undefined;
      amountKind = undefined;
    }
  }

  return createLogEvent({
    type,
    message,
    remoteMessage,
    source,
    target,
    amount,
    amountKind,
    effectType: isStage6 ? STAGE6_EFFECT_TYPE[ev.type] : undefined,
    crit: ev.is_crit ? true : undefined,
    scope: 'node',
  });
}

