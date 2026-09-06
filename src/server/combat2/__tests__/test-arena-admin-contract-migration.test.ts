import { readFileSync, readdirSync } from 'node:fs';
import { describe,expect,it } from 'vitest';
const SQL=readFileSync('supabase/migrations/20260906001327_2c0c7a72-6eea-4cb2-b282-2175f4c1d2ca.sql','utf8').replaceAll('\r\n','\n');
const UI=readFileSync('src/components/admin/Combat2TestArenaPanel.tsx','utf8');
const API=readFileSync('src/features/combat2-test-arena/admin-api.ts','utf8');
const IDENTITY=readFileSync('src/features/combat2/arena-identity.ts','utf8');
describe('Combat2 arena admin contract',()=>{
 it('retains exactly one ledger-recorded migration for each arena batch',()=>{
  const files=readdirSync('supabase/migrations');
  expect(files.filter(f=>f.includes('ab9fdebc-0a3a-4b6a-a0a3-b99b944953a8'))).toHaveLength(1);
  expect(files.filter(f=>f.includes('8c52869c-2e3d-4602-aa5a-96ea750f63d6'))).toHaveLength(1);
  expect(files.filter(f=>f.includes('2c0c7a72-6eea-4cb2-b282-2175f4c1d2ca'))).toHaveLength(1);
  expect(files.some(f=>/202609052(?:21000|30000|33000)_/.test(f))).toBe(false);
 });
 it('projects safe status and access without credentials or unrestricted tables',()=>{
  expect(SQL).toContain('combat2_test_admin_allowed()');
  for(const field of ['reset_eligible','tester_count','claimed_encounter_count','pending_intent_count','pending_event_count','diagnostic_history_exists'])expect(SQL).toContain(`'${field}'`);
  expect(SQL).not.toMatch(/email|service_role_key|worker_secret|raw_snapshot/i);
  expect(SQL).toContain('REVOKE ALL ON FUNCTION public.combat2_test_status(uuid) FROM PUBLIC,anon');
 });
 it('adds narrow admin relocation with registry, access, ownership, claim and departure guards',()=>{
  for(const guard of ['x.user_id','x.active AND x.revoked_at IS NULL','n.arena_id=_arena_id','claim_token IS NOT NULL',"d.status='pending'",'combat2_depart_required'])expect(SQL).toContain(guard);
  expect(SQL).toContain("set_config('app.combat2_test_relocate_authorized','true',true)");
  expect(SQL).toContain('REVOKE ALL ON FUNCTION public.combat2_test_admin_relocate(uuid,uuid,uuid) FROM PUBLIC,anon');
 });
 it('keeps the UI RPC-only, guarded by the existing admin route and exact confirmations',()=>{
  expect(UI).not.toMatch(/\.from\(['"](?:combat2_test|characters|node_)/);
  expect(UI).not.toMatch(/service.role|service_role|current_node_id|dispatcher|worker/i);
  expect(IDENTITY).toContain("resetPhrase: 'RESET COMBAT2 TEST ARENA'");
  expect(UI).toContain('Stop test run and preserve evidence');
  expect(API).toContain('_confirm_destroy_diagnostics:true');
  expect(UI).toContain('disabled={!status?.resetEligible||!!busy}');
  expect(UI).toContain('resetPhrase!==COMBAT2_TEST_ARENA.resetPhrase');
  expect(UI).toContain('crypto.randomUUID()');
  expect(UI).toContain('snapshot!==selection.current');
  expect(UI).not.toMatch(/setInterval|autoRetry|optimistic/i);
  expect(API.match(/combat2_test_[a-z_]+/g)?.every(name=>['combat2_test_status','combat2_test_grant','combat2_test_revoke','combat2_test_admin_relocate','combat2_test_stop','combat2_test_reset'].includes(name))).toBe(true);
  const route=readFileSync('src/pages/AdminRoute.tsx','utf8'); expect(route).toContain('!isAdmin'); expect(route).toContain('<AdminPage');
 });
});
