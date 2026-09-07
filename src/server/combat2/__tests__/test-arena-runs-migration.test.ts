import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SQL=readFileSync('supabase/migrations/20260907110000_combat2_test_runs.sql','utf8').replaceAll('\r\n','\n');
const body=(name:string)=>SQL.slice(SQL.indexOf(`FUNCTION public.${name}`),SQL.indexOf('END; $$;',SQL.indexOf(`FUNCTION public.${name}`))+8);

describe('Combat2 Test Arena diagnostic runs',()=>{
 it('stores one private recording run per arena and durable ordered batch evidence',()=>{
  expect(SQL).toContain("CHECK(status IN('recording','completed'))");
  expect(SQL).toContain("UNIQUE INDEX combat2_test_run_one_recording_per_arena ON public.combat2_test_run(arena_id) WHERE status='recording'");
  expect(SQL).toContain('batch_id uuid NOT NULL UNIQUE');
  expect(SQL).toContain('UNIQUE(run_id,seq)');
  for(const table of ['combat2_test_run','combat2_test_run_batch','combat2_test_run_event']){
   expect(SQL).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
   expect(SQL).toMatch(new RegExp(`REVOKE ALL ON TABLE[^;]*${table}[^;]*FROM PUBLIC,anon,authenticated`));
  }
 });

 it('starts with admin authorization, locking, idempotency and no global mutation',()=>{
  const start=body('combat2_test_run_start');
  expect(start).toContain('combat2_test_admin_allowed()');expect(start).toContain('pg_advisory_xact_lock');
  expect(start).toContain('start_request_id=_request_id');expect(start).toContain('request_id_conflict');expect(start).toContain('already_recording');
  expect(start).toContain('x.active AND x.revoked_at IS NULL');expect(start).toContain("'environment_ready'");expect(start).toContain("'environment_closed'");
  expect(start).not.toMatch(/UPDATE public\.combat_config|wake_world|scheduler_enable|INSERT INTO public\.node_encounter/);
 });

 it('associates only committed matching arena batches and never retroactively attaches',()=>{
  const trigger=body('combat2_test_attach_committed_batch');
  expect(SQL).toContain('AFTER INSERT ON public.node_tick_batch');
  expect(trigger).toContain('SELECT e.test_arena_id INTO arena');expect(trigger).toContain('IF arena IS NULL THEN RETURN NEW');
  expect(trigger).toContain("r.arena_id=arena AND r.status='recording'");expect(trigger).toContain('IF active_run IS NULL THEN RETURN NEW');
  expect(trigger).toContain('ON CONFLICT(batch_id) DO NOTHING');expect(trigger).not.toMatch(/snapshot|proposal|claim_token|intent_cutoff/i);
 });

 it('stops under the same arena lock, freezes the boundary, and leaves global state alone',()=>{
  const stop=body('combat2_test_run_stop');
  expect(stop).toContain('pg_advisory_xact_lock');expect(stop).toContain('public.combat2_test_stop(_arena_id,stop_request)');
  expect(stop).toContain("status='completed',completed_at=now(),stop_request_id=_request_id,final_seq=boundary");
  expect(stop).toContain('already_completed');expect(stop).toContain('no_recording_run');
  expect(stop).not.toMatch(/combat_config|world_state|scheduler|DELETE FROM|reset/i);
 });

 it('serves stable bounded report pages containing only safe projected events',()=>{
  const report=body('combat2_test_run_report');const projection=body('combat2_test_safe_event');
  expect(report).toContain('GREATEST(1,LEAST(COALESCE(_limit,25),50))');expect(report).toContain('b.seq>cursor_value AND b.seq<=latest ORDER BY b.seq LIMIT page_limit');
  for(const field of ['latest_seq','returned_through_seq','has_more','duration_ms','summary','batches'])expect(report).toContain(`'${field}'`);
  for(const safe of ['kind','actor','target','abilityKey','amount','hitQuality','outcomeReason','meta'])expect(projection).toContain(`'${safe}'`);
  expect(projection).not.toMatch(/snapshot|proposal|claim|lease|cutoff|service|email|token|secret/i);
 });

 it('reconciles summary metrics from archived safe events',()=>{
  const stop=body('combat2_test_run_stop');
  for(const metric of ['player_basic_attacks','abilities','creature_attacks','misses','crits','healing','damage_prevented','absorbed_damage','effect_events','opportunity_attacks','movement_flee','deaths','diagnostic_events'])expect(stop).toContain(`'${metric}'`);
  expect(stop).toContain('LEFT JOIN public.combat2_test_run_event');
 });

 it('preserves completed evidence through Reset and refuses Reset while recording',()=>{
  const reset=body('combat2_test_reset');
  expect(reset).toContain("status='recording'");expect(reset).toContain("'kind','recording_run_active'");
  expect(reset).not.toMatch(/DELETE FROM public\.combat2_test_run/);
  expect(reset).toContain('SET current_node_id=staging,hp=c.max_hp,cp=c.max_cp,mp=c.max_mp');
  expect(reset).not.toMatch(/UPDATE public\.characters[^;]*\b(last_death_at|died_at)\s*=/);
 });

 it('exposes only admin RPC execution and no direct browser table access',()=>{
  for(const fn of ['combat2_test_run_start(uuid,uuid)','combat2_test_run_stop(uuid,uuid)','combat2_test_run_report(uuid,uuid,bigint,integer)']){
   expect(SQL).toContain(`REVOKE ALL ON FUNCTION public.${fn} FROM PUBLIC,anon`);expect(SQL).toContain(`GRANT EXECUTE ON FUNCTION public.${fn} TO authenticated,service_role`);
  }
  expect(SQL).not.toMatch(/GRANT (SELECT|INSERT|UPDATE|DELETE|ALL) ON TABLE[^;]* TO authenticated/);
 });
});
