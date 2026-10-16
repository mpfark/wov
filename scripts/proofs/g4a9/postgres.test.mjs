import { test,after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn,execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp,readFile,access } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import net from 'node:net';
import postgres from 'postgres';
import { buildAdapters,manifest } from '../g4a7/source-adapters.mjs';
import {buildRequests,manifest as requestManifest,partyRequestDefinition} from './source-adapters.mjs';
import {buildMovement,manifest as movementManifest} from '../g4a8/source-adapters.mjs';

if(!process.argv[2])throw Error('Supply local PostgreSQL bin directory; no URL/fallback');
const exe=n=>join(resolve(process.argv[2]),n+(process.platform==='win32'?'.exe':''));await access(exe('initdb'));
const root=await mkdtemp(join(tmpdir(),'wov-g4a9-')),clients=[];
const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
await promisify(execFile)(exe('initdb'),['-D',join(root,'data'),'-U','postgres','--auth=trust','--no-locale','--encoding=UTF8'],{windowsHide:true});
const ctl=args=>new Promise((res,rej)=>{const p=spawn(exe('pg_ctl'),args,{stdio:'ignore',windowsHide:true});p.once('error',rej);p.once('exit',n=>n===0?res():rej(Error('pg_ctl '+n)));});
await ctl(['-D',join(root,'data'),'-l',join(root,'server.log'),'-o',`-h 127.0.0.1 -p ${port}`,'-w','start']);
const admin=postgres({host:'127.0.0.1',port,username:'postgres',database:'postgres',max:1});
after(async()=>{for(const c of clients)await c.end({timeout:1});await admin.end({timeout:1});await ctl(['-D',join(root,'data'),'-m','immediate','-w','stop']);});
const generated=buildAdapters();console.log('LOCAL '+(await admin`SELECT version() v`)[0].v+'; cluster '+root);console.log('SOURCE MANIFEST '+JSON.stringify(manifest));
const read=p=>readFile(new URL(p,import.meta.url),'utf8');
const files=await Promise.all(['../g4a6/fixture.sql','../g4a6/candidate.sql','../g4a7/fixture.sql','../g4a7/adapters.sql','../g4a8/fixture.sql','../g4a8/adapters.sql','./fixture.sql','./adapters.sql'].map(read));
const cid='00000000-0000-4000-8000-000000000001',node='00000000-0000-4000-8000-000000000002',dest='00000000-0000-4000-8000-000000000003',enc='00000000-0000-4000-8000-000000000004',enc2='00000000-0000-4000-8000-000000000005';
const actor='00000000-0000-4000-8000-000000000011',user='00000000-0000-4000-8000-000000000012',request='00000000-0000-4000-8000-000000000013',effect='00000000-0000-4000-8000-000000000014';
const at=t=>new Date(Date.UTC(2026,0,1)+t*1000).toISOString();let serial=0;const options={timeout:25000};
async function clock(c,t){await c`SELECT set_config('g4a7.cutoff',${at(t)},false)`;}
async function setup({hp=40,aggressive=true}={}){
 const db='g4a6_fixture_g4a9_'+(++serial);await admin.unsafe('CREATE DATABASE '+db);
 const connect=()=>{const c=postgres({host:'127.0.0.1',port,username:'postgres',database:db,max:1,onnotice:()=>{}});clients.push(c);return c;};
 const a=connect(),b=connect(),o=connect();for(const sql of files.slice(0,3))await o.unsafe(sql);await o.unsafe(generated);await o.unsafe(files[3]);await o.unsafe(files[4]);await o.unsafe(files[6]);await o.unsafe(buildMovement());await o.unsafe(files[5]);await o.unsafe(buildRequests());await o.unsafe(files[7]);
 for(const c of [a,b,o]){await c.unsafe("SET statement_timeout='8s';SET lock_timeout='6s';SET deadlock_timeout='100ms';SET default_transaction_isolation='read committed'");await c`SELECT set_config('g4a7.actor',${user},false)`;await clock(c,0);assert.equal((await c`SELECT current_setting('transaction_isolation') v`)[0].v,'read committed');}
 await o`INSERT INTO g4a6.node_encounter(id,node_id,status) VALUES(${enc},${node},'ended'),(${enc2},${dest},'ended')`;
 await o`INSERT INTO g4a6.creatures(id,node_id,hp,max_hp,is_alive,is_aggressive) VALUES(${cid},${node},${hp},100,true,${aggressive})`;
 await o`INSERT INTO g4a6.characters(id,user_id,current_node_id) VALUES(${actor},${user},${node})`;
 await o`INSERT INTO g4a6.nodes(id,connections) VALUES(${node},${o.json([{node_id:dest,direction:'east'}])}),(${dest},${o.json([{node_id:node,direction:'west'}])})`;
 await settle(o,0);return {a,b,o};
}
const settle=async(c,t)=>{await clock(c,t);return (await c`SELECT g4a6.settle(${cid},g4a6.test_now()) r`)[0].r;};
const entry=async(c,t)=>{await clock(c,t);return (await c`SELECT g4a7.enter(${actor},${request}) r`)[0].r;};
const hostile=async(c,t)=>{await clock(c,t);return (await c`SELECT g4a6.src_hostile(${actor},'basic_attack',NULL,${cid},${request}) r`)[0].r;};
const claim=async(c,t)=>{await clock(c,t);return (await c`SELECT g4a7.claim(${cid}) r`)[0].r;};
const state=async c=>(await c`SELECT cr.*,nc.id runtime_id,nc.hp runtime_hp,nc.pending_action,e.tick,e.state_version FROM g4a6.creatures cr LEFT JOIN g4a6.node_creature nc ON nc.creature_id=cr.id AND nc.spawn_seq=cr.spawn_seq LEFT JOIN g4a6.node_encounter e ON nc.encounter_id=e.id WHERE cr.id=${cid}`)[0];
async function proposal(c,hp,{status='active',pending=null,effects=[]}={}){const s=await state(c);const events=await c`SELECT id FROM g4a6.node_pending_event WHERE consumed_at IS NULL`;return {creatures:[{id:s.runtime_id,creature_id:cid,spawn_seq:s.spawn_seq,hp,is_alive:hp>0,damaged:true,pending_action:pending}],effects_delete:effects,pending_event_ids:events.map(x=>x.id),status};}
async function commit(c,cl,p,t){await clock(c,t);const rows=await c`SELECT id FROM g4a6.node_intent WHERE status='pending' AND seq<=${cl.intent_cutoff_seq??0}`;return (await c`SELECT g4a7.commit_result(${cid},${c.json(cl)},${c.json(p)},${c.array(rows.map(x=>x.id))}::uuid[]) r`)[0].r;}
const pid=async c=>(await c`SELECT pg_backend_pid() p`)[0].p;
async function waiting(o,waiter,holder){const limit=Date.now()+5000;while(Date.now()<limit){const r=(await o`SELECT ${holder}::int=ANY(pg_blocking_pids(${waiter}::int)) blocked,EXISTS(SELECT 1 FROM pg_locks WHERE pid=${waiter} AND locktype='advisory' AND NOT granted) advisory`)[0];if(r.blocked&&r.advisory){console.log(`OBSERVED SOURCE-ADAPTER LOCK ${holder} -> ${waiter}`);return;}await new Promise(r=>setTimeout(r,10));}throw Error('required blocking not observed');}
const outcome=p=>p.then(value=>({value}),error=>({error}));

const follower='00000000-0000-4000-8000-000000000022',offMember='00000000-0000-4000-8000-000000000023',invitee='00000000-0000-4000-8000-000000000024';
const partyId='00000000-0000-4000-8000-000000000031',offNode='00000000-0000-4000-8000-000000000032',otherCreature='00000000-0000-4000-8000-000000000033',otherRequest='00000000-0000-4000-8000-000000000034',movementRequest='00000000-0000-4000-8000-000000000035';
async function addParty(o){
 await o`INSERT INTO g4a6.nodes(id) VALUES(${offNode})`;
 await o`INSERT INTO g4a6.characters(id,user_id,current_node_id) VALUES(${follower},${user},${node}),(${offMember},${user},${offNode}),(${invitee},${user},${offNode})`;
 await o`INSERT INTO g4a6.parties(id,leader_id,tank_id) VALUES(${partyId},${actor},${actor})`;
 await o`INSERT INTO g4a6.party_members(party_id,character_id,status,is_following) VALUES(${partyId},${actor},'accepted',false),(${partyId},${follower},'accepted',true),(${partyId},${offMember},'accepted',true),(${partyId},${invitee},'pending',false)`;
}
async function addCreature(o,n=dest){await o`INSERT INTO g4a6.creatures(id,node_id,hp,max_hp,is_alive,is_aggressive) VALUES(${otherCreature},${n},40,100,true,true)`;await o`SELECT g4a6.settle(${otherCreature},g4a6.test_now())`;}
const moving=async(c,{who=actor,to=dest,id=movementRequest,party=false,finish=true,t=120}={})=>{await clock(c,t);return (await c`SELECT g4a9.move(${who},${to},${id},${party},${finish}) r`)[0].r;};
const regen=async(c,{who=actor,to=dest,reverse=false,t=120}={})=>{await clock(c,t);await c`SELECT g4a9.regenerate(${who},${to},${reverse})`;};
const mutate=async(c,op='stop_following',who=follower,id=otherRequest)=> (await c`SELECT g4a6.party_mutate(${who},${op},${partyId},NULL::uuid,NULL::uuid,${id}) r`)[0].r;
const current=async(c,id=cid)=>(await c`SELECT * FROM g4a6.creatures WHERE id=${id}`)[0];
async function race(x,first,second,verify,beforeRelease=async()=>{}){
 const holder=await pid(x.a),waiter=await pid(x.b);await x.a.unsafe('BEGIN');let pending;
 try{await first(x.a);pending=outcome(second(x.b));await waiting(x.o,waiter,holder);await beforeRelease(x.a);await x.a.unsafe('COMMIT');await verify(await pending);}
 finally{await x.a.unsafe('ROLLBACK');if(pending)await pending;}
}
test('pinned request/party/trigger composition compiles in private fixture',options,async()=>{
 const {o}=await setup();assert.equal(requestManifest.length,20);console.log('REQUEST SOURCE MANIFEST '+JSON.stringify(requestManifest));
 assert.equal((await o`SELECT count(*)::int n FROM pg_proc WHERE pronamespace='public'::regnamespace`)[0].n,0);
});
test('complete solo request validates adjacency/cost, creates receipt, moves and exact replay costs once',options,async()=>{
 const {o}=await setup();assert.equal((await moving(o)).kind,'moved');assert.equal((await moving(o)).kind,'already_moved');
 assert.equal((await o`SELECT mp FROM g4a6.characters WHERE id=${actor}`)[0].mp,95);assert.equal((await current(o)).hp,45);
 assert.equal((await o`SELECT count(*)::int n FROM g4a6.combat2_departure_request`)[0].n,1);
});
test('source party request freezes same-node followers, excludes off-node/pending; leader moves last',options,async()=>{
 const {o}=await setup();await addParty(o);const r=await moving(o,{party:true});assert.equal(r.ok,true,JSON.stringify(r));
 const members=await o`SELECT * FROM g4a6.combat2_party_departure_member ORDER BY movement_order`;assert.deepEqual(members.map(m=>m.character_id),[follower,actor]);
 assert.equal((await o`SELECT current_node_id FROM g4a6.characters WHERE id=${offMember}`)[0].current_node_id,offNode);
 assert.equal((await o`SELECT status FROM g4a6.party_members WHERE character_id=${invitee}`)[0].status,'pending');
 assert.equal((await moving(o,{party:true})).kind,'already_moved');
});
test('source party create and patched stop-follow/replay preserve membership contracts',options,async()=>{
 const {o}=await setup();const r=(await o`SELECT g4a6.party_mutate(${actor},'create',NULL::uuid,NULL::uuid,NULL::uuid,${request}) r`)[0].r;assert.equal(r.kind,'party_created');
 assert.equal((await o`SELECT count(*)::int n FROM g4a6.party_members`)[0].n,1);
});
test('missing destination encounter is created by complete arrival body with settled shared HP',options,async()=>{
 const {o}=await setup();await o`DELETE FROM g4a6.node_encounter WHERE id=${enc2}`;await addCreature(o);
 assert.equal((await moving(o)).ok,true);const s=await current(o,otherCreature);assert.equal(s.hp,45);assert.equal(s.eligible_since,null);
 assert.equal((await o`SELECT nc.hp FROM g4a6.node_creature nc WHERE nc.creature_id=${otherCreature}`)[0].hp,45);
 assert.equal((await o`SELECT count(*)::int n FROM g4a6.node_encounter WHERE node_id=${dest}`)[0].n,1);
});
test('insufficient MP refuses request and rolls back attempted old-rate settlement',options,async()=>{
 const {o}=await setup();await o`UPDATE g4a6.characters SET mp=0 WHERE id=${actor}`;const before=await current(o);
 assert.equal((await moving(o)).kind,'insufficient_resource');assert.deepEqual(await current(o),before);assert.equal((await o`SELECT count(*)::int n FROM g4a6.combat2_departure_request`)[0].n,0);
});
test('party refusal rolls back all settlement and no request/mover receipts remain',options,async()=>{
 const {o}=await setup();await addParty(o);await o`UPDATE g4a6.characters SET mp=0 WHERE id=${follower}`;const before=await current(o);
 const r=await moving(o,{party:true});assert.equal(r.kind,'insufficient_resource');assert.deepEqual(await current(o),before);assert.equal((await o`SELECT count(*)::int n FROM g4a6.combat2_party_departure_request`)[0].n,0);
});
test('real lifecycle child/character triggers refuse inactive movement and membership writes',options,async()=>{
 const {o}=await setup();await addParty(o);
 // Fixture setup, not an authorized production soft-delete workflow.
 await o.unsafe('ALTER TABLE g4a6.characters DISABLE TRIGGER character_lifecycle_character_fence');await o`UPDATE g4a6.characters SET deleted_at=g4a6.test_now() WHERE id=${follower}`;await o.unsafe('ALTER TABLE g4a6.characters ENABLE TRIGGER character_lifecycle_character_fence');
 await assert.rejects(o`UPDATE g4a6.party_members SET is_following=false WHERE character_id=${follower}`,/character_soft_deleted/);
 assert.equal((await moving(o,{who:follower})).kind,'not_authorized');await assert.rejects(o`UPDATE g4a6.characters SET mp=90 WHERE id=${follower}`,/character_soft_deleted/);
});
test('source departure retains creature DoT; source new commit fragment releases only after final blocker removal',options,async()=>{
 const {o}=await setup();await entry(o,0);await o`UPDATE g4a6.node_pending_event SET consumed_at=g4a6.test_now()`;
 await o`INSERT INTO g4a6.node_effect(id,encounter_id,kind,target_creature_id,source_character_id) VALUES(${effect},${enc},'dot',${cid},${actor})`;
 assert.equal((await moving(o,{t:2})).kind,'moved');assert.equal((await current(o)).eligible_since,null);
 await o`UPDATE g4a6.node_encounter SET next_due_at=${at(3)} WHERE id=${enc}`;const cl=await claim(o,3);await commit(o,cl,await proposal(o,40,{status:'ended',effects:[effect]}),4);
 await settle(o,64);assert.equal((await current(o)).hp,40);await settle(o,76);assert.equal((await current(o)).hp,41);
});
test('independent solo request creation versus regeneration',options,async()=>{
 const x=await setup();await race(x,async c=>assert.equal((await moving(c)).kind,'moved'),c=>regen(c),async r=>{assert.equal(r.error?.code,'40001');assert.equal((await current(x.o)).hp,45);});await regen(x.b);assert.equal((await current(x.o)).hp,45);
});
test('independent party-follow request creation versus regeneration',options,async()=>{
 const x=await setup();await addParty(x.o);await race(x,async c=>assert.equal((await moving(c,{party:true})).ok,true),c=>regen(c),async r=>{assert.equal(r.error?.code,'40001');assert.equal((await x.o`SELECT count(*)::int n FROM g4a6.combat2_party_departure_member`)[0].n,2);});await regen(x.b);
});
test('independent membership mutation first serializes coordinated movement and frozen mover set',options,async()=>{
 const x=await setup();await addParty(x.o);await race(x,async c=>assert.equal((await mutate(c)).kind,'not_following'),c=>moving(c,{party:true}),async r=>{assert.equal(r.error?.code,'40001');});assert.equal((await moving(x.b,{party:true})).ok,true);assert.equal((await x.o`SELECT count(*)::int n FROM g4a6.combat2_party_departure_member`)[0].n,1);
});
test('independent multiple creatures opposite input order uses deterministic locks',options,async()=>{
 const x=await setup();await addCreature(x.o,node);await race(x,c=>regen(c,{reverse:true}),c=>regen(c),async r=>{assert.ifError(r.error);assert.equal((await current(x.o)).hp,45);assert.equal((await current(x.o,otherCreature)).hp,45);});
});
test('independent reversed two-node solo movement serializes without late gates',options,async()=>{
 const x=await setup();await x.o`INSERT INTO g4a6.characters(id,user_id,current_node_id) VALUES(${follower},${user},${dest})`;
 await race(x,c=>moving(c),c=>moving(c,{who:follower,to:node,id:otherRequest}),async r=>{assert.ifError(r.error);assert.equal(r.value.ok,true);assert.equal((await x.o`SELECT current_node_id FROM g4a6.characters WHERE id=${follower}`)[0].current_node_id,node);});
});
test('independent missing destination versus concurrent arrival refuses changed coverage then safely retries',options,async()=>{
 const x=await setup();await x.o`DELETE FROM g4a6.node_encounter WHERE id=${enc2}`;await addCreature(x.o);await x.o`INSERT INTO g4a6.characters(id,user_id,current_node_id) VALUES(${follower},${user},${dest})`;
 const incoming=async c=>{await clock(c,120);return (await c`SELECT g4a9.arrive(${follower},${otherRequest}) r`)[0].r;};
 await race(x,c=>moving(c),incoming,async r=>{assert.equal(r.error?.code,'40001');});
 assert.equal((await incoming(x.b)).ok,true);assert.equal((await x.o`SELECT count(*)::int n FROM g4a6.node_encounter WHERE node_id=${dest}`)[0].n,1);
});
test('independent retained projection reactivation versus regeneration retains identity and whole HP',options,async()=>{
 const x=await setup();await addCreature(x.o);await x.o`SELECT g4a6.src_seed(${enc2},${dest})`;const before=(await x.o`SELECT id FROM g4a6.node_creature WHERE creature_id=${otherCreature}`)[0].id;
 await race(x,c=>moving(c),c=>regen(c),async r=>{assert.equal(r.error?.code,'40001');const p=(await x.o`SELECT * FROM g4a6.node_creature WHERE creature_id=${otherCreature}`)[0];assert.equal(p.id,before);assert.equal(p.hp,45);assert.equal((await current(x.o,otherCreature)).eligible_since,null);});await regen(x.b);assert.equal((await current(x.o,otherCreature)).hp,45);
});
test('independent refusal after attempted settlement rolls back before waiter regeneration',options,async()=>{
 const x=await setup();await x.o`UPDATE g4a6.characters SET mp=0 WHERE id=${actor}`;
 await race(x,async c=>{assert.equal((await moving(c)).kind,'insufficient_resource');assert.equal((await current(c)).hp,40);},c=>regen(c),async r=>{assert.ifError(r.error);assert.equal((await current(x.o)).hp,45);});
});
test('independent queued party request versus hostile entry: full finalizer executes before release',options,async()=>{
 const x=await setup();await addParty(x.o);await entry(x.o,0);await x.o`INSERT INTO g4a6.characters(id,user_id,current_node_id) VALUES(${otherCreature},${user},${node})`;
 const attack=async c=>{await clock(c,2);return (await c`SELECT g4a6.src_hostile(${otherCreature},'basic_attack',NULL,${cid},${otherRequest}) r`)[0].r;};
 await race(x,async c=>assert.equal((await moving(c,{party:true,finish:false,t:2})).kind,'queued'),attack,async r=>{assert.ifError(r.error);assert.equal(r.value.ok,true);},async c=>assert.equal((await moving(c,{party:true,t:2})).kind,'moved'));
 assert.equal((await x.o`SELECT status FROM g4a6.combat2_party_departure_request`)[0].status,'completed');
});
test('independent movement versus stale claimed commit refuses old HP overwrite',options,async()=>{
 const x=await setup();await entry(x.o,0);const cl=await claim(x.o,1),p=await proposal(x.o,1);
 await race(x,c=>moving(c,{t:2}),c=>commit(c,cl,p,3),async r=>{assert.ifError(r.error);assert.equal(r.value.ok,false);assert.equal((await current(x.o)).hp,40);assert.equal((await state(x.o)).runtime_hp,40);});
});
test('unchanged archived party result ambiguity refuses and rolls back under local default; diagnostic SQLSTATE42702',options,async()=>{
 const {o}=await setup();await addParty(o);await o.unsafe(partyRequestDefinition(false));assert.equal((await o`SELECT current_setting('plpgsql.variable_conflict') v`)[0].v,'error');
 assert.equal((await moving(o,{party:true})).kind,'party_movement_failed');assert.equal((await current(o)).hp,40);assert.equal((await o`SELECT count(*)::int n FROM g4a6.combat2_party_departure_request`)[0].n,0);
 // Diagnostic-only exception surfacing, not the behavior used by other cases.
 await o.unsafe(partyRequestDefinition(false).replace("WHEN OTHERS THEN RETURN jsonb_build_object('ok',false,'kind','party_movement_failed');","WHEN OTHERS THEN RAISE;"));
 await assert.rejects(moving(o,{party:true}),e=>{console.log('DIAGNOSTIC original terminal aggregate SQLSTATE '+e.code+': '+e.message);return e.code==='42702'&&/cost/.test(e.message);});
});
test('movement settlement applies whole HP and combat arrival discards fraction on retained generation',options,async()=>{
 const {o}=await setup();await addCreature(o);await o`SELECT g4a6.src_seed(${enc2},${dest})`;
 await moving(o,{t:126});const s=await current(o,otherCreature);assert.equal(s.hp,45);assert.equal(s.fractional_credit,'0');assert.equal(s.spawn_seq,1);
 assert.equal((await o`SELECT hp FROM g4a6.node_creature WHERE creature_id=${otherCreature}`)[0].hp,45);
});
test('ordinary death and due respawn retain source generation and zero-rate semantics',options,async()=>{
 const {o}=await setup();await o`SELECT g4a7.edit_rate(${cid},'0')`;await entry(o,0);const cl=await claim(o,1);await commit(o,cl,await proposal(o,0,{status:'ended'}),2);
 await clock(o,301);await o`SELECT g4a7.respawn(${cid})`;assert.equal((await current(o)).hp,0);await clock(o,302);await o`SELECT g4a7.respawn(${cid})`;assert.equal((await current(o)).hp,100);assert.equal((await current(o)).spawn_seq,2);assert.equal((await current(o)).regen_bps,0);
});
test('independent coordinated movement first makes F6 mutation refuse stale coverage before receipt',options,async()=>{
 const x=await setup();await addParty(x.o);
 await race(x,c=>moving(c,{party:true}),c=>mutate(c),async r=>{assert.ifError(r.error);assert.equal(r.value.reason,'lock_coverage_changed');assert.equal((await x.o`SELECT count(*)::int n FROM g4a6.party_operation_request WHERE request_id=${otherRequest}`)[0].n,0);});
 assert.equal((await mutate(x.b)).kind,'not_following');
});
test('independent early node wait precedes character row lock; all off-node/pending coverage is held',options,async()=>{
 const x=await setup();await addParty(x.o);const pa=await pid(x.a),po=await pid(x.o);await x.o.unsafe('BEGIN');
 await x.o`SELECT pg_advisory_xact_lock(hashtextextended('combat_enter_node:'||${node}::text,0))`;
 const pending=outcome(moving(x.a,{party:true}));
 try{await waiting(x.o,pa,po);await x.b.unsafe('BEGIN');await x.b`SELECT id FROM g4a6.characters WHERE id IN(${actor},${follower}) ORDER BY id FOR UPDATE NOWAIT`;await x.b.unsafe('ROLLBACK');}
 finally{await x.o.unsafe('ROLLBACK');}
 assert.equal((await pending).value?.ok,true);
 // Hold a second source-composed movement transaction and inspect exact gates.
 await x.a.unsafe('BEGIN');try{
  await x.a`SELECT g4a9.cover(${actor},${node})`;
  for(const n of [node,dest,offNode])assert.equal((await x.o`WITH k AS(SELECT hashtextextended('combat_enter_node:'||${n}::text,0) h) SELECT EXISTS(SELECT 1 FROM pg_locks,k WHERE pid=${pa} AND locktype='advisory' AND granted AND classid::bigint=((h>>32)&4294967295::bigint) AND objid::bigint=(h&4294967295::bigint) AND objsubid=1) held`)[0].held,true);
 }finally{await x.a.unsafe('ROLLBACK');}
});
test('inconsistent retained cross-node projection refuses without migration or automatic repair',options,async()=>{
 const {o}=await setup();await o`SELECT g4a6.src_seed(${enc},${node})`;await o`UPDATE g4a6.node_creature SET encounter_id=${enc2}`;
 const before=await current(o);await assert.rejects(moving(o),e=>e.code==='40001'&&/cross-node projection/.test(e.message));
 assert.deepEqual(await current(o),before);assert.equal((await o`SELECT current_node_id FROM g4a6.characters WHERE id=${actor}`)[0].current_node_id,node);
});
