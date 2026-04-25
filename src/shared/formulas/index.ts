/**
 * Barrel export for all shared formula modules.
 *
 * Import sites should generally use the specific module
 * (e.g. `@/shared/formulas/combat`) for clarity, but `@/shared/formulas`
 * is acceptable for cross-cutting consumers (tests, edge functions).
 */
export * from './stats';
export * from './classes';
export * from './resources';
export * from './combat';
export * from './xp';
export * from './items';
export * from './creatures';
export * from './economy';
