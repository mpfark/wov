/**
 * maintenance.ts — C0: the combat maintenance gate (fail closed).
 *
 * One operational switch decides whether ANY authoritative combat resolution
 * may run. It is read from `combat_config` (key `combat_mode`) as the first
 * database access of a request, before intent is read, before a roster is
 * loaded, before a single roll and before any mutation.
 *
 * Fail closed is deliberate: an unknown value, a missing row or a failed read
 * all resolve to `maintenance`. During the combat-engine replacement we would
 * rather serve a maintenance notice than let a half-owned resolver mutate
 * authoritative state.
 *
 * The gate is also the permanent kill switch and the operational rollback for
 * the new engine: flipping the row to `maintenance` stops new resolution at
 * the next request, leaves every committed batch readable, and touches no
 * permanent player state.
 */

export type CombatMode = 'open' | 'maintenance';

export const COMBAT_MODE_KEY = 'combat_mode';

/** Shown to players by the client when combat is closed. */
export const COMBAT_MAINTENANCE_MESSAGE =
  'Combat is closed for maintenance. The world is safe; the Wayfarers rest until the smiths are done.';

/** Anything that is not exactly `open` is treated as closed. */
export function parseCombatMode(value: unknown): CombatMode {
  return value === 'open' ? 'open' : 'maintenance';
}

/** Is combat allowed to resolve at all? */
export function isCombatOpen(mode: CombatMode): boolean {
  return mode === 'open';
}

export interface MaintenancePayload {
  maintenance: true;
  combat_mode: 'maintenance';
  message: string;
  /** Empty result surface so no client can render an unresolved tick. */
  events: never[];
  creature_states: never[];
  member_states: never[];
  alive_creature_ids: never[];
  ticks_processed: 0;
  encounter_tick: null;
  encounter_batch_id: null;
  encounter_id: null;
}

/**
 * The only response a gated resolver may produce. It carries no events and no
 * committed batch identity, so the client cannot mistake it for a resolved
 * tick.
 */
export function maintenanceResponse(): MaintenancePayload {
  return {
    maintenance: true,
    combat_mode: 'maintenance',
    message: COMBAT_MAINTENANCE_MESSAGE,
    events: [],
    creature_states: [],
    member_states: [],
    alive_creature_ids: [],
    ticks_processed: 0,
    encounter_tick: null,
    encounter_batch_id: null,
    encounter_id: null,
  };
}

/**
 * Read the switch. Any error, missing row or unexpected value closes combat.
 * `db` is the service-role client the resolver already holds.
 */
export async function readCombatMode(db: {
  from: (table: string) => any;
}): Promise<CombatMode> {
  try {
    const { data, error } = await db
      .from('combat_config')
      .select('value')
      .eq('key', COMBAT_MODE_KEY)
      .maybeSingle();
    if (error) {
      console.warn('[combat-maintenance] mode read failed, failing closed', error.message);
      return 'maintenance';
    }
    return parseCombatMode((data as { value?: unknown } | null)?.value);
  } catch (e) {
    console.warn('[combat-maintenance] mode read threw, failing closed', (e as Error).message);
    return 'maintenance';
  }
}
