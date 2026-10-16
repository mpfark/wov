// LOCAL / NON-DEPLOYABLE. Extract complete definitions, never execute migrations.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root=new URL('../../../',import.meta.url);
const hash=s=>createHash('sha256').update(s).digest('hex');
const paths=[
 'drizzle/migrations/0001_progression_001c_dormant_authority.sql',
 'drizzle/migrations/0002_progression_001d_canonical_xp_cutover.sql',
 'drizzle/migrations/0003_progression_001e_command_authority.sql',
 'drizzle/migrations/0004_progression_001e_r2_xp_body_repair.sql',
 'drizzle/migrations/0005_progression_001f_canonical_renown_respec_authority.sql',
 'docs/operations/legacy-001F5-party-parity-envelope.json',
 'drizzle/migrations/0013_progression_001g_c2_reset_and_cutover.sql'];
const hashes=['e9526a64e166fc8ca84ee80a8397ebec9c919922078e84563aa2ef83b239557a','680915c6e25bba22c81db88b9a48ed49efad365dd38ddbc924f10fcb4c47637f','225cb43a26f63f8e9a5645bb60ab0b273847773a5c51310d75ac118721419968','c784b935b0178d8812605503e498276e0ef2ec09bc58ce679133281fbdd77201','c5c3c05341a7fc42678326d9572ed1442f04579e568d228b4d89f5eb811e18ff','1bf3ab0e87576eb41211dfa6d6fcabb107435828601b0652d8025ce2dec3e43e'];
export const manifest=[];
hashes.push('c93fd93efb75dd9e2ab8478b8672678b2ecd40be846c46da62d19318cbc48b40');
function load(i){const t=readFileSync(new URL(paths[i],root),'utf8').replace(/\r\n/g,'\n');assert.equal(hash(t),hashes[i],paths[i]+' drift');return t;}
function adapt(d){return d.replaceAll('public.','g4a6.').replaceAll('auth.uid()','g4a9.actor_uid()').replaceAll('SECURITY DEFINER','SECURITY INVOKER').replaceAll('SET search_path=pg_catalog,public','SET search_path=pg_catalog,g4a6,pg_temp').replace(/SET search_path TO [^\n]+/g,'SET search_path=pg_catalog,g4a6,pg_temp').replace(/\bclock_timestamp\(\)|\bnow\(\)/g,'g4a6.test_now()');}
function add(d,i,name){const a=adapt(d);manifest.push({source:paths[i],fileLfSha256:hashes[i],identity:name,definitionSha256:hash(d),adaptedSha256:hash(a)});return a+'\n';}
function fn(i,name){const t=load(i),re=new RegExp('CREATE (?:OR REPLACE )?FUNCTION public\\.'+name+'\\('),m=t.match(re);assert(m,name);const s=m.index,tail=t.slice(s),delimiter=tail.match(/\bAS (\$[a-z_]*\$)/i)?.[1];assert(delimiter,name+' delimiter');const first=tail.indexOf(delimiter),end=tail.indexOf(delimiter,first+delimiter.length);assert(end>first);return add(tail.slice(0,end+delimiter.length)+';',i,name);}
function table(i,name){const t=load(i),start=t.indexOf('CREATE TABLE public.'+name+' ('),end=t.indexOf('\n);',start);assert(start>=0&&end>start,name);return add(t.slice(start,end+3),i,name);}
export function buildProgression(){
 manifest.length=0;
 let sql="DO $$ BEGIN IF current_database() NOT LIKE 'g4a6_fixture_g4a12_g4a13_g4a14_%' OR to_regclass('g4a6.fixture_marker') IS NULL THEN RAISE EXCEPTION 'private disposable fixture only'; END IF; END $$;\n";
 sql+='DROP FUNCTION g4a6.combat2_apply_claim_progression_internal(uuid,uuid);\nDROP TABLE g4a12.progression_calls;\n';
 for(const n of ['progression_character_state','progression_receipt','progression_respec_milestone'])sql+=table(0,n);
 sql+=table(2,'progression_class_growth_milestone');
 for(const n of ['progression_snapshot_internal','progression_class_config_internal','character_sync_derived_internal'])sql+=fn(0,n);
 sql+=fn(3,'progression_apply_xp_internal')+fn(1,'combat2_apply_claim_progression_internal')+fn(2,'progression_verify_class_growth_internal')+fn(4,'progression_refuse_raw_progression_write');
 const command=load(2);const trigger=command.match(/CREATE CONSTRAINT TRIGGER progression_verify_class_growth[\s\S]*?\(\);/)[0];sql+=add(trigger,2,'progression_verify_class_growth binding');
 sql+='CREATE TRIGGER progression_refuse_raw_progression_write BEFORE UPDATE ON g4a6.characters FOR EACH ROW EXECUTE FUNCTION g4a6.progression_refuse_raw_progression_write();\n';
 const archive=JSON.parse(load(5));const death=archive.functions.find(f=>f.requested_identity==='release_stances_on_death()');assert(death?.definition);sql+=add(death.definition+';',5,'release_stances_on_death');
 const binding=archive.triggers.find(t=>t.name==='trg_characters_release_stances_on_death');assert(binding);sql+=add(binding.definition.replace(' ON characters ',' ON public.characters ').replace('FUNCTION release_stances_on_death','FUNCTION public.release_stances_on_death')+';',5,binding.name);
 // Exact C2 binding template, limited to touched dependencies present here.
 const c2=load(6),template="CREATE TRIGGER character_lifecycle_child_fence BEFORE INSERT OR UPDATE OR DELETE ON public.%I\n      FOR EACH ROW EXECUTE FUNCTION public.character_lifecycle_child_fence(''character_id'')";assert(c2.includes(template),'C2 binding drift');
 for(const n of ['character_inventory','character_stance','character_stance_request','progression_character_state','progression_receipt','progression_respec_milestone','progression_class_growth_milestone','node_reward_claim','node_participation']){
  assert(c2.includes("'"+n+"'"),n+' C2 target drift');
  sql+=`DROP TRIGGER IF EXISTS character_lifecycle_child_fence ON g4a6.${n};\n`+add(template.replace('%I',n).replaceAll("''","'")+';',6,n+' C2 child binding');
 }
 assert(!sql.includes('public.')&&!sql.includes('auth.'),'isolated namespace');return sql;
}
