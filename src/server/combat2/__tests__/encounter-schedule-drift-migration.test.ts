import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const PATH = 'supabase/migrations/20260930130000_combat2_encounter_schedule_drift.sql';
const sql = readFileSync(PATH, 'utf8').replaceAll('\r\n', '\n');
const base = readFileSync(
  'supabase/migrations/20260829135558_f0037825-ccff-4b35-b0b2-aa6566be826c.sql',
  'utf8',
).replaceAll('\r\n', '\n');
const start = base.indexOf('CREATE OR REPLACE FUNCTION public.node_tick_commit(');
const end = base.indexOf('REVOKE ALL ON FUNCTION public.node_tick_commit(', start);
const repositoryPredecessor = base.slice(start, end)
  .replace('public.node_tick_commit(', 'public.node_tick_commit_without_bounded_failure(')
  .replace("value->'stat_override' stat_override", "NULLIF(value->'stat_override','null'::jsonb) stat_override");

const assignmentPattern = /(claim_expires_at\s*=\s*NULL\s*,\s*)next_due_at\s*=\s*greatest\s*\(\s*now\s*\(\s*\)\s*,\s*next_due_at\s*\)\s*\+\s*interval\s*'2 seconds'(\s*,\s*status\s*=\s*COALESCE)/gs;
const replacement = `next_due_at = next_due_at
         + (floor(greatest(0::numeric, extract(epoch from (now() - next_due_at))) / 2)::bigint + 1)
           * interval '2 seconds'`;

function patchDefinition(definition: string): string {
  const matches = [...definition.matchAll(assignmentPattern)];
  if (matches.length !== 1) throw new Error(`expected one due assignment, found ${matches.length}`);
  return definition.replace(assignmentPattern, (_all, before: string, after: string) =>
    `${before}${replacement}${after}`);
}

function oldNextDue(previousDue: number, commitTransactionStart: number): number {
  return Math.max(previousDue, commitTransactionStart) + 2;
}

function correctedNextDue(previousDue: number, commitTransactionStart: number): number {
  const obsoleteIntervals = Math.floor(Math.max(0, commitTransactionStart - previousDue) / 2);
  return previousDue + (obsoleteIntervals + 1) * 2;
}

function committedFires(nextDue: (due: number, commitAt: number) => number): number[] {
  const fires = [4.095, 6.111, 8.127, 10.143, 12.158, 14.173];
  let due = 4;
  const committed: number[] = [];
  for (const fire of fires) {
    if (fire < due) continue;
    committed.push(fire);
    due = nextDue(due, fire + 0.45);
  }
  return committed;
}

function splitSqlStatements(source: string): string[] {
  const statements: string[] = [];
  let startAt = 0;
  for (let i = 0; i < source.length;) {
    if (source.startsWith('--', i)) {
      const newline = source.indexOf('\n', i + 2);
      i = newline < 0 ? source.length : newline + 1;
      continue;
    }
    const quote = source[i];
    if (quote === "'" || quote === '"') {
      i++;
      while (i < source.length) {
        if (source[i] === quote) {
          if (source[i + 1] === quote) { i += 2; continue; }
          i++; break;
        }
        i++;
      }
      continue;
    }
    if (quote === '$') {
      const delimiter = source.slice(i).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/)?.[0];
      if (delimiter) {
        const close = source.indexOf(delimiter, i + delimiter.length);
        if (close < 0) throw new Error(`unclosed SQL dollar quote ${delimiter}`);
        i = close + delimiter.length;
        continue;
      }
    }
    if (quote === ';') {
      statements.push(source.slice(startAt, i + 1).trim());
      startAt = i + 1;
    }
    i++;
  }
  if (source.slice(startAt).trim()) throw new Error('trailing incomplete SQL statement');
  return statements.filter(Boolean);
}

describe('Combat2 two-second encounter schedule drift correction', () => {
  it('reproduces alternating-heartbeat drift and supports consecutive fires after correction', () => {
    expect(committedFires(oldNextDue)).toEqual([4.095, 8.127, 12.158]);
    expect(committedFires(correctedNextDue)).toEqual([4.095, 6.111, 8.127, 10.143, 12.158, 14.173]);
  });

  it('preserves the prior phase across varied latency without cumulative drift', () => {
    expect(correctedNextDue(4, 4.01)).toBe(6);
    expect(correctedNextDue(6, 6.49)).toBe(8);
    expect(correctedNextDue(8, 9.99)).toBe(10);
    expect(correctedNextDue(10, 10.2)).toBe(12);
  });

  it('skips obsolete opportunities after a delay instead of creating combat debt', () => {
    expect(correctedNextDue(4, 9.5)).toBe(10);
    expect(correctedNextDue(4, 10)).toBe(12);
  });

  it('patches exactly the actual inner commit predecessor and preserves its fences', () => {
    const patched = patchDefinition(repositoryPredecessor);
    expect(patched).toContain(replacement);
    for (const preserved of [
      'SELECT * INTO e FROM public.node_encounter WHERE id = _encounter_id FOR UPDATE',
      'e.claim_token IS DISTINCT FROM _claim_token',
      'e.claim_expires_at <= now()',
      'e.tick IS DISTINCT FROM _expected_last_tick',
      'e.state_version IS DISTINCT FROM _expected_state_version',
      "SET status = 'consumed'",
      'tick             = _candidate_tick',
    ]) expect(patched).toContain(preserved);
    expect(patched).not.toContain("next_due_at      = greatest(now(), next_due_at) + interval '2 seconds'");
  });

  it('tolerates insignificant assignment whitespace but fails closed on zero or multiple matches', () => {
    const compact = repositoryPredecessor.replace(
      "next_due_at      = greatest(now(), next_due_at) + interval '2 seconds'",
      "next_due_at=greatest ( now ( ), next_due_at )+interval '2 seconds'",
    );
    expect(patchDefinition(compact)).toContain(replacement);
    expect(() => patchDefinition(repositoryPredecessor.replace("interval '2 seconds'", "interval '3 seconds'")))
      .toThrow('found 0');
    expect(() => patchDefinition(`${repositoryPredecessor}\n${repositoryPredecessor}`)).toThrow('found 2');
  });

  it('targets only the inner function and leaves wrappers, entry, resolver timing and Test Arena shared', () => {
    expect(sql).toContain('node_tick_commit_without_bounded_failure(uuid,uuid,integer,integer,bigint,uuid[],jsonb)');
    expect(sql).not.toMatch(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.(node_tick_commit|node_tick_claim|combat2_due_nodes)\s*\(/i);
    expect(sql).not.toMatch(/combat_enter|combat2_depart|combat2_party_depart|candidate_tick\s*%\s*2|cooldown_ticks|windup_ticks/);
    expect(sql).not.toMatch(/test_arena_id|combat2_test_/);
  });

  it('retains authority and schema guards and is runner-compatible', () => {
    for (const marker of [
      "owner_name <> 'postgres'", 'NOT security_definer', "volatility <> 'v'",
      "settings IS DISTINCT FROM ARRAY['search_path=public']::text[]",
      "column_name = 'next_due_at'", "data_type = 'timestamp with time zone'",
      "has_function_privilege(\n       'service_role'", "has_function_privilege(\n       'authenticated'",
      'p.proacl IS NOT DISTINCT FROM acl', 'p.proowner = owner_oid',
    ]) expect(sql).toContain(marker);
    const statements = splitSqlStatements(sql);
    expect(statements).toHaveLength(2);
    expect(statements.every(statement => statement.endsWith(';'))).toBe(true);
    expect(statements.some(statement => /^(BEGIN|COMMIT|ROLLBACK)\s*;$/i.test(statement))).toBe(false);
    expect(statements[0]).toMatch(/^--[\s\S]*DO \$migration\$/);
    expect(statements[1]).toMatch(/^COMMENT ON FUNCTION/);
  });
});
