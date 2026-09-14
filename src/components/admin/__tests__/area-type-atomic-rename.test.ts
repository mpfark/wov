import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeAreaTypeRenameResult } from '../area-type-admin';

const SQL = readFileSync('supabase/migrations/20260915130000_admin_area_type_rename.sql', 'utf8');
const UI = readFileSync('src/components/admin/AreaTypeDialog.tsx', 'utf8');

describe('atomic admin Area Type rename', () => {
  it('installs a caller-derived, admin-only, fixed-search-path RPC', () => {
    expect(SQL).toContain('caller uuid := auth.uid()');
    expect(SQL).toContain('public.is_steward_or_overlord()');
    expect(SQL).toContain('SET search_path = public, pg_temp');
    expect(SQL).toContain('REVOKE ALL ON FUNCTION public.admin_area_type_rename(uuid, text, text, text) FROM PUBLIC, anon');
    expect(SQL).toContain('GRANT EXECUTE ON FUNCTION public.admin_area_type_rename(uuid, text, text, text) TO authenticated');
  });

  it('locks deterministically, rejects collisions and updates areas atomically', () => {
    expect(SQL).toContain('ORDER BY name');
    expect(SQL).toContain('ORDER BY id FOR UPDATE');
    expect(SQL).toContain("'kind', 'target_exists'");
    expect(SQL).toContain('UPDATE public.areas SET area_type = target_key WHERE area_type = source_key');
    expect(SQL).toContain('DELETE FROM public.area_types WHERE name = source_key');
  });

  it('durably accepts identical retry and refuses changed request reuse', () => {
    expect(SQL).toContain('ON CONFLICT (request_id) DO NOTHING');
    expect(SQL).toContain("'kind', 'request_conflict'");
    expect(SQL).toContain("jsonb_build_object('replayed', true)");
  });

  it('uses only the RPC for the changed-name path with no direct-write fallback', () => {
    const rename = UI.slice(UI.indexOf("if (editingType !== typeForm.name.trim())"), UI.indexOf('} else {', UI.indexOf("if (editingType !== typeForm.name.trim())")));
    expect(rename).toContain("supabase.rpc('admin_area_type_rename'");
    expect(rename).not.toContain("from('areas')");
    expect(rename).not.toContain("from('area_types').insert");
  });

  it('strictly decodes success and refusal outcomes', () => {
    expect(decodeAreaTypeRenameResult({ ok: true, kind: 'renamed', affected_area_count: 2, replayed: false })).not.toBeNull();
    expect(decodeAreaTypeRenameResult({ ok: false, kind: 'target_exists' })).not.toBeNull();
    expect(decodeAreaTypeRenameResult({ ok: true, kind: 'renamed' })).toBeNull();
  });
});
