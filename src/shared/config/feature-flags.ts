/**
 * feature-flags.ts — Small, code-owned rollout switches.
 *
 * These are intentionally compile-time constants (not database rows): they
 * gate whether a *migration path* is active, and must be flippable without a
 * working backend.
 */

/**
 * Phase 2b: read ability definitions (label, emoji, text, CP cost, unlock
 * level) from the `abilities` / `class_ability_assignments` config tables.
 *
 * When false, the balance-identical hardcoded fallback lists in
 * `class-abilities.ts` are used and no config fetch happens.
 */
export const USE_CONFIG_ABILITIES = true;

/**
 * Phase 2c: read ability *magnitudes* (amount / duration / tick interval) from
 * the stored `amount_calc` / `duration_calc` records instead of the inline
 * hardcoded math in the ability handlers.
 *
 * When false, the legacy inline formulas are used. The seeded calcs are pinned
 * balance-identical to those formulas by `ability-calc-parity.test.ts`.
 */
export const USE_CONFIG_ABILITY_CALCS = true;

/**
 * Checkpoint 5 cutover: the configured `version: 2` records (dice terms,
 * `finalMult` riders, named `mechanic_calcs`) are authoritative for all seven
 * classes. Legacy inline math remains only as a rollback path and is removed at
 * checkpoint 7.
 *
 * Server side the same switch lives in
 * `supabase/functions/_shared/ability-telemetry.ts`, where it can be forced off
 * with the `USE_CONFIG_ABILITY_CALCS_V2=false` environment variable.
 */
export const USE_CONFIG_ABILITY_CALCS_V2 = true;
