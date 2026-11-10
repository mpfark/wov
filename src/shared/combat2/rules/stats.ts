/**
 * stats.ts — Core stat math primitives.
 *
 * CANONICAL OWNER for: getStatModifier, diminishing returns, dice rolling.
 *
 * Pure TS, zero deps. Mirrored byte-for-byte to
 * `supabase/functions/_shared/formulas/stats.ts` for Deno consumption.
 */

/** D&D-style stat modifier: floor((stat - 10) / 2) */
export function getStatModifier(stat: number): number {
  return Math.floor((stat - 10) / 2);
}

/** Roll a d20 (1–20) */
export function rollD20(): number {
  return Math.floor(Math.random() * 20) + 1;
}

/** Roll damage in range [min, max] inclusive */
export function rollDamage(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Integer diminishing return: floor(sqrt(mod)), capped */
export function diminishing(mod: number, cap: number): number {
  return Math.min(cap, Math.floor(Math.sqrt(Math.max(0, mod))));
}

/** Float diminishing return: sqrt(mod) * perPoint, capped */
export function diminishingFloat(mod: number, perPoint: number, cap: number): number {
  return Math.min(cap, Math.sqrt(Math.max(0, mod)) * perPoint);
}
