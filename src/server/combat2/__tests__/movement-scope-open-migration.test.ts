import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SQL=readFileSync('supabase/migrations/20260916112047_236c1f40-146d-4205-805e-718169631d12.sql','utf8').replaceAll('\r\n','\n');

describe('Combat2 movement scope open migration',()=>{
 it('allows an ordinary runtime-eligible destination without a canary row',()=>{
  // Movement eligibility now matches combat_enter: runtime-eligible origin and
  // destination suffice; no canary membership is consulted anywhere.
  expect(SQL).toContain('public.combat2_node_runtime_eligible(_origin)');
  expect(SQL).toContain('public.combat2_node_runtime_eligible(_destination)');
  expect(SQL).not.toContain('combat2_canary_node');
 });
 it('preserves active Test Arena node-pair eligibility',()=>{
  expect(SQL).toContain('combat2_test_arena_node o');
  expect(SQL).toContain('a.active');
  expect(SQL).toContain('d.active');
 });
 it('keeps the helper server-only with a fixed safe search path',()=>{
  expect(SQL).toContain('SECURITY DEFINER SET search_path=public,pg_temp');
  expect(SQL).toContain('REVOKE ALL ON FUNCTION public.combat2_movement_scope_eligible(uuid,uuid) FROM PUBLIC,anon,authenticated');
  expect(SQL).toContain('GRANT EXECUTE ON FUNCTION public.combat2_movement_scope_eligible(uuid,uuid) TO service_role');
 });
});
