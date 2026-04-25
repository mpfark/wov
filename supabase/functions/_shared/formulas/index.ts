/**
 * Barrel export for all shared formula modules.
 *
 * Import sites should generally use the specific module
 * (e.g. `@/shared/formulas/combat`) for clarity, but `@/shared/formulas`
 * is acceptable for cross-cutting consumers (tests, edge functions).
 */
export * from './stats.ts';
export * from './classes.ts';
export * from './resources.ts';
export * from './combat.ts';
export * from './xp.ts';
export * from './items.ts';
export * from './creatures.ts';
export * from './economy.ts';
