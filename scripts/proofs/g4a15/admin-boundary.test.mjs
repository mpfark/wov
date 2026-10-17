// Extends the existing G4A15 full-source disposable harness. No hosted URL.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {moduleSource} from './source-adapters.mjs';
import {setup,auth,clock,quiet,row,state,race,damage,commit,cid,node,dest,enc,user,request,at} from './postgres.test.mjs';

const source=await readFile(new URL('../../../docs/operations/legacy-001G4A19-admin-candidate.sql',import.meta.url),'utf8');
// Explicit fixture adaptations: namespace, Auth lookup and deterministic clock.
// Complete new SQL bodies, owners/definers and ACL statements remain executed.
const candidate=source.replaceAll('public.','g4a6.').replaceAll('auth.uid()','g4a9.actor_uid()')
 .replaceAll('pg_catalog,public,pg_temp','pg_catalog,g4a6,pg_temp').replace(/\bnow\(\)/g,'g4a6.test_now()');
console.log('G4A19 EXACT SQL SHA256 '+createHash('sha256').update(source).digest('hex'));
const opts={timeout:30000};
async function fixture(sql=candidate){const x=await setup();
 await x.o.unsafe(`DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
 END $$;
 GRANT USAGE ON SCHEMA g4a6,g4a9 TO authenticated,anon,service_role;
 GRANT SELECT,INSERT,UPDATE,DELETE,TRUNCATE ON g4a6.creatures TO authenticated,anon,service_role;
 GRANT UPDATE(hp) ON g4a6.creatures TO authenticated;
 ALTER TABLE g4a6.characters ADD COLUMN IF NOT EXISTS active_contract jsonb;`);
 await x.o.unsafe(sql);await auth(x.o);return x;}
async function call(c,action,patch={},expected={},id=cid){await auth(c);return(await c`SELECT g4a6.admin_creature_mutate(${action},${id},${c.json(expected)},${c.json(patch)}) r`)[0].r;}
async function fresh(x){await quiet(x);await x.o`DELETE FROM g4a6.node_creature`;}
async function settle(c,t,id=cid){await clock(c,t);await c`SELECT g4a6.creature_regen_settle(${id},g4a6.test_now())`;}

test('G4A19 metadata changes never heal; stale conflict and desired no-op',opts,async()=>{
 const x=await fixture();const before=await row(x.o);
 assert.equal((await call(x.o,'save',{description:'new'},{description:''})).kind,'updated');
 assert.equal((await row(x.o)).hp,before.hp);assert.equal((await state(x.o)).projection_hp,before.hp);
 assert.equal((await call(x.o,'save',{description:'new'},{description:'stale'})).kind,'already_matches');
 assert.equal((await call(x.o,'save',{description:'other'},{description:'stale'})).kind,'stale');
 assert.equal((await call(x.o,'save',{hp:100},{hp:40})).kind,'invalid_request');
});
test('G4A19 first 4s, fractional 75HP example, elapsed sleep and no repeated settlement',opts,async()=>{
 const x=await fixture();await fresh(x);await x.o`UPDATE g4a6.creatures SET max_hp=75,hp=10`;
 await settle(x.o,0);await settle(x.o,3.99);assert.equal((await row(x.o)).hp,10);
 await settle(x.o,4);assert.equal((await row(x.o)).hp,11);assert.equal(Number((await row(x.o)).regen_credit),.5);
 await settle(x.o,8);assert.equal((await row(x.o)).hp,13);await settle(x.o,8);assert.equal((await row(x.o)).hp,13);
 await settle(x.o,40);assert.equal((await row(x.o)).hp,25);
});
test('G4A19 active empty encounter, DoT/pending/claim block and re-entry resets period',opts,async()=>{
 const x=await fixture();await settle(x.o,0);await settle(x.o,100);assert.equal((await row(x.o)).hp,40);
 await quiet(x);await settle(x.o,100);await settle(x.o,104);assert.equal((await row(x.o)).hp,42);
 await x.o`UPDATE g4a6.node_encounter SET status='active' WHERE id=${enc}`;await settle(x.o,105);
 await quiet(x);await settle(x.o,110);await settle(x.o,113);assert.equal((await row(x.o)).hp,42);
 await settle(x.o,114);assert.equal((await row(x.o)).hp,44);
 await x.o`INSERT INTO g4a6.node_effect(encounter_id,kind,target_creature_id) VALUES(${enc},'dot',${cid})`;
 await settle(x.o,120);assert.equal((await row(x.o)).hp,44);await x.o`DELETE FROM g4a6.node_effect`;
 await x.o`UPDATE g4a6.node_creature SET pending_action='{}'`;await settle(x.o,130);assert.equal((await row(x.o)).hp,44);
 await x.o`UPDATE g4a6.node_creature SET pending_action=NULL`;await settle(x.o,131);await settle(x.o,135);assert.equal((await row(x.o)).hp,46);
});
test('G4A19 rate edits settle old intervals, no retroactive new rate or repeated fraction discard',opts,async()=>{
 const x=await fixture();await fresh(x);await x.o`UPDATE g4a6.creatures SET max_hp=75,hp=10`;await settle(x.o,0);
 await clock(x.o,6);assert.equal((await call(x.o,'save',{regen_percent_4s:'4'},{regen_percent_4s:'2'})).kind,'updated');
 assert.equal((await row(x.o)).hp,11);assert.equal(Number((await row(x.o)).regen_credit),0);
 await settle(x.o,10);assert.equal((await row(x.o)).hp,14);
 const before=await row(x.o);assert.equal((await call(x.o,'save',{regen_percent_4s:'4.00'},{regen_percent_4s:'2'})).kind,'already_matches');
 assert.deepEqual((await row(x.o)).regen_accounted_at,before.regen_accounted_at);
 for(const value of ['2.001','100.01','-1','NaN',''])assert.equal((await call(x.o,'save',{regen_percent_4s:value},{regen_percent_4s:'4'})).kind,'invalid_request');
});
test('G4A19 generated stats/formulas, missing HP/max floor and dead boundaries',opts,async()=>{
 const x=await fixture();await fresh(x);
 assert.equal((await call(x.o,'save',{level:2},{level:1,rarity:'regular',max_hp:100})).kind,'updated');
 let r=await row(x.o);assert.equal(r.max_hp,31);assert.equal(r.hp,1);assert.deepEqual(r.stats,{str:9,dex:8});assert.equal(r.ac,13);
 assert.equal(r.base_aggressive,true);assert.equal(r.is_aggressive,false); // unrelated edits preserve authored/runtime distinction
 assert.equal((await call(x.o,'save',{max_hp:120},{max_hp:31})).kind,'updated');r=await row(x.o);assert.equal(r.hp,90);
 await x.o`UPDATE g4a6.creatures SET is_alive=false,hp=0,died_at=${at(0)}`;const generation=(await row(x.o)).spawn_seq;
 assert.equal((await call(x.o,'save',{max_hp:200},{max_hp:120})).kind,'updated');await settle(x.o,100);
 r=await row(x.o);assert.equal(r.hp,0);assert.equal(r.is_alive,false);assert.equal(r.spawn_seq,generation);
});
test('G4A19 stable create UUID, duplicate refusal, delete and retained-history refusal',opts,async()=>{
 const x=await fixture();assert.equal((await call(x.o,'delete',{}, {name:'local creature',node_id:node})).kind,'combat_active');
 await quiet(x);assert.equal((await call(x.o,'delete',{}, {name:'local creature',node_id:node})).kind,'retained_references');
 assert.equal((await call(x.o,'move',{node_id:null},{node_id:node})).kind,'retained_references');
 const patch={name:'new',node_id:null,level:1,rarity:'regular'};
 assert.equal((await call(x.o,'create',patch,{},request)).kind,'created');
 assert.equal((await call(x.o,'create',patch,{},request)).kind,'identity_exists');
 assert.equal((await row(x.o,request)).hp,23);
 assert.equal((await call(x.o,'delete',{}, {name:'new',node_id:null},request)).kind,'deleted');
 assert.equal((await call(x.o,'delete',{}, {name:'new',node_id:null},request)).kind,'already_absent');
});
test('G4A19 PostgreSQL effective browser DML denial; server rights and Admin role checks',opts,async()=>{
 const x=await fixture();for(const role of ['anon','authenticated']){
 assert.equal((await x.o`SELECT has_table_privilege(${role},'g4a6.creatures','INSERT,UPDATE,DELETE,TRUNCATE') p`)[0].p,false);
 assert.equal((await x.o`SELECT has_any_column_privilege(${role},'g4a6.creatures','INSERT,UPDATE') p`)[0].p,false);}
 assert.equal((await x.o`SELECT has_table_privilege('service_role','g4a6.creatures','UPDATE') p`)[0].p,true);
 await x.o.unsafe('SET ROLE authenticated');await auth(x.o);
 assert.equal((await call(x.o,'save',{name:'admin'},{name:'local creature'})).kind,'updated');
 await assert.rejects(x.o`UPDATE g4a6.creatures SET hp=100`,e=>e.code==='42501');await x.o.unsafe('RESET ROLE');
 await x.o`UPDATE g4a6.user_roles SET role='player'`;
 assert.equal((await call(x.o,'save',{name:'no'},{name:'admin'})).kind,'not_authorized');
 await x.o`SELECT set_config('g4a7.actor','',false)`;
 assert.equal((await x.o`SELECT g4a6.admin_creature_mutate('save',${cid},'{}','{}') r`)[0].r.kind,'not_authorized');
});
test('G4A19 observed metadata row wait versus real resolver/commit preserves damage',opts,async()=>{
 const x=await fixture();const d=await damage(x);
 await race(x,c=>commit(c,d.cl,d.p),c=>call(c,'save',{description:'after damage'},{description:''}),async result=>{
 assert.equal(result.value.kind,'updated');assert.equal((await row(x.o)).hp,33);assert.equal((await state(x.o)).projection_hp,33);});
});
test('G4A19 observed regeneration versus protected max edit; stale max refused',opts,async()=>{
 const x=await fixture();await fresh(x);await settle(x.o,0);await clock(x.a,4);await clock(x.b,4);
 await race(x,c=>c`SELECT g4a6.creature_regen_settle(${cid},g4a6.test_now())`,c=>call(c,'save',{max_hp:120},{max_hp:100}),async result=>{
 assert.equal(result.value.kind,'updated');assert.equal((await row(x.o)).hp,62);});
 assert.equal((await call(x.o,'save',{max_hp:150},{max_hp:100})).kind,'stale');
});
test('G4A19 outstanding projection/claim config fails closed; transaction rollback and retry',opts,async()=>{
 const x=await fixture();assert.equal((await call(x.o,'save',{regen_percent_4s:'3'},{regen_percent_4s:'2'})).kind,'combat_active');
 await quiet(x);assert.equal((await call(x.o,'save',{regen_percent_4s:'3'},{regen_percent_4s:'2'})).kind,'integration_required');
 await fresh(x);await x.o.unsafe('BEGIN');await call(x.o,'save',{description:'rollback'},{description:''});await x.o.unsafe('ROLLBACK');
 assert.equal((await row(x.o)).description,'');assert.equal((await call(x.o,'save',{description:'retry'},{description:''})).kind,'updated');
});


test('G4A19 ordinary source respawn changes generation without retroactive regeneration',opts,async()=>{
 const x=await fixture();await fresh(x);await settle(x.o,0);
 await x.o`UPDATE g4a6.creatures SET hp=0,is_alive=false,died_at=${at(0)},respawn_seconds=0`;
 await clock(x.o,100);await x.o`SELECT g4a7.respawn(${cid})`;
 await x.o`UPDATE g4a6.creatures SET hp=40`;await settle(x.o,100);assert.equal((await row(x.o)).hp,40);
 await settle(x.o,104);assert.equal((await row(x.o)).hp,42);
});

test('G4A19 SQL generated maxima/stats/AC match actual formula across rarities',opts,async()=>{
 const x=await fixture();await fresh(x);
 const {generateCreatureStats}=moduleSource('src/shared/formulas/creatures.ts');
 for(const rarity of ['regular','rare','boss'])for(const level of [2,1,10,35]){
   const old=await row(x.o);
   const r=await call(x.o,'save',{level,rarity},{level:old.level,rarity:old.rarity,max_hp:old.max_hp});
   assert.equal(r.ok,true,JSON.stringify(r));
   const actual=await row(x.o),expected=generateCreatureStats(level,rarity);
   assert.equal(actual.max_hp,expected.hp);assert.equal(actual.ac,expected.ac);assert.deepEqual(actual.stats,expected.stats);
 }
});

export { fixture, call };
