// LOCAL / NON-DEPLOYABLE: reuse archived F5 definitions and the installed F6
// source transformation, not the old handwritten request fixtures.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root=new URL('../../../',import.meta.url),hash=s=>createHash('sha256').update(s).digest('hex');
const evidence='docs/operations/legacy-001F5-party-parity-envelope.json';
const correction='drizzle/migrations/0022_legacy_001f6_party_combat_serialization.sql';
function pinned(path,expected){const text=readFileSync(new URL(path,root),'utf8').replace(/\r\n/g,'\n');assert.equal(hash(text),expected,path+' drift');return text;}
const f5=JSON.parse(pinned(evidence,'1bf3ab0e87576eb41211dfa6d6fcabb107435828601b0652d8025ce2dec3e43e'));
const f6=pinned(correction,'bd35c28c379d6634d8017e26541de7b23f5608a18178b2ac6e13e558aa5ad27d');
export const manifest=[];
function adapt(d){return d.replaceAll('public.','g4a6.').replace(/\bnow\(\)/g,'g4a6.test_now()')
 .replaceAll('auth.uid()','g4a9.actor_uid()').replaceAll('auth.role()','g4a9.actor_role()')
 .replace(/SECURITY DEFINER/g,'SECURITY INVOKER').replace(/SET search_path TO[^\n]+/g,'SET search_path TO pg_catalog,g4a6,pg_temp');}
function qualifyResult(d){
 const needle="SELECT jsonb_agg(jsonb_build_object('character_id',character_id,'display_name',display_name,'order',movement_order,'status',status,'cost',cost) ORDER BY movement_order) INTO outcomes FROM public.combat2_party_departure_member WHERE request_id=_request_id;";
 assert(d.includes(needle),'party result qualification boundary');
 return d.replace(needle,"SELECT jsonb_agg(jsonb_build_object('character_id',m.character_id,'display_name',m.display_name,'order',m.movement_order,'status',m.status,'cost',m.cost) ORDER BY m.movement_order) INTO outcomes FROM public.combat2_party_departure_member m WHERE m.request_id=_request_id;");
}
export function partyRequestDefinition(qualified=true){const d=f5.functions.find(f=>f.requested_identity==='public.combat2_party_depart_without_canary_gate(uuid,uuid,uuid)').definition;return adapt(qualified?qualifyResult(d):d);}
function patchedParty(d){
 const declaration=' member public.party_members; created_party uuid; result jsonb; member_count integer;';
 const boundary=' -- Global order: lifecycle advisory lock, request row, actor row, party row, membership rows.';
 assert(d.includes(declaration)&&d.includes(boundary));const replacement=f6.split('replacement text:=$f6$')[1].split('$f6$;')[0];
 const result=d.replace(declaration,declaration+'\n lock_stage integer; locked_id uuid; lock_coverage jsonb; original_coverage jsonb;')
 .replace(boundary,replacement+' -- Existing request/actor/party/member authorization and mutation body unchanged.');
 assert.equal(hash(result.replace(/\s+/g,' ')),'4db8db846b0099fb87518e48de84602794c544ba3c294aacea3b4b6990822fdd','F9 historical effective party body parity');
 return result;
}
export function buildRequests(){
 manifest.length=0;let sql='';
 const ids=[
 'public.combat2_depart_without_canary_gate(uuid,uuid,uuid)',
 'public.combat2_party_depart_without_canary_gate(uuid,uuid,uuid)',
 'public.combat2_depart_without_immediate_transition(uuid,uuid,uuid)',
 'public.combat2_party_depart_without_immediate_transition(uuid,uuid,uuid)',
 'public.combat2_depart(uuid,uuid,uuid)','public.combat2_party_depart(uuid,uuid,uuid)',
 'public.party_mutate(uuid,text,uuid,uuid,uuid,uuid)','public.party_combat_mutation_blocked(uuid,uuid)',
 'public.party_operation_finish(uuid,jsonb)','public.character_lifecycle_child_fence()',
 'character_lifecycle_character_fence()','restrict_party_leader_updates()',
 'combat2_guard_owned_location_write()','trg_character_encounter_lifecycle()',
 'combat2_fighter_presence_changed()','public.combat2_refresh_tanks(uuid)',
 'public.combat2_validate_party_tank()','public.combat2_party_tank_changed()','update_updated_at()'
 ];
 for(const id of ids){
  let d=f5.functions.find(f=>f.requested_identity===id)?.definition;assert(d,id);
  const original=hash(d);let transformation='complete archived body';
  if(id.startsWith('public.party_mutate(')){d=patchedParty(d);transformation=correction;}
  if(id.startsWith('public.combat2_party_depart_without_canary_gate(')){d=qualifyResult(d);transformation='LOCAL ONLY: qualify terminal result columns; original ambiguity/refusal tested separately';}
  manifest.push({artifact:evidence,identity:id,originalDefinitionSha256:original,patchedDefinitionSha256:hash(d),transformation});
  sql+=adapt(d)+';\n';
 }
 // Full result formatter from pinned original source; F5 archive did not
 // include this identity. Clock/namespace adaptations same as above.
 const path='supabase/migrations/20260908122530_e728cbda-72d0-415c-96bf-a8758fe327ac.sql';
 const text=pinned(path,'a2f1d0476fed074ed408d901815ac696e20de14ed41aa41970eec03817dbd8bf');
 const start=text.indexOf('CREATE OR REPLACE FUNCTION public.combat2_party_departure_result('),end=text.indexOf('$$;',start)+3;assert(start>=0&&end>start);
 const d=text.slice(start,end);manifest.push({artifact:path,identity:'combat2_party_departure_result',originalDefinitionSha256:hash(d)});
 sql+=d.replaceAll('public.','g4a6.').replace('SECURITY DEFINER','SECURITY INVOKER').replace('SET search_path=public,pg_temp','SET search_path=pg_catalog,g4a6,pg_temp');
 // Bind only these exact archived trigger definitions, preserving names/order.
 const names=new Set(['character_lifecycle_character_fence','combat2_guard_owned_location_write','restrict_party_leader_character_updates','trg_characters_encounter_lifecycle','update_characters_updated_at','character_lifecycle_child_fence','combat2_fighter_presence_changed','combat2_party_tank_changed','combat2_validate_party_tank']);
 for(const t of f5.triggers.filter(t=>names.has(t.name))){
  const table=t.table.replace('public.','g4a6.');
  sql+=`\nDROP TRIGGER IF EXISTS ${t.name} ON ${table};\n`+t.definition.replace(/ ON (\w+)/,` ON ${table}`).replace('EXECUTE FUNCTION ','EXECUTE FUNCTION g4a6.')+';';
 }
 return sql+'\nREVOKE ALL ON ALL FUNCTIONS IN SCHEMA g4a6 FROM PUBLIC;';
}
