import { describe,it,expect } from 'vitest';
import { readFileSync } from 'node:fs';
const SQL=readFileSync('supabase/migrations/20260921100000_combat2_bounded_diagnostics.sql','utf8').toLowerCase();
describe('bounded Combat2 diagnostics migration',()=>{
 it('is admin opt-in, service-written, RLS protected and not realtime',()=>{
  for(const token of ['is_steward_or_overlord()','enable row level security','service role required','revoke all','set search_path=public,pg_temp'])expect(SQL).toContain(token);
  expect(SQL).not.toContain('supabase_realtime');
 });
 it('bounds duration, event count, retention and vocabulary',()=>{
  expect(SQL).toContain("interval '5 minutes'"); expect(SQL).toContain('next_sequence>2000');
  expect(SQL).toContain("interval '24 hours'");
  for(const event of ['rpc_received','intent_accepted','tick_due','claim_acquired','decode_completed','resolve_completed','commit_completed','notification_persisted'])expect(SQL).toContain(`'${event}'`);
 });
 it('does not alter gameplay cadence or functions',()=>{
  expect(SQL).not.toMatch(/create or replace function public\.(combat_intent|node_tick_claim|node_tick_commit|combat2_due_nodes)/);
  expect(SQL).not.toContain('pg_cron');
 });
});
