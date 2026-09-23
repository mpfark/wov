/**
 * Regression guard for the 42703 tick-save failure.
 *
 * `enforce_unique_holder_identity` is a DEFERRABLE INITIALLY DEFERRED constraint
 * trigger attached to three tables with different shapes: character_inventory,
 * node_ground_loot and marketplace_listings. Only marketplace_listings has a
 * `status` column.
 *
 * PL/pgSQL resolves record field references when it prepares the whole IF
 * expression, so a direct `NEW.status` reference raises
 * `record "new" has no field "status"` (SQLSTATE 42703) on every write to the
 * other two tables even when the TG_TABLE_NAME guard is false. Because the
 * trigger is deferred it fires at COMMIT, outside the PL/pgSQL EXCEPTION
 * handlers of the node_tick_commit chain, so an authoritative Combat2 tick that
 * recorded weapon durability failed at save with an unclassifiable error.
 *
 * The latest authored definition must therefore never reference a
 * table-specific column directly.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const MIGRATIONS = join(process.cwd(), 'supabase/migrations');
const FN = 'enforce_unique_holder_identity';

function latestDefinition(): { file: string; body: string } {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
  let found: { file: string; body: string } | null = null;
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8');
    const marker = sql.indexOf(`FUNCTION public.${FN}()`);
    if (marker === -1) continue;
    const end = sql.indexOf('END $$;', marker);
    found = { file, body: sql.slice(marker, end === -1 ? undefined : end + 7) };
  }
  if (!found) throw new Error(`no authored definition of ${FN} found`);
  return found;
}

describe('enforce_unique_holder_identity authored contract', () => {
  const { body } = latestDefinition();

  it('never references NEW.status, which does not exist on every attached table', () => {
    expect(body).not.toMatch(/NEW\.status/);
  });

  it('reads the marketplace-only status through a runtime-resolved projection', () => {
    expect(body).toMatch(/to_jsonb\(NEW\)\s*->>\s*'status'/);
  });

  it('reads it only inside the marketplace_listings branch', () => {
    const branch = body.indexOf("TG_TABLE_NAME='marketplace_listings'");
    const read = body.indexOf('to_jsonb(NEW)');
    expect(branch).toBeGreaterThan(-1);
    expect(read).toBeGreaterThan(branch);
  });

  it('still enforces all three unique-instance identity rules', () => {
    expect(body).toMatch(/unique item requires authoritative instance/);
    expect(body).toMatch(/non-unique item cannot carry unique instance/);
    expect(body).toMatch(/unique instance catalogue mismatch/);
  });

  it('only ever references columns shared by all three holder tables', () => {
    const fields = [...body.matchAll(/\bNEW\.([a-z_][a-z0-9_]*)/gi)].map((m) => m[1].toLowerCase());
    expect([...new Set(fields)].sort()).toEqual(['item_id', 'unique_instance_id']);
  });
});
