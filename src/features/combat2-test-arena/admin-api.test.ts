import { describe, expect, it, vi } from 'vitest';
import { COMBAT2_TEST_ARENA, createArenaAdminApi, decodeArenaResult, decodeArenaStatus, decodeTestRunReport, decodeTestRunResult } from './admin-api';

const status = { ok:true,kind:'status',arena_id:COMBAT2_TEST_ARENA.id,arena_key:COMBAT2_TEST_ARENA.key,label:'Arena',active:true,stopped:true,reset_eligible:true,
 node_count:5,creature_count:6,tester_count:0,active_encounter_count:0,claimed_encounter_count:0,pending_intent_count:0,pending_event_count:0,
 combat_mode:'maintenance',world_state:'asleep',scheduler_enabled:false,cron_job_count:0,located_tester_count:0,ordinary_encounter_count:0,live_claim_count:0,ordinary_live_claim_count:0,recent_ordinary_player_count:0,
 arena_live_claim_count:0,recording_status:'none',
 diagnostic_history_exists:false,nodes:[{id:'ffff5010-0000-4000-8000-000000000001',purpose:'staging',label:'Staging',active:true}],access:[] };

describe('Combat2 test arena admin adapter',()=>{
 it('strictly decodes status and refuses malformed/private-shaped data',()=>{
  expect(decodeArenaStatus(status)?.nodeCount).toBe(5);
  expect(decodeArenaStatus({...status,node_count:-1})).toBeNull();
  expect(decodeArenaStatus({...status,nodes:[{...status.nodes[0],id:'arbitrary'}]})).toBeNull();
  expect(decodeArenaStatus({...status,secret:'hidden'})?.arenaKey).toBe(COMBAT2_TEST_ARENA.key);
  expect(decodeArenaStatus({...status,last_dispatcher_at:'2026-09-11T10:00:00Z',last_dispatcher_classification:'dispatched',last_dispatcher_http_status:200,last_arena_tick:7,last_arena_tick_at:'2026-09-11T10:00:00Z'})?.lastArenaTick).toBe(7);
 });
 it('uses only exact RPCs and arguments, including confirmed reset',async()=>{
  const rpc=vi.fn().mockResolvedValue({data:{ok:true,kind:'granted'},error:null}); const api=createArenaAdminApi(rpc);
  await api.grant('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222');
  await api.relocate('22222222-2222-4222-8222-222222222222','ffff5010-0000-4000-8000-000000000001');
  await api.reset('33333333-3333-4333-8333-333333333333');
  await api.startEnvironment('44444444-4444-4444-8444-444444444444');
  await api.closeEnvironment('55555555-5555-4555-8555-555555555555');
 expect(rpc.mock.calls).toEqual([
   ['combat2_test_grant',{_arena_id:COMBAT2_TEST_ARENA.id,_user_id:'11111111-1111-4111-8111-111111111111',_character_id:'22222222-2222-4222-8222-222222222222'}],
   ['combat2_test_admin_relocate',{_arena_id:COMBAT2_TEST_ARENA.id,_character_id:'22222222-2222-4222-8222-222222222222',_destination_node_id:'ffff5010-0000-4000-8000-000000000001'}],
   ['combat2_test_reset',{_arena_id:COMBAT2_TEST_ARENA.id,_request_id:'33333333-3333-4333-8333-333333333333',_confirm_destroy_diagnostics:true}],
   ['combat2_test_environment_start',{_arena_id:COMBAT2_TEST_ARENA.id,_request_id:'44444444-4444-4444-8444-444444444444'}],
   ['combat2_test_environment_close',{_arena_id:COMBAT2_TEST_ARENA.id,_request_id:'55555555-5555-4555-8555-555555555555'}],
  ]);
 });
 it('uses separate run and environment RPC contracts',async()=>{
  const rpc=vi.fn().mockResolvedValue({data:{ok:true,kind:'started',run_id:'11111111-1111-4111-8111-111111111111',status:'recording',started_at:'2026-09-07T00:00:00Z',environment_ready:false,warning:'environment_closed'},error:null});
  const api=createArenaAdminApi(rpc);await api.startRun('22222222-2222-4222-8222-222222222222');
  expect(rpc).toHaveBeenCalledWith('combat2_test_run_start',{_arena_id:COMBAT2_TEST_ARENA.id,_request_id:'22222222-2222-4222-8222-222222222222'});
  expect(rpc).not.toHaveBeenCalledWith('combat2_test_environment_start',expect.anything());
 });
 it('classifies refusal, malformed and transport failure without raw errors',async()=>{
  const refusal=createArenaAdminApi(vi.fn().mockResolvedValue({data:{ok:false,kind:'not_authorized'},error:null}));
  expect((await refusal.stop('33333333-3333-4333-8333-333333333333')).value?.ok).toBe(false);
  const malformed=createArenaAdminApi(vi.fn().mockResolvedValue({data:{ok:true},error:null}));
  expect((await malformed.status()).error).toMatch(/malformed/);
  const transport=createArenaAdminApi(vi.fn().mockResolvedValue({data:null,error:{message:'secret internals'}}));
  expect(await transport.status()).toEqual({error:'Arena request failed.',uncertain:true});
  const diagnosed=createArenaAdminApi(vi.fn().mockResolvedValue({data:{ok:false,kind:'run_stop_failed',stage:'summarize',code:'22023',detail:'private'},error:null}));
  expect(await diagnosed.stopRun('33333333-3333-4333-8333-333333333333')).toEqual({error:'Arena refused: run_stop_failed at summarize (22023).',failure:{kind:'run_stop_failed',stage:'summarize',code:'22023'}});
 });
 it('accepts allowlisted reset diagnostics while remaining compatible with a plain reset failure',()=>{
  expect(decodeArenaResult({ok:false,kind:'reset_failed'})).toEqual({ok:false,kind:'reset_failed',counts:{},ids:{}});
  expect(decodeArenaResult({ok:false,kind:'reset_failed',stage:'tester_restore',code:'42703'})).toEqual({ok:false,kind:'reset_failed',counts:{},ids:{},stage:'tester_restore',code:'42703'});
  expect(decodeArenaResult({ok:false,kind:'reset_failed',stage:'raw database detail',code:'too-long',message:'secret'})).toEqual({ok:false,kind:'reset_failed',counts:{},ids:{}});
 });
 it('strictly decodes run results and stable report pages',()=>{
  expect(decodeTestRunResult({ok:true,kind:'started',run_id:'11111111-1111-4111-8111-111111111111',status:'recording',started_at:'2026-09-07T00:00:00Z',environment_ready:false,warning:'environment_closed'})?.warning).toBe('environment_closed');
  const page={ok:true,kind:'report',run_id:'11111111-1111-4111-8111-111111111111',status:'completed',started_at:'2026-09-07T00:00:00Z',completed_at:'2026-09-07T00:01:00Z',duration_ms:60000,latest_seq:2,returned_through_seq:2,has_more:false,summary:{batch_count:2},batches:[{seq:1,batchId:'22222222-2222-4222-8222-222222222222',encounterId:'33333333-3333-4333-8333-333333333333',tick:1,committedAt:'2026-09-07T00:00:02Z',events:[{kind:'attack'}]}]};
  expect(decodeTestRunReport(page)?.summary.batch_count).toBe(2);
  expect(decodeTestRunReport({...page,batches:[page.batches[0],page.batches[0]]})).toBeNull();
 });
});
