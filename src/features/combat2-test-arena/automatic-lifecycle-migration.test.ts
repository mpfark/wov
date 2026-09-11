import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';

const SQL=readFileSync('supabase/migrations/20260912100000_combat2_commit_and_automatic_arena_lifecycle.sql','utf8');

describe('Combat2 automatic arena lifecycle migration',()=>{
 it('normalizes JSON null equipment fences and bounds commit exceptions',()=>{
  expect(SQL).toContain("NULLIF(value->''stat_override'',''null''::jsonb) stat_override");
  expect(SQL).toContain("'kind','internal_failure'");
  expect(SQL).toContain('GET STACKED DIAGNOSTICS failure_code=RETURNED_SQLSTATE');
 });
 it('wakes only registered owned arena characters and records private presence',()=>{
  expect(SQL).toContain('auth.uid()');expect(SQL).toContain('combat2_test_arena_access_allowed');
  expect(SQL).toContain('combat2_test_presence');expect(SQL).toContain('combat2_dispatch_scheduler_enable');
  expect(SQL).toContain('wake_world');
 });
 it('sleeps after five minutes without presence or live claims',()=>{
  expect(SQL).toContain("interval '5 minutes'");expect(SQL).toContain('combat2_dispatch_scheduler_disable');
  expect(SQL).toContain('shutdown_world');expect(SQL).toContain("'maintenance'");
 });
 it('keeps reset guarded and removes browser execution from manual lifecycle controls',()=>{
  expect(SQL).toContain("'active_player'");expect(SQL).toContain("'live_claim'");
  expect(SQL).toContain('REVOKE ALL ON FUNCTION public.combat2_test_environment_start(uuid,uuid) FROM authenticated');
  expect(SQL).toContain('REVOKE ALL ON FUNCTION public.combat2_test_environment_close(uuid,uuid) FROM authenticated');
 });
});
