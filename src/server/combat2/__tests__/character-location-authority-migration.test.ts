import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SQL = readFileSync('supabase/migrations/20260908150000_character_location_authority.sql', 'utf8').replaceAll('\r\n', '\n');
const MOVEMENT = readFileSync('src/features/world/hooks/useMovementActions.ts', 'utf8');
const CHARACTER = readFileSync('src/features/character/hooks/useCharacter.ts', 'utf8');

describe('character location authority security boundary', () => {
 it('revokes direct browser character mutation before granting a preference-only allowlist',()=>{
  expect(SQL.indexOf('REVOKE INSERT,UPDATE,DELETE ON TABLE public.characters FROM PUBLIC,anon,authenticated')).toBeLessThan(SQL.indexOf('GRANT UPDATE(last_online,wimp_hp_threshold,wimp_direction,portrait_url,portrait_metadata,portrait_generated_at)'));
  for(const field of ['current_node_id','mp','hp','cp','gold','xp','stance_state','reserved_buffs','movement_locked_until'])expect(SQL).toMatch(new RegExp(`REVOKE UPDATE\\([\\s\\S]*${field}`));
  expect(SQL).toContain('DROP POLICY IF EXISTS "Users can update own characters"');
  expect(SQL).toContain('DROP POLICY IF EXISTS "Users can create characters"');
 });
 it('creates characters with server-derived caller and starting location',()=>{
  expect(SQL).toContain('caller uuid:=auth.uid()');expect(SQL).toContain('SELECT default_node_id INTO start_node');
  expect(SQL).toContain('VALUES(caller,btrim(_name)');expect(CHARACTER).toContain("rpc('character_create'");
  expect(CHARACTER).not.toMatch(/\.from\('characters'\)[\s\S]{0,80}\.insert/);
 });
 it('keeps ordinary, party, respawn, summon and admin movement behind reviewed RPCs',()=>{
  for(const signature of ['combat2_depart(uuid,uuid,uuid)','combat2_party_depart(uuid,uuid,uuid)','combat2_respawn(uuid,uuid)','accept_summon(uuid)','admin_teleport(uuid,uuid)'])expect(SQL).toContain(signature);
  expect(SQL).toContain('GRANT EXECUTE ON FUNCTION public.character_special_travel(uuid,text,uuid,uuid) TO authenticated,service_role');
  expect(SQL).toContain('GRANT EXECUTE ON FUNCTION public.move_follower(uuid,uuid) TO service_role');
 });
 it('derives special travel and summon destinations from authoritative state',()=>{
  for(const contract of ['character_visited_nodes','character_waymark','c.current_node_id','c.cp<cost','combat_active','following_leader'])expect(SQL).toContain(contract);
  expect(SQL).toContain('NEW.summoner_node_id FROM public.characters');
  expect(SQL).toContain('c.current_node_id=_req.summoner_node_id');
  expect(MOVEMENT).toContain("rpc('character_special_travel'");
  expect(MOVEMENT).toContain('Hidden-path travel is not connected to an authoritative movement contract.');
 });
 it('denies dead anchors while preserving intended live same-node encounter visibility',()=>{
  expect(SQL).toMatch(/c\.user_id=auth\.uid\(\) AND c\.hp>0 AND c\.current_node_id=node_encounter\.node_id/);
  expect(SQL).toMatch(/JOIN public\.characters c ON c\.current_node_id=e\.node_id[\s\S]*c\.user_id=auth\.uid\(\) AND c\.hp>0/);
 });
 it('keeps internal ledgers closed and does not add character Realtime exposure',()=>{
  expect(SQL).toContain('REVOKE ALL PRIVILEGES ON public.character_special_travel_request,public.character_waymark FROM PUBLIC,anon,authenticated');
  expect(SQL).not.toContain('ALTER PUBLICATION supabase_realtime ADD TABLE');
 });
});
