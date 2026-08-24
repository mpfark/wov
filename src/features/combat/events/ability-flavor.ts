/**
 * ability-flavor.ts — the narrow flavor contract for ability-sourced log lines.
 *
 * The resolver ships FACTS (`abilityKey`, attacker/target names, amount, stack
 * count) and a plain fallback sentence. The player-facing sentence is authored
 * per ability in `abilities.combat_text` and rendered here, so ability identity
 * ("Orbs of Fire", not `orbs_of_fire`) comes from configuration instead of the
 * server's prose.
 *
 * Two perspectives are rendered from the SAME template: the observer text keeps
 * the names, and the self text substitutes a positional marker for the local
 * character which `perspective.ts` resolves to You / you / your. No global
 * capitalisation pass ever touches the sentence.
 *
 * Pure: no React, no side effects, no classification. A missing template simply
 * returns null and the caller keeps the server's fallback sentence.
 */
import { getAbilityLabel, getAuthoredCombatText } from '@/features/combat/utils/ability-text';
import { SELF_MARKER, resolveSelfMarkers } from './perspective';

/**
 * Canonical runtime flavor slots. These names are the contract:
 * `cast`, `hit`, `miss`, `activate`, `pulse`, `apply`, `tick`, `mitigate`,
 * `retaliate`. Historical keys (`pulse_text`, `stack_text`, `hit_text`,
 * `hit_verb`, …) are read as compatibility ALIASES only — nothing writes them
 * any more, and an unknown authored key is never removed.
 */
export const CANONICAL_FLAVOR_SLOTS = [
  'cast',
  'hit',
  'miss',
  'activate',
  'pulse',
  'apply',
  'tick',
  'mitigate',
  'retaliate',
] as const;

export type CanonicalFlavorSlot = (typeof CANONICAL_FLAVOR_SLOTS)[number];

/** Canonical slot per server event type. */
export const FLAVOR_SLOT: Record<string, CanonicalFlavorSlot> = {
  stance_pulse: 'pulse',
  stack_applied: 'apply',
  ability_hit: 'hit',
  ability_crit: 'hit',
  ability_miss: 'miss',
};

/** Legacy keys read for a canonical slot, in precedence order after it. */
const SLOT_ALIASES: Record<CanonicalFlavorSlot, string[]> = {
  cast: ['cast_text'],
  hit: ['hit_text'],
  miss: ['miss_text'],
  activate: ['activate_text'],
  pulse: ['pulse_text'],
  apply: ['stack_text', 'apply_text'],
  tick: ['tick_text'],
  mitigate: ['mitigate_text'],
  retaliate: ['retaliate_text'],
};

/**
 * Verb-only compatibility keys. A verb is not a sentence, so it is composed
 * into the canonical sentence shape for its slot.
 */
const SLOT_VERB_ALIAS: Partial<Record<CanonicalFlavorSlot, string>> = {
  hit: 'hit_verb',
  miss: 'miss_verb',
};

/** Sentence built from a verb-only alias. */
const VERB_TEMPLATE: Partial<Record<CanonicalFlavorSlot, string>> = {
  hit: '{attacker} {verb} {target}!',
  miss: "{attacker}'s {ability} {verb} {target}.",
};

/**
 * Last-resort sentence when an ability authors nothing for an outcome slot.
 * It states identity only — never an inline amount, so the structured `[N]`
 * token stays the single place a number is rendered.
 */
const GENERIC_OUTCOME: Partial<Record<CanonicalFlavorSlot, string>> = {
  hit: '{attacker} strikes {target} with {ability}!',
  miss: "{attacker}'s {ability} misses {target}.",
};

function trimmedString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Authored template for a canonical slot: canonical key first, then legacy
 * aliases, then a verb-only alias composed into the slot's sentence shape.
 */
export function resolveSlotTemplate(
  abilityKey: string,
  slot: CanonicalFlavorSlot,
): string | null {
  const text = getAuthoredCombatText(abilityKey);
  const canonical = trimmedString(text[slot]);
  if (canonical) return canonical;
  for (const alias of SLOT_ALIASES[slot]) {
    const aliased = trimmedString(text[alias]);
    if (aliased) return aliased;
  }
  const verbKey = SLOT_VERB_ALIAS[slot];
  const shape = VERB_TEMPLATE[slot];
  if (verbKey && shape) {
    const verb = trimmedString(text[verbKey]);
    if (verb) return shape.replace('{verb}', verb);
  }
  return null;
}


export interface FlavorTokens {
  attacker?: string | null;
  target?: string | null;
  amount?: number | null;
  stacks?: number | null;
  maxStacks?: number | null;
  abilityKey?: string | null;
  /** Local character name; matching actor tokens render in second person. */
  selfName?: string | null;
  /** Status identity, for `{effect}` in authored text. */
  effectLabel?: string | null;
}

/** True when the template states the damage itself, so no `[N]` is appended. */
export function templateStatesAmount(template: string): boolean {
  return /\{damage\}|\{amount\}/.test(template);
}

function fill(template: string, tokens: FlavorTokens, self: boolean): string {
  const actor = (name: string | null | undefined, fallback: string): string => {
    if (!name) return fallback;
    if (self && tokens.selfName && name === tokens.selfName) return SELF_MARKER;
    return name;
  };
  const map: Record<string, string> = {
    attacker: actor(tokens.attacker, 'Someone'),
    target: actor(tokens.target, 'its foe'),
    damage: tokens.amount != null ? String(tokens.amount) : '',
    amount: tokens.amount != null ? String(tokens.amount) : '',
    stacks: tokens.stacks != null ? String(tokens.stacks) : '',
    max_stacks: tokens.maxStacks != null ? String(tokens.maxStacks) : '',
    ability: tokens.abilityKey ? getAbilityLabel(tokens.abilityKey) : '',
    effect: tokens.effectLabel ?? '',
  };
  return template.replace(/\{([a-z_]+)\}/g, (whole, key: string) =>
    key in map ? map[key] : whole,
  );
}

/**
 * Render the authored sentence for an ability line, or null when the ability
 * authors no text for this event type.
 *
 * `text` = observer perspective (names), `selfText` = local perspective with
 * positional pronouns. They are identical when the local character is not one
 * of the actors.
 */
export function renderAbilityFlavor(
  serverType: string,
  tokens: FlavorTokens,
): { text: string; selfText: string; statesAmount: boolean } | null {
  const slot = FLAVOR_SLOT[serverType];
  if (!slot || !tokens.abilityKey) return null;
  const authored = getAuthoredCombatText(tokens.abilityKey)[slot];
  const template =
    typeof authored === 'string' && authored.trim().length > 0 ? authored.trim() : null;
  if (!template) return null;
  return {
    text: fill(template, tokens, false),
    selfText: resolveSelfMarkers(fill(template, tokens, true)),
    statesAmount: templateStatesAmount(template),
  };
}
