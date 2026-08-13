/**
 * maintenance.ts — client-side contract for the combat maintenance gate (C0).
 *
 * The authority is `combat_config.combat_mode`, read server-side by
 * `combat-tick` and `combat-catchup` before any simulation. This module only
 * types and recognises the gated response so the client can never render a
 * tick that was not resolved.
 *
 * Mirrored from `supabase/functions/_shared/combat/maintenance.ts`.
 */

export type CombatMode = 'open' | 'maintenance';

export const COMBAT_MODE_KEY = 'combat_mode';

export const COMBAT_MAINTENANCE_MESSAGE =
  'Combat is closed for maintenance. The world is safe; the Wayfarers rest until the smiths are done.';

/** Anything that is not exactly `open` is treated as closed. */
export function parseCombatMode(value: unknown): CombatMode {
  return value === 'open' ? 'open' : 'maintenance';
}

export interface MaintenanceResponseShape {
  maintenance: true;
  combat_mode: 'maintenance';
  message?: string;
}

/**
 * Did the resolver refuse to run because combat is closed? A gated response
 * always carries `maintenance: true` and never carries a committed batch.
 */
export function isMaintenanceResponse(data: unknown): data is MaintenanceResponseShape {
  if (!data || typeof data !== 'object') return false;
  return (data as { maintenance?: unknown }).maintenance === true;
}

/** Message to show players, falling back to the canonical text. */
export function maintenanceMessage(data: unknown): string {
  if (isMaintenanceResponse(data) && typeof data.message === 'string' && data.message.length > 0) {
    return data.message;
  }
  return COMBAT_MAINTENANCE_MESSAGE;
}
