// LOCAL / NON-DEPLOYABLE: source is loaded, never edited or copied to migration.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const root=new URL('../../../',import.meta.url);
const pins={
 'supabase/migrations/20260902123413_f5e0f14f-b91d-451a-a267-fbe6fea9665c.sql':'fdd5d412ba3bb03a72d19f29d15925056aa0ef915c6b98579697657a5f7bcc30',
 'supabase/migrations/20260928100000_combat2_authoritative_arrival_hostile_initiation.sql':'540e2d44d853e641bc5b3f04db3067e3e459d3815f575c057b2ffb7ce4c63095',
 'supabase/migrations/20260902194101_e3b1caf6-58cf-4028-b292-49cc3c283914.sql':'ea520d8563565084bac8d9aee0fe7401aa843c5fe69bbaa297e5b4b52f2d70dd',
 'supabase/migrations/20260829135558_f0037825-ccff-4b35-b0b2-aa6566be826c.sql':'f490e131741efe48d88c5cfbdc8c443af0bf242675643a8bd32bee33c44c929d',
 'drizzle/migrations/0002_progression_001d_canonical_xp_cutover.sql':'680915c6e25bba22c81db88b9a48ed49efad365dd38ddbc924f10fcb4c47637f',
 'supabase/migrations/20260717123612_8f687cfb-1b50-4ad5-9ea0-d1f78b5122db.sql':'a81efb1600562fc6a546e8e03ae07437b3b20330d2810cc1f8e7c1765210da9b',
 'supabase/migrations/20260805185103_b8924e02-7328-4878-a630-d1d490bfa791.sql':'a4b5b63626700cd6ee91293302600e7084c22cfc8b5af9592bd3776176af494e',
 'supabase/migrations/20260629060824_a75ddfbf-a2d4-4e53-b368-b3f47ef8ebbe.sql':'671f8b0d3327826505521ef4ac5c83fed7fbcc584abe49db77e2293933ab1066',
 'supabase/migrations/20260813091924_37c97e14-37a5-4719-bfd8-eaa03442e179.sql':'3f8c76dc022106af765cb1fd8693235f053176fb083c83c785692cd0ea193a49',
};
const paths=Object.keys(pins),hash=s=>createHash('sha256').update(s).digest('hex');
export const manifest=[];
function load(index){const path=paths[index],text=readFileSync(new URL(path,root),'utf8').replace(/\r\n/g,'\n');assert.equal(hash(text),pins[path],path+' source drift');return {path,text};}
function body(index,name){const {path,text}=load(index);const re=new RegExp('CREATE(?: OR REPLACE)? FUNCTION public\\.'+name+'\\s*\\(');const start=text.search(re);assert(start>=0,name);const tail=text.slice(start);const marker=/\bAS\s+(\$\w*\$)/i.exec(tail);assert(marker,name+' dollar body');const begin=start+marker.index+marker[0].length,end=text.indexOf(marker[1],begin);assert(end>begin);
 const original=text.slice(begin,end);manifest.push({path,function:name,firstLine:text.slice(0,start).split('\n').length,bodySha256:hash(original)});return original;}
const adapt=s=>s.replaceAll('public.','g4a6.').replace(/\bnow\(\)/g,'g4a6.test_now()');
function fn(name,args,returns,source){return `CREATE FUNCTION g4a6.${name}(${args}) RETURNS ${returns} LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,g4a6,pg_temp AS $src$${adapt(source)}$src$;\n`;}
function cut(text,start,end){const a=text.indexOf(start);assert(a>=0,start);const b=text.indexOf(end,a+start.length);assert(b>a,end);return text.slice(a,b);}

export function buildAdapters(){manifest.length=0;
 let sql=fn('src_enter','_character_id uuid,_request_id uuid','jsonb',body(0,'combat_enter'));
 sql+=fn('src_hostile','_character_id uuid,_intent_kind text,_ability_key text,_target_creature_id uuid,_request_id uuid','jsonb',body(1,'combat2_hostile_action'));
 sql+=fn('combat_intent','_encounter_id uuid,_character_id uuid,_intent_kind text,_ability_key text,_stance_key text,_target_creature_id uuid,_target_character_id uuid,_request_id uuid','jsonb',body(1,'combat_intent'));
 sql+=fn('src_seed','_encounter_id uuid,_node_id uuid','void',body(2,'combat2_seed_spawns'));
 sql+=fn('src_regen','','void',body(5,'regen_creature_hp'));
 sql+=fn('src_wake','','integer',body(6,'heal_creatures_on_wake'));
 sql+=fn('src_respawn','','void',body(7,'respawn_creatures'));
 sql+=fn('src_spawn_trigger','','trigger',body(8,'bump_creature_spawn_seq'));
 sql+='CREATE TRIGGER g4a7_spawn BEFORE UPDATE OF is_alive ON g4a6.creatures FOR EACH ROW EXECUTE FUNCTION g4a6.src_spawn_trigger();\n';
 const q=body(3,'node_tick_claim');
 // Preserve claim lease/gates and literal encounter+creature JSON selection;
 // omit fighter/equipment/effect/intent snapshot sections, not their importance.
 let prefix=cut(q,'\nDECLARE',"    'fighters'");prefix=prefix.replace(/,\s*$/,'')+'\n  );\n';
 const result=q.slice(q.indexOf("  RETURN jsonb_build_object(\n    'ok', true, 'kind', 'claimed'"));assert(result.includes("'claim_token', v_token"));
 sql+=fn('src_claim','_node_id uuid,_lease_ms integer DEFAULT 5000','jsonb',prefix+result);
 const core=body(4,'node_tick_commit_without_bounded_failure');
 const guards=cut(core,'  SELECT * INTO e FROM public.node_encounter','  v_pending_ids :=');
 // Omit Arena-proposal validation (no Arena fixture), retain all lease/tick/version gates.
 const guardStart=guards.indexOf('  IF e.tick >= _candidate_tick');assert(guardStart>=0);
 const identity=cut(core,'  -- creatures: node_creature','  -- effects (update + delete)');
 const writes=cut(core,"  FOR rec IN SELECT * FROM jsonb_array_elements(COALESCE(_proposed->'creatures'",'  DELETE FROM public.node_effect');
 const deletes=cut(core,'  DELETE FROM public.node_effect',"  FOR rec IN SELECT * FROM jsonb_array_elements(COALESCE(_proposed->'effects_update'");
 const pending=cut(core,'  v_pending_ids := ARRAY(','  -- ---------- encounter-scope validation');
 const consume=cut(core,'  -- exactly-once consumption',"  FOR rec IN SELECT * FROM jsonb_array_elements(COALESCE(_proposed->'departures'");
 const terminal=cut(core,'  UPDATE public.node_encounter\n     SET tick             =',"  RETURN jsonb_build_object('ok', true, 'kind', 'committed'");
 const commit=`
DECLARE e g4a6.node_encounter; rec jsonb; v_bad text; v_pending_ids uuid[];
BEGIN
 SELECT * INTO e FROM g4a6.node_encounter WHERE id=_encounter_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'kind','stale_claim'); END IF;
 ${guards.slice(guardStart)}
 ${pending}${identity}${writes}${deletes}${consume}${terminal}
 RETURN jsonb_build_object('ok',true,'kind','committed','tick',_candidate_tick);
END;`;
 sql+=fn('src_commit_fragment','_encounter_id uuid,_claim_token uuid,_candidate_tick integer,_expected_last_tick integer,_expected_state_version bigint,_intent_ids uuid[],_proposed jsonb','jsonb',commit);
 assert(!sql.includes('public.'),'no public object references permitted');
 return sql;
}
