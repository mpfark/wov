import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createLootRequestTracker, decodeLootMutationResult, MAX_LOOT_ENTRIES } from '../loot/loot-table-admin';

const SQL = readFileSync('supabase/migrations/20260915180000_admin_loot_table_mutation.sql', 'utf8');
const UI = readFileSync('src/components/admin/loot/LegacyLootTablesTab.tsx', 'utf8');

describe('atomic admin loot-table mutations', () => {
  it('derives authority and isolates its fixed-search-path request ledger', () => {
    for (const token of ['caller uuid := auth.uid()', 'public.is_steward_or_overlord()', 'SECURITY DEFINER', 'SET search_path = public, pg_temp']) expect(SQL).toContain(token);
    expect(SQL).toContain('ENABLE ROW LEVEL SECURITY');
    expect(SQL).toContain('REVOKE ALL PRIVILEGES ON TABLE public.admin_loot_table_request FROM PUBLIC, anon, authenticated');
    expect(SQL).toContain('REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN');
    expect(SQL).toContain('REVOKE ALL ON FUNCTION public.admin_mutate_loot_table');
    expect(SQL).toContain('GRANT EXECUTE ON FUNCTION public.admin_mutate_loot_table');
    expect(SQL).not.toContain('supabase_realtime');
  });

  it('supports only atomic save and delete with rollback-safe database failures', () => {
    expect(SQL).toContain("op NOT IN ('save', 'delete')");
    expect(SQL).toContain("'kind', 'unsupported_operation'");
    expect(SQL).toContain('INSERT INTO public.loot_tables (name)');
    expect(SQL).toContain('UPDATE public.loot_tables SET name');
    expect(SQL).toContain('DELETE FROM public.loot_table_entries WHERE loot_table_id = new_table_id');
    expect(SQL).toContain('INSERT INTO public.loot_table_entries (id, loot_table_id, item_id, weight)');
    expect(SQL).toContain('EXCEPTION WHEN OTHERS THEN');
    expect(SQL).toContain("response := jsonb_build_object('ok', false, 'kind', 'database_error')");
  });

  it('validates nested payloads, limits, item references and duplicate entry IDs', () => {
    expect(MAX_LOOT_ENTRIES).toBe(200);
    expect(SQL).toContain('jsonb_array_length(_desired_entries) > 200');
    expect(SQL).toContain("ARRAY['entry_id', 'item_id', 'weight']::text[]");
    expect(SQL).toContain("(value->>'weight')::numeric NOT BETWEEN 1 AND 100");
    expect(SQL).toContain("'kind', 'duplicate_entry'");
    expect(SQL).toContain("'kind', 'entry_not_found'");
    expect(SQL).toContain("'kind', 'item_not_found'");
  });

  it('preserves duplicate-item semantics while keeping stable existing entry IDs', () => {
    expect(SQL).not.toMatch(/DISTINCT value->>'item_id'.*duplicate/s);
    expect(SQL).toContain("ELSE (entry->>'entry_id')::uuid END");
    expect(SQL).toContain('THEN gen_random_uuid()');
    expect(UI).toContain('duplicate item rows are allowed and add their weights');
  });

  it('compares complete table, entry and creature-reference state before writes', () => {
    expect(SQL).toContain("actual_table := jsonb_build_object('id', table_row.id, 'name', table_row.name)");
    expect(SQL).toContain("jsonb_build_object('id', id, 'item_id', item_id, 'weight', weight) ORDER BY id");
    expect(SQL).toContain("coalesce(jsonb_agg(id ORDER BY id), '[]')");
    expect(SQL).toContain("'kind', 'stale_loot_table_state'");
    expect(SQL.indexOf("'kind', 'stale_loot_table_state'")).toBeLessThan(SQL.indexOf('DELETE FROM public.loot_table_entries WHERE loot_table_id = new_table_id'));
  });

  it('locks request, table, entries, items, then creatures in deterministic order', () => {
    const request = SQL.indexOf('WHERE request_id = _request_id FOR UPDATE');
    const table = SQL.indexOf('WHERE id = _loot_table_id FOR UPDATE');
    const entries = SQL.indexOf('WHERE loot_table_id = _loot_table_id ORDER BY id FOR UPDATE');
    const items = SQL.indexOf('WHERE id = ANY(item_ids) ORDER BY id FOR KEY SHARE');
    const creatures = SQL.indexOf('WHERE loot_table_id = _loot_table_id ORDER BY id FOR UPDATE', entries + 1);
    expect(request).toBeGreaterThan(-1);
    expect(request).toBeLessThan(table);
    expect(table).toBeLessThan(entries);
    expect(entries).toBeLessThan(items);
    expect(items).toBeLessThan(creatures);
    expect(SQL).toContain("ORDER BY coalesce(value->>'entry_id', ''), value->>'item_id'");
  });

  it('refuses referenced deletion and exposes only a safe count', () => {
    expect(SQL).toContain("'kind', 'table_in_use', 'reference_count', reference_count");
    expect(SQL).not.toContain('ON DELETE SET NULL');
    expect(UI).toContain('This is allowed only when no creature references it.');
    expect(UI).toContain('creature(s) use this table');
  });

  it('durably replays identical input and refuses changed request reuse', () => {
    expect(SQL).toContain('ON CONFLICT (request_id) DO NOTHING');
    expect(SQL).toContain('prior.expected_entries IS DISTINCT FROM _expected_entries');
    expect(SQL).toContain('prior.desired_entries IS DISTINCT FROM _desired_entries');
    expect(SQL).toContain("'kind', 'request_conflict'");
    expect(SQL).toContain("jsonb_build_object('replayed', true)");
    let sequence = 0;
    const tracker = createLootRequestTracker(() => `request-${++sequence}`);
    const first = tracker.requestIdFor('same');
    tracker.settle('same', true);
    expect(tracker.requestIdFor('same')).toBe(first);
    tracker.settle('same', false);
    expect(tracker.requestIdFor('same')).not.toBe(first);
  });

  it('routes writes only through the RPC and fences duplicates and stale completions', () => {
    expect(UI).toContain('submitLootMutation(');
    expect(UI).not.toMatch(/\.from\('loot_tables'\)\.(insert|update|delete)/);
    expect(UI).not.toMatch(/\.from\('loot_table_entries'\)\.(insert|update|delete)/);
    expect(UI).toContain('mutationFence.current.tryAcquire()');
    expect(UI).toContain('editorGuard.current.isCurrent(editorRequest)');
    expect(UI).toContain('authoritative state refreshed before retrying');
    expect(UI).toContain('Save table and entries atomically');
  });

  it('strictly decodes successes and distinguishable refusals', () => {
    expect(decodeLootMutationResult({ ok: true, kind: 'created', loot_table_id: 'id', entry_count: 2, replayed: false })).not.toBeNull();
    expect(decodeLootMutationResult({ ok: false, kind: 'table_in_use', reference_count: 2 })).not.toBeNull();
    expect(decodeLootMutationResult({ ok: false, kind: 'duplicate_entry' })).not.toBeNull();
    expect(decodeLootMutationResult({ ok: true, kind: 'created', loot_table_id: 'id', entry_count: '2', replayed: false })).toBeNull();
    expect(decodeLootMutationResult({ ok: false, kind: 'unknown' })).toBeNull();
  });

  it('does not touch runtime loot, inventory or reward tables', () => {
    for (const forbidden of ['character_inventory', 'combat2_', 'node_loot', 'reward_config']) expect(SQL).not.toContain(forbidden);
  });
});
