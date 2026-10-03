import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

const path = 'supabase/migrations/20261002190000_combat2_legacy_browser_privileges.sql';
const sql = readFileSync(path, 'utf8');
const audit = readFileSync('docs/design/combat2-legacy-sql-dependency-audit.md', 'utf8');
const root = 'supabase/migrations/';
const transport = readFileSync(root + '20260817212703_b721c8fc-a5d5-408a-8115-7223a5c1d207.sql', 'utf8');
const targets = [
  ['effects_catchup_send(uuid,uuid,bigint,uuid,integer)', 'bigint', 'ecea10b2', transport],
  ['effects_catchup_dispatch_one(uuid)', 'jsonb', '6aabce3e', transport],
  ['effects_catchup_reconcile(integer)', 'jsonb', '867305d4', readFileSync(root + '20260817212608_470e95d2-884c-4573-95c1-6b65332a9759.sql', 'utf8')],
  ['effects_catchup_credential_health()', 'jsonb', 'b9fc05d8', readFileSync(root + '20260817212455_753a515d-7db2-4bba-91d7-2e35066a40f5.sql', 'utf8')],
  ['clear_stances(uuid)', 'jsonb', 'b45bbfa4', readFileSync(root + '20260624221925_7a898099-a992-4cc6-b304-90686f95c5c6.sql', 'utf8')],
] as const;

// Same lexer boundaries used by the existing schedule-drift migration test.
// This proves complete statements, not PL/pgSQL compilation or effective ACLs.
function statements(source: string) {
  const result: string[] = [];
  let start = 0;
  for (let i = 0; i < source.length;) {
    if (source.startsWith('--', i)) {
      const end = source.indexOf('\n', i + 2);
      i = end < 0 ? source.length : end + 1; continue;
    }
    if (source[i] === "'" || source[i] === '"') {
      const quote = source[i++]; let closed = false;
      while (i < source.length) {
        if (source[i++] === quote) {
          if (source[i] === quote) { i++; continue; }
          closed = true; break;
        }
      }
      if (!closed) throw new Error('unclosed literal');
      continue;
    }
    const dollar = source.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)?.[0];
    if (dollar) {
      const end = source.indexOf(dollar, i + dollar.length);
      if (end < 0) throw new Error('unclosed dollar quote');
      i = end + dollar.length; continue;
    }
    if (source[i++] === ';') { result.push(source.slice(start, i)); start = i; }
  }
  if (source.slice(start).trim()) throw new Error('incomplete statement');
  return result;
}

describe('legacy browser ACL batch C source contracts (not PostgreSQL execution)', () => {
  it.each(targets)('targets only the actual predecessor %s and its reported drift marker', (signature, result, prefix, predecessor) => {
    const name = signature.split('(')[0];
    const declaration = predecessor.slice(predecessor.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`));
    const header = declaration.slice(0, declaration.indexOf('AS '));
    expect(header).toContain(`RETURNS ${result}`);
    expect(header).toMatch(/LANGUAGE plpgsql/i);
    expect(header).toContain('SECURITY DEFINER');
    expect(header).toMatch(/SET search_path (?:TO 'public'|= public)/);
    expect(audit).toContain(`\`${signature}\``);
    expect(audit).toContain(prefix);
    expect(sql).toContain(`('public.${signature}', '${name}', '${result}', '${prefix}')`);
    expect(sql).toContain(`REVOKE EXECUTE ON FUNCTION public.${signature} FROM PUBLIC,anon,authenticated;`);
  });
  it('completes every missing/overload/definition/security/role guard before changing privileges', () => {
    const preflight = sql.slice(0, sql.indexOf('  REVOKE EXECUTE'));
    for (const guard of ['missing predecessor', 'unexpected overload', 'predecessor definition/metadata drift',
      'required role missing', 'required internal access missing', 'inherited browser access needs separate decision']) {
      expect(preflight).toContain(`RAISE EXCEPTION 'ENG-LEGACY-002 ${guard}`);
    }
    for (const metadata of ['to_regprocedure(spec.signature)', "p.proowner = 'postgres'::regrole", 'p.prosecdef',
      "p.prokind = 'f'", "p.provolatile = 'v'", "lanname = 'plpgsql'", 'p.prorettype = spec.result_type::regtype',
      "p.proconfig = ARRAY['search_path=public']", 'left(md5(pg_get_functiondef(p.oid)), 8)']) expect(preflight).toContain(metadata);
    expect(sql.match(/REVOKE EXECUTE ON FUNCTION/g)).toHaveLength(5);
  });
  it('observes schedule absence without unsupported locking or claiming concurrent exclusion', () => {
    expect(sql).toContain("to_regclass('cron.job') IS NULL");
    expect(sql).toContain('incomplete schedule visibility under RLS');
    expect(sql).toContain('r.rolbypassrls');
    expect(sql).not.toMatch(/LOCK\s+TABLE|pg_(?:try_)?advisory/i);
    expect(sql).toContain('Read-only installation precondition, not a concurrent-creation fence.');
    expect(sql).toContain('Owner-rights internal calls can still rearm schedules after this observation.');
    expect(audit).toContain('does not prevent concurrent schedule creation');
    expect(sql).toContain("jobname = 'effects-catchup'");
    expect(sql).toContain("IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'effects-catchup'");
    expect(sql).toContain("OR command ~* '\\m(effects_due_dispatch|effects_catchup_send|effects_catchup_dispatch_one|effects_catchup_reconcile|schedule_effects_catchup)\\M'");
    expect(sql).toContain('effects-catchup schedule exists');
    expect(sql.indexOf('effects-catchup schedule exists')).toBeLessThan(sql.indexOf('  REVOKE EXECUTE'));
    expect(sql).not.toMatch(/cron\.(?:schedule|unschedule)\s*\(/);
  });
  it('checks effective denial, possible inherited/SET ROLE paths and preserves ALL non-browser grants', () => {
    for (const marker of ["'anon', 'authenticated'", "pg_has_role(browser_role, a.grantee, 'USAGE')",
      "pg_has_role(browser_role, a.grantee, 'MEMBER')", "pg_has_role(browser_role, 'postgres', 'MEMBER')",
      'r.rolsuper', "has_function_privilege(browser_role, fn, 'EXECUTE')",
      "has_function_privilege('postgres', fn, 'EXECUTE')", "has_function_privilege('service_role', fn, 'EXECUTE')",
      "a.grantee = 0 AND a.privilege_type = 'EXECUTE'", 'PUBLIC denial failed', 'internal access lost',
      'to_jsonb(a) ORDER BY a.grantee, a.grantor, a.is_grantable']) expect(sql).toContain(marker);
    expect(sql).not.toMatch(/(?:GRANT|REVOKE)\s+[^;]*\b(?:supabase_read_only_user|supabase_admin)\b/i);
    expect(sql).not.toMatch(/^\s*(?:GRANT|REVOKE)\s+[^;]*\bROLE\b/im);
  });
  it('verifies unchanged full definitions/catalogue metadata/internal ACLs and never invokes or alters retained dependencies', () => {
    expect(sql).toContain("'catalogue', to_jsonb(p) - 'proacl'");
    expect(sql).toContain("'definition', pg_get_functiondef(p.oid)");
    expect(sql).toContain('current_state IS DISTINCT FROM saved');
    expect(sql).toContain('target set changed during revocation');
    expect(sql).not.toMatch(/CREATE(?: OR REPLACE)? FUNCTION|ALTER FUNCTION|DROP|INSERT INTO|UPDATE public\.|DELETE FROM|PERFORM public\./i);
    for (const retained of ['wake_world', 'world_watchdog', 'node_tick_commit', 'settle_out_of_combat_resources',
      'damage_party_member', 'heal_party_member', 'sync_character_resources']) expect(sql).not.toContain(retained);
    expect(sql).not.toContain('EXCEPTION WHEN');
  });
  it('contains one complete atomic runner-compatible statement, with inline assertions and no trailing postflight', () => {
    expect(statements(sql)).toHaveLength(1);
    expect(sql.trimEnd()).toMatch(/END;\s*\$\$;$/);
    expect(sql).not.toMatch(/^\s*(?:BEGIN|COMMIT)\s*;/m);
    expect(() => statements(sql.slice(0, -4))).toThrow();
    expect(() => statements("DO $$ BEGIN RAISE NOTICE 'text;'; END; $$;")).not.toThrow();
    expect(() => statements("SELECT 'unfinished")).toThrow();
  });
  it('separates reported installation from unreconciled database history and preserves rejected evidence', () => {
    const state = JSON.parse(readFileSync('docs/operations/project-state.json', 'utf8'));
    const observed = state.volatile_runtime_observations.find((row: { identity: string }) => row.identity === 'ENG-LEGACY-002 installed SQL dependency audit');
    expect(observed).toMatchObject({ status: 'unknown', timestamp: '2026-10-02T18:14:37Z',
      evidence_type: 'operator_reported', directly_verified: false });
    expect(observed.reporting_actor).toContain('Lovable');
    const candidate = state.database_migrations.find((row: { identity: string }) => row.identity === path.split('/').at(-1));
    expect(candidate).toMatchObject({ status: 'installed', evidence_type: 'operator_reported', directly_verified: false });
    expect(candidate.reporting_actor).toContain('Lovable');
    for (const fact of ['rollback-only', 'restored original ACLs', 'browser execution denied',
      'non-browser grants retained', 'bodies and security metadata unchanged', '510', '20261001230000',
      'database journal unverified', 'history unreconciled']) expect(candidate.evidence).toContain(fact);
    const rejected = state.known_blockers.find((row: { identity: string }) => row.identity === 'eng-legacy-002-batch-c-cron-lock-permission');
    expect(rejected.evidence).toContain('42501');
    const history = state.known_blockers.find((row: { identity: string }) => row.identity === 'eng-legacy-002-batch-c-history-reconciliation');
    expect(history).toMatchObject({ status: 'blocked', directly_verified: false });
    expect(history.evidence).toContain('before the next migration');
    expect(audit).toContain('1fc1314088a3b48184c354f568046abadfc795c50f15c5a753f01088affb762f');
    expect(state.combat2_operational_work.find((row: { identity: string }) => row.identity === 'combat2-browser-legacy-isolation-batch-b-2026-10-02').status)
      .toBe('ready_for_manual_publish');
  });
  it('verifies unchanged source/artifact Git blobs and local journal without claiming a database journal', () => {
    const artifact = 'drizzle/migrations/0000_combat2_legacy_browser_privileges.sql';
    const blob = (file: string) => execFileSync('git', ['show', `HEAD:${file}`]);
    const source = blob(path);
    expect(source.equals(blob(artifact))).toBe(true);
    const hash = createHash('sha256').update(source).digest('hex');
    expect(hash).toBe('73df81b17ee54a0294e231d2f91a70ecc3a9da37508c027f00674d8181b92b65');
    const state = JSON.parse(readFileSync('docs/operations/project-state.json', 'utf8'));
    expect(state.database_migrations.find((row: { identity: string }) => row.identity === path.split('/').at(-1)).evidence).toContain(hash);
    const journal = JSON.parse(readFileSync('drizzle/migrations/meta/_journal.json', 'utf8'));
    expect(journal.entries.filter((row: { tag: string }) => row.tag === '0000_combat2_legacy_browser_privileges')).toHaveLength(1);
    expect(audit).toContain('Local file journal is not database journal proof');
  });
});
