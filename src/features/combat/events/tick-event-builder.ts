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
  'bleed_applied',
  'poison_proc',
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
 * Build a structured event for a stage-5 server event, or null when the event
 * belongs to another stage (caller then falls back to the legacy path).
 */
export function buildTickLogEvent(
  ev: TickEventInput,
  localCharacterId: string,
  localCharacterName: string,
): GameLogEvent | null {
  if (!STAGE5_TYPES.has(ev.type)) return null;

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
  const source = creatureIsSource ? creatureActor : playerActor ?? creatureActor;
  const target = creatureIsSource ? playerActor : creatureActor;

  const hasDamage = typeof ev.damage === 'number' && ev.damage > 0;

  return createLogEvent({
    type,
    message,
    remoteMessage,
    source,
    target,
    amount: hasDamage ? ev.damage : undefined,
    amountKind: hasDamage ? 'damage' : undefined,
    crit: ev.is_crit ? true : undefined,
    scope: 'node',
  });
}
