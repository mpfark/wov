/**
 * c2/index.ts — the C2 authority layer.
 *
 * Not wired to production execution. Combat remains gated by the maintenance
 * mode installed in C0; the legacy resolver is still the only code path that
 * ever ran, and it is closed.
 */

export * from './contract.ts';
export * from './death-id.ts';
export * from './deaths.ts';
export * from './payload.ts';
export { md5Hex } from './md5.ts';
