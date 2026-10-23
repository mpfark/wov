// Local PostgreSQL only. Reuse complete G4A21 claim/commit/arrival/respawn source.
// Explicit runner: --test --test-name-pattern=AGGRESSION
// Only source prefixes are imported; no historical test cases register.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
test('AGGRESSION', async t => {
const runCase=t.test.bind(t);
process.argv[2] ??= process.env.WOV_LOCAL_PG_BIN;
// Extract the unchanged fixture/composition prefixes, not their registered historical tests.
// Absolute import URLs preserve original source-relative paths; bodies are not reimplemented.
const baseUrl=new URL('./g4a15/postgres.test.mjs',import.meta.url);
const moduleUrl=(source,url)=>'data:text/javascript;base64,'+Buffer.from(source
 .replace(/from (['"])([^'"]+)\1/g,(_,q,p)=>'from '+JSON.stringify(p.startsWith('.')?new URL(p,url).href:p.includes(':')?p:import.meta.resolve(p)))
 .replaceAll('import.meta.url',JSON.stringify(url.href))).toString('base64');
const original=readFileSync(baseUrl,'utf8');
const base=moduleUrl(original.slice(0,original.indexOf('\ntest('))+'\nexport {setup,auth,clock,row,state,race,proposal,damage,cid,node,dest,enc,enc2,actor,user,request,at};',baseUrl);
const {clock,row,race,proposal,damage,cid,node,dest,enc,actor,user,request,at}=await import(base);
const publicUrl=new URL('./g4a15/public-hp.test.mjs',import.meta.url);
let composition=readFileSync(publicUrl,'utf8');composition=composition.slice(0,composition.indexOf('\ntest('))
 .replace(/import \{fixture\} from '[^']+';/,'')
 .replace(/from '\.\/postgres.test.mjs'/,'from '+JSON.stringify(base))
 .replace('async function wired()','export async function wired()');
const admin=readFileSync(new URL('./g4a15/admin-boundary.test.mjs',import.meta.url),'utf8');
const fixture=admin.slice(admin.indexOf('async function fixture('),admin.indexOf('\nasync function call('));
composition='import {setup,auth} from '+JSON.stringify(base)+';\n'+fixture+'\n'+composition;
const {wired}=await import(moduleUrl(composition,publicUrl));
const source=readFileSync(new URL('../../docs/operations/combat2-persistent-aggression.sql',import.meta.url),'utf8').replace(/\r\n/g,'\n');
const core='g4a6.node_tick_commit_without_bounded_failure(uuid,uuid,integer,integer,bigint,uuid[],jsonb)';
async function setup(install=true){const x=await wired();
 await x.o`UPDATE g4a6.creatures SET base_aggressive=false WHERE id=${cid}`;
 await x.o.unsafe(`REVOKE ALL ON FUNCTION ${core} FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION ${core} TO service_role`);
 const md5=(await x.o`SELECT md5(regexp_replace(prosrc,'[[:space:]]+',' ','g')) h FROM pg_proc WHERE oid=${core}::regprocedure`)[0].h;
 // Namespace, deterministic clock and invoker fixture substitutions only; exact source otherwise.
 const sql=source.replaceAll('public.','g4a6.').replaceAll('74d0800a416276d89e6495724c3c82d5',md5)
  .replaceAll('before.prosecdef IS DISTINCT FROM true','before.prosecdef IS DISTINCT FROM false')
  .replaceAll('SECURITY DEFINER','SECURITY INVOKER').replaceAll('pg_catalog,public,pg_temp','pg_catalog,g4a6,pg_temp');
 if(install)await x.o.begin(t=>t.unsafe(sql));return {...x,candidate:sql};
}
async function engage(x){await clock(x.o,0);await x.o`SELECT set_config('g4a7.actor',${user},false)`;
 const r=(await x.o`SELECT g4a6.combat2_hostile_action(${actor},'basic_attack',NULL,${cid},${request}) r`)[0].r;
 assert.equal(r.ok,true,JSON.stringify(r));assert.equal((await row(x.o)).is_aggressive,false);
 // Existing fixture's combat_intent is a double: seed the autoattack state it omits.
 // The actual decoder/catalogue/resolver and complete guarded commit execute below.
 const nc=(await x.o`SELECT id,spawn_seq FROM g4a6.node_creature WHERE creature_id=${cid}`)[0];
 await x.o`INSERT INTO g4a6.node_effect(encounter_id,kind,effect_type,target_character_id,target_creature_id,source_character_id,config)
 VALUES(${enc},'autoattack','basic_attack',${actor},${cid},${actor},${x.o.json({node_creature_id:nc.id,spawn_seq:nc.spawn_seq})})`;
}
async function claim(x,t=0){await clock(x.o,t);const r=(await x.o`SELECT g4a6.node_tick_claim(${node},5000) r`)[0].r;assert.equal(r.kind,'claimed',JSON.stringify(r));return r;}
async function commit(x,cl,p,c=x.o){await c`SELECT set_config('g4a7.actor','',false)`;
 return(await c`SELECT g4a6.node_tick_commit(${enc},${cl.claim_token},${cl.candidate_tick},${cl.last_committed_tick},${cl.state_version},${p.intent_ids},${c.json(p)}) r`)[0].r;}
async function hit(x){await engage(x);const cl=await claim(x),p=proposal(cl);return {cl,p,r:await commit(x,cl,p)};}
const opts={timeout:30000};
await runCase('AGGRESSION original real damaging attack has no durable provocation; corrected source does',opts,async()=>{
 const old=await setup(false);const prior=await hit(old);assert.equal(prior.r.kind,'committed');assert((await row(old.o)).hp<40);assert.equal((await row(old.o)).is_aggressive,false);
 const x=await setup();const {cl,p,r}=await hit(x);assert.equal(r.kind,'committed');
 assert(p.events.some(e=>e.kind==='attack'&&e.amount>0));assert.equal((await row(x.o)).is_aggressive,true);assert.equal((await row(x.o)).provoked_spawn_seq,1);
 assert.equal((await commit(x,cl,p)).kind,'already_committed');assert.equal((await row(x.o)).provoked_spawn_seq,1);
});
await runCase('AGGRESSION departure/quiescence and regeneration preserve life hostility; arrival re-engages',opts,async()=>{
 const x=await setup();await hit(x);await x.o`SELECT set_config('g4a7.actor',${user},false)`;
 const r=(await x.o`SELECT g4a6.combat2_depart(${actor},${dest},gen_random_uuid()) r`)[0].r;assert.equal(r.ok,true,JSON.stringify(r));
 const ending=await claim(x,2);assert.equal((await commit(x,ending,proposal(ending))).kind,'committed');
 assert.equal((await x.o`SELECT status FROM g4a6.node_encounter WHERE id=${enc}`)[0].status,'ended');
 const wounded=(await row(x.o)).hp;await clock(x.o,6);await x.o`SELECT g4a6.regen_creature_hp()`;assert((await row(x.o)).hp>wounded);assert.equal((await row(x.o)).is_aggressive,true);
 // Same fixture-only relocation setup as G4A21; the real automatic entry body is tested next.
 await x.o`ALTER TABLE g4a6.characters DISABLE TRIGGER g4a8_arrival`;await x.o`UPDATE g4a6.characters SET current_node_id=${node} WHERE id=${actor}`;await x.o`ALTER TABLE g4a6.characters ENABLE TRIGGER g4a8_arrival`;
 await x.o`SELECT set_config('g4a7.actor',${user},false)`;
 const entry=(await x.o`SELECT g4a6.combat_enter(${actor},gen_random_uuid()) r`)[0].r;assert.equal(entry.ok,true,JSON.stringify(entry));
 assert.equal((await row(x.o)).provoked_spawn_seq,1);
});
await runCase('AGGRESSION death/ordinary respawn resets marker and configured passive temperament',opts,async()=>{
 const x=await setup();await hit(x);await x.o`UPDATE g4a6.creatures SET hp=0,is_alive=false,died_at=${at(0)}`;
 await x.o`UPDATE g4a6.node_creature SET hp=0,is_alive=false WHERE creature_id=${cid}`;
 assert.equal((await row(x.o)).provoked_spawn_seq,null);await clock(x.o,400);await x.o`SELECT g4a6.respawn_creatures()`;
 const c=await row(x.o);assert.equal(c.spawn_seq,2);assert.equal(c.is_aggressive,false);assert.equal(c.provoked_spawn_seq,null);
});
await runCase('AGGRESSION existing passive neighbors and natural defaults are independent; Admin metadata cannot clear provocation',opts,async()=>{
 const x=await setup();await x.o`INSERT INTO g4a6.creatures(id,node_id,hp,max_hp,is_alive,is_aggressive,base_aggressive) VALUES(gen_random_uuid(),${node},100,100,true,false,false)`;
 await hit(x);assert.equal((await x.o`SELECT is_aggressive FROM g4a6.creatures WHERE id<>${cid} LIMIT 1`)[0].is_aggressive,false);
 await x.o`UPDATE g4a6.creatures SET name='edited',is_aggressive=false WHERE id=${cid}`;assert.equal((await row(x.o)).is_aggressive,true);
 await x.o`UPDATE g4a6.creatures SET is_alive=false,hp=0,died_at=${at(0)},base_aggressive=true WHERE id=${cid}`;
 await x.o`UPDATE g4a6.node_creature SET hp=0,is_alive=false WHERE creature_id=${cid}`;
 await clock(x.o,400);await x.o`SELECT g4a6.respawn_creatures()`;assert.equal((await row(x.o)).is_aggressive,true);
});
await runCase('AGGRESSION concurrent exact commit blocks, replays once and cannot lose provocation',opts,async()=>{
 const x=await setup();await engage(x);const cl=await claim(x),p=proposal(cl);
 await race(x,c=>commit(x,cl,p,c),c=>commit(x,cl,p,c),async r=>{assert.ifError(r.error);assert.equal(r.value.kind,'already_committed');assert.equal((await row(x.o)).is_aggressive,true);});
});
await runCase('AGGRESSION stale generation refusal and transactional failure leave no marker',opts,async()=>{
 const x=await setup();await engage(x);const cl=await claim(x),p=proposal(cl);p.creatures[0].spawn_seq=999;
 const r=await commit(x,cl,p);assert.notEqual(r.kind,'committed');assert.equal((await row(x.o)).provoked_spawn_seq,null);
 await assert.rejects(x.o.begin(async t=>{await t`UPDATE g4a6.creatures SET provoked_spawn_seq=spawn_seq WHERE id=${cid}`;throw Error('rollback fixture');}),/rollback fixture/);
 assert.equal((await row(x.o)).provoked_spawn_seq,null);
});

await runCase('AGGRESSION non-damaging and miss proposal branches cannot provoke',opts,async()=>{
 const x=await setup();await engage(x);const cl=await claim(x),p=proposal(cl);
 // Explicit branch fixture, not a claimed end-to-end missed-roll test.
 for(const c of p.creatures){c.hp=40;c.damaged=false;}
 for(const event of p.events)if(event.kind==='attack'){event.hitQuality='miss';event.amount=0;}
 assert.equal((await commit(x,cl,p)).kind,'committed');assert.equal((await row(x.o)).provoked_spawn_seq,null);
});
await runCase('AGGRESSION DoT-only proposal retains existing behavior pending separate owner decision',opts,async()=>{
 const x=await setup();const {cl,p}=await damage(x);
 assert(p.events.some(e=>e.kind==='effect_pulse'));assert.equal((await commit(x,cl,p)).kind,'committed');
 assert((await row(x.o)).hp<40);assert.equal((await row(x.o)).provoked_spawn_seq,null);
});

await runCase('AGGRESSION another owner-controlled character enters and repeated entry keeps one life marker',opts,async()=>{
 const x=await setup();await hit(x);await x.o`SELECT set_config('g4a7.actor',${user},false)`;
 await x.o`INSERT INTO g4a6.characters(id,user_id,current_node_id,race) VALUES(${request},${user},${node},'human')`;
 for(let i=0;i<2;i++){const r=(await x.o`SELECT g4a6.combat_enter(${request},gen_random_uuid()) r`)[0].r;
  if(i===0)assert.equal(r.ok,true,JSON.stringify(r));else assert.equal(r.kind,'already_present');}
 assert.equal((await row(x.o)).provoked_spawn_seq,1);
 assert.equal((await x.o`SELECT count(*)::int n FROM g4a6.node_fighter WHERE character_id=${request} AND present`)[0].n,1);
});
await runCase('AGGRESSION next attack tick waits for the preceding commit and retains life hostility',opts,async()=>{
 const x=await setup();await engage(x);const cl=await claim(x),p=proposal(cl);
 await race(x,c=>commit(x,cl,p,c),async c=>{await clock(c,2);const next=(await c`SELECT g4a6.node_tick_claim(${node},5000) r`)[0].r;
  assert.equal(next.kind,'claimed');return commit(x,next,proposal(next),c);},async r=>{assert.ifError(r.error);assert.equal(r.value.kind,'committed');assert.equal((await row(x.o)).provoked_spawn_seq,1);});
});

await runCase('AGGRESSION late authority guard rolls back the entire installation candidate',opts,async()=>{
 const x=await setup(false);await x.o`GRANT UPDATE ON g4a6.creatures TO anon`;
 const before=(await x.o`SELECT prosrc FROM pg_proc WHERE oid=${core}::regprocedure`)[0].prosrc;
 await assert.rejects(x.o.begin(t=>t.unsafe(x.candidate)),/browser creature mutation boundary unavailable/);
 assert.equal((await x.o`SELECT count(*)::int n FROM pg_attribute WHERE attrelid='g4a6.creatures'::regclass AND attname='provoked_spawn_seq' AND NOT attisdropped`)[0].n,0);
 assert.equal((await x.o`SELECT to_regprocedure('g4a6.creature_life_hostility()') f`)[0].f,null);
 assert.equal((await x.o`SELECT prosrc FROM pg_proc WHERE oid=${core}::regprocedure`)[0].prosrc,before);
});

});
