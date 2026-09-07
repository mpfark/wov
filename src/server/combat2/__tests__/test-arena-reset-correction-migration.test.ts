import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SQL=readFileSync('supabase/migrations/20260907090000_combat2_test_reset_tester_restore.sql','utf8').replaceAll('\r\n','\n');
const TYPES=readFileSync('src/integrations/supabase/types.ts','utf8').replaceAll('\r\n','\n');
const CHARACTER_TYPES=TYPES.slice(TYPES.indexOf('      characters: {'),TYPES.indexOf('      class_ability_assignments: {'));

describe('Combat2 test arena reset tester-restore correction',()=>{
 it('replaces only the reset function and retains its authorization and replay contract',()=>{
  expect(SQL.match(/CREATE OR REPLACE FUNCTION/g)).toHaveLength(1);
  expect(SQL).toContain('public.combat2_test_reset(_arena_id uuid,_request_id uuid,_confirm_destroy_diagnostics boolean) RETURNS jsonb');
  expect(SQL).toContain('public.combat2_test_admin_allowed()');
  expect(SQL).toContain("hashtextextended('combat2-test:'||_arena_id::text,0)");
  expect(SQL).toContain("prior.operation<>'reset'");
  expect(SQL).toContain("'kind','request_id_conflict'");
  expect(SQL).toContain('RETURN prior.result');
  expect(SQL).toContain("'kind','confirmation_required'");
  expect(SQL).toContain("'kind','unknown_arena'");
  expect(SQL).toContain("'kind','arena_not_stopped'");
  expect(SQL).toMatch(/REVOKE ALL ON FUNCTION public\.combat2_test_reset\(uuid,uuid,boolean\) FROM PUBLIC,anon/);
  expect(SQL).toMatch(/GRANT EXECUTE ON FUNCTION public\.combat2_test_reset\(uuid,uuid,boolean\) TO authenticated,service_role/);
 });

 it('restores only currently owned active registered testers and preserves death history',()=>{
  const testerRestore=SQL.slice(SQL.indexOf('UPDATE public.characters c'),SQL.indexOf('GET DIAGNOSTICS restored_characters'));
  const testerAssignments=testerRestore.slice(testerRestore.indexOf(' SET '),testerRestore.indexOf('\n WHERE '));
  expect(SQL).toContain("set_config('app.combat2_test_relocate_authorized','true',true)");
  expect(SQL.indexOf("set_config('app.combat2_test_relocate_authorized'")).toBeLessThan(SQL.indexOf('UPDATE public.characters c'));
  expect(testerRestore).toContain('SET current_node_id=staging,hp=c.max_hp,cp=c.max_cp,mp=c.max_mp');
  expect(testerRestore).toContain('x.character_id=c.id AND x.user_id=c.user_id AND x.active AND x.revoked_at IS NULL');
  expect(testerRestore).not.toMatch(/\bdied_at\s*=/);
  expect(testerRestore).not.toMatch(/\blast_death_at\s*=/);
  expect(testerAssignments).not.toMatch(/\b(xp|gold|level|class|user_id|loadout|equipment|inventory|materials)\s*=/i);
  for(const column of ['current_node_id','hp','max_hp','cp','max_cp','mp','max_mp','last_death_at']) expect(CHARACTER_TYPES).toMatch(new RegExp(`\\b${column}(?:\\?|):`));
  expect(CHARACTER_TYPES).not.toMatch(/\bdied_at(?:\?|):/);
 });

 it('keeps registry-derived FK-safe cleanup, permanent content, and creature restoration',()=>{
  const deletes=['combat2_tick_notification','node_tick_log','combat2_departure_request','node_reward_claim','node_ground_loot','node_encounter'];
  for(const table of deletes) expect(SQL).toContain(`DELETE FROM public.${table}`);
  for(let i=1;i<deletes.length;i++) expect(SQL.indexOf(`DELETE FROM public.${deletes[i-1]}`)).toBeLessThan(SQL.indexOf(`DELETE FROM public.${deletes[i]}`));
  expect(SQL).not.toMatch(/DELETE FROM public\.(nodes|creatures|regions|combat2_test_arena|combat2_test_arena_node|combat2_test_arena_creature|combat2_test_arena_access)(\s|;)/);
  expect(SQL).toContain('SET hp=r.baseline_hp,is_alive=true,died_at=NULL,last_damaged_at=NULL,is_aggressive=c.base_aggressive,rewards_awarded_at=NULL,spawn_seq=spawn_seq+1');
  expect(SQL).not.toMatch(/combat_mode|world_state|scheduler|dispatcher|processNodeTickOnce/i);
 });

 it('finalizes the request after cleanup and failure remains one rollback-safe exception boundary',()=>{
  const lastDelete=SQL.lastIndexOf('DELETE FROM public.node_encounter');
  const insert=SQL.indexOf('INSERT INTO public.combat2_test_arena_request');
  expect(insert).toBeGreaterThan(lastDelete);
  expect(SQL.indexOf("failure_stage:='request_finalize'")).toBeLessThan(insert);
  expect(SQL).toContain("VALUES(_request_id,_arena_id,'reset',callers,true,result); RETURN result;");
  expect(SQL.match(/EXCEPTION WHEN OTHERS/g)).toHaveLength(1);
  expect(SQL).toContain('GET STACKED DIAGNOSTICS failure_code=RETURNED_SQLSTATE');
  expect(SQL).not.toMatch(/SQLERRM|PG_EXCEPTION_DETAIL|PG_EXCEPTION_HINT|MESSAGE_TEXT/);
 });

 it('exposes only allowlisted diagnostic stages and a validated SQLSTATE',()=>{
  for(const stage of ['cleanup','tester_restore','creature_restore','request_finalize']) expect(SQL).toContain(`'${stage}'`);
  expect(SQL).toContain("failure_stage IN ('cleanup','tester_restore','creature_restore','request_finalize')");
  expect(SQL).toContain("failure_code ~ '^[[:alnum:]]{5}$'");
  expect(SQL).toContain("'ok',false,'kind','reset_failed'");
 });
});
