import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';

const SQL=readFileSync('supabase/migrations/20260909210000_combat2_node_canary_control.sql','utf8');

describe('Combat2 node canary control',()=>{
  it('keeps scope private, expiring and server controlled',()=>{
    expect(SQL).toContain('CREATE TABLE public.combat2_canary_node');
    expect(SQL).toContain('expires_at>now()');
    expect(SQL).toContain('ENABLE ROW LEVEL SECURITY');
    expect(SQL).toMatch(/REVOKE ALL ON TABLE public\.combat2_canary_node FROM PUBLIC, anon, authenticated/);
    expect(SQL).not.toMatch(/GRANT .*combat2_canary_node TO authenticated/);
  });
  it('gates entry, claims, and dispatcher discovery through one predicate',()=>{
    for(const fn of ['combat_enter','node_tick_claim','combat2_due_nodes','combat2_depart','combat2_party_depart','combat2_respawn'])expect(SQL).toContain(`CREATE FUNCTION public.${fn}`);
    expect(SQL.match(/combat2_node_runtime_eligible/g)?.length).toBeGreaterThanOrEqual(5);
    expect(SQL).toContain("'scope_refused'");
  });
  it('prevents movement and respawn from escaping the node scope',()=>{
    expect(SQL).toContain("'destination_not_enabled'");
    expect(SQL).toContain("'respawn_destination_not_enabled'");
    expect(SQL).toContain('combat2_depart_without_canary_gate');
    expect(SQL).toContain('combat2_party_depart_without_canary_gate');
    expect(SQL).toContain('combat2_respawn_without_canary_gate');
  });
  it('preserves installed implementations and lets in-flight commits stand',()=>{
    expect(SQL).toContain('combat_enter_without_canary_gate');
    expect(SQL).toContain('node_tick_claim_without_canary_gate');
    expect(SQL).toContain('combat2_due_nodes_without_canary_gate');
    expect(SQL).not.toMatch(/node_tick_commit_without_canary|CREATE FUNCTION public\.node_tick_commit/);
  });
  it('exposes only a self-scoped eligibility result to authenticated browsers',()=>{
    expect(SQL).toContain('CREATE FUNCTION public.combat2_session_access');
    expect(SQL).toContain('c.user_id=auth.uid()');
    expect(SQL).toContain("'scope',CASE WHEN is_arena THEN 'test_arena' ELSE 'canary' END");
  });
});
