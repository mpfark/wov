import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
const SQL=readFileSync('supabase/migrations/20260907143000_combat2_authoritative_respawn.sql','utf8');

describe('Combat2 authoritative respawn migration',()=>{
 it('installs server-owned exact configuration',()=>{
  expect(SQL).toContain("'b0000000-0000-4000-8000-000000000001',3000,1,0.10");
  expect(SQL).toMatch(/default_node_id uuid NOT NULL REFERENCES public\.nodes/);
  expect(SQL).toMatch(/ENABLE ROW LEVEL SECURITY/);
  expect(SQL).toMatch(/REVOKE ALL ON public\.combat2_respawn_config FROM PUBLIC, anon, authenticated/);
  expect(SQL).not.toMatch(/Hearthvale Square|nodes\[0\]|-1\s*,\s*0/);
 });
 it('accepts no browser-controlled respawn values and gates ownership/death/delay',()=>{
  expect(SQL).toMatch(/combat2_respawn\(_character_id uuid,_request_id uuid\)/);
  expect(SQL).toContain('auth.uid()'); expect(SQL).toContain('public.owns_character(_character_id)');
  expect(SQL).toContain('IF c.hp > 0'); expect(SQL).toContain('c.last_death_at');
  expect(SQL).toContain("make_interval(secs=>cfg.delay_ms/1000.0)");
  expect(SQL).toContain("'kind','not_ready','eligible_at',eligible_at");
 });
 it('atomically fences post-death work and preserves historical death time',()=>{
  for(const table of ['node_intent','node_effect','node_pending_event','combat2_departure_request','node_fighter','node_encounter'])expect(SQL).toContain(`public.${table}`);
  expect(SQL).toMatch(/SET hp=restored,gold=GREATEST\(COALESCE\(gold,0\)-loss,0\),current_node_id=cfg\.default_node_id/);
  const characterSet=SQL.match(/UPDATE public\.characters SET([\s\S]*?)\n    WHERE id=_character_id/)?.[1]??'';
  expect(characterSet).not.toContain('last_death_at');
  expect(SQL).toContain("set_config('app.combat2_respawn_authorized','true',true)");
 });
 it('refuses Test Arena recovery and exposes narrow grants',()=>{
  expect(SQL).toContain("'kind','test_arena_reset_required'");
  expect(SQL).toMatch(/REVOKE ALL ON FUNCTION public\.combat2_respawn\(uuid,uuid\) FROM PUBLIC,anon/);
  expect(SQL).toMatch(/GRANT EXECUTE ON FUNCTION public\.combat2_respawn\(uuid,uuid\) TO authenticated,service_role/);
 });
});
