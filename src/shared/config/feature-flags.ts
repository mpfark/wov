/**
 * feature-flags.ts — Small, code-owned rollout switches.
 *
 * These are intentionally compile-time constants (not database rows): they
 * gate whether a *migration path* is active, and must be flippable without a
 * working backend.
 */

/**
 * Phase 2b: read ability definitions (label, text, CP cost, unlock
 * level) from the `abilities` / `class_ability_assignments` config tables.
 *
 * When false, the balance-identical hardcoded fallback lists in
 * `class-abilities.ts` are used and no config fetch happens.
 */
export const USE_CONFIG_ABILITIES = true;

/**
 * Phase D: ability resolver mode.
 *
 *   'v2'     — normal: live `abilities` rows drive the client calc registry.
 *   'sealed' — the client resolves ONLY from the compiled, parity-verified
 *              `ABILITY_SEED`; configured rows are ignored.
 *
 * Sealed mode is a temporary safety switch against invalid database
 * configuration, a bad registry refresh or an unsafe admin edit. It does NOT
 * protect against bugs shared by both modes (resolver, evaluator, mechanic
 * handlers). The server has the matching switch via the `ability_resolver_mode`
 * configuration key (or the `ABILITY_RESOLVER_MODE` environment override).
 * Remove both once this pass is verified in production.
 */
export const ABILITY_RESOLVER_MODE: 'v2' | 'sealed' = 'v2';

/** Exact, frontend-only rollout gate for the dormant Combat2 client path. */
export function combat2ClientEnabled(value: unknown): boolean {
  return value === 'true';
}

export const COMBAT2_CLIENT_ENABLED = combat2ClientEnabled(
  import.meta.env.VITE_COMBAT2_CLIENT_ENABLED,
);
