/**
 * pure/mechanics.ts — the resolver's mechanic registry.
 *
 * `ActionSnapshot.mechanic` is a closed union taken from this list. The C3a
 * machine-check (`src/test/combat/c3a/coverage.test.ts`) fails if the live
 * configuration contains an active mechanic that is not listed here, and fails
 * if a mechanic is listed here without a resolver branch.
 *
 * Every mechanic is its OWN gameplay contract. Two mechanics never share a
 * branch just because their numbers look similar: `stack_apply` for Ignite and
 * for Envenom differ in trigger and effect payload, `party_regen` for Crescendo
 * and Purifying Light differ in the resource they restore, and so on. The
 * per-ability differences arrive through the loader-resolved `ActionSnapshot`
 * fields, never through a class branch inside the simulation.
 */

/** Mechanics the pure resolver implements, grouped by how they resolve. */
export const RESOLVER_MECHANICS = [
  // Direct damage
  'weapon_attack',
  'spell_attack',
  'multi_attack',
  'burst_damage',
  'stack_consume',
  // Healing / resources
  'heal',
  'hp_transfer',
  'party_regen',
  // Persistent friendly state
  'absorb_buff',
  'mitigation_buff',
  'offense_buff',
  'stealth_buff',
  'block_buff',
  'evasion_buff',
  'regen_buff',
  'reactive_holy',
  'aura_pulse',
  'stack_apply',
  // Hostile state
  'control_debuff',
  'dot_debuff',
] as const;

export type ResolverMechanic = (typeof RESOLVER_MECHANICS)[number];

const SET = new Set<string>(RESOLVER_MECHANICS);

export function isResolverMechanic(key: string | null | undefined): key is ResolverMechanic {
  return !!key && SET.has(key);
}

/**
 * Semantic family of each mechanic. The machine-check uses this to prove no
 * active ability is silently mapped onto a family with different semantics
 * (for example a stack applier folded into a plain DoT).
 */
export const MECHANIC_FAMILY: Readonly<Record<ResolverMechanic, string>> = {
  weapon_attack: 'direct_damage',
  spell_attack: 'direct_damage',
  multi_attack: 'multi_hit_damage',
  burst_damage: 'burst_damage',
  stack_consume: 'stack_finisher',
  heal: 'heal',
  hp_transfer: 'hp_transfer',
  party_regen: 'party_regen',
  absorb_buff: 'friendly_state',
  mitigation_buff: 'friendly_state',
  offense_buff: 'friendly_state',
  stealth_buff: 'stealth_state',
  block_buff: 'defensive_state',
  evasion_buff: 'defensive_state',
  regen_buff: 'periodic_friendly_state',
  reactive_holy: 'reactive_state',
  aura_pulse: 'persistent_area',
  stack_apply: 'stack_source',
  control_debuff: 'hostile_state',
  dot_debuff: 'hostile_periodic',
};
