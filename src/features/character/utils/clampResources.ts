import type { Character } from '../hooks/useCharacter';

export interface EffectiveCaps {
  maxHp?: number;
  maxCp?: number;
  maxMp?: number;
}

/**
 * Clamp `hp`/`cp`/`mp` fields in a character update to their effective caps.
 *
 * - When `caps` is supplied (e.g. by the regen loop with gear-boosted maxima),
 *   those values are the upper bound. This prevents the snap-back bug where
 *   gear-boosted HP (e.g. 250) was silently truncated to base `max_hp` (233)
 *   when persisted to the DB.
 * - When `caps` is omitted, the function falls back to the base
 *   `max_hp/max_cp/max_mp` on the character row — preserving safety for any
 *   caller that doesn't know about gear bonuses.
 *
 * Other fields in `updates` are passed through untouched.
 */
export function clampResourceUpdates(
  updates: Partial<Character>,
  base: Pick<Character, 'max_hp' | 'max_cp' | 'max_mp'>,
  caps?: EffectiveCaps,
): Partial<Character> {
  const out = { ...updates } as any;
  const hpCap = caps?.maxHp ?? base.max_hp;
  const cpCap = caps?.maxCp ?? base.max_cp;
  const mpCap = caps?.maxMp ?? base.max_mp;
  if (out.hp != null) out.hp = Math.min(out.hp, hpCap);
  if (out.cp != null) out.cp = Math.min(out.cp, cpCap);
  if (out.mp != null) out.mp = Math.min(out.mp, mpCap);
  return out;
}
