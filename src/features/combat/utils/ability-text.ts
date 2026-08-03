/**
 * ability-text.ts — Canonical, ability-identity-keyed presentation text.
 *
 * CANONICAL OWNER for: which authored combat text a runtime ability uses.
 *
 * Resolution order (identity first, mechanic last):
 *   1. authored `abilities.combat_text.cast` for the ability's `ability_key`
 *   2. ability-key flavor table (`cast-flavor.ts` → `getAbilityCastFlavor`)
 *   3. mechanic-key flavor table (`cast-flavor.ts` → `getCastFlavor`) — fallback
 *
 * This is what keeps Fireball and Frost Bolt textually distinct while both
 * dispatch through the shared `fireball` mechanic handler.
 */
import { ABILITY_SEED } from '@/shared/config/ability-seed';
import type { ClassAbility } from './class-abilities';
import { getAbilityCastFlavor, getCastFlavor } from './cast-flavor';

/** ability_key -> authored combat_text record. */
const AUTHORED_TEXT: Record<string, Record<string, unknown>> = {};

function prime(): void {
  for (const seed of ABILITY_SEED) {
    if (seed.combat_text && Object.keys(seed.combat_text).length > 0) {
      AUTHORED_TEXT[seed.ability_key] = seed.combat_text;
    }
  }
}
prime();

/** Replace the authored-text registry from configured rows (config load). */
export function setAbilityTextRegistry(
  rows: { ability_key?: string; combat_text?: unknown }[],
): void {
  for (const row of rows) {
    if (!row.ability_key) continue;
    const text = row.combat_text;
    if (!text || typeof text !== 'object') continue;
    AUTHORED_TEXT[row.ability_key] = text as Record<string, unknown>;
  }
}

/** Restore the compiled seed text only (tests). */
export function resetAbilityTextRegistry(): void {
  for (const key of Object.keys(AUTHORED_TEXT)) delete AUTHORED_TEXT[key];
  prime();
}

/** Authored `combat_text` for an ability key ({} when none). */
export function getAuthoredCombatText(abilityKey: string): Record<string, unknown> {
  return AUTHORED_TEXT[abilityKey] ?? {};
}

function pick(values: string[]): string {
  return values[Math.floor(Math.random() * values.length)];
}

function substitute(template: string, target: string | null): string {
  return template.replace('{target}', target ?? 'your foe');
}

/** Authored cast line for an ability key, or null when nothing is authored. */
export function getAuthoredCastFlavor(
  abilityKey: string,
  targetName: string | null,
): string | null {
  const cast = AUTHORED_TEXT[abilityKey]?.cast;
  if (typeof cast === 'string' && cast.trim().length > 0) {
    return substitute(cast, targetName);
  }
  if (Array.isArray(cast)) {
    const variants = cast.filter((v): v is string => typeof v === 'string' && v.length > 0);
    if (variants.length > 0) return substitute(pick(variants), targetName);
  }
  return null;
}

/**
 * Cast-time flavor for a queued ability, resolved by canonical identity with a
 * mechanic-level fallback. Returns null when nothing is defined at any level.
 */
export function resolveCastFlavor(
  ability: Pick<ClassAbility, 'abilityKey' | 'type'>,
  characterClass: string,
  targetName: string | null,
): string | null {
  return getAuthoredCastFlavor(ability.abilityKey, targetName)
    ?? getAbilityCastFlavor(ability.abilityKey, targetName)
    ?? getCastFlavor(ability.type, characterClass, targetName);
}
