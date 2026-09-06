import {readFileSync,readdirSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
const SQL=readFileSync('supabase/migrations/20260906134803_7ca9b782-4f52-47e1-9691-8b286ca26c48.sql','utf8').replaceAll('\r\n','\n').toLowerCase();
const allMigrations=(readFileSync('supabase/migrations/20260831133000_combat2_dispatch_scheduler_foundation.sql','utf8')+
 readFileSync('supabase/migrations/20260902093129_6e2ff6de-db65-4d4d-83e1-dadcfebaa70c.sql','utf8')+
 readFileSync('supabase/migrations/20260902123413_f5e0f14f-b91d-451a-a267-fbe6fea9665c.sql','utf8')+
 readFileSync('supabase/migrations/20260906001238_8c52869c-2e3d-4602-aa5a-96ea750f63d6.sql','utf8')).toLowerCase();
describe('Combat2 internal-state RLS hardening',()=>{
 it('enables non-forced RLS with no client policy or privilege',()=>{
  for(const table of ['combat2_dispatch_schedule_state','node_arrival_group']){
   expect(SQL).toContain(`alter table public.${table} enable row level security`);
   expect(SQL).toContain(`revoke all on table public.${table} from public,anon,authenticated`);
  }
  const statements = SQL.split('\n').filter((line)=>!line.trimStart().startsWith('--')).join('\n');
  expect(statements).not.toContain(' force row level security');
  expect(statements).not.toContain('create policy');
  expect(statements).not.toMatch(/grant[^;]+\bto\s+(public|anon|authenticated)\b/);
 });
 it('keeps only minimum service-role table operations',()=>{
  expect(SQL).toContain('grant select,update on table public.combat2_dispatch_schedule_state to service_role');
  expect(SQL).toContain('grant select,insert,update,delete on table public.node_arrival_group to service_role');
  expect(SQL).not.toContain('grant all');
 });
 it('leaves privileged scheduler and arrival-group function bodies intact',()=>{
  for(const fn of ['combat2_dispatch_scheduler_fire','combat2_dispatch_scheduler_enable','combat2_refresh_tanks','combat_enter'])expect(allMigrations).toContain(fn);
  expect(allMigrations).toContain('security definer');
  expect(allMigrations).toContain('combat2_dispatch_schedule_state');
  expect(allMigrations).toContain('node_arrival_group');
  expect(SQL).not.toMatch(/create or replace function|insert into|update public|delete from/);
 });
 it('has no browser/Edge direct access or Realtime publication',()=>{
  const code=(readdirSync('src',{recursive:true}) as string[]).filter(f=>/\.(ts|tsx)$/.test(f)&&!f.includes('integrations\\supabase\\types.ts')).map(f=>readFileSync(`src/${f}`,'utf8')).join('\n')+
   (readdirSync('supabase/functions',{recursive:true}) as string[]).filter(f=>/\.ts$/.test(f)).map(f=>readFileSync(`supabase/functions/${f}`,'utf8')).join('\n');
  expect(code).not.toMatch(/\.from\(['"](?:combat2_dispatch_schedule_state|node_arrival_group)['"]\)/);
  const migrations=(readdirSync('supabase/migrations') as string[]).map(f=>readFileSync(`supabase/migrations/${f}`,'utf8')).join('\n');
  expect(migrations).not.toMatch(/alter publication supabase_realtime add table public\.(?:combat2_dispatch_schedule_state|node_arrival_group)/i);
  const types=readFileSync('src/integrations/supabase/types.ts','utf8');
  expect(types).toContain('combat2_dispatch_schedule_state:'); expect(types).toContain('node_arrival_group:');
 });
});
