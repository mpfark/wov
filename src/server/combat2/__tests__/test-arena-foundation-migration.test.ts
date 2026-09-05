import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SQL = readFileSync('supabase/migrations/20260905221000_combat2_test_arena_foundation.sql', 'utf8').replaceAll('\r\n', '\n');
const RESOLVER = readFileSync('src/shared/combat2/resolver.ts', 'utf8');
const DECODE = readFileSync('src/shared/combat2/decode.ts', 'utf8');
const TYPES = readFileSync('src/shared/combat2/types.ts', 'utf8');

describe('Combat2 test-arena foundation migration', () => {
  it('installs empty normalized registries with closed grants', () => {
    expect(SQL).toContain('CREATE TABLE public.combat2_test_arena (');
    expect(SQL).toContain('CREATE TABLE public.combat2_test_arena_node (');
    expect(SQL).toContain('CREATE TABLE public.combat2_test_arena_access (');
    expect(SQL).toMatch(/node_id uuid PRIMARY KEY/);
    expect(SQL).toMatch(/PRIMARY KEY \(arena_id,user_id,character_id\)/);
    expect(SQL).toMatch(/purpose IN \('staging','low','equal','high_damage','boss'\)/);
    expect(SQL.match(/ENABLE ROW LEVEL SECURITY/g)).toHaveLength(3);
    expect(SQL).toMatch(/REVOKE ALL ON public\.combat2_test_arena[\s\S]*FROM PUBLIC,anon,authenticated/);
    expect(SQL).not.toMatch(/INSERT INTO public\.combat2_test_arena/);
  });

  it('requires active exact user, character, ownership, arena and node bindings', () => {
    expect(SQL).toMatch(/combat2_test_arena_access_allowed\(_user_id uuid,_character_id uuid,_node_id uuid\)/);
    expect(SQL).toMatch(/x\.user_id=_user_id[\s\S]*x\.character_id=_character_id/);
    expect(SQL).toMatch(/x\.active AND x\.revoked_at IS NULL/);
    expect(SQL).toMatch(/c\.id=x\.character_id AND c\.user_id=x\.user_id/);
    expect(SQL).toMatch(/WHERE n\.node_id=_node_id AND n\.active/);
    expect(SQL).toMatch(/REVOKE ALL ON FUNCTION public\.combat2_test_arena_access_allowed[\s\S]*PUBLIC,anon,authenticated/);
  });

  it('hides registered nodes and exposes no registry rows to players', () => {
    expect(SQL).toMatch(/combat2_test_node_visible\(_node_id uuid\)[\s\S]*NOT EXISTS\(SELECT 1 FROM public\.combat2_test_arena_node/);
    expect(SQL).toMatch(/combat2_test_node_visible\(nodes\.id\)/);
    expect(SQL).toMatch(/RETURNS boolean[\s\S]*SECURITY DEFINER SET search_path=public,auth,pg_temp/);
  });

  it('guards every current_node_id writer through one before-update trigger', () => {
    expect(SQL).toMatch(/CREATE TRIGGER combat2_guard_test_arena_location BEFORE UPDATE OF current_node_id ON public\.characters/);
    expect(SQL).toContain('test_arena_relocation_required');
    expect(SQL).toContain("current_setting('app.combat2_depart_authorized',true)");
    expect(SQL).toContain("current_setting('app.combat2_test_relocate_authorized',true)");
    expect(SQL).toMatch(/combat2_test_relocate\(_character_id uuid,_destination_node_id uuid\)/);
    expect(SQL).toMatch(/NOT public\.owns_character\(_character_id\)/);
    expect(SQL).toContain("'combat2_depart_required'");
  });

  it('derives an immutable encounter marker and refuses test reward proposals at commit', () => {
    expect(SQL).toMatch(/ADD COLUMN test_arena_id uuid/);
    expect(SQL).toMatch(/BEFORE INSERT OR UPDATE OF status,test_arena_id ON public\.node_encounter/);
    expect(SQL).toContain('test_arena_identity_immutable');
    expect(SQL).toContain("''test_arena_id'', e.test_arena_id");
    expect(SQL).toContain("_proposed->'rewards'");
    expect(SQL).toContain('test_rewards_forbidden');
    expect(DECODE).toContain('snapshot.encounter.test_arena_id: expected UUID or null');
    expect(DECODE).toContain('snapshot.encounter.test_arena_id: required');
    expect(RESOLVER).toContain("snapshot.encounter.test_arena_id == null ? [...recipients].sort() : []");
    const proposal = TYPES.slice(TYPES.indexOf('export interface ProposedTick'), TYPES.indexOf('export function emptyProposedTick'));
    expect(proposal).not.toMatch(/loot|durability|achievement|progression/);
  });
});
