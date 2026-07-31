/**
 * load-class-registry.ts — Server-side loader for the configurable class
 * registry (Phase 2).
 *
 * Reads the `classes` table and feeds it into the shared class config so all
 * combat/resource math in this invocation uses the configured values instead
 * of the hardcoded fallback tables. Memoised per isolate with a short TTL so
 * a hot function does not re-query on every tick.
 */
import { setClassRegistry, type ClassConfigRow } from './formulas/classes.ts';

const TTL_MS = 60_000;
let loadedAt = 0;
let inflight: Promise<void> | null = null;

export async function loadClassRegistry(db: any, force = false): Promise<void> {
  if (!force && Date.now() - loadedAt < TTL_MS) return;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const { data, error } = await db
        .from('classes')
        .select('class_key,label,base_hp,base_ac,crit_range,level_bonuses,weapon_proficiencies,is_pre_class,is_selectable,sort_order,status');
      if (error) throw error;
      if (data && data.length > 0) {
        setClassRegistry(data as ClassConfigRow[]);
        loadedAt = Date.now();
      }
    } catch (err) {
      // Non-fatal: fallback tables stay in effect (balance-identical seed).
      console.error('[class-registry] load failed, using fallback tables:', err);
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}
