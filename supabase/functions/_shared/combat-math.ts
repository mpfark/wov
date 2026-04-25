/**
 * combat-math.ts — Server (Deno) barrel re-export of the canonical formula
 * modules under `./formulas/`.
 *
 * Historically this file held its own copy of every combat formula and was
 * kept in sync with the client by hand. Today the canonical owners live in
 * `./formulas/*.ts` (mirrored from `src/shared/formulas/*.ts`). Edge functions
 * should import directly from `./formulas/<module>.ts` for clarity, but this
 * barrel preserves the historic import path used by `combat-tick`,
 * `reward-calculator`, and `combat-catchup`.
 *
 * MIRROR RULE
 * ───────────
 * Files under `supabase/functions/_shared/formulas/` are byte-mirrored from
 * `src/shared/formulas/` with one mechanical change: relative imports are
 * suffixed with `.ts` for Deno. Edit the client copy and re-mirror; never
 * edit the Deno copy directly.
 */

export * from "./formulas/stats.ts";
export * from "./formulas/classes.ts";
export * from "./formulas/resources.ts";
export * from "./formulas/combat.ts";
export * from "./formulas/xp.ts";
export * from "./formulas/items.ts";
export * from "./formulas/creatures.ts";
export * from "./formulas/economy.ts";

// ── Deprecated compatibility shims ───────────────────────────────
// These exist purely so legacy imports keep resolving while call sites
// migrate to the canonical names. Do not add new usages.

import { getWisAntiCrit } from "./formulas/combat.ts";

/** @deprecated Renamed to `getWisAntiCrit`. WIS no longer grants outright dodge. */
export function getWisDodgeChance(wis: number): number {
  return getWisAntiCrit(wis);
}

/** @deprecated Unused. Kept exported only to avoid breaking imports. */
export function getDexMultiAttack(_dex: number): number {
  return 1;
}
