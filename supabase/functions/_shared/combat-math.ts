/**
 * combat-math.ts — DEPRECATED.
 *
 * This file is now a thin re-export of the canonical formula modules under
 * `./formulas/`. Edge functions should import directly from
 * `./formulas/<module>.ts` for clarity. This stub will be removed in a
 * future cleanup pass once any external scripts have migrated.
 *
 * Authoritative source: `src/shared/formulas/*.ts` (mirrored to
 * `supabase/functions/_shared/formulas/*.ts`).
 *
 * @deprecated Import from `./formulas/<module>.ts` directly.
 */

export * from "./formulas/stats.ts";
export * from "./formulas/classes.ts";
export * from "./formulas/resources.ts";
export * from "./formulas/combat.ts";
export * from "./formulas/xp.ts";
export * from "./formulas/items.ts";
export * from "./formulas/creatures.ts";
export * from "./formulas/economy.ts";

import { getWisAntiCrit } from "./formulas/combat.ts";

/** @deprecated Renamed to `getWisAntiCrit`. WIS no longer grants outright dodge. */
export function getWisDodgeChance(wis: number): number {
  return getWisAntiCrit(wis);
}

/** @deprecated Unused. Kept exported only to avoid breaking imports. */
export function getDexMultiAttack(_dex: number): number {
  return 1;
}
