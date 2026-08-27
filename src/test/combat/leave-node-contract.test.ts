/**
 * Static contract guard for the authoritative departure surface.
 *
 * A live-database privilege matrix still has to run in the maintenance window;
 * this pins the properties that must not silently regress in the repository:
 * departure is server-only (no client-callable RPC at all), definer + fixed
 * search_path, advisory locking, writes scoped to the node being LEFT, a
 * trigger on the node change itself, participation generations rotated from
 * reconciled state rather than elapsed time, and a tick/spawn-fenced telegraph
 * recovery boundary.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const PENDING =
  'supabase/pending/20260827_bosscast_lifecycle_prerelease_corrections.sql';
const sql = readFileSync(PENDING, 'utf8');

describe('encounter departure — security contract', () => {
  it('every departure function is SECURITY DEFINER with a fixed search_path', () => {
    const fns = sql.split('CREATE OR REPLACE FUNCTION').slice(1);
    const relevant = fns.filter((f) =>
      /encounter_end_participation|characters_end_participation_on_node_change/.test(
        f.split('\n')[0],
      ),
    );
    expect(relevant).toHaveLength(2);
    for (const f of relevant) {
      expect(f).toMatch(/SECURITY DEFINER/);
      expect(f).toMatch(/SET search_path TO 'public'/);
    }
  });

  it('removes the client departure path entirely', () => {
    expect(sql).toContain(
      'DROP FUNCTION IF EXISTS public.encounter_leave_node(uuid, uuid);',
    );
    // No grant may resurrect a client-callable departure surface.
    expect(sql).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.encounter_leave_node/,
    );
  });

  it('the internal implementation is service_role only, never PUBLIC or anon', () => {
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.encounter_end_participation(uuid, uuid) FROM PUBLIC',
    );
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.encounter_end_participation(uuid, uuid) TO service_role',
    );
    expect(sql).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.encounter_end_participation\(uuid, uuid\) TO (anon|authenticated|PUBLIC)/,
    );
  });

  it('scopes every write to the encounter of the node being left, and to that character', () => {
    const body = sql.slice(
      sql.indexOf('encounter_end_participation(_character_id uuid'),
      sql.indexOf('REVOKE ALL ON FUNCTION public.encounter_end_participation'),
    );
    expect(body).toMatch(/FROM public\.encounters e\s*\n\s*WHERE e\.node_id = _node_id/);
    for (const table of [
      'public.encounter_engagements',
      'public.encounter_participants',
    ]) {
      const stmt = body.slice(body.indexOf(`DELETE FROM ${table}`));
      expect(stmt.slice(0, 200)).toMatch(
        /WHERE encounter_id = v_enc AND character_id = _character_id/,
      );
    }
    expect(body).toMatch(/UPDATE public\.combat_actions[\s\S]*?character_id = _character_id[\s\S]*?encounter_id = v_enc/);
  });

  it('serialises against intake with the encounter advisory lock', () => {
    expect(sql).toContain('PERFORM pg_advisory_xact_lock(public.encounter_lock_key(v_enc));');
  });

  it('arms the effects catch-up for the node that was left', () => {
    expect(sql).toContain('PERFORM public.arm_effects_catchup_for_node(_node_id);');
  });

  it('departure is server-authoritative: a trigger fires on the node change itself', () => {
    expect(sql).toMatch(
      /CREATE TRIGGER trg_characters_node_change_participation\s*\nAFTER UPDATE OF current_node_id ON public\.characters/,
    );
    expect(sql).toMatch(
      /WHEN \(OLD\.current_node_id IS DISTINCT FROM NEW\.current_node_id/,
    );
    expect(sql).toContain('PERFORM public.encounter_end_participation(OLD.id, OLD.current_node_id);');
  });

  it('rotates the participation generation from reconciled state, never from elapsed time', () => {
    expect(sql).toContain(
      'ALTER TABLE public.encounter_participants\n  ADD COLUMN IF NOT EXISTS node_id uuid',
    );
    expect(sql).toContain(
      "WHEN ep.encounter_id IS DISTINCT FROM EXCLUDED.encounter_id\n             OR ep.node_id IS DISTINCT FROM EXCLUDED.node_id\n             THEN nextval('public.encounter_participation_generation_seq')",
    );
    // No time-based guessing anywhere in intake's generation decision.
    const intake = sql.slice(
      sql.indexOf('FUNCTION public.encounter_intake('),
      sql.indexOf('-- 3. Tick-authoritative'),
    );
    expect(intake).not.toMatch(/interval '\d+ seconds'/);
  });

  it('the durable recovery boundary is in ticks and fenced by spawn_seq', () => {
    expect(sql).toContain("'castReadyTick', COALESCE((");
    expect(sql).toContain("(ce.payload #>> '{config,readyTick}')::bigint");
    expect(sql).toContain(
      "COALESCE((ce.payload #>> '{config,casterSpawnSeq}')::bigint, -1)\n                = COALESCE(cr.spawn_seq, 0)",
    );
    // Wall-clock death fencing is gone.
    expect(sql).not.toContain('AND ce.started_at >= COALESCE(cr.died_at, ce.started_at)');
  });

  it('closes unresolved legacy casts that lack the authoritative contract', () => {
    expect(sql).toMatch(
      /UPDATE public\.encounter_cast_events[\s\S]*?WHERE resolved_at IS NULL[\s\S]*?config,casterSpawnSeq\}'\) IS NULL/,
    );
    expect(sql).toContain("'outcomeReason', 'legacy_no_contract'");
  });
});
