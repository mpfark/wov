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
