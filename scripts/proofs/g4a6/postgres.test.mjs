// Fresh disposable loopback cluster only. No connection URL / hosted route.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import net from 'node:net';
import postgres from 'postgres';

if (!process.argv[2]) throw Error('Supply LOCAL PostgreSQL bin directory; no fallback/skip');
const bin=resolve(process.argv[2]), exe=n=>join(bin,n+(process.platform==='win32'?'.exe':''));
await access(exe('initdb')); await access(exe('pg_ctl'));
const root=await mkdtemp(join(tmpdir(),'wov-g4a6-'));
const listener=net.createServer(); await new Promise(r=>listener.listen(0,'127.0.0.1',r));
const port=listener.address().port; await new Promise(r=>listener.close(r));
await promisify(execFile)(exe('initdb'),['-D',join(root,'data'),'-U','postgres','--auth=trust','--no-locale','--encoding=UTF8'],{windowsHide:true});
const ctl=args=>new Promise((res,rej)=>{const p=spawn(exe('pg_ctl'),args,{stdio:'ignore',windowsHide:true});p.once('error',rej);p.once('exit',n=>n===0?res():rej(Error('pg_ctl failed '+n+' '+root)));});
await ctl(['-D',join(root,'data'),'-l',join(root,'server.log'),'-o',`-h 127.0.0.1 -p ${port}`,'-w','start']);
const admin=postgres({host:'127.0.0.1',port,username:'postgres',database:'postgres',max:1}), clients=[];
after(async()=>{for(const c of clients)await c.end({timeout:1});await admin.end({timeout:1});await ctl(['-D',join(root,'data'),'-m','immediate','-w','stop']);});
await admin.unsafe('CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role');
const version=(await admin`SELECT version() v`)[0].v;
console.log('LOCAL POSTGRES: '+version+'; cluster '+root);
const fixture=await readFile(new URL('./fixture.sql',import.meta.url),'utf8');
const candidate=await readFile(new URL('./candidate.sql',import.meta.url),'utf8');
const cid='00000000-0000-4000-8000-000000000001', node='00000000-0000-4000-8000-000000000002';
const dest='00000000-0000-4000-8000-000000000003', enc='00000000-0000-4000-8000-000000000004';
const enc2='00000000-0000-4000-8000-000000000005', projection='00000000-0000-4000-8000-000000000006';
const token='00000000-0000-4000-8000-000000000007', effect='00000000-0000-4000-8000-000000000008';
const at=seconds=>new Date(Date.UTC(2026,0,1)+seconds*1000).toISOString();
let serial=0;
async function setup({hp=1,max=100,alive=true,status='ended'}={}) {
  const db='g4a6_fixture_'+(++serial); await admin.unsafe('CREATE DATABASE '+db);
  const connect=()=>{const c=postgres({host:'127.0.0.1',port,username:'postgres',database:db,max:1,onnotice:()=>{}});clients.push(c);return c;};
  const a=connect(),b=connect(),o=connect(); await o.unsafe(fixture);await o.unsafe(candidate);
  for(const c of [a,b,o]) {await c.unsafe("SET statement_timeout='8s'; SET lock_timeout='6s'; SET deadlock_timeout='100ms'; SET default_transaction_isolation='read committed'");assert.equal((await c`SELECT current_setting('transaction_isolation') i`)[0].i,'read committed');}
  await o`INSERT INTO g4a6.node_encounter(id,node_id,status) VALUES(${enc},${node},${status}),(${enc2},${dest},'ended')`;
  await o`INSERT INTO g4a6.creatures(id,node_id,hp,max_hp,is_alive) VALUES(${cid},${node},${hp},${max},${alive})`;
  await o`INSERT INTO g4a6.node_creature(id,encounter_id,creature_id,spawn_seq,hp,is_alive) VALUES(${projection},${enc},${cid},1,${hp},${alive})`;
  await settle(o,0);return {a,b,o};
}
const settle=(c,t)=>c`SELECT g4a6.settle(${cid},${at(t)}) r`.then(x=>x[0].r);
const enter=(c,t)=>c`SELECT g4a6.enter_combat(${cid},${at(t)})`;
const leave=(c,t)=>c`SELECT g4a6.leave_combat(${cid},${at(t)})`;
const claim=(c,t)=>c`SELECT g4a6.claim(${cid},${at(t)},${token}) r`.then(x=>x[0].r);
const commit=(c,cl,hp,t)=>c`SELECT g4a6.commit_result(${cid},${token},${cl.version},${cl.generation},${cl.tick},${hp},${at(t)}) r`.then(x=>x[0].r);
const state=async c=>(await c`SELECT cr.*,nc.hp projection_hp,nc.id projection_id,nc.encounter_id,e.state_version,e.tick
 FROM g4a6.creatures cr LEFT JOIN g4a6.node_creature nc ON nc.creature_id=cr.id AND nc.spawn_seq=cr.spawn_seq
 LEFT JOIN g4a6.node_encounter e ON e.id=nc.encounter_id WHERE cr.id=${cid}`)[0];
const pid=async c=>(await c`SELECT pg_backend_pid() p`)[0].p;
async function waiting(o,waiter,holder){
  const limit=Date.now()+5000;
  while(Date.now()<limit){const r=(await o`SELECT ${holder}::integer=ANY(pg_blocking_pids(${waiter}::integer)) blocked,
    EXISTS(SELECT 1 FROM pg_locks WHERE pid=${waiter} AND locktype='advisory' AND NOT granted) advisory`)[0];
    if(r.blocked&&r.advisory){console.log(`OBSERVED NODE LOCK ${holder} -> ${waiter}`);return;}
    await new Promise(r=>setTimeout(r,10));
  }throw Error('required real node advisory blocking not observed');
}
const outcome=p=>p.then(value=>({value}),error=>({error}));
const options={timeout:25000};

test('candidate refuses non-fixture database; creates no public function',options,async()=>{
  await assert.rejects(admin.unsafe(candidate),/disposable fixture/);
  const {o}=await setup();assert.equal((await o`SELECT count(*)::int n FROM pg_proc WHERE pronamespace='public'::regnamespace`)[0].n,0);
});
test('default/custom/zero/100 rates and invalid precision/range',options,async()=>{
  const {o}=await setup();assert.equal((await state(o)).regen_bps,500);
  for(const [rate,expected] of [['5',500],['2.25',225],['0',0],['100.00',10000]])assert.equal((await o`SELECT g4a6.rate_bps(${rate}) r`)[0].r,expected);
  for(const rate of ['-1','100.01','2.001','5.000','NaN','1e1','',null])await assert.rejects(o`SELECT g4a6.rate_bps(${rate})`);
  await o`SELECT g4a6.edit_rate(${cid},'0',${at(0)})`;await settle(o,120);assert.equal((await state(o)).hp,1);
  await o`SELECT g4a6.edit_rate(${cid},'100.00',${at(120)})`;await settle(o,180);assert.equal((await state(o)).hp,100);
});
test('60 second delay, persisted fraction and exact microsecond replay',options,async()=>{
  const {o}=await setup({max:23});await settle(o,60);assert.equal((await state(o)).fractional_credit,'0');
  await settle(o,90);assert.equal((await state(o)).fractional_credit,'345000000000');
  await settle(o,120);const s=await state(o);assert.equal(s.hp,2);assert.equal(s.fractional_credit,'90000000000');
  assert.equal(await settle(o,120),'already_settled');assert.deepEqual(await state(o),s);
  // postgres.js timestamp serialization goes through JS Date (milliseconds).
  // Add the microsecond on the server so this tests native SQL precision.
  await o`SELECT g4a6.settle(${cid},${at(120)}::timestamptz + interval '1 microsecond')`;
  assert.equal((await state(o)).fractional_credit,'90000011500');
});
test('partition invariance for custom rate and repeated short settlements',options,async()=>{
  const x=await setup({max:123}),y=await setup({max:123});
  for(const c of [x.o,y.o])await c`SELECT g4a6.edit_rate(${cid},'2.25',${at(0)})`;
  await settle(x.o,187.123);
  for(const t of [0.001,30,60,60.001,61,90.125,100,180,187.123])await settle(y.o,t);
  const a=await state(x.o),b=await state(y.o);for(const key of ['hp','projection_hp','fractional_credit','accounted_through'])assert.deepEqual(a[key],b[key]);
});
test('renewed combat retains whole HP, discards fraction, resets uninterrupted delay',options,async()=>{
  const {o}=await setup();await settle(o,78);assert.equal((await state(o)).hp,2);assert.equal((await state(o)).fractional_credit,'300000000000');
  await enter(o,78);assert.equal((await state(o)).fractional_credit,'0');await settle(o,500);assert.equal((await state(o)).hp,2);
  await leave(o,500);await settle(o,560);assert.equal((await state(o)).hp,2);await settle(o,620);assert.equal((await state(o)).hp,7);
});
test('DoT and pending cast block empty/ended encounters until resolved under lock',options,async()=>{
  const {o}=await setup();await o`SELECT g4a6.lock_creature(${cid})`;
  await o`INSERT INTO g4a6.node_effect(id,encounter_id,kind,target_creature_id) VALUES(${effect},${enc},'dot',${cid})`;
  await o`SELECT g4a6.reconcile(${cid},${at(0)})`;await settle(o,600);assert.equal((await state(o)).hp,1);
  await o`DELETE FROM g4a6.node_effect`;await o`UPDATE g4a6.node_creature SET pending_action='{"resolve_at_tick":1}'`;
  await settle(o,700);assert.equal((await state(o)).hp,1);
  await o.begin(async tx=>{await tx`SELECT g4a6.lock_creature(${cid})`;await tx`UPDATE g4a6.node_creature SET pending_action=NULL`;await tx`SELECT g4a6.reconcile(${cid},${at(700)})`;});
  await settle(o,760);assert.equal((await state(o)).hp,1);await settle(o,820);assert.equal((await state(o)).hp,6);
});
test('eligible sleep counts elapsed time; initialization never pays historical wounds',options,async()=>{
  const {o}=await setup({hp:43});assert.equal((await state(o)).hp,43);await settle(o,60);assert.equal((await state(o)).hp,43);
  await o`SELECT g4a6.edit_rate(${cid},'0.01',${at(60)})`;await settle(o,86400);assert.equal((await state(o)).hp,57);
  const before=await state(o);await settle(o,86400);assert.deepEqual(await state(o),before);
});
test('whole HP caps at max and does not bank excess',options,async()=>{
  const {o}=await setup({hp:99});await settle(o,120);assert.equal((await state(o)).hp,100);assert.equal((await state(o)).fractional_credit,'0');
});
test('active rate edit refuses; inactive rate edit preserves fraction as proposed policy',options,async()=>{
  const {o}=await setup();await settle(o,66);await o`SELECT g4a6.edit_rate(${cid},'2.50',${at(66)})`;
  assert.equal((await state(o)).fractional_credit,'300000000000');await settle(o,78);assert.equal((await state(o)).hp,2);
  await enter(o,78);const s=await state(o);await assert.rejects(o`SELECT g4a6.edit_rate(${cid},'1',${at(79)})`,/active/);assert.deepEqual(await state(o),s);
});
test('max edits preserve missing HP both directions; floor defaults refused and opt-in evaluated',options,async()=>{
  const {o}=await setup({hp:40});await o`SELECT g4a6.edit_max(${cid},120,${at(0)})`;assert.equal((await state(o)).hp,60);
  await o`SELECT g4a6.edit_max(${cid},80,${at(0)})`;assert.equal((await state(o)).hp,20);
  const s=await state(o);await assert.rejects(o`SELECT g4a6.edit_max(${cid},30,${at(0)})`,/floor/);assert.deepEqual(await state(o),s);
  await o`SELECT g4a6.edit_max(${cid},30,${at(0)},true)`;assert.equal((await state(o)).hp,1);assert.equal((await state(o)).projection_hp,1);
});
test('quiet-ended reassignment preserves generation/identity and synchronization',options,async()=>{
  const {o}=await setup();await o`SELECT g4a6.reassign(${cid},${dest},${at(120)})`;const s=await state(o);
  assert.equal(s.node_id,dest);assert.equal(s.encounter_id,enc2);assert.equal(s.projection_id,projection);assert.equal(s.spawn_seq,1);assert.equal(s.hp,s.projection_hp);
  await enter(o,120);await assert.rejects(o`SELECT g4a6.reassign(${cid},${node},${at(121)})`,/quiescent/);
});
test('ended reassignment refuses effects, pending casts, intents and outstanding expired claim',options,async()=>{
  const {o}=await setup();
  await o`INSERT INTO g4a6.node_effect(id,encounter_id,kind,target_creature_id) VALUES(${effect},${enc},'dot',${cid})`;
  await assert.rejects(o`SELECT g4a6.reassign(${cid},${dest},${at(120)})`);await o`DELETE FROM g4a6.node_effect`;
  await o`UPDATE g4a6.node_creature SET pending_action='{}'`;await assert.rejects(o`SELECT g4a6.reassign(${cid},${dest},${at(120)})`);await o`UPDATE g4a6.node_creature SET pending_action=NULL`;
  await o`INSERT INTO g4a6.node_intent VALUES(${effect},${enc},'pending')`;await assert.rejects(o`SELECT g4a6.reassign(${cid},${dest},${at(120)})`);await o`DELETE FROM g4a6.node_intent`;
  await claim(o,0);await assert.rejects(o`SELECT g4a6.reassign(${cid},${dest},${at(120)})`);
});
test('live lease defers maintenance, expired claim cannot overwrite newer HP',options,async()=>{
  const {o}=await setup();const cl=await claim(o,0);assert.equal(await settle(o,3),'live_claim_deferred');assert.equal((await state(o)).hp,1);
  await settle(o,120);await assert.rejects(commit(o,cl,1,120),/stale/);assert.equal((await state(o)).hp,6);
});
test('NULL claim/commit metadata and nonfinite cutoffs refuse without writes',options,async()=>{
  const {o}=await setup();const before=await state(o);
  await assert.rejects(o`SELECT g4a6.claim(${cid},${at(0)},NULL)`,/token/);
  await assert.rejects(o`SELECT g4a6.commit_result(${cid},${token},NULL,1,1,1,${at(0)})`,/metadata/);
  await assert.rejects(o`SELECT g4a6.settle(${cid},'infinity'::timestamptz)`,/finite/);
  await assert.rejects(o`SELECT g4a6.reconcile(${cid},NULL)`,/finite/);
  assert.deepEqual(await state(o),before);
});
test('same-generation ended seed/reactivation retains authoritative wounds',options,async()=>{
  const {o}=await setup({hp:40});await settle(o,120);await o`SELECT g4a6.seed(${cid})`;await enter(o,120);
  const s=await state(o);assert.equal(s.hp,45);assert.equal(s.hp,s.projection_hp);assert.equal(s.projection_id,projection);
});
test('new projection seeds existing wounds; seed refuses unexplained divergence',options,async()=>{
  const {o}=await setup({hp:43});await o`DELETE FROM g4a6.node_creature`;await o`SELECT g4a6.seed(${cid})`;
  assert.equal((await state(o)).projection_hp,43);
  await o`UPDATE g4a6.node_creature SET hp=99`;
  await assert.rejects(o`SELECT g4a6.seed(${cid})`,/mismatch/);assert.equal((await state(o)).hp,43);
});
test('version fence alone rejects old proposal despite matching token and live lease',options,async()=>{
  const {o}=await setup();const cl=await claim(o,0);await settle(o,120);
  await o`UPDATE g4a6.node_encounter SET claim_token=${token},claim_expires_at=${at(125)},claimed_tick=${cl.tick} WHERE id=${enc}`;
  await assert.rejects(commit(o,cl,1,121),/stale/);assert.equal((await state(o)).hp,6);
});
test('successful damage/death commit and exact commit replay',options,async()=>{
  const {o}=await setup({hp:40});await enter(o,0);const cl=await claim(o,1);assert.equal(await commit(o,cl,30,2),'committed');assert.equal((await state(o)).hp,30);
  const before=await state(o);assert.equal(await commit(o,cl,30,3),'already_committed');assert.deepEqual(await state(o),before);
  const death=await claim(o,3);await commit(o,death,0,4);await settle(o,600);assert.equal((await state(o)).hp,0);assert.equal((await state(o)).is_alive,false);
});
test('ordinary respawn remains separate at rate0; old generation cannot mutate new life',options,async()=>{
  const {o}=await setup({hp:0,alive:false});await o`SELECT g4a6.edit_rate(${cid},'0',${at(0)})`;await settle(o,600);assert.equal((await state(o)).hp,0);
  await o`SELECT g4a6.observe_due_respawn(${cid},${at(600)})`;await o`SELECT g4a6.seed(${cid})`;const s=await state(o);assert.equal(s.hp,100);assert.equal(s.spawn_seq,2);assert.equal(s.regen_bps,0);
  const cl=await claim(o,601);await assert.rejects(commit(o,{...cl,generation:1},50,602),/stale/);
});
test('rollback/failure restores HP, credit, cursor and encounter version; mismatch not repaired',options,async()=>{
  const {a,o}=await setup();const before=await state(o);await a.unsafe('BEGIN');await settle(a,120);await a.unsafe('ROLLBACK');assert.deepEqual(await state(o),before);
  await assert.rejects(o.unsafe(`DO $$ BEGIN PERFORM g4a6.settle('${cid}','${at(120)}'); RAISE EXCEPTION 'late failure'; END $$`),/late failure/);assert.deepEqual(await state(o),before);
  await o`UPDATE g4a6.node_creature SET hp=99`;await assert.rejects(settle(o,120),/mismatch/);assert.equal((await state(o)).hp,1);
});
test('hostile entry plus pending-intent admission blocks, and failed admission rolls back entry',options,async()=>{
  const {o}=await setup();const before=await state(o);
  await assert.rejects(o.begin(async tx=>{await enter(tx,120);throw Error('intent refused');}),/intent refused/);
  assert.deepEqual(await state(o),before);
  await o.begin(async tx=>{await enter(tx,120);await tx`INSERT INTO g4a6.node_intent VALUES(${effect},${enc},'pending')`;await tx`SELECT g4a6.reconcile(${cid},${at(120)})`;});
  await leave(o,120);await settle(o,600);assert.equal((await state(o)).hp,6);assert.equal((await state(o)).eligible_since,null);
  await o.begin(async tx=>{await tx`SELECT g4a6.lock_creature(${cid})`;await tx`UPDATE g4a6.node_intent SET status='consumed'`;await tx`SELECT g4a6.reconcile(${cid},${at(600)})`;});
  await settle(o,660);assert.equal((await state(o)).hp,6);await settle(o,720);assert.equal((await state(o)).hp,11);
});
test('private fixture functions have no browser EXECUTE; explicitly READ COMMITTED',options,async()=>{
  const {o}=await setup();assert.equal((await o`SELECT has_function_privilege('authenticated','g4a6.settle(uuid,timestamptz)','EXECUTE') e`)[0].e,false);
  assert.equal((await o`SELECT current_setting('transaction_isolation') i`)[0].i,'read committed');
});

async function race(first,second,check,{hp=1,prepare}={}){
  const {a,b,o}=await setup({hp});const ap=await pid(a),bp=await pid(b);const prepared=await prepare?.(o);await a.unsafe('BEGIN');let pending;
  try{const context=await first(a,o,prepared);pending=outcome(second(b,context));await waiting(o,bp,ap);await a.unsafe('COMMIT');const result=await pending;await check(o,result);}
  finally{await a.unsafe('ROLLBACK');if(pending)await pending;}
}
test('INDEPENDENT SESSIONS: regeneration-first blocks entry, which sees earned HP',options,async()=>{
  await race(a=>settle(a,120),b=>enter(b,120),async(o,r)=>{assert.ifError(r.error);const s=await state(o);assert.equal(s.hp,6);assert.equal(s.projection_hp,6);assert.equal(s.eligible_since,null);assert.equal(s.fractional_credit,'0');});
});
test('INDEPENDENT SESSIONS: entry-first blocks regeneration and preserves combat HP',options,async()=>{
  await race(a=>enter(a,66),b=>settle(b,120),async(o,r)=>{assert.ifError(r.error);assert.equal((await state(o)).hp,1);assert.equal((await state(o)).fractional_credit,'0');});
});
test('INDEPENDENT SESSIONS: combat commit-first blocks regeneration; no stale restore',options,async()=>{
  await race(async(a,o,cl)=>{await commit(a,cl,30,2);},b=>settle(b,120),async(o,r)=>{assert.ifError(r.error);assert.equal((await state(o)).hp,30);assert.equal((await state(o)).projection_hp,30);},{hp:40,prepare:async o=>{await enter(o,0);return claim(o,1);}});
});
test('INDEPENDENT SESSIONS: regeneration-first fences expired worker commit',options,async()=>{
  await race(async(a,o,cl)=>{await settle(a,120);return cl;},(b,cl)=>commit(b,cl,1,120),async(o,r)=>{assert.match(r.error?.message??'',/stale/);assert.equal((await state(o)).hp,6);},{prepare:o=>claim(o,0)});
});
