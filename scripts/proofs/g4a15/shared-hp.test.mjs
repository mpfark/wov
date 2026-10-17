// G4A20 extends the existing full-source fixture; no second database harness.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {buildSharedHP} from './prepare-shared-hp.mjs';
import {fixture,call} from './admin-boundary.test.mjs';
import {clock,quiet,row,state,race,damage,commit,claim,proposal,cid,node,dest,enc,enc2,actor,user,request,at} from './postgres.test.mjs';
import {moduleSource} from './source-adapters.mjs';

const sql=buildSharedHP();console.log('G4A20 SQL SHA256 '+createHash('sha256').update(sql).digest('hex'));
assert.equal(sql,readFileSync(new URL('../../../docs/operations/legacy-001G4A20-shared-hp-candidate.sql',import.meta.url),'utf8'));
const adapt=s=>s.replaceAll('public.','g4a6.').replaceAll('auth.uid()','g4a9.actor_uid()')
 .replaceAll('pg_catalog,public,pg_temp','pg_catalog,g4a6,pg_temp').replace(/\bnow\(\)/g,'g4a6.test_now()');
const opts={timeout:30000};
async function integrated(){const x=await fixture(adapt(sql));
 // These are the shared hooks already called by the complete G4A7–15 source
 // adapters. Replace their old accounting body, never the resolver/reward logic.
 await x.o.unsafe(`CREATE OR REPLACE FUNCTION g4a6.settle(cid uuid,cutoff timestamptz) RETURNS text LANGUAGE plpgsql AS $$
 BEGIN PERFORM g4a6.creature_regen_settle(cid,cutoff); RETURN 'settled'; END $$;
 CREATE OR REPLACE FUNCTION g4a6.reconcile(cid uuid,cutoff timestamptz) RETURNS void LANGUAGE plpgsql AS $$
 BEGIN PERFORM g4a6.creature_regen_settle(cid,cutoff); END $$;
 CREATE OR REPLACE FUNCTION g4a6.src_wake() RETURNS integer LANGUAGE sql AS $$ SELECT g4a6.heal_creatures_on_wake() $$;
 CREATE OR REPLACE FUNCTION g4a6.src_regen() RETURNS void LANGUAGE sql AS $$ SELECT g4a6.regen_creature_hp() $$;`);
 // Record the claim lease as a blocked transition even if no maintenance call
 // observes it. Do not recover that elapsed time when commit clears the lease.
 const def=(await x.o`SELECT pg_get_functiondef('g4a12.claim(uuid,integer)'::regprocedure) d`)[0].d;
 assert(def.includes('\n RETURN result;'));
 await x.o.unsafe(def.replace('\n RETURN result;',`\n IF result->>'kind'='claimed' THEN
 FOREACH cid IN ARRAY ids LOOP PERFORM g4a6.reconcile(cid,g4a6.test_now()); END LOOP; END IF;
 RETURN result;`));
 await x.o`SELECT g4a6.reconcile(${cid},g4a6.test_now())`;
 return x;
}
async function tick(x,t){const cl=await claim(x.o,t);assert.equal(cl.kind,'claimed',JSON.stringify(cl));const p=proposal(cl);return {cl,p,r:await commit(x.o,cl,p,t)};}
async function regen(x,t){await clock(x.o,t);await x.o`SELECT g4a6.regen_creature_hp()`;}

test('G4A20 real claim/resolver/commit ends quiescent encounter; 4/8/20s recovery persists on re-entry',opts,async()=>{
 const x=await integrated();const end=await tick(x,0);assert.equal(end.p.status,'ended');assert.equal(end.r.kind,'committed');
 for(const [t,hp]of [[3,40],[4,42],[8,44],[20,50]]){await regen(x,t);assert.equal((await row(x.o)).hp,hp);assert.equal((await state(x.o)).projection_hp,hp);}
 await clock(x.o,21);await x.o`SELECT set_config('g4a7.actor',${user},false)`;
 const r=(await x.o`SELECT g4a9.entry(${actor},${request}) r`)[0].r;assert.equal(r.ok,true,JSON.stringify(r));
 assert.equal((await row(x.o)).hp,50);assert.equal((await row(x.o)).regen_eligible_since,null);
});
test('G4A20 canonical DoT damage/commit blocks healing then starts a new interval',opts,async()=>{
 const x=await integrated();const d=await damage(x);assert.equal((await commit(x.o,d.cl,d.p,0)).kind,'committed');
 assert.equal((await row(x.o)).hp,33);
 await tick(x,2); // the source expiry boundary is the following tick, not wall-clock maintenance
 assert.equal((await x.o`SELECT count(*)::integer n FROM g4a6.node_effect WHERE kind='dot'`)[0].n,0);
 await regen(x,5);assert.equal((await row(x.o)).hp,33);
 await regen(x,6);assert.equal((await row(x.o)).hp,35);
});
test('G4A20 retained projection configuration synchronizes/fences; same-value retry is unchanged',opts,async()=>{
 const x=await integrated();await tick(x,0);
 assert.equal((await call(x.o,'save',{max_hp:120},{max_hp:100})).kind,'updated');
 assert.equal((await row(x.o)).hp,60);assert.equal((await state(x.o)).projection_hp,60);
 const version=(await state(x.o)).state_version;
 assert.equal((await call(x.o,'save',{max_hp:120},{max_hp:100})).kind,'already_matches');assert.equal((await state(x.o)).state_version,version);
 assert.equal((await call(x.o,'save',{regen_percent_4s:'4'},{regen_percent_4s:'2'})).kind,'updated');
 await regen(x,4);assert.equal((await row(x.o)).hp,64);
});
test('G4A20 safe-ended same-generation transfer preserves wounds and fences both encounters',opts,async()=>{
 const x=await integrated();await tick(x,0);
 assert.equal((await call(x.o,'move',{node_id:dest},{node_id:node})).kind,'updated');
 assert.equal((await row(x.o)).hp,40);assert.equal((await row(x.o)).node_id,dest);
 assert.equal((await x.o`SELECT encounter_id FROM g4a6.node_creature WHERE creature_id=${cid}`)[0].encounter_id,enc2);
 assert.equal((await call(x.o,'move',{node_id:null},{node_id:dest})).kind,'retained_references');
});
test('G4A20 SQL boss acceptance compared with actual catalogue adapter; disabled document remains inert',opts,async()=>{
 const x=await integrated();await tick(x,0);const {adaptBossCast}=moduleSource('src/shared/combat2/boss-catalog.ts');
 for(const target_mode of ['tank','aoe','random','tank_preferred','tank_strict','random_alive','wrong']){
 const cast={enabled:true,label:'test',ability_key:'test_cast',cast_ms:4000,base_amount:10,target_mode};
 const expected=!('rejection' in adaptBossCast(cid,cast));
 assert.equal((await x.o`SELECT g4a6.creature_admin_boss_valid(${x.o.json(cast)}) v`)[0].v,expected);
 }
 for(const bad of [{},{enabled:true,label:'bad',cast_ms:4000},{label:'bad',cast_ms:'4000',base_amount:10}])
 assert.equal((await x.o`SELECT g4a6.creature_admin_boss_valid(${x.o.json(bad)}) v`)[0].v,false);
 const doc={enabled:true,label:'test',ability_key:'test_cast',cast_ms:4000,base_amount:10,target_mode:'tank'};
 assert.equal((await call(x.o,'save',{boss_cast:doc},{boss_cast:null})).kind,'updated');
});
test('G4A20 wake never instant-heals; elapsed eligible sleep uses the same maintenance owner',opts,async()=>{
 const x=await integrated();await tick(x,0);await clock(x.o,20);
 assert.equal((await x.o`SELECT g4a6.src_wake() r`)[0].r,0);assert.equal((await row(x.o)).hp,40);
 await x.o`SELECT g4a6.src_regen()`;assert.equal((await row(x.o)).hp,50);
});
test('G4A20 claim lease is blocked time even without an intervening maintenance observer',opts,async()=>{
 const x=await integrated();await tick(x,0);await clock(x.o,1);
 await x.o`SELECT set_config('g4a7.actor',${user},false)`;
 assert.equal((await x.o`SELECT g4a9.entry(${actor},${request}) r`)[0].r.ok,true);
 await x.o`SELECT set_config('g4a7.actor','',false)`;
 const cl=await claim(x.o,1,10000),p=proposal(cl);
 assert.equal((await commit(x.o,cl,p,5)).kind,'committed');
 await regen(x,8);assert.equal((await row(x.o)).hp,40);await regen(x,9);assert.equal((await row(x.o)).hp,42);
});
test('G4A20 concrete retained-engagement blocker: no fighters does not end active combat or authorize healing',opts,async()=>{
 const x=await integrated();await x.o`UPDATE g4a6.node_creature SET engaged=true`;
 const result=await tick(x,0);assert.notEqual(result.p.status,'ended');
 await regen(x,20);assert.equal((await row(x.o)).hp,40);assert.equal((await row(x.o)).regen_eligible_since,null);
 console.log('BLOCKER: living engaged creature persists with no fighters; no invented encounter-ending policy.');
});
test('G4A20 observed canonical death/reward commit versus maintenance preserves death and receipt replay',opts,async()=>{
 const x=await integrated();const d=await damage(x,{amount:40});
 await race(x,c=>commit(c,d.cl,d.p,0),async c=>{await clock(c,20);await c`SELECT g4a6.regen_creature_hp()`;},async r=>{
 assert.ifError(r.error);assert.equal((await row(x.o)).hp,0);assert.equal((await row(x.o)).is_alive,false);});
 const xp=(await x.o`SELECT xp FROM g4a6.characters WHERE id=${actor}`)[0].xp;
 assert.equal((await commit(x.o,d.cl,d.p,20)).kind,'already_committed');assert.equal((await x.o`SELECT xp FROM g4a6.characters WHERE id=${actor}`)[0].xp,xp);
});
test('G4A20 observed protected projected edit versus maintenance serializes through the existing gates',opts,async()=>{
 const x=await integrated();await tick(x,0);await clock(x.a,4);await clock(x.b,4);
 await race(x,c=>call(c,'save',{max_hp:120},{max_hp:100}),c=>c`SELECT g4a6.creature_regen_settle(${cid},g4a6.test_now())`,async r=>{
 assert.ifError(r.error);assert.equal((await row(x.o)).hp,(await state(x.o)).projection_hp);});
});
test('G4A20 complete solo request, relocation and arrival preserve durable HP',opts,async()=>{
 const x=await integrated();await tick(x,0);await clock(x.o,1);await x.o`SELECT set_config('g4a7.actor',${user},false)`;
 const result=(await x.o`SELECT g4a9.move(${actor},${dest},${request},false,true) r`)[0].r;
 assert.equal(result.ok,true,JSON.stringify(result));
 assert.equal((await x.o`SELECT current_node_id FROM g4a6.characters WHERE id=${actor}`)[0].current_node_id,dest);
 await regen(x,4);assert.equal((await row(x.o)).hp,42);
});
test('G4A20 complete party request and coordinated immediate departure retain shared accounting',opts,async()=>{
 const x=await integrated();await tick(x,0);const follower='00000000-0000-4000-8000-000000000021',party='00000000-0000-4000-8000-000000000022';
 await x.o`SELECT set_config('g4a7.actor','',false)`;
 await x.o`INSERT INTO g4a6.characters(id,user_id,current_node_id,race) VALUES(${follower},${user},${node},'human')`;
 await x.o`INSERT INTO g4a6.parties(id,leader_id,tank_id) VALUES(${party},${actor},${actor})`;
 await x.o`INSERT INTO g4a6.party_members(party_id,character_id,status,is_following) VALUES(${party},${actor},'accepted',false),(${party},${follower},'accepted',true)`;
 await x.o`SELECT set_config('g4a7.actor',${user},false)`;await clock(x.o,1);
 const result=(await x.o`SELECT g4a9.move(${actor},${dest},${request},true,true) r`)[0].r;
 assert.equal(result.ok,true,JSON.stringify(result));
 assert.equal((await x.o`SELECT count(*)::integer n FROM g4a6.characters WHERE current_node_id=${dest}`)[0].n,2);
 await regen(x,4);assert.equal((await row(x.o)).hp,42);
});
