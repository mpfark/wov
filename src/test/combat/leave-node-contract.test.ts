/**
 * Static contract guard for the authoritative departure surface.
 *
 * A live-database privilege matrix still has to run in the maintenance window;
 * this pins the properties that must not silently regress in the repository:
 * definer + fixed search_path, an explicit ownership/privilege gate, no PUBLIC
 * or anon execute, advisory locking, scoping to the node being LEFT, and a
 * server-side trigger so no browser callback is load bearing.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const PENDING =
  'supabase/pending/20260827_bosscast_lifecycle_prerelease_corrections.sql';
const sql = readFileSync(PENDING, 'utf8');

describe('encounter_leave_node / encounter_end_participation — security contract', () => {
  it('both functions are SECURITY DEFINER with a fixed search_path', () => {
    const fns = sql.split('CREATE OR REPLACE FUNCTION').slice(1);
    const relevant = fns.filter((f) =>
      /encounter_leave_node|encounter_end_participation|characters_end_participation_on_node_change/.test(
        f.split('\n')[0],
      ),
    );
    expect(relevant).toHaveLength(3);
    for (const f of relevant) {
      expect(f).toMatch(/SECURITY DEFINER/);
      expect(f).toMatch(/SET search_path TO 'public'/);
    }
  });

  it('rejects a non-owner and an unauthenticated non-service caller', () => {
    expect(sql).toMatch(/IF NOT public\.owns_character\(_character_id\) THEN\s*\n\s*RAISE EXCEPTION 'not your character'/);
    expect(sql).toMatch(/ELSIF COALESCE\(auth\.role\(\), current_user\) <> 'service_role' THEN\s*\n\s*RAISE EXCEPTION 'not authorized'/);
  });

  it('grants execute only to authenticated and service_role, never PUBLIC or anon', () => {
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.encounter_leave_node(uuid, uuid) FROM PUBLIC',
    );
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.encounter_leave_node(uuid, uuid) TO authenticated',
    );
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.encounter_leave_node(uuid, uuid) TO service_role',
    );
    expect(sql).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.encounter_(leave_node|end_participation)\(uuid, uuid\) TO (anon|PUBLIC)/);
    // The internal implementation is not client-callable at all.
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.encounter_end_participation(uuid, uuid) FROM PUBLIC',
    );
    expect(sql).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.encounter_end_participation\(uuid, uuid\) TO authenticated/,
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

  it('intake rotates the participation generation for a stale row', () => {
    expect(sql).toContain("WHEN ep.last_action_at < now() - interval '3 seconds'");
    expect(sql).toContain(
      "WHEN ep.encounter_id IS DISTINCT FROM EXCLUDED.encounter_id\n             THEN nextval('public.encounter_participation_generation_seq')",
    );
  });

  it('the durable recovery boundary is fenced to the live spawn', () => {
    expect(sql).toContain('AND ce.started_at >= COALESCE(cr.died_at, ce.started_at)');
  });

  it('closes unresolved legacy casts instead of resolving them by timestamp', () => {
    expect(sql).toMatch(
      /UPDATE public\.encounter_cast_events[\s\S]*?WHERE resolved_at IS NULL[\s\S]*?frozenRoster'\) IS NULL/,
    );
  });
});
