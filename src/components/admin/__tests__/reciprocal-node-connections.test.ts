import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createConnectionRequestTracker, decodeConnectionMutationResult, directionalMetadata, findExactConnection } from '../node-connection-admin';

const SQL = readFileSync('supabase/migrations/20260915140000_admin_reciprocal_node_connections.sql', 'utf8');
const NODE = readFileSync('src/components/admin/NodeEditorPanel.tsx', 'utf8');
const MAP = readFileSync('src/components/admin/AdminWorldMapView.tsx', 'utf8');
const MANAGER = NODE.slice(NODE.indexOf('function ConnectionsManager'), NODE.indexOf('/* ─── AI Suggest Button for Nodes'));

describe('authoritative reciprocal node connections', () => {
  it('uses established authorization, fixed search path and closed ACLs', () => {
    expect(SQL).toContain('caller uuid := auth.uid()');
    expect(SQL).toContain('public.is_steward_or_overlord()');
    expect(SQL).toContain('SET search_path = public, pg_temp');
    expect(SQL).toContain('REVOKE ALL PRIVILEGES ON TABLE public.admin_node_connection_request FROM PUBLIC, anon, authenticated');
    expect(SQL).toContain('REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN');
    expect(SQL).toContain('GRANT EXECUTE ON FUNCTION public.admin_mutate_reciprocal_node_connection');
  });

  it('fingerprints every semantic input and serializes request then node locks', () => {
    expect(SQL).toContain('prior.expected_source_entry IS DISTINCT FROM expected_source');
    expect(SQL).toContain('prior.expected_target_entry IS DISTINCT FROM expected_target');
    expect(SQL).toContain("'kind', 'request_conflict'");
    expect(SQL.indexOf('FOR UPDATE;')).toBeLessThan(SQL.indexOf('ORDER BY id\n    FOR UPDATE'));
  });

  it('uses jsonb equality for stale source and reverse entries', () => {
    expect(SQL).toContain('source_entry <> expected_source OR target_entry <> expected_target');
    expect(SQL).toContain("'kind', 'stale_connection_state'");
    expect(SQL).not.toContain('expected_source_entry::text');
  });

  it('enforces opposite directions and symmetric hidden while preserving reverse metadata', () => {
    for (const pair of [["'N'", "'S'"], ["'NE'", "'SW'"], ["'E'", "'W'"], ["'NW'", "'SE'"]]) {
      expect(SQL).toContain(`WHEN ${pair[0]} THEN ${pair[1]}`);
    }
    expect(SQL).toContain("new_target_entry := target_entry\n          || jsonb_build_object('node_id', _source_node_id, 'direction', reverse_direction, 'hidden', _desired_hidden)");
    expect(SQL).toContain("source_entry - 'label' - 'locked' - 'lock_key' - 'lock_hint'");
  });

  it('refuses duplicate, one-sided and conflicting state and removes exact ordinals', () => {
    expect(SQL).toContain("'kind', 'not_an_ordinary_reciprocal_pair'");
    expect(SQL).toContain("'kind', 'conflicting_reciprocal_state'");
    expect(SQL).toContain('WHERE ord <> source_position');
    expect(SQL).toContain('WHERE ord <> target_position');
  });

  it('routes both editors through the shared RPC adapter without covered direct-write fallback', () => {
    expect(MANAGER.match(/submitReciprocalConnection/g)?.length).toBe(4);
    expect(MANAGER).not.toContain("update({ connections:");
    expect(MAP).toContain('submitReciprocalConnection({');
    expect(MAP).not.toContain('const srcConns =');
  });

  it('keeps connections out of ordinary existing-node saves', () => {
    const existingSave = NODE.slice(NODE.indexOf('if (activeNodeId) {'), NODE.indexOf('} else {', NODE.indexOf('if (activeNodeId) {')));
    expect(existingSave).not.toContain('connections,');
  });

  it('preserves directional metadata and treats duplicate loaded entries as invalid', () => {
    expect(directionalMetadata({ label: ' East ', locked: true, lock_key: ' Key ', lock_hint: ' Hint ' })).toEqual({ label: 'East', locked: true, lock_key: 'Key', lock_hint: 'Hint' });
    expect(directionalMetadata({ label: '', locked: false, lock_key: 'ignored' })).toEqual({});
    const entry = { node_id: 'b', direction: 'E', hidden: false, future: { x: 1 } };
    expect(findExactConnection([entry], 'b')).toEqual(entry);
    expect(findExactConnection([entry, { ...entry }], 'b')).toBeNull();
  });

  it('strictly decodes success and refusal results', () => {
    expect(decodeConnectionMutationResult({ ok: true, kind: 'edited', source_node_id: 'a', target_node_id: 'b', replayed: false })).not.toBeNull();
    expect(decodeConnectionMutationResult({ ok: false, kind: 'stale_connection_state' })).not.toBeNull();
    expect(decodeConnectionMutationResult({ ok: true, kind: 'edited' })).toBeNull();
  });

  it('reuses a request UUID only for an unresolved identical transport retry', () => {
    let sequence = 0;
    const tracker = createConnectionRequestTracker(() => `request-${++sequence}`);
    const first = tracker.requestIdFor('same');
    expect(tracker.requestIdFor('same')).toBe(first);
    tracker.settle('same', true);
    expect(tracker.requestIdFor('same')).toBe(first);
    tracker.settle('same', false);
    expect(tracker.requestIdFor('same')).not.toBe(first);
    expect(tracker.requestIdFor('changed')).not.toBe(first);
  });
});
