import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,access} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import net from 'node:net';
import {createHash} from 'node:crypto';
import postgres from 'postgres';
import {fixture,original,activation,candidate,ids} from './fixtures/legacy-001G3B-idle-fixture.mjs';

// No connection URL accepted. Always a fresh loopback-only temporary cluster.
if(!process.argv[2])throw Error('Supply local PostgreSQL bin directory; tests must not silently skip');
const bin=resolve(process.argv[2]),exe=n=>join(bin,n+(process.platform==='win32'?'.exe':''));
await access(exe('initdb'));await access(exe('pg_ctl'));
const root=await mkdtemp(join(tmpdir(),'wov-g3b-postgres-')),clients=[];
const run=promisify(execFile);
const ctl=args=>new Promise((res,rej)=>{const p=spawn(exe('pg_ctl'),args,{stdio:'ignore',windowsHide:true});p.once('error',rej);p.once('exit',c=>c===0?res():rej(Error('pg_ctl exit '+c+'; '+root)));});
const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
await run(exe('initdb'),['-D',join(root,'data'),'-U','postgres','--auth=trust','--no-locale','--encoding=UTF8'],{windowsHide:true});
await ctl(['-D',join(root,'data'),'-l',join(root,'server.log'),'-o',`-h 127.0.0.1 -p ${port}`,'-w','start']);
const admin=postgres({host:'127.0.0.1',port,username:'postgres',database:'postgres',max:1});
after(async()=>{for(const c of clients)await c.end({timeout:1});await admin.end({timeout:1});await ctl(['-D',join(root,'data'),'-m','immediate','-w','stop']);});
await admin.unsafe('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role');
console.log('LOCAL ONLY '+root+'; '+(await admin.unsafe('SELECT version() v'))[0].v);
for(const [name,body] of Object.entries({original,activation,candidate}))console.log(name+' SHA256 '+createHash('sha256').update(body).digest('hex'));
let serial=0;const options={timeout:25000};
async function setup(patched=true){
 const db='g3b_'+(++serial);await admin.unsafe('CREATE DATABASE '+db);
 const connect=()=>{const c=postgres({host:'127.0.0.1',port,username:'postgres',database:db,max:1,onnotice:()=>{}});clients.push(c);return c;};
 const a=connect(),i=connect(),o=connect();await o.unsafe(fixture);if(patched)await o.unsafe(candidate);
 for(const c of [a,i,o]){await c.unsafe("SET statement_timeout='8s'; SET lock_timeout='6s'; SET deadlock_timeout='100ms'; SET default_transaction_isolation='read committed'");assert.equal((await c.unsafe("SELECT current_setting('transaction_isolation') isolation"))[0].isolation,'read committed');}
 await a.unsafe(`SET ROLE authenticated; SELECT set_config('test.actor','${ids.actor}',false)`);
 await i.unsafe('SET ROLE service_role');return {a,i,o};
}
const pid=async c=>(await c.unsafe('SELECT pg_backend_pid() p'))[0].p;
const call=c=>c.unsafe('SELECT public.combat2_session_access($1,$2) r',[ids.character,ids.node]).then(r=>r[0].r);
// postgres.js queries are lazy: attach then before observing the competing lock.
const idle=c=>c.unsafe('SELECT public.idle_shutdown_check()').then(rows=>rows);
const state=async c=>(await c.unsafe("SELECT w.state,c.value,f.*,(SELECT count(*)::int FROM combat2_player_presence) leases FROM world_state w CROSS JOIN combat_config c CROSS JOIN fixture_state f"))[0];
async function waiting(o,waiter,holder){
 const end=Date.now()+5000;
 while(Date.now()<end){const rows=await o.unsafe(`SELECT $2::int=ANY(pg_blocking_pids($1::int)) blocked,
 EXISTS(SELECT 1 FROM pg_locks WHERE pid=$1 AND locktype='advisory' AND NOT granted) advisory`,[waiter,holder]);
  if(rows[0].blocked&&rows[0].advisory){console.log(`observed advisory blocker ${holder} -> ${waiter}`);return;}
  await new Promise(r=>setTimeout(r,15));
 }throw Error('Required advisory blocker not observed');
}
async function hold(o,key){await o.unsafe('SELECT pg_advisory_lock($1::bigint)',[key]);}
async function release(o,key){await o.unsafe('SELECT pg_advisory_unlock($1::bigint)',[key]);}

test('original body: activation commits inside idle decision window; stale idle sleeps',options,async()=>{
 const {a,i,o}=await setup(false),ip=await pid(i),op=await pid(o);
 await i.unsafe("SET test.idle_barrier='on'");await hold(o,73193001);const running=idle(i);
 try{await waiting(o,ip,op);assert.equal((await call(a)).kind,'allowed');assert.equal((await state(o)).leases,1);}
 finally{await release(o,73193001);}await running;const s=await state(o);assert.equal(s.state,'asleep');assert.equal(s.value,'maintenance');assert.equal(s.enabled,false);assert.equal(s.leases,1);
});
test('corrected idle-first: activation waits through idle commit then wakes',options,async()=>{
 const {a,i,o}=await setup(),ip=await pid(i),ap=await pid(a),op=await pid(o);
 await i.unsafe("SET test.idle_barrier='on'");await hold(o,73193001);const running=idle(i);let accessing;
 try{await waiting(o,ip,op);accessing=call(a);await waiting(o,ap,ip);}finally{await release(o,73193001);}
 await running;assert.equal((await accessing).kind,'allowed');const s=await state(o);assert.equal(s.state,'awake');assert.equal(s.value,'open');assert.equal(s.enabled,true);assert.equal(s.shutdowns,1);assert.equal(s.leases,1);
});
test('corrected activation-first: idle waits then sees committed presence',options,async()=>{
 const {a,i,o}=await setup(),ip=await pid(i),ap=await pid(a),op=await pid(o);
 await a.unsafe("SET test.activation_barrier='on'");await hold(o,73193002);const accessing=call(a);let running;
 try{await waiting(o,ap,op);running=idle(i);await waiting(o,ip,ap);}finally{await release(o,73193002);}
 assert.equal((await accessing).kind,'allowed');await running;const s=await state(o);assert.equal(s.state,'awake');assert.equal(s.shutdowns,0);assert.equal(s.leases,1);
});
test('empty-presence idle still shuts down; ordinary/test/live-claim predicates preserved',options,async()=>{
 for(const mode of ['empty','ordinary','test','claim']){const {i,o}=await setup();
  if(mode==='ordinary')await o.unsafe(`INSERT INTO combat2_player_presence VALUES('${ids.character}','${ids.actor}',clock_timestamp())`);
  if(mode==='test')await o.unsafe(`INSERT INTO combat2_test_arena_access VALUES('${ids.arena}','${ids.character}','${ids.actor}',true,NULL);INSERT INTO combat2_test_arena_node VALUES('${ids.arena}','${ids.node}',true);INSERT INTO combat2_test_presence VALUES('${ids.arena}','${ids.character}','${ids.actor}',clock_timestamp())`);
  if(mode==='claim')await o.unsafe(`INSERT INTO node_encounter VALUES('${ids.arena}',now()+interval '1 minute')`);
  await idle(i);assert.equal((await state(o)).shutdowns,mode==='empty'?1:0);
 }
});
test('unauthorized/inactive activation refuses without world effects',options,async()=>{
 for(const mode of ['anonymous','wrong-owner','deleted']){const {a,o}=await setup();
  if(mode==='anonymous')await a.unsafe("SET test.actor=''");
  if(mode==='wrong-owner')await a.unsafe(`SET test.actor='10000000-0000-4000-8000-000000000099'`);
  if(mode==='deleted')await o.unsafe('UPDATE characters SET deleted_at=now()');
  assert.equal((await call(a)).kind,'not_authorized');const s=await state(o);assert.equal(s.wakes,0);assert.equal(s.leases,0);
 }
});
test('scheduler refusal compensates; exception rolls activation block back',options,async()=>{
 for(const mode of ['refuse','throw']){const {a,o}=await setup();await a.unsafe(`SET test.scheduler='${mode}'`);assert.equal((await call(a)).kind,'access_check_failed');const s=await state(o);assert.equal(s.leases,0);assert.equal(s.state,mode==='refuse'?'asleep':'awake');assert.equal(s.wakes,mode==='refuse'?1:0);}
});
test('idle failure rolls all effects back and releases gate; outer rollback restores state',options,async()=>{
 const {a,i,o}=await setup();await i.unsafe("SET test.shutdown_failure='on'");await assert.rejects(idle(i),e=>e.code==='P0001');let s=await state(o);assert.equal(s.shutdowns,0);assert.equal(s.state,'awake');assert.equal(s.value,'open');assert.equal((await call(a)).kind,'allowed');
 await o.unsafe('DELETE FROM combat2_player_presence');await i.unsafe("SET test.shutdown_failure='off'; BEGIN");await idle(i);await i.unsafe('ROLLBACK');s=await state(o);assert.equal(s.shutdowns,0);assert.equal(s.state,'awake');
 assert.equal((await o.unsafe("SELECT pg_try_advisory_xact_lock(hashtext('combat2-production-activation')) ok"))[0].ok,true);
});
test('bounded lock timeout is detected, and rollback releases transaction gate',options,async()=>{
 const {i,o}=await setup();await o.unsafe("SELECT pg_advisory_lock(hashtext('combat2-production-activation'))");await i.unsafe("SET lock_timeout='150ms'");
 try{await assert.rejects(idle(i),e=>e.code==='55P03');}finally{await o.unsafe("SELECT pg_advisory_unlock(hashtext('combat2-production-activation'))");}
 assert.equal((await state(o)).shutdowns,0);assert.equal((await o.unsafe("SELECT pg_try_advisory_xact_lock(hashtext('combat2-production-activation')) ok"))[0].ok,true);
});
test('explicit REPEATABLE READ stale snapshot remains unsupported; no universal isolation claim',options,async()=>{
 const {a,i,o}=await setup();await i.unsafe('BEGIN ISOLATION LEVEL REPEATABLE READ');assert.equal((await i.unsafe("SELECT current_setting('transaction_isolation') isolation,txid_current_snapshot() snapshot"))[0].isolation,'repeatable read');
 assert.equal((await call(a)).kind,'allowed');
 // Activation deliberately writes shared singleton rows. A stale repeatable-read
 // idle cannot silently be treated as RC: PG refuses the conflicting UPDATE.
 await assert.rejects(idle(i),e=>e.code==='40001');await i.unsafe('ROLLBACK');assert.equal((await state(o)).state,'awake');
});
test('observer detects a deliberate fixture-only deadlock; rollback releases both gates',options,async()=>{
 const {a,i,o}=await setup(),ap=await pid(a),ip=await pid(i);
 await a.unsafe('BEGIN; SELECT pg_advisory_xact_lock(73193011)');await i.unsafe('BEGIN; SELECT pg_advisory_xact_lock(73193012)');
 const first=a.unsafe('SELECT pg_advisory_xact_lock(73193012)').then(()=>null,e=>e);
 try{await waiting(o,ap,ip);const second=i.unsafe('SELECT pg_advisory_xact_lock(73193011)').then(()=>null,e=>e);
  const outcomes=await Promise.all([first,second]);assert.equal(outcomes.filter(e=>e?.code==='40P01').length,1);
 }finally{await a.unsafe('ROLLBACK');await i.unsafe('ROLLBACK');}
 assert.equal((await o.unsafe('SELECT pg_try_advisory_xact_lock(73193011) AND pg_try_advisory_xact_lock(73193012) ok'))[0].ok,true);
});
test('candidate changes only initial lock; preserves complete pg_proc metadata and drift guards',options,async()=>{
 const {o}=await setup(false);const before=(await o.unsafe("SELECT prosrc,to_jsonb(p)-'prosrc' metadata FROM pg_proc p WHERE oid='idle_shutdown_check()'::regprocedure"))[0];
 await o.unsafe(candidate);const after=(await o.unsafe("SELECT prosrc,to_jsonb(p)-'prosrc' metadata FROM pg_proc p WHERE oid='idle_shutdown_check()'::regprocedure"))[0];
 assert.deepEqual(after.metadata,before.metadata);assert.equal(after.prosrc.replace(" PERFORM pg_advisory_xact_lock(hashtext('combat2-production-activation'));\n",''),before.prosrc);
 await assert.rejects(o.unsafe(candidate),/source\/settings drift/);await o.unsafe('ROLLBACK');
 const acl=(await o.unsafe("SELECT has_function_privilege('authenticated','idle_shutdown_check()','EXECUTE') browser,has_function_privilege('service_role','idle_shutdown_check()','EXECUTE') server"))[0];assert.equal(acl.browser,false);assert.equal(acl.server,true);
});
