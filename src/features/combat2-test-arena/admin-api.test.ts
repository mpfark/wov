import { describe, expect, it, vi } from 'vitest';
import { COMBAT2_TEST_ARENA, createArenaAdminApi, decodeArenaStatus } from './admin-api';

const status = { ok:true,kind:'status',arena_id:COMBAT2_TEST_ARENA.id,arena_key:COMBAT2_TEST_ARENA.key,label:'Arena',active:true,stopped:true,reset_eligible:true,
 node_count:5,creature_count:6,tester_count:0,active_encounter_count:0,claimed_encounter_count:0,pending_intent_count:0,pending_event_count:0,
 diagnostic_history_exists:false,nodes:[{id:'ffff5010-0000-4000-8000-000000000001',purpose:'staging',label:'Staging',active:true}],access:[] };

describe('Combat2 test arena admin adapter',()=>{
 it('strictly decodes status and refuses malformed/private-shaped data',()=>{
  expect(decodeArenaStatus(status)?.nodeCount).toBe(5);
  expect(decodeArenaStatus({...status,node_count:-1})).toBeNull();
  expect(decodeArenaStatus({...status,nodes:[{...status.nodes[0],id:'arbitrary'}]})).toBeNull();
  expect(decodeArenaStatus({...status,secret:'hidden'})?.arenaKey).toBe(COMBAT2_TEST_ARENA.key);
 });
 it('uses only exact RPCs and arguments, including confirmed reset',async()=>{
  const rpc=vi.fn().mockResolvedValue({data:{ok:true,kind:'granted'},error:null}); const api=createArenaAdminApi(rpc);
  await api.grant('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222');
  await api.relocate('22222222-2222-4222-8222-222222222222','ffff5010-0000-4000-8000-000000000001');
  await api.reset('33333333-3333-4333-8333-333333333333');
  expect(rpc.mock.calls).toEqual([
   ['combat2_test_grant',{_arena_id:COMBAT2_TEST_ARENA.id,_user_id:'11111111-1111-4111-8111-111111111111',_character_id:'22222222-2222-4222-8222-222222222222'}],
   ['combat2_test_admin_relocate',{_arena_id:COMBAT2_TEST_ARENA.id,_character_id:'22222222-2222-4222-8222-222222222222',_destination_node_id:'ffff5010-0000-4000-8000-000000000001'}],
   ['combat2_test_reset',{_arena_id:COMBAT2_TEST_ARENA.id,_request_id:'33333333-3333-4333-8333-333333333333',_confirm_destroy_diagnostics:true}],
  ]);
 });
 it('classifies refusal, malformed and transport failure without raw errors',async()=>{
  const refusal=createArenaAdminApi(vi.fn().mockResolvedValue({data:{ok:false,kind:'not_authorized'},error:null}));
  expect((await refusal.stop('33333333-3333-4333-8333-333333333333')).value?.ok).toBe(false);
  const malformed=createArenaAdminApi(vi.fn().mockResolvedValue({data:{ok:true},error:null}));
  expect((await malformed.status()).error).toMatch(/malformed/);
  const transport=createArenaAdminApi(vi.fn().mockResolvedValue({data:null,error:{message:'secret internals'}}));
  expect(await transport.status()).toEqual({error:'Arena request failed.',uncertain:true});
 });
});
