import { readFileSync } from 'node:fs';
import { describe,expect,it } from 'vitest';

const SQL=readFileSync('supabase/migrations/20260908130000_party_privilege_hardening.sql','utf8');
const LIFECYCLE=readFileSync('supabase/migrations/20260908101012_50a06710-aefe-4487-a7ed-f0c2e5858ab2.sql','utf8');

describe('authoritative party privilege hardening',()=>{
 it('revokes every inherited table privilege before granting authenticated SELECT only',()=>{
  expect(SQL).toMatch(/REVOKE ALL PRIVILEGES ON TABLE[\s\S]*public\.parties,[\s\S]*public\.party_members,[\s\S]*public\.party_operation_request[\s\S]*FROM PUBLIC, anon, authenticated, service_role/);
  expect(SQL).toContain('GRANT SELECT ON TABLE public.parties, public.party_members TO authenticated');
  expect(SQL).not.toMatch(/GRANT (?:INSERT|UPDATE|DELETE|TRUNCATE|REFERENCES|TRIGGER|MAINTAIN|ALL)[^;]*authenticated/i);
  expect(SQL).not.toMatch(/GRANT SELECT[^;]*party_operation_request[^;]*authenticated/i);
 });
 it('leaves no browser sequence privilege and scopes any defensive sequence handling to party tables',()=>{
  expect(SQL).toContain("table_class.relname IN ('parties', 'party_members', 'party_operation_request')");
  expect(SQL).toContain('REVOKE ALL PRIVILEGES ON SEQUENCE %I.%I FROM PUBLIC, anon, authenticated');
  expect(LIFECYCLE).toContain('request_id uuid PRIMARY KEY');
  expect(LIFECYCLE).not.toMatch(/(?:smallserial|serial|bigserial|nextval\()/i);
 });
 it('allows only public party RPCs and the required safe RLS predicate for authenticated',()=>{
  for(const signature of ['party_mutate(uuid,text,uuid,uuid,uuid,uuid)','party_state(uuid)','combat2_party_preflight(uuid,uuid)','party_can_view(uuid)'])expect(SQL).toContain(`GRANT EXECUTE ON FUNCTION public.${signature} TO authenticated`);
  for(const signature of ['party_operation_finish(uuid,jsonb)','party_combat_mutation_blocked(uuid,uuid)','is_party_member(uuid)','accept_party_invite(uuid)','set_party_tank(uuid,uuid)','combat2_validate_party_tank()','combat2_party_tank_changed()']){expect(SQL).toContain(`REVOKE ALL ON FUNCTION public.${signature} FROM PUBLIC, anon, authenticated, service_role`);expect(SQL).not.toContain(`GRANT EXECUTE ON FUNCTION public.${signature} TO authenticated`);}
 });
 it('retains only participant SELECT policies and removes every obsolete mutation policy',()=>{
  for(const policy of ['Character owner can create party','Leader can update party','Leader can delete party','Can insert party members','Can update party members','Can delete party members'])expect(SQL).toContain(`DROP POLICY IF EXISTS "${policy}"`);
  expect(LIFECYCLE).toContain('CREATE POLICY "Party participants can view parties"');
  expect(LIFECYCLE).toContain('CREATE POLICY "Party participants can view memberships"');
  expect(LIFECYCLE).toContain('public.party_can_view');
  expect(LIFECYCLE).toContain('ALTER TABLE public.party_operation_request ENABLE ROW LEVEL SECURITY');
 });
 it('preserves SECURITY DEFINER ownership access, fixed search paths, and Realtime scope',()=>{
  for(const name of ['party_mutate','party_state','combat2_party_preflight','party_operation_finish','party_combat_mutation_blocked','party_can_view'])expect(LIFECYCLE).toMatch(new RegExp(`${name}[\\s\\S]*?SECURITY DEFINER SET search_path=`));
  expect(LIFECYCLE).toContain('GRANT ALL ON public.party_operation_request TO service_role');
  expect(SQL).toContain('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE');
  const history=readFileSync('supabase/migrations/20260212092159_6e63f535-2ef9-4e05-9cea-d87a44570baf.sql','utf8');
  expect(history).toContain('ALTER PUBLICATION supabase_realtime ADD TABLE public.parties');
  expect(history).toContain('ALTER PUBLICATION supabase_realtime ADD TABLE public.party_members');
 });
});
