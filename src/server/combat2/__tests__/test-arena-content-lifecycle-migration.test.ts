import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { adaptBossCast } from '@/shared/combat2/boss-catalog';

const SQL = readFileSync('supabase/migrations/20260906001238_8c52869c-2e3d-4602-aa5a-96ea750f63d6.sql','utf8').replaceAll('\r\n','\n');
const ids = (prefix: string) => [...SQL.matchAll(new RegExp(`'(${prefix}[0-9a-f-]+)'`,'g'))].map(m=>m[1]);

describe('permanent Combat2 proving-ground content and lifecycle', () => {
 it('owns exactly one isolated region, arena and five registered nodes', () => {
  expect(SQL).toMatch(
    /INSERT INTO public\.combat2_test_arena[\s\S]*?VALUES\s*\(\s*'ffff5000-0000-4000-8000-000000000002',\s*'combat2_proving_ground'/,
  );
  expect(SQL).toContain("'combat2_proving_ground'");
  for(const purpose of ['staging','low','equal','high_damage','boss']) expect(SQL).toContain(`'${purpose}',true`);
  expect(new Set(ids('ffff501'))).toHaveLength(5);
  expect(SQL).not.toMatch(/is_teleport[^\n]*true|"hidden":true|"locked":true/);
  expect(SQL).toMatch(/CREATE POLICY "Visible regions"[\s\S]*combat2_test_region_visible/);
 });

 it('has only visible unlocked staging spokes and their reverse edges', () => {
  const connections=[...SQL.matchAll(/'\[(\{[^']*"node_id"[^']*)\]'/g)].map(m=>m[1]);
  expect(connections).toHaveLength(5);
  expect(connections.every(c=>!c.includes('"hidden":true')&&!c.includes('"locked":true'))).toBe(true);
  for(const chamber of ['ffff5011','ffff5012','ffff5013','ffff5014']) {
   expect(SQL.match(new RegExp(chamber,'g'))!.length).toBeGreaterThanOrEqual(3);
  }
  expect(SQL).not.toMatch(/"node_id":"(?!ffff501[0-4])/);
 });

 it('registers controlled rewardless creatures and a supported deterministic cast', () => {
  expect(new Set(ids('ffff502'))).toHaveLength(6);
  expect(SQL.match(/,0,'salvage_only','\[\]',NULL,86400/g)).toHaveLength(6);
  expect(SQL).toContain("false,false,false,true,0,'salvage_only'");
  const cast={enabled:true,ability_key:'proving_ground_slam',label:'Proving Ground Slam',cast_ms:4000,cooldown_ms:4000,
   chance:1,base_amount:35,target_mode:'tank',damage_type:'physical',cast_flavor:'raises its testing hammer',hit_flavor:'brings the testing hammer down'};
  expect(adaptBossCast('ffff5025-0000-4000-8000-000000000001',cast)).toMatchObject({ability:{windup_ticks:2,magnitude:35,targeting:'tank'}});
  expect(SQL).not.toMatch(/stored_power|accumulate|loot_table_id[^\n]*ffff/);
 });

 it('keeps admin contracts narrow and stores replay results without identities or snapshots', () => {
  for(const sig of ['combat2_test_status(uuid)','combat2_test_grant(uuid,uuid,uuid)','combat2_test_revoke(uuid,uuid,uuid)','combat2_test_stop(uuid,uuid)','combat2_test_reset(uuid,uuid,boolean)']) expect(SQL).toContain(sig);
  expect(SQL).toContain("auth.role()='service_role' OR public.is_steward_or_overlord()");
  expect(SQL).toMatch(/id=_character_id AND user_id=_user_id/);
  expect(SQL).not.toMatch(/@|service_role_key|worker_secret|raw_snapshot/i);
 });

 it('stops only bound encounters, fences claims and preserves diagnostics', () => {
  expect(SQL).toContain("status='ended',stop_reason='test_stop',claim_token=NULL,claimed_tick=NULL,claim_expires_at=NULL");
  expect(SQL).toContain("reject_reason='test_stop'");
  const stop=SQL.slice(SQL.indexOf('combat2_test_stop('),SQL.indexOf('combat2_test_reset('));
  expect(stop).toContain('test_arena_id=_arena_id');
  expect(stop).not.toMatch(/combat_mode|world_state|scheduler|DELETE FROM public\.node_tick_batch|DELETE FROM public\.node_tick_log/);
  expect(stop).toContain("prior.operation<>'stop'");
  expect(stop).toContain("'kind','stop_failed'");
  for(const count of ['intents_rejected','events_consumed','effects_removed','fighters_absented','groups_deactivated']) expect(stop).toContain(`'${count}'`);
 });

 it('requires stopped state and confirmation, then deletes only registry-derived runtime scope', () => {
  const reset=SQL.slice(SQL.indexOf('combat2_test_reset('));
  expect(reset).toContain('confirmation_required');
  expect(reset).toContain('arena_not_stopped');
  expect(reset).toContain('test_arena_id=_arena_id');
  expect(reset).toContain('SELECT node_id INTO staging');
  expect(reset).toContain("purpose='staging'");
  expect(reset).toContain("SET current_node_id=staging,hp=c.max_hp,cp=c.max_cp,mp=c.max_mp,died_at=NULL");
  expect(reset).toContain('x.active AND x.revoked_at IS NULL');
  expect(reset).toContain('SET hp=r.baseline_hp,is_alive=true,died_at=NULL');
  for(const table of ['combat2_tick_notification','node_tick_log','combat2_departure_request','node_reward_claim','node_ground_loot','node_encounter']) expect(reset).toContain(`DELETE FROM public.${table}`);
  for(const count of ['encounters_deleted','characters_restored','creatures_restored']) expect(reset).toContain(`'${count}'`);
  expect(reset).toContain("'kind','reset_failed'");
  expect(reset).not.toMatch(/SET[^;]*(xp|gold|class|level)|DELETE FROM public\.(nodes|creatures|regions|combat2_test_arena)(\s|;)/);
  expect(reset).not.toMatch(/combat_mode|world_state|scheduler/);
 });
});
