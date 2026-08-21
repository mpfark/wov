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
  'dot_tick',
  // Kills / deaths (loot + rewards are stage 10)
  'creature_kill',
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
  'block',
  'evasion_dodge',
  'dodge',
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

/**
 * Stage 8 — status *interactions*: a debuff being resisted, blocked by
 * immunity, diminished, broken, cleansed, refreshed, stacked or consumed.
 *
 * Orientation is the whole point of this stage. Each type declares who is
 * resisting/removing (`actor`) and therefore which side the line is written
 * from; nothing is inferred from the prose. `player` = the local side won the
 * interaction (their control landed, or they shook one off), `creature` = the
 * creature won it (our control failed, or theirs held).
 */
interface Stage8Spec {
  effectType: string;
  /** Which actor the line is *about* — becomes `source`; the other becomes `target`. */
  actor: 'player' | 'creature';
  /** Set when the interaction deserves emphasis over a routine status line. */
  severity?: 'notable';
  /** Interaction carries a stack count. */
  stacks?: boolean;
}

const STAGE8_SPEC: Record<string, Stage8Spec> = {
  // Player wins the interaction
  debuff_resist: { effectType: 'resist', actor: 'player' },
  debuff_immune: { effectType: 'immune', actor: 'player' },
  debuff_cleansed: { effectType: 'cleanse', actor: 'player' },
  cc_break: { effectType: 'cc_break', actor: 'player', severity: 'notable' },
  cc_immune: { effectType: 'cc_immune', actor: 'player' },
  cc_diminish: { effectType: 'cc_diminish', actor: 'player' },
  // Creature wins the interaction — our control fails to land or is thrown off
  creature_resist: { effectType: 'resist', actor: 'creature', severity: 'notable' },
  creature_immune: { effectType: 'immune', actor: 'creature', severity: 'notable' },
  // Stacking interactions — player-driven, carrying a stack count
  debuff_stack: { effectType: 'stack', actor: 'player', stacks: true },
  debuff_refreshed: { effectType: 'refresh', actor: 'player', stacks: true },
  debuff_max_stacks: { effectType: 'max_stacks', actor: 'player', severity: 'notable', stacks: true },
  stack_consumed: { effectType: 'stack_consumed', actor: 'player', stacks: true },
};


/** Amount semantics per stage-6 server type (used when the prose carries `[N]`). */
const STAGE6_AMOUNT_KIND: Record<string, 'heal' | 'block' | 'absorb'> = {
  consecrate_heal: 'heal',
  shield_block: 'block',
  block: 'block',
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
  block: 'block',
  evasion_dodge: 'dodge',
  dodge: 'dodge',
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
  /** Stage 8: structured stack count for stacking interactions. */
  stacks?: number;
  /** Phase 3: stack ceiling, for authored `{max_stacks}` templates. */
  max_stacks?: number;
  /** Stage 8: effect identity when the server distinguishes it (e.g. 'poison'). */
  effect_type?: string;
  /**
   * Phase 3: canonical `abilities.ability_key` stamped by the server for every
   * event a cast emits (and for DoT ticks whose effect row records it).
   * Additive metadata only — never used to classify or style the line.
   */
  ability_key?: string;
  /** Phase 3: presentation names, so authored templates can be filled. */
  attacker_name?: string;
  target_name?: string;
}

/**
 * Phase 3 — ability lines whose sentence is authored per ability in
 * `abilities.combat_text`. The server sends facts plus a plain fallback; the
 * authored template owns identity and wording.
 */
const FLAVOR_SPEC: Record<string, { amountKind: 'damage' | 'stacks'; effectType?: string }> = {
  stance_pulse: { amountKind: 'damage' },
  stack_applied: { amountKind: 'stacks' },
};


/** Verbs whose second-person form is not just "drop the -s". */
const IRREGULAR_SECOND_PERSON: Record<string, string> = {
  has: 'have',
  is: 'are',
  does: 'do',
  goes: 'go',
  was: 'were',
};

/**
 * Turn a third-person singular verb into its second-person form.
 * Purely grammatical — the server authors third-person prose, so once the
 * local name folds to "You" the verb must follow ("You blocks" → "You block").
 */
function secondPersonVerb(verb: string): string {
  const irregular = IRREGULAR_SECOND_PERSON[verb];
  if (irregular) return irregular;
  if (!verb.endsWith('s')) return verb;
  if (/(?:ss|us|is)$/.test(verb)) return verb;
  if (/[^aeiou]ies$/.test(verb)) return `${verb.slice(0, -3)}y`;
  if (/(?:sh|ch|s|x|z)es$/.test(verb)) return verb.slice(0, -2);
  return verb.slice(0, -1);
}

/**
 * Conjugate the verb that directly follows a folded "You" subject.
 * Only the pronoun subject is touched — "Your ward burns …" keeps its
 * third-person verb because the subject there is the ward, not the player.
 */
export function applySecondPersonGrammar(message: string): string {
  return message.replace(
    /(^|[.!?]\s+|\s)(You) ([a-z]+)\b/g,
    (_m, lead: string, subject: string, verb: string) => `${lead}${subject} ${secondPersonVerb(verb)}`,
  );
}

/**
 * Server prose occasionally interpolates a raw `ability_key`. Render it as the
 * ability's readable name; display-only, never used to classify a line.
 */
export function humanizeAbilityKeys(message: string): string {
  return message.replace(/\b[a-z]+(?:_[a-z]+)+\b/g, (token) =>
    token
      .split('_')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' '),
  );
}

/**
 * Ability identity for lines the server writes generically. The effect is a
 * known ability, so the log names it instead of describing it vaguely.
 */
const ABILITY_IDENTITY_PROSE: Record<string, [RegExp, string]> = {
  holy_shield_return: [/\bward\b/g, 'Holy Shield'],
};

/**
 * Server prose that states its own amount in words, where the styled structured
 * token is the intended presentation. Holy Shield reads
 * `Your Holy Shield burns Ithram! [36]` — the sentence drops the numeral and
 * `EventLogLine` renders the amount exactly once from `event.amount`.
 */
const AMOUNT_AS_TOKEN: Record<string, RegExp> = {
  holy_shield_return: / for \d+\.\s*$/,
};

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
  return applySecondPersonGrammar(msg);
}


/**
 * Build a structured event for a stage-5/6/7/8 server event, or null when the
 * event belongs to another stage (caller then falls back to the legacy path).
 */
export function buildTickLogEvent(
  ev: TickEventInput,
  localCharacterId: string,
  localCharacterName: string,
): GameLogEvent | null {
  const isStage6 = STAGE6_TYPES.has(ev.type);
  const isStage7 = STAGE7_TYPES.has(ev.type);
  const stage8 = STAGE8_SPEC[ev.type];
  if (!STAGE5_TYPES.has(ev.type) && !isStage6 && !isStage7 && !stage8) return null;

  const type = mapServerEventType(ev.type);
  const isLocal = !!ev.character_id && ev.character_id === localCharacterId;

  const identity = ABILITY_IDENTITY_PROSE[ev.type];
  const amountAsToken = AMOUNT_AS_TOKEN[ev.type];
  let prose = identity ? ev.message.replace(identity[0], identity[1]) : ev.message;
  if (amountAsToken) prose = prose.replace(amountAsToken, '!');
  const remoteMessage = humanizeAbilityKeys(prose);
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

  // Stage 7 control effects: the afflicted actor is always the target, the
  // inflicting actor the source. Creature-sourced control (stagger, movement
  // lock) flips the orientation, which is exactly what decides `threat` vs
  // `action` presentation — no wording involved.
  // Stage 8 declares the winning actor explicitly per interaction type.
  const creatureIsSource = stage8
    ? stage8.actor === 'creature'
    : CREATURE_SOURCE_TYPES.has(ev.type) ||
      (isStage7 && STAGE7_CREATURE_SOURCED.has(ev.type));
  // Stage 6 lines describe what happened TO the protected/healed player, so
  // the player is always the subject; the creature (if any) is the other side.
  const source = creatureIsSource
    ? creatureActor
    : isStage6 || stage8
      ? playerActor
      : playerActor ?? creatureActor;
  const target = creatureIsSource ? playerActor : creatureActor;

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
  // Status lines carry effect identity, not a damage number — any `[N]` in the
  // prose belongs to the effect's own description, so nothing is re-attached.
  if (isStage7) {
    amount = undefined;
    amountKind = undefined;
  }
  // Stage 8 carries a stack count when the server sends one — never a damage
  // number, and never scraped out of the prose.
  if (stage8) {
    const stacks = typeof ev.stacks === 'number' && ev.stacks > 0 ? ev.stacks : undefined;
    amount = stage8.stacks ? stacks : undefined;
    amountKind = amount !== undefined ? 'stacks' : undefined;
  }

  return createLogEvent({
    type,
    message,
    remoteMessage,
    source,
    target,
    amount,
    amountKind,
    effectType: stage8
      ? ev.effect_type ?? stage8.effectType
      : isStage7
        ? STAGE7_EFFECT_TYPE[ev.type]
        : isStage6
          ? STAGE6_EFFECT_TYPE[ev.type]
          : undefined,
    severity: stage8 ? stage8.severity : isStage7 ? stage7Severity(ev.type) : undefined,
    abilityKey: ev.ability_key || undefined,
    crit: ev.is_crit ? true : undefined,
    scope: 'node',
  });
}



