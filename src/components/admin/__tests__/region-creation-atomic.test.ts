import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createRegionRequestTracker, decodeRegionCreationResult } from '../region-creation-admin';

const SQL = readFileSync('supabase/migrations/20260915150000_admin_region_initial_node_creation.sql', 'utf8');
const MANAGER = readFileSync('src/components/admin/RegionManager.tsx', 'utf8');

describe('atomic region and optional initial-node creation', () => {
  it('derives browser identity and enforces established authority and safe function ACLs', () => {
    expect(SQL).toContain('caller uuid := auth.uid()');
    expect(SQL).toContain('public.is_steward_or_overlord()');
    expect(SQL).toContain('SECURITY DEFINER');
    expect(SQL).toContain('SET search_path = public, pg_temp');
    expect(SQL).toContain('REVOKE ALL ON FUNCTION public.admin_create_region_with_initial_node');
    expect(SQL).toContain('GRANT EXECUTE ON FUNCTION public.admin_create_region_with_initial_node');
  });

  it('isolates the durable request ledger from browser roles and realtime', () => {
    expect(SQL).toContain('ALTER TABLE public.admin_region_creation_request ENABLE ROW LEVEL SECURITY');
    expect(SQL).toContain('REVOKE ALL PRIVILEGES ON TABLE public.admin_region_creation_request FROM PUBLIC, anon, authenticated');
    expect(SQL).toContain('REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN');
    expect(SQL).not.toContain('supabase_realtime');
  });

  it('supports region-only and region-plus-one-node creation in one exception boundary', () => {
    const creationBlock = SQL.slice(SQL.indexOf('BEGIN\n      IF _create_initial_node'), SQL.indexOf('EXCEPTION\n      WHEN unique_violation'));
    expect(creationBlock).toContain('INSERT INTO public.regions');
    expect(creationBlock).toContain('IF _create_initial_node THEN');
    expect(creationBlock.match(/INSERT INTO public\.nodes/g)).toHaveLength(1);
    expect(creationBlock.indexOf('INSERT INTO public.regions')).toBeLessThan(creationBlock.indexOf('INSERT INTO public.nodes'));
  });

  it('validates names and levels before content inserts and records safe failures', () => {
    expect(SQL).toContain("clean_name IS NULL OR clean_name = '' OR length(clean_name) > 200");
    expect(SQL).toContain('_min_level < 1 OR _max_level < _min_level');
    expect(SQL).toContain("length(initial_node_name) > 200");
    expect(SQL).toContain("'kind', 'database_error'");
    expect(SQL.indexOf("'kind', 'invalid_request'")).toBeLessThan(SQL.indexOf('INSERT INTO public.regions'));
  });

  it('fingerprints all semantic inputs, serializes placement and handles replay/conflict', () => {
    for (const field of ['region_name', 'region_description', 'min_level', 'max_level', 'create_initial_node']) {
      expect(SQL).toContain(`prior.${field} IS DISTINCT FROM _${field}`);
    }
    expect(SQL).toContain("'kind', 'request_conflict'");
    expect(SQL).toContain("prior.result || jsonb_build_object('replayed', true)");
    expect(SQL.indexOf('FOR UPDATE;')).toBeLessThan(SQL.indexOf('pg_advisory_xact_lock'));
  });

  it('uses the established initial-node defaults and server-derived IDs and coordinates', () => {
    expect(SQL).toContain("initial_node_name := clean_name || ' Entrance'");
    expect(SQL).toContain('SELECT coalesce(max(x), 0)::bigint + 10 INTO initial_x FROM public.nodes');
    expect(SQL).toContain("VALUES (initial_node_name, '', new_region_id, '[]'::jsonb, initial_x::integer, 0)");
    const signature = SQL.slice(SQL.indexOf('CREATE OR REPLACE FUNCTION'), SQL.indexOf(') RETURNS jsonb'));
    expect(signature).not.toMatch(/_region_id|_initial_node_id|_initial_x|_initial_y/);
  });

  it('creates no area, connection, placement, discovery or gameplay side effects', () => {
    for (const table of ['areas', 'character_visited_nodes', 'creatures', 'npcs', 'node_encounter']) {
      expect(SQL).not.toContain(`INSERT INTO public.${table}`);
    }
    expect(SQL).not.toContain('UPDATE public.nodes');
    expect(SQL).not.toContain('jsonb_build_object(\'node_id\'');
  });

  it('routes the covered UI only through the RPC and fences duplicate or stale completion', () => {
    expect(MANAGER).toContain('submitRegionCreation({');
    expect(MANAGER).toContain('creationFence.current.tryAcquire()');
    expect(MANAGER).toContain('creationFence.current.release(operation)');
    expect(MANAGER).toContain('creationFence.current.invalidate()');
    expect(MANAGER).not.toContain("supabase.from('regions').insert");
    expect(MANAGER).not.toContain("supabase.from('nodes').insert");
    expect(MANAGER).not.toContain('updatedConns');
  });

  it('strictly decodes success and refusal outcomes', () => {
    expect(decodeRegionCreationResult({ ok: true, kind: 'created', region_id: 'r', initial_node_id: null, replayed: false })).not.toBeNull();
    expect(decodeRegionCreationResult({ ok: true, kind: 'created', region_id: 'r', initial_node_id: 'n', replayed: true })).not.toBeNull();
    expect(decodeRegionCreationResult({ ok: false, kind: 'request_conflict' })).not.toBeNull();
    expect(decodeRegionCreationResult({ ok: true, kind: 'created', region_id: 'r' })).toBeNull();
  });

  it('reuses the UUID only for an unresolved identical transport retry', () => {
    let sequence = 0;
    const tracker = createRegionRequestTracker(() => `request-${++sequence}`);
    const first = tracker.requestIdFor('same');
    expect(tracker.requestIdFor('same')).toBe(first);
    tracker.settle('same', true);
    expect(tracker.requestIdFor('same')).toBe(first);
    tracker.settle('same', false);
    expect(tracker.requestIdFor('same')).not.toBe(first);
    expect(tracker.requestIdFor('changed')).not.toBe(first);
  });
});
