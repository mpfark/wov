/**
 * c3-catalog.ts — the edge adapter that turns the server ability registry into
 * the `AbilityCatalog` the C3 loader consumes.
 *
 * The catalog carries the `ability_config_version()` value it was built from.
 * The orchestration compares it against the version the authoritative snapshot
 * pinned; a mismatch refreshes once and otherwise fails the tick closed, so a
 * stale isolate can never resolve magnitudes from unpinned configuration.
 */
import {
  loadAbilityCalcs,
  getServerAbilityCalcs,
} from '../load-ability-calcs.ts';
import type { AbilityCatalog } from './c3/loader.ts';
import type { AbilityConfigEntry } from './c3/ability-resolve.ts';

async function readConfigVersion(db: any): Promise<string> {
  const { data, error } = await db.rpc('ability_config_version', {});
  if (error) throw new Error(`ability_config_version failed: ${error.message}`);
  const version = typeof data === 'string' ? data : String(data ?? '');
  if (!version) throw new Error('ability_config_version returned no value');
  return version;
}

function toEntry(row: ReturnType<typeof getServerAbilityCalcs>): AbilityConfigEntry | null {
  if (!row) return null;
  return {
    abilityKey: row.abilityKey,
    classAbilityKey: row.classAbilityKey,
    classKey: row.classKey,
    mechanicKey: row.mechanicKey,
    amountCalc: row.amountCalc,
    durationCalc: row.durationCalc,
    intervalMs: row.intervalMs,
    mechanicCalcs: row.mechanicCalcs ?? {},
    effectConfig: row.effectConfig ?? {},
    cpCost: row.cpCost,
    damageType: row.damageType,
    unlockLevel: row.unlockLevel,
    label: row.label,
  };
}

/**
 * Build a catalog from live configuration. `force` bypasses the registry TTL so
 * a version mismatch can be corrected within one request.
 */
export async function buildAbilityCatalog(db: any, force = false): Promise<AbilityCatalog> {
  // Version first: reading it before the registry means a concurrent admin edit
  // can only ever make the catalog look OLDER than it is, never newer, so a
  // mismatch is always detected rather than masked.
  const configVersion = await readConfigVersion(db);
  await loadAbilityCalcs(db, force);
  return {
    configVersion,
    lookup: (classKey: string, abilityKey: string) =>
      toEntry(getServerAbilityCalcs(classKey, abilityKey)),
  };
}
