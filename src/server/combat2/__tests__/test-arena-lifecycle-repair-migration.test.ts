import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';

const SQL=readFileSync('supabase/migrations/20260910090000_combat2_test_arena_lifecycle_repair.sql','utf8').replaceAll('\r\n','\n');
const body=(name:string)=>{const start=SQL.indexOf(`FUNCTION public.${name}`);return SQL.slice(start,SQL.indexOf('END $$;',start)+7);};

describe('Combat2 Test Arena lifecycle repair',()=>{
 it('pairs pending-event consumption with the authoritative encounter tick',()=>{
  const finalize=body('combat2_test_finalize_pending_events');
  expect(finalize).toContain('SET consumed_at=now(), consumed_tick=e.tick');
  expect(finalize).toContain('e.id=p.encounter_id AND e.test_arena_id=_arena_id');
  expect(finalize).toContain('p.consumed_at IS NULL AND p.consumed_tick IS NULL');
  expect(SQL).not.toMatch(/DROP CONSTRAINT node_pending_event_consumed_chk|consumed_tick\s*=\s*_request/i);
 });
 it('puts finalization in front of every normal/emergency/close stop caller',()=>{
  const stop=body('combat2_test_stop');
  expect(stop).toContain('combat2_test_finalize_pending_events(_arena_id)');
  expect(stop).toContain('combat2_test_stop_without_event_finalization');
  expect(stop).toContain('RETURN prior.result');
 });
 it('completes recording without stopping or deleting arena runtime',()=>{
  const stop=body('combat2_test_run_stop');
  expect(stop).toContain("status='completed',completed_at=now(),stop_request_id=_request_id,final_seq=boundary");
  expect(stop).toContain("'kind','already_completed'");
  expect(stop).not.toMatch(/combat2_test_stop|DELETE FROM|node_encounter|node_pending_event|scheduler|shutdown_world/);
 });
 it('allows only same-active-arena movement without an ordinary canary row',()=>{
  const scope=body('combat2_movement_scope_eligible');
  expect(scope).toContain('d.arena_id=o.arena_id AND d.active');
  expect(scope).toContain('a.id=o.arena_id AND a.active');
  expect(scope).not.toContain('combat2_test_run');
  for(const fn of ['combat2_depart','combat2_party_depart'])expect(body(fn)).toContain('combat2_movement_scope_eligible(origin,_destination_node_id)');
 });
 it('shuts down only after players and live claims are absent and permits restart later',()=>{
  const idle=body('idle_shutdown_check');
  expect(idle).toContain("last_online>now()-interval '30 minutes'");
  expect(idle).toContain('claim_expires_at>now()');
  expect(idle).toContain("SET value='maintenance'");
  expect(idle).toContain('combat2_dispatch_scheduler_disable()');
  expect(idle).toContain('shutdown_world()');
  expect(idle).not.toContain('combat2_test_run');
  expect(SQL).not.toMatch(/combat2_test_environment_start_without|DROP FUNCTION public\.combat2_test_environment_start/);
 });
});
