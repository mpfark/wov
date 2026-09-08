import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SQL=readFileSync('supabase/migrations/20260908140000_authoritative_party_movement.sql','utf8').replaceAll('\r\n','\n');
const MOVEMENT=readFileSync('src/features/world/hooks/useMovementActions.ts','utf8');
const PAGE=readFileSync('src/pages/GamePage.tsx','utf8');

describe('authoritative coordinated party movement migration',()=>{
 it('uses the existing follow flag through owner-controlled durable party operations',()=>{
  expect(SQL).toContain("'follow','stop_following'");
  expect(SQL).toContain("p.leader_id=actor.id");
  expect(SQL).toContain("SET is_following=(_operation='follow')");
  expect(SQL).toContain('party_combat_mutation_blocked');
 });
 it('derives included movers and stable follower-first, leader-last order server-side',()=>{
  expect(SQL).toMatch(/pm\.status='accepted' AND pm\.is_following/);
  expect(SQL).toMatch(/c\.current_node_id=leader\.current_node_id AND c\.hp>0/);
  expect(SQL).toMatch(/ORDER BY leader_last,joined_at,id/g);
  expect(SQL).toMatch(/combat2_party_depart\(_leader_character_id uuid,_destination_node_id uuid,_request_id uuid\)/);
 });
 it('performs all static checks before durable queue insertion',()=>{
  const preflight=SQL.indexOf('-- Static all-or-none pass');
  const insert=SQL.indexOf('INSERT INTO public.combat2_party_departure_request VALUES');
  expect(preflight).toBeGreaterThan(0);expect(insert).toBeGreaterThan(preflight);
  for(const contract of ["conn->>'hidden'","conn->>'locked'",'insufficient_resource','movement_already_pending','claim_expires_at>now()'])expect(SQL).toContain(contract);
 });
 it('binds parent/member requests and queues ordered per-fighter opportunities exactly once',()=>{
  for(const contract of ['combat2_party_departure_request','combat2_party_departure_member','departure_request_id uuid NOT NULL UNIQUE','fighter_entry_seq','arrival_group_id','fighter_depart_requested',"ordinal*interval '1 microsecond'"])expect(SQL).toContain(contract);
  expect(SQL).toContain('combat2_party_departure_state(_character_id uuid)');
  expect(SQL).toContain('c.user_id=auth.uid()');
  expect(SQL).toContain("status='completed'");
  expect(SQL).toContain("status=CASE WHEN did_move THEN 'moved' ELSE 'remaining' END");
 });
 it('keeps browser privileges closed and revokes the obsolete follower RPC',()=>{
  expect(SQL).toMatch(/ENABLE ROW LEVEL SECURITY/g);
  expect(SQL).toContain('REVOKE ALL PRIVILEGES ON public.combat2_party_departure_request,public.combat2_party_departure_member FROM PUBLIC,anon,authenticated');
  expect(SQL).toContain('REVOKE ALL ON FUNCTION public.move_follower(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role');
  expect(SQL).toContain('GRANT EXECUTE ON FUNCTION public.combat2_party_depart(uuid,uuid,uuid) TO authenticated,service_role');
 });
 it('removes browser follower relocation and routes ordinary movement authoritatively',()=>{
  expect(MOVEMENT).not.toContain("rpc('move_follower'");
  expect(MOVEMENT).toContain('if (p.authorizeCombat2Depart)');
  expect(PAGE).toContain('createPartyAwareDepartureAdapter');
  expect(PAGE).toContain('authorizeCombat2Depart,');
  expect(PAGE).not.toContain('FOLLOW_GRACE_MS');
 });
});
