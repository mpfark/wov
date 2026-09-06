import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
const SQL=readFileSync('supabase/migrations/20260906131558_19f87cbf-1f77-4f69-b04d-d29fbf0edb7b.sql','utf8').replaceAll('\r\n','\n');
describe('Combat2 test session self-access migration',()=>{
 it('defines exactly one stable, read-only, self-scoped overload',()=>{
  expect(SQL.match(/CREATE OR REPLACE FUNCTION public\.combat2_test_session_access/g)).toHaveLength(1);
  expect(SQL).toContain('(_character_id uuid,_node_id uuid) RETURNS jsonb');
  expect(SQL).toContain('LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,auth,pg_temp');
  expect(SQL).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b|_user_id|email/i);
 });
 it('requires current ownership, current location, active registered node and canonical access helper',()=>{
  for(const clause of ['a.active','n.active','c.user_id=auth.uid()','c.current_node_id=_node_id','combat2_test_arena_access_allowed(auth.uid(),_character_id,_node_id)'])expect(SQL).toContain(clause);
  expect(SQL).toContain("'kind','not_authorized'");
  expect(SQL).toContain("'kind','not_test_node'");
  expect(SQL).not.toMatch(/character_name|access-row|claim_token|snapshot/i);
 });
 it('grants only authenticated invocation and exposes no raw error',()=>{
  expect(SQL).toContain('REVOKE ALL ON FUNCTION public.combat2_test_session_access(uuid,uuid) FROM PUBLIC,anon');
  expect(SQL).toContain('GRANT EXECUTE ON FUNCTION public.combat2_test_session_access(uuid,uuid) TO authenticated');
  expect(SQL).toContain("'kind','access_check_failed'");
 });
});
