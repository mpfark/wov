/**
 * Permanent zero-write / scope guard for `public.node_creature_roster`.
 *
 * STABLE is a guardrail, not the security guarantee: this test pins the
 * function body itself as narrowly read-only, ownership-checked and
 * current-node-only. The migration SQL lives in the repo, so the contract is
 * asserted statically without needing a live database.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.sql')) out.push(p);
  }
  return out;
}

/** The most recent migration that defines the roster function. */
function rosterSql(): string {
  const files = walk('supabase/migrations')
    .filter(f => readFileSync(f, 'utf8').includes('node_creature_roster'))
    .sort();
  expect(files.length, 'roster migration must exist in the repo').toBeGreaterThan(0);
  return readFileSync(files[files.length - 1], 'utf8');
}

describe('node_creature_roster — read-only contract', () => {
  const sql = rosterSql();
  const body = sql.slice(sql.indexOf('node_creature_roster'));

  it('is STABLE, SECURITY DEFINER with a fixed search_path', () => {
    expect(body).toMatch(/\bSTABLE\b/i);
    expect(body).toMatch(/SECURITY DEFINER/i);
    expect(body).toMatch(/SET search_path = public/i);
  });

  it('performs no write of any kind', () => {
    const statements = body.replace(/--.*$/gm, '');
    for (const kw of ['INSERT INTO', 'UPDATE ', 'DELETE FROM', 'TRUNCATE', 'MERGE ', 'COPY ']) {
      expect(statements.toUpperCase()).not.toContain(kw);
    }
  });

  it('never calls an authority or encounter-creating routine', () => {
    for (const fn of [
      'encounter_for_node', 'encounter_ensure_for', 'encounter_intake',
      'commit_encounter_tick', 'encounter_engage', 'claim_encounter_tick',
      'award_', 'grant_', 'apply_',
    ]) {
      expect(body).not.toContain(fn);
    }
  });

  it('verifies ownership and resolves the node server-side', () => {
    expect(body).toContain('auth.uid()');
    expect(body).toContain('current_node_id');
    // No node argument may exist — an arbitrary node can never be actionable.
    expect(body).toMatch(/node_creature_roster\(_character_id uuid\)/);
  });

  it('excludes dead creatures from the roster', () => {
    expect(body).toMatch(/is_alive = true/);
  });

  it('grants execute to authenticated and service_role but not anon', () => {
    expect(body).toMatch(/GRANT EXECUTE ON FUNCTION public\.node_creature_roster\(uuid\) TO authenticated/i);
    expect(body).toMatch(/GRANT EXECUTE ON FUNCTION public\.node_creature_roster\(uuid\) TO service_role/i);
    expect(body).toMatch(/REVOKE ALL ON FUNCTION public\.node_creature_roster\(uuid\) FROM anon/i);
    expect(body).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.node_creature_roster\(uuid\) TO anon/i);
  });
});
