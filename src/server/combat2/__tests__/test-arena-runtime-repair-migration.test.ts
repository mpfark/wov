import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';

const PATH='supabase/migrations/20260911100000_combat2_test_arena_runtime_repair.sql';
const SQL=readFileSync(PATH,'utf8').replaceAll('\r\n','\n');
const lower=SQL.toLowerCase().replace(/\s+/g,' ');
const body=(name:string)=>{const start=SQL.indexOf(`FUNCTION public.${name}`);return SQL.slice(start,SQL.indexOf('END $$;',start)+7);};

describe('Combat2 Test Arena continuous runtime repair',()=>{
 it('filters eligibility before the bounded due-node limit',()=>{
  const due=body('combat2_due_nodes');
  expect(due.indexOf('combat2_node_runtime_eligible(e.node_id)')).toBeLessThan(due.indexOf('LIMIT v_limit'));
  expect(due).not.toContain('combat2_due_nodes_without_canary_gate(_limit)');
  expect(due).toContain("e.status='active' AND e.next_due_at<=now()");
  expect(due).toContain('e.claim_expires_at<=now()');
 });
 it('keeps one scheduler request in flight and records bounded terminal evidence',()=>{
  const fire=body('combat2_dispatch_scheduler_fire');
  expect(fire.match(/net\.http_post/g)).toHaveLength(1);
  expect(fire).toContain('last_http_status=response.status_code');
  expect(fire).toContain('last_classification=classification');
  expect(fire).toContain('last_success_at=CASE WHEN');
  expect(fire).toContain("item->>'classification' NOT IN('committed','already_committed','not_due','in_flight','no_claim')");
  expect(fire).toContain("last_classification='timeout'");
  expect(fire).not.toMatch(/last_.*content|last_.*secret/);
  expect(lower).not.toMatch(/eyj[a-z0-9_-]{20,}/);
 });
 it('uses an authenticated, server-timestamped arena heartbeat',()=>{
  const heartbeat=body('combat2_test_presence_heartbeat');
  expect(heartbeat).toContain('caller uuid:=auth.uid()');
  expect(heartbeat).toContain('clock_timestamp()');
  expect(heartbeat.slice(0,heartbeat.indexOf('RETURNS'))).not.toMatch(/_seen|_timestamp|_active/);
  expect(lower).toContain('revoke all on function public.combat2_test_presence_heartbeat(uuid,uuid) from public,anon');
 });
 it('keeps active arena presence or a live claim awake but allows abandonment shutdown',()=>{
  const idle=body('idle_shutdown_check');
  expect(idle).toContain("p.seen_at>now()-interval '5 minutes'");
  expect(idle).toContain('c.current_node_id');
  expect(idle).toContain('claim_expires_at>now()');
  expect(idle).toContain('combat2_dispatch_scheduler_disable()');
  expect(idle).not.toContain('combat2_test_run');
 });
 it('stops recording through the admin wrapper without stopping combat',()=>{
  const stop=body('combat2_test_run_stop');
  expect(stop).toContain('public.combat2_test_admin_allowed()');
  expect(stop).toContain("status='completed'");
  expect(stop).toContain("'kind','already_completed'");
  expect(stop).toContain("'kind','run_stop_failed','stage',failure_stage");
  expect(stop).not.toMatch(/combat2_test_stop|shutdown_world|scheduler_disable|DELETE FROM/);
  expect(lower).toContain('grant execute on function public.combat2_test_run_stop(uuid,uuid) to authenticated,service_role');
 });
 it('exposes only bounded dispatcher, tick, claim and recording health',()=>{
  const status=body('combat2_test_runtime_status');
  for(const key of ['last_dispatcher_at','last_successful_dispatcher_at','last_dispatcher_classification','last_dispatcher_http_status','last_dispatcher_error_code','last_arena_tick','last_arena_tick_at','arena_live_claim_count','recording_status'])expect(status).toContain(`'${key}'`);
  expect(status).not.toMatch(/snapshot|authorization|secret|response\.content/);
 });
});
