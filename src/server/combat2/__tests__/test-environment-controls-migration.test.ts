import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
const SQL=readFileSync('supabase/migrations/20260906160000_combat2_test_environment_controls.sql','utf8').replaceAll('\r\n','\n');
const lower=SQL.toLowerCase();
const body=(name:string,next:string)=>lower.slice(lower.indexOf(`function public.${name}`),lower.indexOf(`function public.${next}`));
describe('Combat2 test environment controls migration',()=>{
 it('defines narrow secured RPCs and request-ledger idempotency',()=>{
  for(const sig of ['combat2_test_environment_start(uuid,uuid)','combat2_test_environment_close(uuid,uuid)']){
   expect(SQL).toContain(`REVOKE ALL ON FUNCTION public.${sig} FROM PUBLIC,anon`);
   expect(SQL).toContain(`GRANT EXECUTE ON FUNCTION public.${sig} TO authenticated,service_role`);
  }
  expect(lower.match(/security definer set search_path=public,auth,cron,pg_temp/g)).toHaveLength(3);
  expect(lower).toContain("check(operation in('stop','reset','environment_start','environment_close'))");
  expect(lower).toContain("kind','request_id_conflict'");
  expect(lower.match(/pg_advisory_xact_lock\(hashtextextended\('combat2-test:'/g)).toHaveLength(2);
 });
 it('starts only for a valid located tester and verifies one exact scheduler',()=>{
  const start=body('combat2_test_environment_start(','combat2_test_environment_close(');
  expect(start).toContain('combat2_test_arena_access'); expect(start).toContain('c.user_id=x.user_id'); expect(start).toContain('n.node_id=c.current_node_id');
  expect(start).toContain("kind','located_tester_required'"); expect(start).toContain("kind','arena_claim_active'");
  expect(start).toContain("update public.combat_config set value='open'"); expect(start).toContain('public.wake_world()'); expect(start).toContain('public.combat2_dispatch_scheduler_enable()');
  expect(start).toContain("schedule='2 seconds'"); expect(start).toContain("command='select public.combat2_dispatch_scheduler_fire();'");
  expect(start).toContain("kind','already_started'"); expect(start).toContain("kind','start_failed'");
  expect(start).not.toMatch(/node_tick|node_intent|combat2-dispatch-once\/|http_post|combat_enter/);
 });
 it('stops with evidence preservation and closes globally only without ordinary activity',()=>{
  const close=lower.slice(lower.indexOf('function public.combat2_test_environment_close('),lower.indexOf('revoke all on function public.combat2_test_status'));
  expect(close).toContain('public.combat2_test_stop(_arena_id,stop_id)');
  expect(close).toContain("test_arena_id is null and status='active'"); expect(close).toContain('claim_expires_at>now()'); expect(close).toContain("last_online>now()-interval '30 minutes'");
  expect(close).toContain("kind','arena_stopped_world_left_open'"); expect(close).toContain("update public.combat_config set value='maintenance'");
  expect(close).toContain('public.shutdown_world()'); expect(close).toContain('public.combat2_dispatch_scheduler_disable()'); expect(close).toContain('jobs<>0');
  expect(close).toContain("kind','close_failed'"); expect(close).not.toMatch(/combat2_test_reset|delete from public\.node_encounter/);
 });
 it('returns aggregate status without secrets or cron commands',()=>{
  for(const field of ['combat_mode','world_state','scheduler_enabled','cron_job_count','tester_count','located_tester_count','active_encounter_count','ordinary_encounter_count','live_claim_count','recent_ordinary_player_count','last_start_classification','last_close_classification'])expect(lower).toContain(`'${field}'`);
  expect(lower).not.toMatch(/decrypted_secret|authorization|bearer|user_email|sqlerrm/);
 });
});
