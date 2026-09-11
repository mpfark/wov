import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';

const scheduler=readFileSync('supabase/migrations/20260831133000_combat2_dispatch_scheduler_foundation.sql','utf8').toLowerCase().replace(/\s+/g,' ');
const entry=readFileSync('supabase/migrations/20260902093129_6e2ff6de-db65-4d4d-83e1-dadcfebaa70c.sql','utf8').toLowerCase().replace(/\s+/g,' ');
const activation=readFileSync('supabase/migrations/20260911222513_76362b2d-cdb0-4f60-82e3-52754aacfde6.sql','utf8').toLowerCase().replace(/\s+/g,' ');

describe('Combat2 entry-to-first-tick latency contract',()=>{
 it('wakes and enables before allowing arena access',()=>{
  const wake=activation.indexOf('perform public.wake_world()');const enable=activation.indexOf('combat2_dispatch_scheduler_enable()');const allowed=activation.indexOf("'scope','test_arena'");
  expect(wake).toBeGreaterThan(-1);expect(enable).toBeGreaterThan(wake);expect(allowed).toBeGreaterThan(enable);
 });
 it('makes a new or resumed encounter due immediately and dispatches on the shared two-second cadence',()=>{
  expect(entry).toContain("insert into public.node_encounter(node_id,status,next_due_at) values(v_node,'active',now())");
  expect(entry).toContain("set status='active',next_due_at=now()");
  expect(scheduler).toContain("'combat2-dispatch-once', '2 seconds'");
  expect(scheduler.match(/select net\.http_post\(/g)).toHaveLength(1);
 });
});
