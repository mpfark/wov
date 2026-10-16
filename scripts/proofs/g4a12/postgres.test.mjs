import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,readFile,access} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import net from 'node:net';
import postgres from 'postgres';
import {buildAdapters} from '../g4a7/source-adapters.mjs';
import {buildMovement} from '../g4a8/source-adapters.mjs';
import {buildRequests} from '../g4a9/source-adapters.mjs';
import {buildFull,manifest,runtimeSources} from './source-adapters.mjs';
import {processNodeTickOnce} from '../../../supabase/functions/_shared/combat2/process-node-tick-once.ts';
import {decodeClaim} from '../../../supabase/functions/_shared/combat2/decode.ts';
import {resolveNodeTick} from '../../../supabase/functions/_shared/combat2/resolver.ts';
import {buildAbilityCatalog} from '../../../supabase/functions/_shared/combat2/catalog.ts';
import {adaptClaimedBossCatalog} from '../../../supabase/functions/_shared/combat2/boss-catalog.ts';
if(!process.argv[2])throw Error('Local PostgreSQL bin required; no connection URL/fallback');
const exe=n=>join(resolve(process.argv[2]),n+(process.platform==='win32'?'.exe':''));await access(exe('initdb'));
const root=await mkdtemp(join(tmpdir(),'wov-g4a12-')),clients=[];
const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
await promisify(execFile)(exe('initdb'),['-D',join(root,'data'),'-U','postgres','--auth=trust','--no-locale','--encoding=UTF8'],{windowsHide:true});
const ctl=args=>new Promise((res,rej)=>{const p=spawn(exe('pg_ctl'),args,{stdio:'ignore',windowsHide:true});p.once('error',rej);p.once('exit',n=>n===0?res():rej(Error('pg_ctl '+n)));});
await ctl(['-D',join(root,'data'),'-l',join(root,'server.log'),'-o',`-h 127.0.0.1 -p ${port}`,'-w','start']);
const admin=postgres({host:'127.0.0.1',port,username:'postgres',database:'postgres',max:1});
after(async()=>{for(const c of clients)await c.end({timeout:1});await admin.end({timeout:1});await ctl(['-D',join(root,'data'),'-m','immediate','-w','stop']);console.log('STOPPED disposable cluster '+root);});
console.log('LOCAL '+(await admin`SELECT version() v`)[0].v+'; cluster '+root);
const read=p=>readFile(new URL(p,import.meta.url),'utf8');
const files=await Promise.all(['../g4a6/fixture.sql','../g4a6/candidate.sql','../g4a7/fixture.sql','../g4a7/adapters.sql','../g4a8/fixture.sql','../g4a8/adapters.sql','../g4a9/fixture.sql','../g4a9/adapters.sql','./fixture.sql','./adapters.sql'].map(read));
const inventory=JSON.parse(await read('../../../supabase/functions/_shared/combat2/active-abilities.json'));const catalogue=buildAbilityCatalog(inventory.abilities,inventory.statuses);assert.equal(catalogue.rejected.length,0);
console.log('RUNTIME SOURCE MANIFEST '+JSON.stringify(runtimeSources()));
const full=buildFull();console.log('COMPLETE SOURCE MANIFEST '+JSON.stringify(manifest));
const cid='00000000-0000-4000-8000-000000000001',node='00000000-0000-4000-8000-000000000002',dest='00000000-0000-4000-8000-000000000003',enc='00000000-0000-4000-8000-000000000004',enc2='00000000-0000-4000-8000-000000000005';
const actor='00000000-0000-4000-8000-000000000011',user='00000000-0000-4000-8000-000000000012',request='00000000-0000-4000-8000-000000000013';
const at=t=>new Date(Date.UTC(2026,0,1)+t*1000).toISOString();let serial=0;const options={timeout:30000};
async function clock(c,t){await c`SELECT set_config('g4a7.cutoff',${at(t)},false)`;}
async function setup({hp=40,engaged=false}={}){
 const db='g4a6_fixture_g4a12_'+(++serial);await admin.unsafe('CREATE DATABASE '+db);
 const connect=()=>{const c=postgres({host:'127.0.0.1',port,username:'postgres',database:db,max:1,onnotice:()=>{}});clients.push(c);return c;};
 const a=connect(),b=connect(),o=connect();for(const sql of files.slice(0,3))await o.unsafe(sql);await o.unsafe(buildAdapters());await o.unsafe(files[3]);await o.unsafe(files[4]);await o.unsafe(files[6]);await o.unsafe(buildMovement());await o.unsafe(files[5]);await o.unsafe(buildRequests());await o.unsafe(files[7]);await o.unsafe(files[8]);await o.unsafe(full);await o.unsafe(files[9]);
 for(const c of [a,b,o]){await c.unsafe("SET statement_timeout='8s';SET lock_timeout='6s';SET deadlock_timeout='100ms';SET default_transaction_isolation='read committed';SET plpgsql.variable_conflict='error'");await c`SELECT set_config('g4a7.actor',${user},false)`;await clock(c,0);assert.equal((await c`SELECT current_setting('transaction_isolation') v`)[0].v,'read committed');}
 await o`INSERT INTO g4a6.node_encounter(id,node_id,status) VALUES(${enc},${node},'active'),(${enc2},${dest},'ended')`;
 await o`INSERT INTO g4a6.nodes(id,connections) VALUES(${node},${o.json([{node_id:dest,direction:'east'}])}),(${dest},${o.json([{node_id:node,direction:'west'}])})`;
 await o`INSERT INTO g4a6.creatures(id,node_id,hp,max_hp,is_alive,is_aggressive,stats) VALUES(${cid},${node},${hp},100,true,false,${o.json({str:10,dex:10,con:10,int:10,wis:10,cha:10})})`;
 await o`INSERT INTO g4a6.characters(id,user_id,current_node_id,race) VALUES(${actor},${user},${node},'human')`;
 await o`SELECT g4a6.settle(${cid},g4a6.test_now())`;await o`SELECT g4a6.seed(${cid})`;
 if(engaged){await o`INSERT INTO g4a6.node_fighter(encounter_id,character_id,present,entry_seq) VALUES(${enc},${actor},true,1)`;await o`UPDATE g4a6.node_creature SET engaged=true`;await o`SELECT g4a6.reconcile(${cid},g4a6.test_now())`;}
 return {a,b,o};
}
const claim=async(c,t=0,lease=5000)=>{await clock(c,t);return(await c`SELECT g4a12.claim(${node},${lease}) r`)[0].r;};
const settle=async(c,t)=>{await clock(c,t);return(await c`SELECT g4a6.settle(${cid},g4a6.test_now()) r`)[0].r;};
function proposal(cl){const d=decodeClaim(cl);assert.equal(d.ok,true,JSON.stringify(d));const boss=adaptClaimedBossCatalog(d.snapshot);assert.equal(boss.rejected.length,0);return resolveNodeTick(boss.snapshot,{abilities:catalogue.specs});}
const commit=async(c,cl,p,t=0)=>{await clock(c,t);return(await c`SELECT g4a12.commit_result(${c.json(cl)},${c.json(p)}) r`)[0].r;};
const state=async c=>(await c`SELECT c.hp,c.spawn_seq,c.is_alive,c.eligible_since,c.fractional_credit,nc.hp projection_hp,e.tick,e.state_version,e.claim_token FROM g4a6.creatures c LEFT JOIN g4a6.node_creature nc ON nc.creature_id=c.id AND nc.spawn_seq=c.spawn_seq LEFT JOIN g4a6.node_encounter e ON e.id=nc.encounter_id WHERE c.id=${cid}`)[0];
const pid=async c=>(await c`SELECT pg_backend_pid() p`)[0].p;
async function blocked(o,waiter,holder){const limit=Date.now()+5000;while(Date.now()<limit){const r=(await o`SELECT ${holder}::int=ANY(pg_blocking_pids(${waiter}::int)) blocked,EXISTS(SELECT 1 FROM pg_locks WHERE pid=${waiter} AND locktype='advisory' AND NOT granted) advisory`)[0];if(r.blocked&&r.advisory){console.log(`OBSERVED G4A12 NODE BLOCK ${holder} -> ${waiter}`);return;}await new Promise(r=>setTimeout(r,10));}throw Error('blocking evidence absent');}
const outcome=p=>p.then(value=>({value}),error=>({error}));
async function race(x,first,second,verify){const holder=await pid(x.a),waiter=await pid(x.b);await x.a.unsafe('BEGIN');let pending;try{const firstResult=await first(x.a);pending=outcome(second(x.b));await blocked(x.o,waiter,holder);await x.a.unsafe('COMMIT');await verify(await pending,firstResult);}finally{await x.a.unsafe('ROLLBACK');if(pending)await pending;}}

test('complete claim snapshot through actual decoder/resolver/worker and complete commit chain',options,async()=>{
 const {o}=await setup();let captured;
 const result=await processNodeTickOnce(node,{abilityRecords:inventory.abilities,statusRecords:inventory.statuses,transport:{claimNode:()=>claim(o,120),commitTick:async args=>{captured=args;return commit(o,{encounter_id:args._encounter_id,claim_token:args._claim_token,candidate_tick:args._candidate_tick,last_committed_tick:args._expected_last_tick,state_version:args._expected_state_version},args._proposed,120);}}});
 assert.equal(result.kind,'committed',JSON.stringify(result));assert(captured);assert.equal((await state(o)).hp,45);assert.equal((await state(o)).projection_hp,45);assert.equal((await o`SELECT count(*)::int n FROM g4a6.node_tick_batch`)[0].n,1);
});

const effect='00000000-0000-4000-8000-000000000014',follower='00000000-0000-4000-8000-000000000022',party='00000000-0000-4000-8000-000000000031';
async function dot(c,{amount=7,expiry=180,source=null}={}){const nc=(await c`SELECT id FROM g4a6.node_creature WHERE creature_id=${cid}`)[0].id;await c`INSERT INTO g4a6.node_effect(id,encounter_id,kind,effect_type,target_creature_id,source_character_id,magnitude,config,expires_at,next_due_at,interval_ms) VALUES(${effect},${enc},'dot','damage',${cid},${source},${amount},${c.json({node_creature_id:nc,spawn_seq:1,activated_at_tick:0,expires_after_tick:1,interval_ticks:1,next_pulse_tick:1})},${at(expiry)},${at(0)},2000)`;if(expiry<=100)await c`UPDATE g4a6.node_encounter SET tick=1 WHERE id=${enc}`;await c`SELECT g4a6.reconcile(${cid},g4a6.test_now())`;}
async function killReady(c){await c`INSERT INTO g4a6.node_fighter(encounter_id,character_id,present,entry_seq) VALUES(${enc},${actor},false,1)`;await c`UPDATE g4a6.creatures SET gold_enabled=true,gold_min=3,gold_max=3,gold_chance=1`;await dot(c,{amount:100,source:actor});}
async function partyReady(c){await c`INSERT INTO g4a6.characters(id,user_id,current_node_id,race) VALUES(${follower},${user},${node},'human')`;await c`INSERT INTO g4a6.parties(id,leader_id,tank_id) VALUES(${party},${actor},${actor})`;await c`INSERT INTO g4a6.party_members(party_id,character_id,status,is_following) VALUES(${party},${actor},'accepted',false),(${party},${follower},'accepted',true)`;}
const entry=async(c,t=120)=>{await clock(c,t);return(await c`SELECT g4a9.entry(${actor},${request}) r`)[0].r;};
const moving=async(c,t=120,part=false)=>{await clock(c,t);return(await c`SELECT g4a9.move(${actor},${dest},${request},${part},true) r`)[0].r;};

test('lease in-flight refusal, expiry, stale token, not-due and exact successful replay',options,async()=>{
 const {o}=await setup();const cl=await claim(o);assert.equal((await claim(o,2)).reason,'in_flight');const fresh=await claim(o,6);assert.notEqual(fresh.claim_token,cl.claim_token);assert.equal((await commit(o,cl,proposal(cl),6)).kind,'stale_claim');const p=proposal(fresh);assert.equal((await commit(o,fresh,p,6)).kind,'committed');const before=await state(o);assert.equal((await commit(o,fresh,p,6)).kind,'already_committed');assert.deepEqual(await state(o),before);await o`UPDATE g4a6.node_encounter SET status='active',next_due_at=${at(999)} WHERE id=${enc}`;assert.equal((await claim(o,7)).kind,'not_due');
});
test('real basic-attack intent resolves deterministically and consumes once through full mutations',options,async()=>{
 const {o}=await setup({engaged:true});await o`INSERT INTO g4a6.node_intent(encounter_id,character_id,intent_kind,target_creature_id,status,request_id) VALUES(${enc},${actor},'basic_attack',${cid},'pending',${request})`;
 const cl=await claim(o),p=proposal(cl);assert.deepEqual(proposal(cl),p);assert.equal(p.intent_ids.length,1);assert.equal((await commit(o,cl,p)).kind,'committed');assert.equal((await o`SELECT status FROM g4a6.node_intent`)[0].status,'consumed');assert.equal((await state(o)).hp,(await state(o)).projection_hp);assert.equal((await commit(o,cl,p)).kind,'already_committed');assert.equal((await o`SELECT count(*)::int n FROM g4a6.node_tick_batch`)[0].n,1);
});
test('actual DoT pulse persists damage; expiry commit starts eligibility and preserves 60-second delay',options,async()=>{
 const {o}=await setup();await dot(o);const cl=await claim(o,120),p=proposal(cl);assert.equal(p.creatures[0].hp,33);assert.equal((await commit(o,cl,p,120)).kind,'committed');assert.equal((await state(o)).hp,33);assert.equal((await state(o)).eligible_since,null);
 const next=await claim(o,181),expired=proposal(next);assert(expired.effects_delete.includes(effect));assert.equal(expired.status,'ended');assert.equal((await commit(o,next,expired,181)).kind,'committed');assert.equal(new Date((await state(o)).eligible_since).toISOString(),at(181));await settle(o,241);assert.equal((await state(o)).hp,33);await settle(o,301);assert.equal((await state(o)).hp,38);assert.equal((await state(o)).projection_hp,38);
});
test('character damage and healing effects use real resolver and source resource writes',options,async()=>{
 const {o}=await setup({engaged:true});await o`UPDATE g4a6.node_creature SET engaged=false`;await o`INSERT INTO g4a6.node_effect(id,encounter_id,kind,effect_type,target_character_id,magnitude,next_due_at,interval_ms) VALUES(${effect},${enc},'dot','damage',${actor},7,${at(0)},2000)`;await o`UPDATE g4a6.node_effect SET config=${o.json({activated_at_tick:0,expires_after_tick:10,interval_ticks:1,next_pulse_tick:1})}`;
 const cl=await claim(o),p=proposal(cl);assert.equal((await commit(o,cl,p)).kind,'committed');assert.equal((await o`SELECT hp FROM g4a6.characters WHERE id=${actor}`)[0].hp,93);
 await o`UPDATE g4a6.node_effect SET kind='regen',effect_type='healing',magnitude=3,next_due_at=${at(2)}`;const cl2=await claim(o,2);assert.equal((await commit(o,cl2,proposal(cl2),2)).kind,'committed');assert.equal((await o`SELECT hp FROM g4a6.characters WHERE id=${actor}`)[0].hp,96);
});
test('real death proposal fences generation, rewards once, and delegates progression to labelled spy',options,async()=>{
 const {o}=await setup();await killReady(o);const cl=await claim(o),p=proposal(cl);assert.equal(p.creatures[0].is_alive,false);assert.equal(p.rewards.length,1);assert.equal((await commit(o,cl,p)).kind,'committed');assert.equal((await state(o)).hp,0);assert.equal((await state(o)).is_alive,false);assert.equal((await o`SELECT gold FROM g4a6.characters WHERE id=${actor}`)[0].gold,3);assert.equal((await o`SELECT count(*)::int n FROM g4a12.progression_calls`)[0].n,1);assert.equal((await commit(o,cl,p)).kind,'already_committed');assert.equal((await o`SELECT count(*)::int n FROM g4a6.node_reward_claim`)[0].n,1);await settle(o,1200);assert.equal((await state(o)).hp,0);
});
test('bounded failure in progression delegate rolls back HP/reward/batch writes and same claim retries',options,async()=>{
 const {o}=await setup();await killReady(o);const cl=await claim(o),p=proposal(cl);await o`SELECT set_config('g4a12.fail_progression','on',false)`;const before=await state(o);assert.equal((await commit(o,cl,p)).kind,'internal_failure');assert.deepEqual(await state(o),before);assert.equal((await o`SELECT count(*)::int n FROM g4a6.node_reward_claim`)[0].n,0);assert.equal((await o`SELECT count(*)::int n FROM g4a6.node_tick_batch`)[0].n,0);await o`SELECT set_config('g4a12.fail_progression','off',false)`;assert.equal((await commit(o,cl,p)).kind,'committed');
});
test('foreign creature and stance targets reject without HP writes',options,async()=>{
 const {o}=await setup();const cl=await claim(o),p=proposal(cl);const before=await state(o);p.creatures.push({id:request,creature_id:cid,spawn_seq:1,hp:1,is_alive:true});assert.equal((await commit(o,cl,p)).kind,'foreign_reference');assert.deepEqual(await state(o),before);p.creatures=[];p.stance_clear_character_ids=[follower];await assert.rejects(commit(o,cl,p),/stance_target_outside_encounter/);assert.deepEqual(await state(o),before);
});
test('complete equipment fence rejects an equipped row added after claim',options,async()=>{
 const {o}=await setup({engaged:true});const cl=await claim(o),p=proposal(cl),before=await state(o);await o`INSERT INTO g4a6.items(id,name,item_type) VALUES(${request},'fixture sword','equipment')`;await o`INSERT INTO g4a6.character_inventory(character_id,item_id,equipped_slot) VALUES(${actor},${request},'main_hand')`;assert.equal((await commit(o,cl,p)).kind,'stale_equipment');assert.deepEqual(await state(o),before);
});
test('expired lease settlement invalidates old snapshot before it can restore older HP',options,async()=>{
 const {o}=await setup();const cl=await claim(o),p=proposal(cl);await settle(o,120);assert.equal((await state(o)).hp,45);assert.equal((await commit(o,cl,p,120)).kind,'stale_claim');assert.equal((await state(o)).hp,45);
});
test('same-generation reactivation seeds durable wounded HP after a real ended tick',options,async()=>{
 const {o}=await setup();const cl=await claim(o),p=proposal(cl);assert.equal(p.status,'ended');assert.equal((await commit(o,cl,p)).kind,'committed');await settle(o,120);assert.equal((await state(o)).hp,45);assert.equal((await entry(o,120)).ok,true);const fresh=await claim(o,120);assert.equal(fresh.kind,'claimed');assert.equal(fresh.snapshot.creatures[0].hp,45);assert.equal(fresh.snapshot.creatures[0].spawn_seq,1);
});
test('old generation cannot commit after candidate ordinary respawn',options,async()=>{
 const {o}=await setup();await dot(o);const cl=await claim(o),p=proposal(cl);await o`UPDATE g4a6.creatures SET hp=0,is_alive=false,died_at=${at(0)} WHERE id=${cid}`;await o`UPDATE g4a6.node_creature SET hp=0,is_alive=false`;await clock(o,400);await o`SELECT g4a7.respawn(${cid})`;assert.equal((await state(o)).spawn_seq,2);assert.equal((await state(o)).hp,100);assert.equal((await commit(o,cl,p,400)).kind,'stale_snapshot');assert.equal((await state(o)).hp,100);
});

test('SESSION: regeneration first blocks full claim; snapshot reads settled HP',options,async()=>{const x=await setup();await race(x,c=>settle(c,120),c=>claim(c,120),async r=>{assert.ifError(r.error);assert.equal(r.value.snapshot.creatures[0].hp,45);});});
test('SESSION: full claim first blocks regeneration; live lease defers settlement',options,async()=>{const x=await setup();await race(x,c=>claim(c,120),c=>settle(c,121),async r=>{assert.ifError(r.error);assert.equal(r.value,'live_claim_deferred');assert.equal((await state(x.o)).hp,45);});});
test('SESSION: actual DoT commit blocks regeneration and persists coherent damage',options,async()=>{const x=await setup();await dot(x.o);const cl=await claim(x.o,120),p=proposal(cl);await race(x,c=>commit(c,cl,p,120),c=>settle(c,121),async r=>{assert.ifError(r.error);assert.equal((await state(x.o)).hp,33);assert.equal((await state(x.o)).projection_hp,33);assert.equal((await state(x.o)).eligible_since,null);});});
test('SESSION: regeneration precedes stale commit without overwriting healed HP',options,async()=>{const x=await setup();const cl=await claim(x.o),p=proposal(cl);await race(x,c=>settle(c,120),c=>commit(c,cl,p,120),async r=>{assert.ifError(r.error);assert.equal(r.value.kind,'stale_claim');assert.equal((await state(x.o)).hp,45);});});
test('SESSION: new entry fences existing lease before old full commit',options,async()=>{const x=await setup();const cl=await claim(x.o),p=proposal(cl);await race(x,c=>entry(c,1),c=>commit(c,cl,p,1),async r=>{assert.ifError(r.error);assert.equal(r.value.kind,'stale_claim');assert.equal((await state(x.o)).hp,40);});});
test('SESSION: final DoT expiry commit blocks settlement and starts fresh eligibility',options,async()=>{const x=await setup();await dot(x.o,{expiry:100});const cl=await claim(x.o,120),p=proposal(cl);assert(p.effects_delete.includes(effect));await race(x,c=>commit(c,cl,p,120),c=>settle(c,121),async r=>{assert.ifError(r.error);assert.equal((await state(x.o)).hp,40);assert.equal(new Date((await state(x.o)).eligible_since).toISOString(),at(120));});});
test('SESSION: ordinary respawn coverage refuses old-generation commit',options,async()=>{const x=await setup();await dot(x.o);const cl=await claim(x.o),p=proposal(cl);await x.o`UPDATE g4a6.creatures SET hp=0,is_alive=false,died_at=${at(0)} WHERE id=${cid}`;await x.o`UPDATE g4a6.node_creature SET hp=0,is_alive=false`;await race(x,async c=>{await clock(c,400);await c`SELECT g4a7.respawn(${cid})`;},c=>commit(c,cl,p,400),async r=>{assert.equal(r.error?.code,'40001');assert.equal((await state(x.o)).hp,100);assert.equal((await commit(x.o,cl,p,400)).kind,'stale_snapshot');});});
test('SESSION: same claim submitted twice blocks then replays one batch',options,async()=>{const x=await setup();const cl=await claim(x.o),p=proposal(cl);await race(x,c=>commit(c,cl,p),c=>commit(c,cl,p),async r=>{assert.ifError(r.error);assert.equal(r.value.kind,'already_committed');assert.equal((await x.o`SELECT count(*)::int n FROM g4a6.node_tick_batch`)[0].n,1);});});
test('SESSION: full claim blocks solo movement; relocation fences old commit',options,async()=>{const x=await setup();let cl;await race(x,async c=>(cl=await claim(c,120)),c=>moving(c,120),async r=>{assert.ifError(r.error);assert.equal(r.value.ok,true);assert.equal((await commit(x.o,cl,proposal(cl),120)).kind,'stale_claim');});});
test('SESSION: party-follow arrival composition precedes full claim without late node locks',options,async()=>{const x=await setup();await partyReady(x.o);await race(x,c=>moving(c,120,true),c=>claim(c,120),async r=>{assert.ifError(r.error);assert.equal(r.value.kind,'claimed');assert.equal((await x.o`SELECT count(*)::int n FROM g4a6.characters WHERE current_node_id=${dest}`)[0].n,2);});});

test('authored ability intent uses actual published catalogue, real resolver and full commit',options,async()=>{
 const {o}=await setup({engaged:true});await o`UPDATE g4a6.characters SET hp=50 WHERE id=${actor}`;
 await o`INSERT INTO g4a6.node_intent(encounter_id,character_id,intent_kind,ability_key,status,request_id) VALUES(${enc},${actor},'ability','second_wind','pending',${request})`;
 const cl=await claim(o),p=proposal(cl);assert(p.characters.some(c=>c.id===actor&&c.hp>50),JSON.stringify(p.events));assert.equal((await commit(o,cl,p)).kind,'committed');assert((await o`SELECT hp FROM g4a6.characters WHERE id=${actor}`)[0].hp>50);
});
test('source stance claim/fence and real Force Shield consumption persist once',options,async()=>{
 const {o}=await setup({engaged:true});await o`UPDATE g4a6.characters SET class='wizard' WHERE id=${actor}`;
 await o`INSERT INTO g4a6.character_stance(character_id,ability_key,reserve_pct,version,state,activated_at) VALUES(${actor},'force_shield',0.1,2,${o.json({ward_remaining:4})},${at(0)})`;
 const cast={enabled:true,ability_key:'fixture_cast',label:'fixture',cast_ms:2000,cooldown_ms:4000,chance:1,base_amount:7,target_mode:'aoe',damage_type:'physical'};
 const pending={ability_key:'fixture_cast',ability_label:'fixture',started_at_tick:0,resolve_at_tick:1,target_mode:'all_present_at_resolution',primary_magnitude:7,secondary_magnitude:0,damage_type:'physical',target_fighter_id:null,target_character_id:null,target_entry_seq:null};
 await o`UPDATE g4a6.creatures SET boss_cast=${o.json(cast)}`;await o`UPDATE g4a6.node_creature SET pending_action=${o.json(pending)}`;
 const cl=await claim(o),p=proposal(cl);assert.equal(p.stance_fence.length,1);assert.equal(p.stance_updates.length,1);assert.equal((await commit(o,cl,p)).kind,'committed');const st=(await o`SELECT * FROM g4a6.character_stance`)[0];assert.equal(Number(st.version),3);assert.equal(st.state.ward_remaining,0);assert.equal((await o`SELECT hp FROM g4a6.characters WHERE id=${actor}`)[0].hp,97);assert.equal((await commit(o,cl,p)).kind,'stale_stance');assert.equal(Number((await o`SELECT version FROM g4a6.character_stance`)[0].version),3);
});
test('pending boss action blocks regeneration and actual resolver clears a missing configured ability',options,async()=>{
 const {o}=await setup({engaged:true});const pending={ability_key:'fixture_missing_cast',ability_label:'fixture',started_at_tick:0,resolve_at_tick:1,target_mode:'current_tank_at_resolution',primary_magnitude:20,secondary_magnitude:0,damage_type:'physical',target_fighter_id:null,target_character_id:null,target_entry_seq:null};await o`UPDATE g4a6.node_creature SET pending_action=${o.json(pending)}`;await o`SELECT g4a6.reconcile(${cid},g4a6.test_now())`;await settle(o,120);assert.equal((await state(o)).hp,40);
 const cl=await claim(o,120),p=proposal(cl);assert(p.events.some(e=>e.kind==='boss_cast_evaded'));assert.equal(p.creatures[0].pending_action,null);assert.equal((await commit(o,cl,p,120)).kind,'committed');assert.equal((await o`SELECT pending_action FROM g4a6.node_creature`)[0].pending_action,null);assert.equal((await state(o)).eligible_since,null); // present engaged fighter remains a blocker
});

test('real loot proposal inserts one death outcome and ground item; replay cannot duplicate',options,async()=>{
 const {o}=await setup();await killReady(o);await o`INSERT INTO g4a6.items(id,name,item_type,world_drop) VALUES(${request},'fixture ordinary sword','equipment',true)`;await o`UPDATE g4a6.creatures SET item_source='world_pool',drop_chance=1`;const cl=await claim(o),p=proposal(cl);assert(p.loot.some(l=>l.item_id===request&&l.outcome==='dropped'));assert.equal((await commit(o,cl,p)).kind,'committed');assert.equal((await o`SELECT count(*)::int n FROM g4a6.node_ground_loot`)[0].n,1);assert.equal((await commit(o,cl,p)).kind,'already_committed');assert.equal((await o`SELECT count(*)::int n FROM g4a6.node_ground_loot`)[0].n,1);
});
test('SESSION: bounded failed commit releases serialization for exact retry without duplicate awards',options,async()=>{
 const x=await setup();await killReady(x.o);const cl=await claim(x.o),p=proposal(cl);await x.a`SELECT set_config('g4a12.fail_progression','on',false)`;await race(x,c=>commit(c,cl,p),c=>commit(c,cl,p),async(r,first)=>{assert.equal(first.kind,'internal_failure');assert.ifError(r.error);assert.equal(r.value.kind,'committed');assert.equal((await x.o`SELECT count(*)::int n FROM g4a6.node_reward_claim`)[0].n,1);assert.equal((await x.o`SELECT gold FROM g4a6.characters WHERE id=${actor}`)[0].gold,3);});
});
async function destinationCreature(c){await c`INSERT INTO g4a6.creatures(id,node_id,hp,max_hp,is_alive,is_aggressive,stats) VALUES(${follower},${dest},40,100,true,true,${c.json({str:10,dex:10,con:10,int:10,wis:10,cha:10})})`;await c`SELECT g4a6.settle(${follower},g4a6.test_now())`;}
const destinationClaim=async(c,t=120)=>{await clock(c,t);return(await c`SELECT g4a12.claim(${dest},5000) r`)[0].r;};
test('SESSION: coordinated arrival into creature node precedes complete destination claim',options,async()=>{
 const x=await setup();await partyReady(x.o);await destinationCreature(x.o);await race(x,c=>moving(c,120,true),c=>destinationClaim(c),async r=>{assert.ifError(r.error);assert.equal(r.value.kind,'claimed');assert.equal(r.value.snapshot.creatures[0].hp,45);assert.equal(r.value.snapshot.fighters.filter(f=>f.present).length,2);assert.equal(decodeClaim(r.value).ok,true);assert.equal((await commit(x.o,r.value,proposal(r.value),120)).kind,'committed');});
});

test('multi-node commit proposal is explicitly refused before acquiring late destination locks',options,async()=>{
 const {o}=await setup();const cl=await claim(o),p=proposal(cl),before=await state(o);p.departures=[{destination_node_id:dest,outcome:'moved'}];await assert.rejects(commit(o,cl,p),/multi-node commit adapter not exercised/);assert.deepEqual(await state(o),before);
});
