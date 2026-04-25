/**
 * combat-math.ts — Thin barrel re-export of the canonical formula modules
 * under `@/shared/formulas`.
 *
 * Historically this file held its own copy of every combat formula and was
 * mirrored to the Deno side by hand. Today the canonical owners live in
 * `src/shared/formulas/*.ts` (mirrored to `supabase/functions/_shared/formulas/`).
 *
 * Prefer importing from `@/shared/formulas/<module>` directly in new code.
 * This barrel exists to keep historic call sites (and the test in
 * `src/lib/__tests__/effective-caps.test.ts`) working without churn.
 */

export * from '@/shared/formulas/stats';
export * from '@/shared/formulas/classes';
export * from '@/shared/formulas/resources';
export * from '@/shared/formulas/combat';
export * from '@/shared/formulas/xp';
export * from '@/shared/formulas/items';
export * from '@/shared/formulas/creatures';
export * from '@/shared/formulas/economy';

// ── Deprecated compatibility shim ────────────────────────────────
import { getWisAntiCrit } from '@/shared/formulas/combat';

/** @deprecated Renamed to `getWisAntiCrit`. */
export function getWisDodgeChance(wis: number): number {
  return getWisAntiCrit(wis);
}
