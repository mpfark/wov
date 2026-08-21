/**
 * ability-flavor.ts — the narrow flavor contract for ability-sourced log lines.
 *
 * The resolver ships FACTS (`abilityKey`, attacker/target names, amount, stack
 * count) and a plain fallback sentence. The player-facing sentence is authored
 * per ability in `abilities.combat_text` and rendered here, so ability identity
 * ("Orbs of Fire", not `orbs_of_fire`) comes from configuration instead of the
 * server's prose.
 *
 * Pure: no React, no side effects, no classification. A missing template simply
 * returns null and the caller keeps the server's fallback sentence.
 */
import { getAbilityLabel, getAuthoredCombatText } from '@/features/combat/utils/ability-text';

/** Authored `combat_text` slot per server event type. */
export const FLAVOR_SLOT: Record<string, string> = {
  stance_pulse: 'pulse_text',
  stack_applied: 'stack_text',
};

export interface FlavorTokens {
  attacker?: string | null;
  target?: string | null;
  amount?: number | null;
  stacks?: number | null;
  maxStacks?: number | null;
  abilityKey?: string | null;
}

/** True when the template states the damage itself, so no `[N]` is appended. */
export function templateStatesAmount(template: string): boolean {
  return /\{damage\}|\{amount\}/.test(template);
}

function fill(template: string, tokens: FlavorTokens): string {
  const map: Record<string, string> = {
    attacker: tokens.attacker ?? 'Someone',
    target: tokens.target ?? 'its foe',
    damage: tokens.amount != null ? String(tokens.amount) : '',
    amount: tokens.amount != null ? String(tokens.amount) : '',
    stacks: tokens.stacks != null ? String(tokens.stacks) : '',
    max_stacks: tokens.maxStacks != null ? String(tokens.maxStacks) : '',
    ability: tokens.abilityKey ? getAbilityLabel(tokens.abilityKey) : '',
  };
  return template.replace(/\{([a-z_]+)\}/g, (whole, key: string) =>
    key in map ? map[key] : whole,
  );
}

/**
 * Render the authored sentence for an ability line, or null when the ability
 * authors no text for this event type.
 */
export function renderAbilityFlavor(
  serverType: string,
  tokens: FlavorTokens,
): { text: string; statesAmount: boolean } | null {
  const slot = FLAVOR_SLOT[serverType];
  if (!slot || !tokens.abilityKey) return null;
  const authored = getAuthoredCombatText(tokens.abilityKey)[slot];
  const template =
    typeof authored === 'string' && authored.trim().length > 0 ? authored.trim() : null;
  if (!template) return null;
  return { text: fill(template, tokens), statesAmount: templateStatesAmount(template) };
}
