/**
 * offense-buff.ts — Phase 8 decomposition.
 *
 * Damage-multiplier resolution for the shared `offense_buff` base (Arcane Surge
 * today, any configured `offense_mode: 'damage_mult'` ability tomorrow).
 * Extracted verbatim from `combat-tick/index.ts`.
 */
import { resolveMagnitude } from "./ability-magnitude.ts";
import { buildServerCalcInputs } from "../load-ability-calcs.ts";

/**
 * Arcane Surge is a global damage-pipeline rule (not a per-ability rider), so
 * its multiplier is resolved from its own configured ability row rather than a
 * hardcoded helper. `fallbackValue: 1` is a neutral constant, never a formula —
 * a missing calc leaves damage untouched and reports an actionable failure.
 */
export function surgeMult(
  classKey: string, level: number, intStat: number,
  characterId?: string | null, nodeId?: string | null,
  abilityKey = 'arcane_surge',
): number {
  return resolveMagnitude({
    classKey, abilityKey, kind: 'amount',
    inputs: buildServerCalcInputs(level, { int: intStat }),
    fallbackValue: 1, characterId, nodeId,
  });
}

/**
 * The damage-amplifying half of the shared `offense_buff` base carries its own
 * ability identity in the buff bag, so the multiplier is resolved from whichever
 * ability granted it. Bags that only carry `damage_buff: true` fall back to
 * Arcane Surge.
 */
export function offenseBuffKey(bag: Record<string, any> | null | undefined): string {
  const v = bag?.damage_buff;
  return (v && typeof v === 'object' && typeof v.ability_key === 'string')
    ? v.ability_key : 'arcane_surge';
}
