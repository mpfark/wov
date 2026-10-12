// Static regression checks only. No database driver or SQL execution.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync,existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
const correction=readFileSync('docs/operations/legacy-001C5A-hp-helper-containment.sql','utf8');
const preflight=readFileSync('docs/operations/legacy-001C5A-hp-helper-preflight.sql','utf8');
const signatures=['public.heal_party_member(uuid,uuid,integer)','public.heal_party_member(uuid,uuid,integer,integer)','public.damage_party_member(uuid,integer)'];
const fingerprints=['0760c5b00b30c473e1ebbe3f20cc87a26a3a6988d35dc2cd09112af867ad45c9','3e95e38ce52038b169c465bf82528cb3d742e7378da4577608b605d492b99e97','642207a3714bac31f12c95edaec1c1a495b342ab5114a4f8a46ff38a4acff34b'];
const withoutComments=s=>s.replace(/--[^\n]*/g,'');
test('exact three signatures, including integer fourth argument; no name-wide target',()=>{
 for(const s of [preflight,correction]){const actual=[...s.matchAll(/'((?:public\.)(?:heal_party_member|damage_party_member)\([^']+\))'/g)].map(m=>m[1]);assert.deepEqual(actual,signatures);}
 assert(correction.includes('target:=to_regprocedure(row.identity)'));assert(correction.includes('missing exact signature'));
});
test('source hashes match full latest bodies and are embedded in both artifacts',()=>{
 const source=readFileSync('supabase/migrations/20260731184728_660b1bac-c685-45ae-8cf3-769f81061cbe.sql','utf8').replace(/\r\n/g,'\n');
 const actual=[];for(const m of source.matchAll(/CREATE OR REPLACE FUNCTION public\.(heal_party_member|damage_party_member)\(/g)){const tail=source.slice(m.index),a=/AS\s+(\$[\w]*\$)/.exec(tail),body=tail.slice(a.index+a[0].length).split(a[1])[0];actual.push(createHash('sha256').update(body).digest('hex'));}
 assert.deepEqual(actual,fingerprints);fingerprints.forEach(h=>{assert(correction.includes(h));assert(preflight.includes(h));});
});
test('preflight is one SELECT with only catalog reads and definition/privilege helpers',()=>{
 const clean=withoutComments(preflight).replace(/'(?:''|[^'])*'/g,"''");assert.equal(clean.split(';').filter(x=>x.trim()).length,1);assert.match(clean.trim(),/^WITH /);
 assert(!/\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|REVOKE|GRANT|CALL|DO|SET|COPY|EXPLAIN)\b/i.test(clean));
 assert(!/\bFROM\s+(?:public\.)?(characters|character_inventory)\b/i.test(clean));assert(preflight.includes('pg_current_snapshot()'));
});
test('correction only revokes browser execution, no function/table/role replacement or grants',()=>{
 const s=withoutComments(correction);assert(!/\b(GRANT|CREATE|ALTER|DROP|INSERT|UPDATE|DELETE)\b/.test(s));
 const revokes=[...s.matchAll(/REVOKE EXECUTE ON FUNCTION[^']+/g)].map(x=>x[0]);assert.deepEqual(revokes,['REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated']);
 assert.match(s,/^\s*BEGIN;/);assert.match(s,/COMMIT;\s*$/);
});
test('body/security/default/owner drift gates precede every revoke',()=>{
 const revoke=correction.indexOf("EXECUTE format('REVOKE");
 for(const marker of ['row.fingerprint',"p.proowner='postgres'::regrole",'p.prosecdef',"p.proconfig=ARRAY['search_path=public']",'p.pronargdefaults=row.defaults','expected server authority absent'])assert(correction.indexOf(marker)<revoke);
 assert(correction.includes("'integer'::regtype"));assert(correction.includes("l.lanname='plpgsql'"));
});
test('public and effective browser denial postconditions reject inherited privilege leaks',()=>{
 const after=correction.slice(correction.indexOf("EXECUTE format('REVOKE"));
 for(const marker of ["has_function_privilege('anon'","has_function_privilege('authenticated'",'a.grantee=0',"a.privilege_type='EXECUTE'",'inherited browser EXECUTE remains'])assert(after.includes(marker));
});
test('retained direct ACL entries/grant options, server access, owner and full definition preserved',()=>{
 assert.equal((correction.match(/INTO retained_acl/g)||[]).length,1);
 assert.equal((correction.match(/a\.grantee NOT IN \('anon'::regrole,'authenticated'::regrole\)/g)||[]).length,2);
 for(const marker of ['a.grantor','a.is_grantable','IS DISTINCT FROM retained_acl','IS DISTINCT FROM before_def','IS DISTINCT FROM before_owner'])assert(correction.includes(marker));
 assert.equal((correction.match(/has_function_privilege\('service_role'/g)||[]).length,2);assert.equal((correction.match(/has_function_privilege\('postgres'/g)||[]).length,2);
});
test('standard migration chain retained; any installed C5A entry is exact reviewed 0019',()=>{
 const j=JSON.parse(readFileSync('drizzle/migrations/meta/_journal.json'));let prior;
  const installed=j.entries.filter(e=>e.tag.includes('001c5a'));assert(installed.length<=1);
  if(installed.length){assert.equal(installed[0].idx,19);assert.equal(installed[0].tag,'0019_legacy_001c5a_hp_helper_containment');
    assert.equal(readFileSync('drizzle/migrations/'+installed[0].tag+'.sql','utf8').replace(/\r\n/g,'\n'),correction.replace(/\r\n/g,'\n'));}
  for(const [i,e] of j.entries.entries()){assert.equal(e.idx,i);assert(existsSync('drizzle/migrations/'+e.tag+'.sql'));const snap=JSON.parse(readFileSync('drizzle/migrations/meta/'+String(i).padStart(4,'0')+'_snapshot.json'));if(prior)assert.equal(snap.prevId,prior.id);prior=snap;}
 assert(!existsSync('drizzle/migrations/legacy-001C5A-hp-helper-containment.sql'));
});
