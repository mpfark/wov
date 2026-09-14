import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SQL=readFileSync('supabase/migrations/20260915100000_combat2_special_transition_fences.sql','utf8').replaceAll('\r\n','\n');
const UI=readFileSync('src/features/world/hooks/useMovementActions.ts','utf8');
const PAGE=readFileSync('src/pages/GamePage.tsx','utf8');

describe('Combat2 special transition fences',()=>{
 it('fences queued solo/party departures, present fighters, and live claims',()=>{
  for(const token of ['combat2_departure_request','combat2_party_departure_member',"d.status='queued'","m.status='queued'",
    'f.present',"e.status='active'",'e.claim_token IS NOT NULL','e.claimed_until>clock_timestamp()']) expect(SQL).toContain(token);
  expect(SQL.match(/combat2_special_transition_conflict\(c\.id,c\.current_node_id\)/g)).toHaveLength(2);
 });
 it('keeps browser access narrow and fixed-search-path helpers server-only',()=>{
  expect(SQL).toContain('SECURITY DEFINER SET search_path=public,pg_temp');
  expect(SQL).toContain('REVOKE ALL ON FUNCTION public.combat2_special_transition_conflict(uuid,uuid) FROM PUBLIC,anon,authenticated');
  expect(SQL).toContain('GRANT EXECUTE ON FUNCTION public.combat2_special_transition_conflict(uuid,uuid) TO service_role');
 });
 it('uses stable request ids, single flight, server results, and authoritative refresh without browser resource writes',()=>{
  expect(UI).toContain('specialTravelPending.current');
  expect(UI).toContain('specialTravelRequest.current?.key === requestKey');
  expect(UI).toContain("rpc('character_special_travel'");
  expect(UI).toContain('await p.refreshCharacter?.()');
  expect(UI).not.toContain('current_node_id: result.destination_node_id');
  expect(UI).not.toContain('cp: Math.max((p.character.cp');
  expect(PAGE).toContain('refreshCharacter: refetchCharacters');
 });
 it('does not unblock summon acceptance while Combat2 owns the session',()=>{
  expect(PAGE).toContain('useControlledAction(legacyExecution.allowed, setCombat2Diagnostic, legacyAcceptSummon)');
 });
});
