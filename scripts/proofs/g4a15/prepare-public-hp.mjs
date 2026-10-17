// Forward authoring only; no connection, migration runner or hosted operations.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {buildFull,definitions} from '../g4a12/source-adapters.mjs';
const root=new URL('../../../',import.meta.url),read=p=>fs.readFileSync(new URL(p,root),'utf8').replace(/\r\n/g,'\n');
const hash=(s,algo='sha256')=>createHash(algo).update(s).digest('hex'),lit=s=>"'"+s.replaceAll("'","''")+"'";
const normalized=s=>s.replace(/\s+/g,' ');
const f5=JSON.parse(read('docs/operations/legacy-001F5-party-parity-envelope.json'));
assert.equal(hash(read('docs/operations/legacy-001F5-party-parity-envelope.json')),'1bf3ab0e87576eb41211dfa6d6fcabb107435828601b0652d8025ce2dec3e43e');
function extract(text,name){const start=text.search(new RegExp('CREATE(?: OR REPLACE)? FUNCTION public\\.'+name+'\\s*\\('));assert(start>=0,name);const t=text.slice(start),m=/\bAS\s+(\$\w*\$)/i.exec(t);assert(m);const begin=m.index+m[0].length,end=t.indexOf(m[1],begin);assert(end>begin);return {definition:t.slice(0,end+m[1].length),body:t.slice(begin,end)};}
const archived=n=>f5.functions.find(f=>f.requested_identity.startsWith('public.'+n+'('))?.definition;
const fileBody=(p,n)=>extract(read(p),n).definition;
export function targets(){buildFull();return [
 ['combat_enter','uuid,uuid',archived('combat_enter'),'ARRAY[(SELECT current_node_id FROM public.characters WHERE id=_character_id)]','ARRAY[_character_id]'],
 ['combat2_hostile_action','uuid,text,text,uuid,uuid',fileBody('supabase/migrations/20260928100000_combat2_authoritative_arrival_hostile_initiation.sql','combat2_hostile_action'),'ARRAY[(SELECT current_node_id FROM public.characters WHERE id=_character_id)]','ARRAY[_character_id]'],
 ['combat2_depart','uuid,uuid,uuid',archived('combat2_depart'),'ARRAY[_destination_node_id,(SELECT current_node_id FROM public.characters WHERE id=_character_id)]','ARRAY[_character_id]'],
 ['combat2_party_depart','uuid,uuid,uuid',archived('combat2_party_depart'),'ARRAY[_destination_node_id,(SELECT current_node_id FROM public.characters WHERE id=_leader_character_id)]','ARRAY[_leader_character_id]'],
 ['combat2_arrive_after_relocation','uuid,uuid',fileBody('supabase/migrations/20260928100000_combat2_authoritative_arrival_hostile_initiation.sql','combat2_arrive_after_relocation'),'ARRAY[(SELECT current_node_id FROM public.characters WHERE id=_character_id)]','ARRAY[_character_id]'],
 ['node_tick_claim','uuid,integer',definitions.find(d=>d.identity==='node_tick_claim').definition,'ARRAY[_node_id]','ARRAY[]::uuid[]'],
 ['node_tick_commit','uuid,uuid,integer,integer,bigint,uuid[],jsonb',definitions.find(d=>d.identity==='node_tick_commit').definition,"ARRAY[(SELECT node_id FROM public.node_encounter WHERE id=_encounter_id)] || ARRAY(SELECT (v->>'destination_node_id')::uuid FROM jsonb_array_elements(coalesce(_proposed->'departures','[]')) v WHERE v->>'outcome'='moved')",'ARRAY[]::uuid[]'],
 ['respawn_creatures','',fileBody('supabase/migrations/20260629060824_a75ddfbf-a2d4-4e53-b368-b3f47ef8ebbe.sql','respawn_creatures'),'ARRAY(SELECT DISTINCT node_id FROM public.creatures WHERE node_id IS NOT NULL)','ARRAY[]::uuid[]','void'],
 ];}

// Read SQL tokens, skipping strings/identifiers/comments. RETURN expressions are
// retained exactly and evaluated once; no regex edits inside dynamic SQL/text.
function statements(src){const out=[];let i=0;const skip=()=>{if(src.startsWith('--',i)){i=src.indexOf('\n',i);if(i<0)i=src.length;return true;}if(src.startsWith('/*',i)){let depth=1;i+=2;while(depth&&i<src.length){if(src.startsWith('/*',i)){depth++;i+=2;}else if(src.startsWith('*/',i)){depth--;i+=2;}else i++;}assert.equal(depth,0);return true;}if(src[i]==="'"||src[i]==='"'){const q=src[i++];while(i<src.length){if(src[i++]===q){if(src[i]===q){i++;continue;}return true;}}throw Error('unterminated SQL string');}const m=/^\$\w*\$/.exec(src.slice(i));if(m){const end=src.indexOf(m[0],i+m[0].length);assert(end>=0);i=end+m[0].length;return true;}return false;};
 while(i<src.length){if(skip())continue;const m=/^[A-Za-z_][A-Za-z_0-9]*/.exec(src.slice(i));if(m){const start=i;i+=m[0].length;if(m[0].toUpperCase()!=='RETURN')continue;const expression=i;while(i<src.length){if(skip())continue;if(src[i]===';')break;i++;}assert(i<src.length);out.push({old:src.slice(start,++i),expression:src.slice(expression,i-1).trim()});}else i++;}return out;}

export function patch(target,adapt=s=>s){const [name,args,def,nodes,actors,returns='jsonb']=target;assert(def,name);const original=adapt(extract(def,name).body),isVoid=returns==='void';const changes=[...new Map(statements(original).map(s=>[s.old,s])).values()].map(s=>[s.old,isVoid?'EXIT hp_original;':`hp_result := ${s.expression}; EXIT hp_original;`]);
 let prefix=`DECLARE hp_scope jsonb; hp_result jsonb; hp_inherited text:=current_setting('app.creature_hp_coverage',true);\nBEGIN\n`;
 if(name==='combat2_arrive_after_relocation')prefix+=`IF nullif(hp_inherited,'') IS NULL THEN RAISE EXCEPTION 'arrival requires early HP coverage' USING ERRCODE='40001'; END IF;\n`;
 prefix+=`hp_scope:=public.creature_hp_cover(${nodes},${actors});\nPERFORM set_config('app.creature_hp_coverage',hp_scope::text,true);\nBEGIN\n`;
 // The origin's live commit lease must remain untouched until the inner commit
 // validates it. Only other covered nodes can settle before an in-tick arrival.
 if(name==='node_tick_commit')prefix+=`IF (SELECT tick FROM public.node_encounter WHERE id=_encounter_id)<_candidate_tick THEN PERFORM public.creature_hp_account(jsonb_set(hp_scope,'{creatures}',coalesce((SELECT jsonb_agg(v) FROM jsonb_array_elements(hp_scope->'creatures') v WHERE (v->>'node_id')::uuid IS DISTINCT FROM (SELECT node_id FROM public.node_encounter WHERE id=_encounter_id)),'[]'))); END IF;\n`;
 else prefix+=`PERFORM public.creature_hp_account(hp_scope);\n`;
 prefix+='<<hp_original>>\n';
 let suffix=`\n`;
 if(!isVoid)suffix+=`IF hp_result->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'HP boundary refusal' USING ERRCODE='P1021'; END IF;\n`;
 if(name==='respawn_creatures')suffix+=`UPDATE public.node_encounter SET state_version=state_version+1,claim_token=NULL,claimed_tick=NULL,claim_expires_at=NULL WHERE id IN(SELECT nc.encounter_id FROM public.node_creature nc JOIN public.creatures c ON c.id=nc.creature_id JOIN jsonb_array_elements(hp_scope->'creatures') v ON (v->>'id')::uuid=c.id WHERE (v->>'spawn_seq')::integer IS DISTINCT FROM c.spawn_seq);\n`;
 if(name==='node_tick_commit')suffix+=`IF hp_result->>'kind'='committed' THEN PERFORM public.creature_hp_account(hp_scope); END IF;\n`;
 else suffix+=`PERFORM public.creature_hp_account(hp_scope);\n`;
 if(!isVoid)suffix+=`EXCEPTION WHEN SQLSTATE 'P1021' THEN NULL;\n`;
 suffix+=`END;\nPERFORM set_config('app.creature_hp_coverage',coalesce(hp_inherited,''),true);\n${isVoid?'RETURN;':'RETURN hp_result;'}\nEND;\n`;
 prefix=adapt(prefix);suffix=adapt(suffix);
 const identity=adapt('public.'+name+'('+args+')');
 return {name,identity,original,changes,prefix,suffix,sql:`-- ${name}: exact source guard; existing identity/owner/settings/ACL retained.\nDO $hp_patch$\nDECLARE function_oid regprocedure:=to_regprocedure(${lit(identity)}); old_body text; body text; definition text; before record; after record;\nBEGIN\n IF function_oid IS NULL THEN RAISE EXCEPTION 'missing HP dependency: ${name}'; END IF;\n SELECT proowner,prosecdef,proconfig,proacl INTO before FROM pg_proc WHERE pg_proc.oid=function_oid;\n SELECT prosrc,pg_get_functiondef(function_oid) INTO old_body,definition FROM pg_proc WHERE pg_proc.oid=function_oid;\n IF md5(regexp_replace(old_body,'\\s+',' ','g')) IS DISTINCT FROM ${lit(hash(normalized(original),'md5'))} THEN RAISE EXCEPTION 'source drift: ${name}'; END IF;\n body:=old_body;\n${changes.map(([a,b])=>` IF position(${lit(a)} IN body)=0 THEN RAISE EXCEPTION 'RETURN drift: ${name}'; END IF;\n body:=replace(body,${lit(a)},${lit(b)});`).join('\n')}\n body:=${lit(prefix)}||body||CASE WHEN right(btrim(body,chr(10)||chr(13)||chr(9)||chr(32)),1)=chr(59) THEN '' ELSE ';' END||${lit(suffix)};\n EXECUTE replace(definition,old_body,body);\n SELECT proowner,prosecdef,proconfig,proacl INTO after FROM pg_proc WHERE pg_proc.oid=function_oid;\n IF before IS DISTINCT FROM after THEN RAISE EXCEPTION 'HP metadata drift: ${name}'; END IF;\nEND $hp_patch$;\n`};}

export function commitPatch(adapt=s=>s){const def=definitions.find(d=>d.identity==='node_tick_commit_without_bounded_failure').definition;const original=adapt(extract(def,'node_tick_commit_without_bounded_failure').body);
 const old='           is_alive        = COALESCE((rec->>\'is_alive\')::boolean, nc.is_alive) AND nc.is_alive,';
 const replacement=old+"\n           engaged         = COALESCE((rec->>'engaged')::boolean, nc.engaged),";
 assert(original.includes(old));return `DO $hp_commit$ DECLARE function_oid regprocedure:=to_regprocedure(${lit(adapt('public.node_tick_commit_without_bounded_failure(uuid,uuid,integer,integer,bigint,uuid[],jsonb)'))}); s text; d text; BEGIN\n SELECT prosrc,pg_get_functiondef(function_oid) INTO s,d FROM pg_proc WHERE pg_proc.oid=function_oid;\n IF md5(regexp_replace(s,'\\s+',' ','g')) IS DISTINCT FROM ${lit(hash(normalized(original),'md5'))} THEN RAISE EXCEPTION 'commit source drift'; END IF;\n EXECUTE replace(d,s,replace(s,${lit(old)},${lit(replacement)}));\nEND $hp_commit$;\n`;}
export function legacyTargets(){return [
 ['regen_creature_hp','',fileBody('supabase/migrations/20260717123612_8f687cfb-1b50-4ad5-9ea0-d1f78b5122db.sql','regen_creature_hp')],
 ['heal_creatures_on_wake','',fileBody('supabase/migrations/20260805185103_b8924e02-7328-4878-a630-d1d490bfa791.sql','heal_creatures_on_wake')]];}
export function legacyPatch(t,adapt=s=>s){const [name,args,def]=t,old=adapt(extract(def,name).body),replacement=adapt(extract(read('docs/operations/legacy-001G4A20-shared-hp-candidate.sql'),name).definition);return `DO $hp_legacy$ DECLARE function_oid regprocedure:=to_regprocedure(${lit(adapt('public.'+name+'('+args+')'))}); s text; before record; after record; BEGIN
 IF function_oid IS NULL THEN RAISE EXCEPTION 'missing legacy HP dependency: ${name}'; END IF;
 SELECT prosrc INTO s FROM pg_proc WHERE oid=function_oid;
 IF md5(regexp_replace(s,'\\s+',' ','g')) IS DISTINCT FROM ${lit(hash(normalized(old),'md5'))} THEN RAISE EXCEPTION 'legacy source drift: ${name}'; END IF;
 SELECT proowner,prosecdef,proconfig,proacl INTO before FROM pg_proc WHERE oid=function_oid;
 EXECUTE ${lit(replacement)};
 SELECT proowner,prosecdef,proconfig,proacl INTO after FROM pg_proc WHERE oid=function_oid;
 IF before IS DISTINCT FROM after THEN RAISE EXCEPTION 'legacy metadata drift: ${name}'; END IF;
 END $hp_legacy$;\n`;}
export function buildPublicHP(){let base=read('docs/operations/legacy-001G4A20-shared-hp-candidate.sql');assert.equal(hash(base),'fc0eba6441f682d16b73199952b0a99a699dea2ffc2fdbeac07741f91458dc9a');const ts=targets();
 const tail=base.indexOf('CREATE OR REPLACE FUNCTION public.regen_creature_hp()');assert(tail>0);base=base.slice(0,tail)+legacyTargets().map(t=>legacyPatch(t)).join('\n')+'COMMIT;\n';
 const blocker='AND (e.node_id IS DISTINCT FROM c.node_id OR e.status=\'active\' OR e.claim_token IS NOT NULL));';assert(base.includes(blocker));
 base=base.replace(blocker,()=>blocker.slice(0,-1)+`\n OR EXISTS(SELECT 1 FROM public.creatures c WHERE c.id=cid AND (
 EXISTS(SELECT 1 FROM public.encounter_creatures ec JOIN public.encounters e ON e.id=ec.encounter_id WHERE ec.creature_id=c.id AND e.status='active')
 OR EXISTS(SELECT 1 FROM public.combat_sessions s WHERE s.node_id=c.node_id AND c.id=ANY(s.engaged_creature_ids))
 OR EXISTS(SELECT 1 FROM public.active_effects ae WHERE ae.target_id=c.id AND ae.expires_at>floor(extract(epoch FROM now())*1000)::bigint)));`);
 return base.replace(/-- G4A20[^\n]*\n-- Forward[^\n]*\n-- PARTIAL[^\n]*\n-- Replaces[^\n]*/, '-- G4A21 consolidated forward candidate. NOT INSTALLED; no automatic migration.\n-- Replaces uninstalled G4A19/G4A20 candidates, never apply sequentially.')
 .replace(/COMMIT;\s*$/,()=>read('docs/operations/legacy-001G4A21-shared-hp-hooks.sql')+'\n'+commitPatch()+ts.map(t=>patch(t).sql).join('\n')+'\n-- G4A24 approved wake-healer browser EXECUTE containment; trusted server rights retained.\nREVOKE EXECUTE ON FUNCTION public.heal_creatures_on_wake() FROM anon, authenticated, PUBLIC;\n\nCOMMIT;\n');}
if(process.argv.includes('--write'))fs.writeFileSync(new URL('docs/operations/legacy-001G4A21-shared-hp-candidate.sql',root),buildPublicHP());
