// LOCAL / NON-DEPLOYABLE. Complete pinned bodies, no historical DDL execution.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import path from 'node:path';
const root=new URL('../../../',import.meta.url),hash=s=>createHash('sha256').update(s).digest('hex');
const pins={
 'docs/operations/legacy-001F5-party-parity-envelope.json':'1bf3ab0e87576eb41211dfa6d6fcabb107435828601b0652d8025ce2dec3e43e',
 'drizzle/migrations/0002_progression_001d_canonical_xp_cutover.sql':'680915c6e25bba22c81db88b9a48ed49efad365dd38ddbc924f10fcb4c47637f',
 'drizzle/migrations/0017_legacy_001b3_stance_encounter_guard.sql':'cd170a15d6d69415cd0787de5050b1d3f79723bb5e7f70ff6296792ca0ef5f06',
 'docs/operations/progression-001D-evidence/node_tick_commit.sql':'36edc2dd1d83d3bb9be96af461188ca2f12e8b823741ddfb1e72c74abe0e3489',
 'docs/operations/progression-001D-evidence/node_tick_commit_without_character_stances.sql':'ed8eea68390aa9f910fdbe6b4905d9c41c586c23e3035c3893b5a1afddacb6a6',
 'docs/operations/progression-001D-evidence/node_tick_commit_without_authoritative_arrival.sql':'5c0ca87eb78a403cb615dfc0e0b4d024a66190898efc6957d87c30c2d4e0d2ac',
 'docs/operations/progression-001D-evidence/node_tick_commit_without_boss_timing.sql':'e5a277313c5725d06fb2fea7272347035a703ea7058177f640d16963f7798302',
};
export const manifest=[];
// G4A21 uses unadapted definitions to author guarded public-source patches.
export const definitions=[];
function load(p){const t=readFileSync(new URL(p,root),'utf8').replace(/\r\n/g,'\n');assert.equal(hash(t),pins[p],p+' drift');return t;}
const adapt=d=>d.replaceAll('public.','g4a6.').replace(/\bnow\(\)/g,'g4a6.test_now()').replace(/\bclock_timestamp\(\)/g,'g4a6.test_now()').replaceAll('SECURITY DEFINER','SECURITY INVOKER').replace(/SET search_path (?:TO|=)[^\n]+/g,'SET search_path TO pg_catalog,g4a6,pg_temp');
function add(d,p,label){definitions.push({identity:label,definition:d});const out=adapt(d);manifest.push({source:p,identity:label,sourceSha256:hash(d),adaptedSha256:hash(out),adaptations:'namespace, deterministic clock, invoker/search_path; no omitted body sections'});return out+';\n';}
export function buildFull(){manifest.length=0;let sql="DO $$ BEGIN IF current_database() NOT LIKE 'g4a6_fixture_g4a12_%' OR to_regclass('g4a6.fixture_marker') IS NULL THEN RAISE EXCEPTION 'private disposable fixture only'; END IF; END $$;\n";const archive=Object.keys(pins)[0],f5=JSON.parse(load(archive));
 for(const name of ['node_tick_claim_without_canary_gate','node_tick_claim_without_boss_timing','node_tick_claim_without_character_stances','node_tick_claim']){
 const f=f5.functions.find(f=>f.requested_identity===`public.${name}(uuid,integer)`);assert(f?.present);sql+=add(f.definition,archive,name);}
 const corePath=Object.keys(pins)[1],text=load(corePath),start=text.indexOf('CREATE OR REPLACE FUNCTION public.node_tick_commit_without_bounded_failure('),end=text.indexOf('$function$',text.indexOf('AS $function$',start)+14)+10;assert(start>0&&end>start);sql+=add(text.slice(start,end),corePath,'node_tick_commit_without_bounded_failure');
 for(const name of ['node_tick_commit_without_boss_timing','node_tick_commit_without_authoritative_arrival','node_tick_commit_without_character_stances']){const p=`docs/operations/progression-001D-evidence/${name}.sql`;sql+=add(load(p),p,name);}
 const outerPath='docs/operations/progression-001D-evidence/node_tick_commit.sql';let d=load(outerPath);const patch=load(Object.keys(pins)[2]);const guard=patch.split('$guard$')[1];assert(guard?.includes('stance_target_outside_encounter'));
 const decl='DECLARE row jsonb; result jsonb; current_version bigint;',needle="BEGIN\n FOR row IN SELECT value FROM jsonb_array_elements(coalesce(_proposed->'stance_fence'";
 assert(d.includes(decl)&&d.includes(needle));d=d.replace(decl,decl.slice(0,-1)+'; stance_target uuid; locked_node uuid; encounter_node uuid;').replace(needle,guard);
 assert.equal(hash(d.replace(/\s+/g,' ')),'a0267a1d2c0c50d8724f8b5b4b2fb001cdbf1e3d08dae58377e1f81f289c287f','G2B conditional historical outer parity');
 sql+=add(d,outerPath+' + 0017 exact guard extraction','node_tick_commit');
 assert(!sql.includes('public.'),'fixture references only');return sql;
}

// G4A21 repin: resolver/type/mirror quiescent-ending implementation changed.
// Historical G4A12–20 evidence retains its original runtime graph hash.
// Pins the actual imported Edge worker/resolver graph and published catalogue.
export function runtimeSources(){
 const seen=new Set();function visit(rel){if(seen.has(rel))return;seen.add(rel);const t=readFileSync(new URL(rel,root),'utf8');for(const m of t.matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g)){const f=path.posix.normalize(path.posix.join(path.posix.dirname(rel),m[1]));if(/\.(ts|json)$/.test(f))visit(f);}}
 for(const p of ['supabase/functions/_shared/combat2/process-node-tick-once.ts','supabase/functions/_shared/combat2/dispatch-node-ticks-once.ts','supabase/functions/_shared/combat2/active-abilities.json'])visit(p);
 const rows=[...seen].sort().map(p=>({path:p,sha256:hash(readFileSync(new URL(p,root),'utf8').replace(/\r\n/g,'\n'))}));
 assert.equal(hash(JSON.stringify(rows)),'635fe3fa2006c9e32d4a20085b2253c48fd1e02ff75485c47e96f2d0563005e6','runtime source graph drift');return rows;
}
