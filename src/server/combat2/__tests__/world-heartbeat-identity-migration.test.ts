import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const PATH = 'supabase/migrations/20260929130000_combat2_world_heartbeat_identity.sql';
const sql = readFileSync(PATH, 'utf8').replaceAll('\r\n', '\n');
const lower = sql.toLowerCase();
const schedulerFoundation = readFileSync('supabase/migrations/20260831133000_combat2_dispatch_scheduler_foundation.sql', 'utf8')
  .replaceAll('\r\n', '\n');
const predecessorStart = schedulerFoundation.indexOf('CREATE OR REPLACE FUNCTION public.combat2_dispatch_scheduler_fire()');
const predecessorEnd = schedulerFoundation.indexOf('REVOKE ALL ON FUNCTION public.combat2_dispatch_scheduler_fire()', predecessorStart);
const repositoryPredecessor = schedulerFoundation.slice(predecessorStart, predecessorEnd);

function splitSqlStatements(source: string): string[] {
  const statements: string[] = [];
  let start = 0;
  let index = 0;
  while (index < source.length) {
    if (source.startsWith('--', index)) {
      const newline = source.indexOf('\n', index + 2);
      index = newline < 0 ? source.length : newline + 1;
      continue;
    }
    if (source.startsWith('/*', index)) {
      const close = source.indexOf('*/', index + 2);
      if (close < 0) throw new Error('unclosed SQL block comment');
      index = close + 2;
      continue;
    }
    const quote = source[index];
    if (quote === "'" || quote === '"') {
      index++;
      while (index < source.length) {
        if (source[index] === quote) {
          if (source[index + 1] === quote) {
            index += 2;
            continue;
          }
          index++;
          break;
        }
        index++;
      }
      continue;
    }
    if (quote === '$') {
      const delimiter = source.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/)?.[0];
      if (delimiter) {
        const close = source.indexOf(delimiter, index + delimiter.length);
        if (close < 0) throw new Error(`unclosed SQL dollar quote ${delimiter}`);
        index = close + delimiter.length;
        continue;
      }
    }
    if (quote === ';') {
      statements.push(source.slice(start, index + 1).trim());
      start = index + 1;
    }
    index++;
  }
  if (source.slice(start).trim()) throw new Error('trailing incomplete SQL statement');
  return statements.filter(Boolean);
}

const executableStatements = splitSqlStatements(sql);
const httpBodyPattern = /(net\.http_post\s*\([^;]*)(body\s*:=\s*'\{\}'::jsonb)(\s*,\s*timeout_milliseconds\s*:=)/gs;

function patchHeartbeatBody(definition: string): string {
  const matches = [...definition.matchAll(httpBodyPattern)];
  if (matches.length !== 1) throw new Error(`expected one HTTP body assignment, found ${matches.length}`);
  return definition.replace(httpBodyPattern, (_match, prefix: string, _assignment: string, suffix: string) =>
    `${prefix}body := jsonb_build_object('heartbeat_id', heartbeat_id)${suffix}`);
}

describe('ENG-HB-001 world heartbeat identity migration', () => {
  it('guards the installed scheduler, settlement and diagnostic predecessors', () => {
    for (const marker of [
      "'public.combat2_dispatch_scheduler_fire()'::regprocedure",
      "'public.combat2_dispatch_scheduler_fire_without_resource_settlement()'::regprocedure",
      "'public.settle_out_of_combat_resources(timestamptz)'::regprocedure",
      "'public.combat2_diagnostic_record_server_events(uuid,jsonb)'",
      "r.rolname='postgres'", "p.prosecdef", "p.provolatile='v'",
      "search_path=public, pg_temp", "search_path=public, cron, net, vault, pg_temp",
      "search_path=public, cron, pg_temp", 'has_function_privilege',
      "attname='elapsed_ms' AND atttypid='numeric'::regtype", 'diagnostic column contract drift',
    ]) expect(sql).toContain(marker);
    expect(sql).toContain("wrapper_definition !~ 'settle_out_of_combat_resources[[:space:]]*");
    expect(sql).toContain("SELECT count(*) INTO http_body_matches FROM regexp_matches");
    expect(sql).not.toContain("replace(definition,'body := ''{}''::jsonb'");
  });

  it.each([
    ["compact", "body:='{}'::jsonb"],
    ['spaced', "body := '{}'::jsonb"],
    ['tabs and newlines', "body\t:=\n  '{}'::jsonb"],
  ])('matches and patches the real repository HTTP predecessor with %s assignment', (_label, assignment) => {
    const fixture = repositoryPredecessor.replace("body := '{}'::jsonb", assignment);
    const patched = patchHeartbeatBody(fixture);
    expect(patched).toContain("body := jsonb_build_object('heartbeat_id', heartbeat_id)");
    expect(patched).toContain("url := 'https://gpclaklkaolyzfnooajt.supabase.co/functions/v1/combat2-dispatch-once'");
    expect(patched).toContain('timeout_milliseconds := 12000');
  });

  it('fails closed for zero, multiple, or unexpected HTTP body contracts', () => {
    expect(() => patchHeartbeatBody(repositoryPredecessor.replace("'{}'::jsonb", "jsonb_build_object('other', true)")))
      .toThrow('found 0');
    expect(() => patchHeartbeatBody(`${repositoryPredecessor}\n${repositoryPredecessor}`)).toThrow('found 2');
    expect(() => patchHeartbeatBody(repositoryPredecessor.replace("'{}'::jsonb", "'{\"unexpected\":true}'::jsonb")))
      .toThrow('found 0');
  });

  it('preserves quoted text and unrelated assignments while patching only the HTTP body argument', () => {
    const prefix = "PERFORM 'body := ''{}''::jsonb';\nunrelated := '{}'::jsonb;\n";
    const patched = patchHeartbeatBody(prefix + repositoryPredecessor);
    expect(patched.startsWith(prefix)).toBe(true);
    expect(patched.match(/jsonb_build_object\('heartbeat_id'/g)).toHaveLength(1);
  });

  it('creates one monotonic bigint identity and a bounded scalar-only run record', () => {
    expect(sql).toContain('heartbeat_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY');
    expect(sql).toContain('CREATE INDEX world_heartbeat_run_started_at_idx');
    for (const field of ['scheduler_eligible','scheduler_classification','settlement_kind','settlement_bucket',
      'settlement_steps','dispatch_classification','candidate_count','processed_count','more_may_remain']) {
      expect(sql).toContain(field);
    }
    for (const forbidden of ['character_id','claim_token','request_id uuid','payload json','snapshot','credential','secret text']) {
      const table = sql.slice(sql.indexOf('CREATE TABLE public.world_heartbeat_run'), sql.indexOf('CREATE INDEX world_heartbeat_run_started_at_idx'));
      expect(table.toLowerCase()).not.toContain(forbidden);
    }
  });

  it('allocates before eligibility outcomes and preserves settlement/dispatch failure isolation', () => {
    const wrapper = sql.slice(sql.indexOf('CREATE FUNCTION public.combat2_dispatch_scheduler_fire()'),
      sql.indexOf('REVOKE ALL ON FUNCTION public.combat2_dispatch_scheduler_fire()'));
    expect(wrapper.indexOf('INSERT INTO public.world_heartbeat_run')).toBeLessThan(wrapper.indexOf('settle_out_of_combat_resources'));
    expect(wrapper).toContain('public.combat2_dispatch_scheduler_eligible()');
    expect(wrapper).toMatch(/BEGIN\s+settlement:=public\.settle_out_of_combat_resources[\s\S]*EXCEPTION WHEN OTHERS THEN[\s\S]*settlement_error/);
    expect(wrapper).toMatch(/BEGIN\s+dispatch:=public\.combat2_dispatch_scheduler_fire_without_resource_settlement[\s\S]*EXCEPTION WHEN OTHERS THEN[\s\S]*scheduler_error/);
    expect(wrapper).toContain("'heartbeat_id',heartbeat.heartbeat_id");
    expect(wrapper).not.toContain('SQLERRM');
  });

  it('retains 24 hours with indexed bounded cleanup and no second scheduler', () => {
    expect(sql).toContain("started_at<clock_timestamp()-interval '24 hours'");
    expect(sql).toContain('ORDER BY started_at,heartbeat_id LIMIT 2048');
    expect(sql).toContain('cleanup_deleted BETWEEN 0 AND 2048');
    expect(lower).not.toContain('cron.schedule(');
    expect(lower).not.toContain('create extension');
  });

  it('keeps browser and Realtime access closed and exposes only server functions', () => {
    expect(sql).toContain('ALTER TABLE public.world_heartbeat_run ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('REVOKE ALL ON TABLE public.world_heartbeat_run FROM PUBLIC,anon,authenticated');
    expect(sql).not.toContain('supabase_realtime');
    for (const signature of [
      'public.combat2_heartbeat_record_dispatch(bigint,text,integer,integer,boolean)',
      'public.combat2_diagnostic_record_server_event_with_heartbeat(uuid,text,uuid,uuid,uuid,uuid,bigint,text,numeric,bigint)',
    ]) {
      expect(sql).toContain(`REVOKE ALL ON FUNCTION ${signature}`);
      expect(sql).toContain(`GRANT EXECUTE ON FUNCTION ${signature}`);
    }
  });

  it('correlates diagnostics while keeping encounter tick and heartbeat distinct', () => {
    expect(sql).toContain('ALTER TABLE public.combat2_diagnostic_server_event\n  ADD COLUMN heartbeat_id bigint');
    expect(sql).toContain("event->>'heartbeat_id'");
    expect(sql).toContain("NULLIF(event->>'tick','')::bigint");
    expect(sql).not.toMatch(/SET\s+(tick|claimed_tick)\s*=\s*heartbeat/i);
  });

  it('passes the identity to Edge without changing immediate movement or entry functions', () => {
    expect(sql).toContain("body := jsonb_build_object(''heartbeat_id''");
    expect(sql).toContain("set_config('app.combat2_heartbeat_id'");
    expect(lower).not.toMatch(/create (or replace )?function public\.(combat2_depart|combat2_party_depart|combat_enter|combat2_hostile_action)\s*\(/);
  });

  it('contains complete runner-compatible statements and no embedded transaction control', () => {
    expect(executableStatements.at(-1)).toContain('TO service_role;');
    expect(executableStatements.some((statement) => /^(BEGIN|COMMIT|ROLLBACK)\s*;$/i.test(statement))).toBe(false);
    const doBlocks = executableStatements.filter((statement) => /^(?:--[^\n]*\n\s*)*DO\s+\$\$/i.test(statement));
    expect(doBlocks).toHaveLength(2);
    expect(doBlocks.every((statement) => statement.endsWith('$$;'))).toBe(true);
    expect(executableStatements.every((statement) => statement.endsWith(';'))).toBe(true);
  });
});
