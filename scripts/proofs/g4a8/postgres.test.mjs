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
import {buildMovement,manifest as movementManifest} from './source-adapters.mjs';

if(!process.argv[2])throw Error('Supply local PostgreSQL bin directory; no URL/fallback');
const exe=n=>join(resolve(process.argv[2]),n+(process.platform==='win32'?'.exe':''));await access(exe('initdb'));
const root=await mkdtemp(join(tmpdir(),'wov-g4a8-')),clients=[];
const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
await promisify(execFile)(exe('initdb'),['-D',join(root,'data'),'-U','postgres','--auth=trust','--no-locale','--encoding=UTF8'],{windowsHide:true});
const ctl=args=>new Promise((res,rej)=>{const p=spawn(exe('pg_ctl'),args,{stdio:'ignore',windowsHide:true});p.once('error',rej);p.once('exit',n=>n===0?res():rej(Error('pg_ctl '+n)));});
await ctl(['-D',join(root,'data'),'-l',join(root,'server.log'),'-o',`-h 127.0.0.1 -p ${port}`,'-w','start']);
const admin=postgres({host:'127.0.0.1',port,username:'postgres',database:'postgres',max:1});
after(async()=>{for(const c of clients)await c.end({timeout:1});await admin.end({timeout:1});await ctl(['-D',join(root,'data'),'-m','immediate','-w','stop']);});
const generated=buildAdapters();console.log('LOCAL '+(await admin`SELECT version() v`)[0].v+'; cluster '+root);console.log('SOURCE MANIFEST '+JSON.stringify(manifest));
const read=p=>readFile(new URL(p,import.meta.url),'utf8');
const files=await Promise.all(['../g4a6/fixture.sql','../g4a6/candidate.sql','../g4a7/fixture.sql','../g4a7/adapters.sql','./fixture.sql','./adapters.sql'].map(read));
const cid='00000000-0000-4000-8000-000000000001',node='00000000-0000-4000-8000-000000000002',dest='00000000-0000-4000-8000-000000000003',enc='00000000-0000-4000-8000-000000000004',enc2='00000000-0000-4000-8000-000000000005';
const actor='00000000-0000-4000-8000-000000000011',user='00000000-0000-4000-8000-000000000012',request='00000000-0000-4000-8000-000000000013',effect='00000000-0000-4000-8000-000000000014';
const at=t=>new Date(Date.UTC(2026,0,1)+t*1000).toISOString();let serial=0;const options={timeout:25000};
async function clock(c,t){await c`SELECT set_config('g4a7.cutoff',${at(t)},false)`;}
async function setup({hp=40,aggressive=true}={}){
 const db='g4a6_fixture_g4a8_'+(++serial);await admin.unsafe('CREATE DATABASE '+db);
 const connect=()=>{const c=postgres({host:'127.0.0.1',port,username:'postgres',database:db,max:1,onnotice:()=>{}});clients.push(c);return c;};
 const a=connect(),b=connect(),o=connect();for(const sql of files.slice(0,3))await o.unsafe(sql);await o.unsafe(generated);await o.unsafe(files[3]);await o.unsafe(files[4]);await o.unsafe(buildMovement());await o.unsafe(files[5]);
 for(const c of [a,b,o]){await c.unsafe("SET statement_timeout='8s';SET lock_timeout='6s';SET deadlock_timeout='100ms';SET default_transaction_isolation='read committed'");await c`SELECT set_config('g4a7.actor',${user},false)`;await clock(c,0);assert.equal((await c`SELECT current_setting('transaction_isolation') v`)[0].v,'read committed');}
 await o`INSERT INTO g4a6.node_encounter(id,node_id,status) VALUES(${enc},${node},'ended'),(${enc2},${dest},'ended')`;
 await o`INSERT INTO g4a6.creatures(id,node_id,hp,max_hp,is_alive,is_aggressive) VALUES(${cid},${node},${hp},100,true,${aggressive})`;
 await o`INSERT INTO g4a6.characters(id,user_id,current_node_id) VALUES(${actor},${user},${node})`;
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

const partyRequest='00000000-0000-4000-8000-000000000021',follower='00000000-0000-4000-8000-000000000022',followerRequest='00000000-0000-4000-8000-000000000023';
async function departure(o,{party=false,effectBlock=false}={}){
 await entry(o,0);
 // Consume entry event as an ordinary prior commit would; not a resolver test.
 await o`UPDATE g4a6.node_pending_event SET consumed_at=g4a6.test_now()`;
 const f=(await o`SELECT * FROM g4a6.node_fighter WHERE character_id=${actor}`)[0];
 await o`INSERT INTO g4a6.combat2_departure_request(request_id,character_id,origin_node_id,destination_node_id,encounter_id,fighter_id,fighter_entry_seq) VALUES(${request},${actor},${node},${dest},${enc},${f.id},${f.entry_seq})`;
 if(effectBlock)await o`INSERT INTO g4a6.node_effect(id,encounter_id,kind,target_creature_id,source_character_id) VALUES(${effect},${enc},'dot',${cid},${actor})`;
 if(party){
  await o`INSERT INTO g4a6.characters(id,user_id,current_node_id) VALUES(${follower},${user},${node})`;
  await o`INSERT INTO g4a6.combat2_party_departure_request(request_id,origin_node_id,destination_node_id) VALUES(${partyRequest},${node},${dest})`;
  await o`INSERT INTO g4a6.combat2_party_departure_member(request_id,character_id,display_name,movement_order,departure_request_id,status) VALUES(${partyRequest},${actor},'leader',1,${request},'queued'),(${partyRequest},${follower},'follower',2,${followerRequest},'waiting')`;
 }
}
const move=async(c,party=false)=> (await c`SELECT g4a8.move(${party?partyRequest:request},${party}) r`)[0].r;
async function race(x,first,second,verify){
 const holder=await pid(x.a),waiter=await pid(x.b);
 await x.a.unsafe('BEGIN');let pending;
 try{await first(x.a);pending=outcome(second(x.b));await waiting(x.o,waiter,holder);await x.a.unsafe('COMMIT');const r=await pending;await verify(r);}
 finally{await x.a.unsafe('ROLLBACK');if(pending)await pending;}
}
test('six complete pinned movement/cleanup bodies; no public functions installed',options,async()=>{
 const {o}=await setup();assert.equal(movementManifest.length,6);console.log('MOVEMENT SOURCE MANIFEST '+JSON.stringify(movementManifest));
 assert.equal((await o`SELECT count(*)::int n FROM pg_proc WHERE pronamespace='public'::regnamespace`)[0].n,0);
});
test('source solo departure consumes MP once, fences claim, preserves creature DoT and refuses regeneration',options,async()=>{
 const {o}=await setup();await departure(o,{effectBlock:true});await clock(o,120);
 await o`UPDATE g4a6.node_encounter SET claim_token=${request},claimed_tick=1,claim_expires_at=${at(200)} WHERE id=${enc}`;
 assert.equal((await move(o)).kind,'moved');assert.equal((await move(o)).kind,'already_moved');
 assert.equal((await o`SELECT mp FROM g4a6.characters WHERE id=${actor}`)[0].mp,99);
 assert.equal((await o`SELECT count(*)::int n FROM g4a6.node_effect`)[0].n,1);
 assert.equal((await state(o)).eligible_since,null);await settle(o,240);assert.equal((await state(o)).eligible_since,null);assert.equal((await state(o)).hp,40);
 assert.equal((await o`SELECT claim_token FROM g4a6.node_encounter WHERE id=${enc}`)[0].claim_token,null);
});
test('departure without residual blockers starts eligibility; delay is not credited retroactively',options,async()=>{
 const {o}=await setup();await departure(o);await clock(o,120);await move(o);await settle(o,179);assert.equal((await state(o)).hp,40);await settle(o,240);assert.equal((await state(o)).hp,45);
});
test('complete party finalizer moves queued leader plus waiting follower; retry does not charge twice',options,async()=>{
 const {o}=await setup();await departure(o,{party:true});assert.equal((await move(o,true)).kind,'moved');assert.equal((await move(o,true)).kind,'already_moved');
 assert.equal((await o`SELECT count(*)::int n FROM g4a6.characters WHERE current_node_id=${dest} AND mp=99`)[0].n,2);
});
test('source arrival trigger engages destination from durable HP; full arrival request replays',options,async()=>{
 const {o}=await setup();await o`UPDATE g4a6.characters SET current_node_id=${dest} WHERE id=${actor}`;
 await clock(o,120);await o`SELECT g4a8.cover(ARRAY[${node},${dest}]::uuid[])`;await settle(o,120);
 // In one transaction: prelock/settlement and relocation before AFTER trigger.
 await o.begin(async t=>{await t`SELECT g4a8.cover(ARRAY[${node},${dest}]::uuid[])`;await t`SELECT set_config('app.combat2_depart_authorized','true',true)`;await t`UPDATE g4a6.characters SET current_node_id=${node} WHERE id=${actor}`;});
 assert.equal((await state(o)).runtime_hp,45);assert.equal((await o`SELECT present FROM g4a6.node_fighter`)[0].present,true);
 const event=(await o`SELECT request_id FROM g4a6.node_pending_event`)[0];await o`SELECT set_config('app.combat2_depart_authorized','true',false)`;assert.equal((await o`SELECT g4a6.combat2_arrive_after_relocation(${actor},${event.request_id}) r`)[0].r.kind,'already_entered');
});
test('failed second party member rolls back first movement, MP, requests and regeneration transition',options,async()=>{
 const {o}=await setup();await departure(o,{party:true});await o`UPDATE g4a6.characters SET mp=0 WHERE id=${follower}`;
 await assert.rejects(move(o,true),/party_immediate_depart_fence_failed/);assert.equal((await o`SELECT current_node_id FROM g4a6.characters WHERE id=${actor}`)[0].current_node_id,node);assert.equal((await o`SELECT status FROM g4a6.combat2_departure_request`)[0].status,'queued');
});
test('raw generic HP save and retained-projection deletion refuse atomically; safe name allowed',options,async()=>{
 const {o}=await setup();await o`SELECT g4a8.raw_admin_save(${cid},'{"name":"kept"}')`;
 await assert.rejects(o`SELECT g4a8.raw_admin_save(${cid},'{"name":"lost","hp":100}')`,/guarded writer/);assert.equal((await state(o)).hp,40);assert.equal((await state(o)).name,'kept');
 await entry(o,0);await assert.rejects(o`SELECT g4a8.guarded_edit(${cid},'delete',NULL)`,/retained projection/);
});
test('rate settles old whole credit, discards fraction, starts cursor; max preserves missing HP and living floor',options,async()=>{
 const {o}=await setup();await clock(o,126);await o`SELECT g4a8.guarded_edit(${cid},'rate','10')`;let s=await state(o);assert.equal(s.hp,45);assert.equal(s.fractional_credit,'0');assert.equal(s.accounted_through.toISOString(),at(126));
 await o`SELECT g4a8.guarded_edit(${cid},'max','30')`;s=await state(o);assert.equal(s.hp,1);assert.equal(s.is_alive,true);
});
test('active attachment refuses rate, max, reassignment including outstanding claim',options,async()=>{
 const {o}=await setup();await entry(o,0);await claim(o,1);
 for(const [kind,value] of [['rate','10'],['max','90'],['node',dest]])await assert.rejects(o`SELECT g4a8.guarded_edit(${cid},${kind},${value})`);
 assert.equal((await state(o)).hp,40);
});
test('independent arrival versus regeneration: entry holds gate; settlement observes blocker',options,async()=>{
 const x=await setup();await race(x,async c=>{await clock(c,120);assert.equal((await c`SELECT g4a8.arrive(${actor},${request}) r`)[0].r.kind,'entered');},c=>settle(c,120),async r=>{assert.ifError(r.error);assert.equal((await state(x.o)).eligible_since,null);assert.equal((await state(x.o)).hp,45);});
});
test('independent source departure versus regeneration: retained DoT still blocks',options,async()=>{
 const x=await setup();await departure(x.o,{effectBlock:true});await race(x,c=>move(c),c=>settle(c,120),async r=>{assert.ifError(r.error);assert.equal((await state(x.o)).eligible_since,null);assert.equal((await state(x.o)).hp,40);});
});
test('independent party-follow finalizer versus regeneration: serialized movement and quiet release',options,async()=>{
 const x=await setup();await departure(x.o,{party:true});await race(x,c=>move(c,true),c=>settle(c,60),async r=>{assert.ifError(r.error);assert.equal((await x.o`SELECT count(*)::int n FROM g4a6.characters WHERE current_node_id=${dest}`)[0].n,2);});
});
test('independent quiet-ended reassignment versus entry: old node has no creature after transfer',options,async()=>{
 const x=await setup();await x.o`SELECT g4a6.combat2_seed_spawns(${enc},${node})`;
 await race(x,c=>c`SELECT g4a8.guarded_edit(${cid},'node',${dest})`,async c=>{await c`SELECT g4a8.cover(ARRAY[${node},${dest}]::uuid[])`;return (await c`SELECT g4a6.src_enter(${actor},${request}) r`)[0].r;},async r=>{assert.ifError(r.error);assert.equal(r.value.kind,'no_living_creatures');assert.equal((await state(x.o)).node_id,dest);assert.equal((await state(x.o)).hp,40);assert.equal((await x.o`SELECT count(*)::int n FROM g4a6.node_fighter`)[0].n,0);});
});
test('independent source commit versus Admin edit: edit waits then refuses active attachment',options,async()=>{
 const x=await setup();await entry(x.o,0);const cl=await claim(x.o,1),p=await proposal(x.o,30);
 await race(x,c=>commit(c,cl,p,2),c=>c`SELECT g4a8.guarded_edit(${cid},'max','90')`,async r=>{assert.match(r.error?.message??'',/active/);assert.equal((await state(x.o)).hp,30);assert.equal((await state(x.o)).runtime_hp,30);});
});
test('independent multi-node opposite coverage order uses sorted gates without late acquisition',options,async()=>{
 const x=await setup();await race(x,c=>c`SELECT g4a8.cover(ARRAY[${node},${dest}]::uuid[])`,c=>c`SELECT g4a8.cover(ARRAY[${dest},${node}]::uuid[])`,async r=>{assert.ifError(r.error);});
});
for(const [kind,value] of [['rate','10'],['max','90']])test('independent active claim versus Admin '+kind+': observed wait then refusal',options,async()=>{
 const x=await setup();await entry(x.o,0);
 await race(x,c=>claim(c,1),c=>c`SELECT g4a8.guarded_edit(${cid},${kind},${value})`,async r=>{assert.match(r.error?.message??'',/active/);assert.equal((await state(x.o)).hp,40);assert.notEqual((await x.o`SELECT claim_token FROM g4a6.node_encounter WHERE id=${enc}`)[0].claim_token,null);});
});
test('complete legacy cleanup and trigger remove only old-node participation; replay is empty',options,async()=>{
 const {o}=await setup();await departure(o);
 await o`INSERT INTO g4a6.encounters(id,node_id,status) VALUES(${enc},${node},'active')`;
 await o`INSERT INTO g4a6.encounter_engagements VALUES(${enc},${actor})`;
 await o`INSERT INTO g4a6.encounter_participants VALUES(${enc},${actor})`;
 await o`INSERT INTO g4a6.combat_actions(encounter_id,character_id,status) VALUES(${enc},${actor},'pending')`;
 await move(o);
 assert.equal((await o`SELECT count(*)::int n FROM g4a6.encounter_participants`)[0].n,0);
 assert.equal((await o`SELECT status FROM g4a6.combat_actions`)[0].status,'cancelled');
 assert.equal((await o`SELECT g4a6.encounter_end_participation(${actor},${node}) r`)[0].r.participation_ended,0);
});
test('arrival adapter exact replay preserves accounting and encounter fences',options,async()=>{
 const {o}=await setup();await o`SELECT g4a8.arrive(${actor},${request})`;const before=await state(o);await clock(o,120);
 assert.equal((await o`SELECT g4a8.arrive(${actor},${request}) r`)[0].r.kind,'already_entered');assert.deepEqual(await state(o),before);
});
test('cross-node retained projection refuses before any late node gate or character write',options,async()=>{
 const {o}=await setup();await departure(o);await o`UPDATE g4a6.node_creature SET encounter_id=${enc2}`;
 await assert.rejects(move(o),/projection coverage mismatch/);assert.equal((await o`SELECT current_node_id FROM g4a6.characters WHERE id=${actor}`)[0].current_node_id,node);
});
test('quiet rate change fences retained projection even with no whole HP applied',options,async()=>{
 const {o}=await setup();await o`SELECT g4a6.src_seed(${enc},${node})`;const before=(await state(o)).state_version;
 await o`SELECT g4a8.guarded_edit(${cid},'rate','10')`;assert.equal(Number((await state(o)).state_version),Number(before)+1);assert.equal((await state(o)).hp,40);
});
