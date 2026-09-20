import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
const SQL=readFileSync('supabase/migrations/20260921110000_combat2_diagnostic_dispatch_integration.sql','utf8').toLowerCase();
describe('diagnostic dispatcher integration migration',()=>{
 it('derives relevance from authoritative active session, character, fighter, node and encounter state',()=>{
  for(const token of ['s.stopped_at is null','s.expires_at>clock_timestamp()','ch.current_node_id=c.node_id','nf.character_id=s.character_id','nf.present','s.encounter_id is null or s.encounter_id=c.encounter_id'])expect(SQL).toContain(token);
 });
 it('keeps browser roles away and delegates to the existing protected sink',()=>{
  expect(SQL).toContain("auth.role() is distinct from 'service_role'");
  expect(SQL).toContain('perform public.combat2_diagnostic_record_server_event');
  expect(SQL).toContain('from public,anon,authenticated');
 });
 it('bounds batches and capacity while containing diagnostic failure',()=>{
  expect(SQL).toContain('jsonb_array_length(_events)>32'); expect(SQL).toContain('before_count>=2000');
  expect(SQL).toContain("'diagnostic_failure'"); expect(SQL).not.toContain('supabase_realtime');
 });
});
