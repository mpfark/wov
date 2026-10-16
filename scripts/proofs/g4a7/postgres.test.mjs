import { test,after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn,execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp,readFile,access } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import net from 'node:net';
import postgres from 'postgres';
import { buildAdapters,manifest } from './source-adapters.mjs';

if(!process.argv[2])throw Error('Supply local PostgreSQL bin directory; no URL/fallback');
const exe=n=>join(resolve(process.argv[2]),n+(process.platform==='win32'?'.exe':''));await access(exe('initdb'));
const root=await mkdtemp(join(tmpdir(),'wov-g4a7-')),clients=[];
const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
await promisify(execFile)(exe('initdb'),['-D',join(root,'data'),'-U','postgres','--auth=trust','--no-locale','--encoding=UTF8'],{windowsHide:true});
const ctl=args=>new Promise((res,rej)=>{const p=spawn(exe('pg_ctl'),args,{stdio:'ignore',windowsHide:true});p.once('error',rej);p.once('exit',n=>n===0?res():rej(Error('pg_ctl '+n)));});
await ctl(['-D',join(root,'data'),'-l',join(root,'server.log'),'-o',`-h 127.0.0.1 -p ${port}`,'-w','start']);
const admin=postgres({host:'127.0.0.1',port,username:'postgres',database:'postgres',max:1});
after(async()=>{for(const c of clients)await c.end({timeout:1});await admin.end({timeout:1});await ctl(['-D',join(root,'data'),'-m','immediate','-w','stop']);});
const generated=buildAdapters();console.log('LOCAL '+(await admin`SELECT version() v`)[0].v+'; cluster '+root);console.log('SOURCE MANIFEST '+JSON.stringify(manifest));
const read=p=>readFile(new URL(p,import.meta.url),'utf8');
const files=await Promise.all(['../g4a6/fixture.sql','../g4a6/candidate.sql','./fixture.sql','./adapters.sql'].map(read));
const cid='00000000-0000-4000-8000-000000000001',node='00000000-0000-4000-8000-000000000002',dest='00000000-0000-4000-8000-000000000003',enc='00000000-0000-4000-8000-000000000004',enc2='00000000-0000-4000-8000-000000000005';
const actor='00000000-0000-4000-8000-000000000011',user='00000000-0000-4000-8000-000000000012',request='00000000-0000-4000-8000-000000000013',effect='00000000-0000-4000-8000-000000000014';
const at=t=>new Date(Date.UTC(2026,0,1)+t*1000).toISOString();let serial=0;const options={timeout:25000};
async function clock(c,t){await c`SELECT set_config('g4a7.cutoff',${at(t)},false)`;}
async function setup({hp=40,aggressive=true}={}){
 const db='g4a6_fixture_g4a7_'+(++serial);await admin.unsafe('CREATE DATABASE '+db);
 const connect=()=>{const c=postgres({host:'127.0.0.1',port,username:'postgres',database:db,max:1,onnotice:()=>{}});clients.push(c);return c;};
 const a=connect(),b=connect(),o=connect();for(const sql of files.slice(0,3))await o.unsafe(sql);await o.unsafe(generated);await o.unsafe(files[3]);
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

test('hash-pinned source extraction:10 identities, no public references or stored body copies',options,async()=>{
 assert.equal(manifest.length,10);assert(!generated.includes('public.'));assert(generated.includes('cr.spawn_seq ='));const {o}=await setup();assert.equal((await o`SELECT count(*)::int n FROM pg_proc WHERE pronamespace='public'::regnamespace`)[0].n,0);
});
test('adapted FULL entry: wounded HP settled, initial spawn seeded and request replays without duplicate membership',options,async()=>{
 const {o}=await setup();const r=await entry(o,120);assert.equal(r.kind,'entered');const s=await state(o);assert.equal(s.hp,45);assert.equal(s.runtime_hp,45);assert.equal(s.fractional_credit,'0');
 const again=await entry(o,120);assert.equal(again.kind,'already_entered');assert.equal((await o`SELECT count(*)::int n FROM g4a6.node_fighter`)[0].n,1);assert.deepEqual(await state(o),s);
});
test('adapted FULL hostile source + source intent lock wrapper, with explicitly doubled admission',options,async()=>{
 const {o}=await setup();assert.equal((await hostile(o,120)).ok,true);assert.equal((await state(o)).hp,45);assert.equal((await o`SELECT count(*)::int n FROM g4a6.node_intent WHERE status='pending'`)[0].n,1);
 assert.equal((await hostile(o,120)).kind,'already_accepted');assert.equal((await o`SELECT count(*)::int n FROM g4a6.node_intent`)[0].n,1);
});
test('actual hostile subtransaction rolls entry/accounting back on intent refusal; Auth is a labeled double',options,async()=>{
 const {o}=await setup();const before=await state(o);await o`SELECT set_config('g4a7.refuse_intent','on',false)`;assert.equal((await hostile(o,120)).ok,false);assert.deepEqual(await state(o),before);
 assert.equal((await o`SELECT count(*)::int n FROM g4a6.node_fighter`)[0].n,0);await o`SELECT set_config('g4a7.actor',${dest},false)`;assert.equal((await hostile(o,120)).kind,'not_authorized');
});
test('adapted source seed baseline retains stale same-generation row; candidate refuses mismatch',options,async()=>{
 const {o}=await setup();await o`SELECT g4a6.src_seed(${enc},${node})`;await o`UPDATE g4a6.creatures SET hp=50`;
 await o`SELECT g4a6.src_seed(${enc},${node})`;assert.equal((await state(o)).runtime_hp,40);await assert.rejects(settle(o,120),/mismatch/);
});
test('retained ended projection reactivation preserves wounds and runtime identity',options,async()=>{
 const {o}=await setup();await o`SELECT g4a6.src_seed(${enc},${node})`;const id=(await state(o)).runtime_id;await entry(o,120);assert.equal((await state(o)).runtime_id,id);assert.equal((await state(o)).hp,45);
});
test('full source entry exercises party arrival-group branch without claiming party_mutate integration',options,async()=>{
 const {o}=await setup();await o`INSERT INTO g4a6.party_members VALUES(${actor},${dest},'accepted')`;const r=await entry(o,0);assert.equal(r.ok,true);assert.equal((await o`SELECT party_id_at_entry FROM g4a6.node_fighter`)[0].party_id_at_entry,dest);assert.equal((await o`SELECT count(*)::int n FROM g4a6.node_arrival_group WHERE party_id=${dest}`)[0].n,1);
});
test('adapted claim pre-synchronizes HP; exact source guard/write fragments mirror damage and replay',options,async()=>{
 const {o}=await setup();await entry(o,0);const cl=await claim(o,1);assert.equal(cl.kind,'claimed');assert.equal(cl.snapshot.creatures[0].hp,40);
 const p=await proposal(o,30);assert.equal((await commit(o,cl,p,2)).kind,'committed');const s=await state(o);assert.equal(s.hp,30);assert.equal(s.runtime_hp,30);assert.equal(s.last_damaged_at.toISOString(),at(2));assert.equal((await commit(o,cl,p,3)).kind,'already_committed');assert.deepEqual(await state(o),s);
});
test('new authoritative entry fences a quiet live lease before settlement, preserving earned whole HP',options,async()=>{
 const {o}=await setup();await o`SELECT g4a6.src_seed(${enc},${node})`;await o`UPDATE g4a6.node_encounter SET status='active' WHERE id=${enc}`;
 const cl=await claim(o,70);assert.equal((await state(o)).hp,40);assert.equal((await state(o)).fractional_credit,'500000000000');
 const r=await entry(o,72);assert.equal(r.ok,true);assert.equal((await state(o)).hp,41);assert.equal((await state(o)).runtime_hp,41);assert.equal((await state(o)).fractional_credit,'0');
 assert.equal((await commit(o,cl,await proposal(o,39),73)).kind,'stale_claim');
});
test('exact source creature identity guard rejects foreign runtime reference atomically',options,async()=>{
 const {o}=await setup();await entry(o,0);const cl=await claim(o,1);const p=await proposal(o,30);p.creatures[0].id=effect;const before=await state(o);const r=await commit(o,cl,p,2);assert.equal(r.kind,'foreign_reference');assert.equal(r.relation,'creatures');assert.deepEqual(await state(o),before);
});
test('source commit effects-delete/pending-action clear releases OOC only after all work resolves',options,async()=>{
 const {o}=await setup();await entry(o,0);await o`INSERT INTO g4a6.node_effect(id,encounter_id,kind,target_creature_id) VALUES(${effect},${enc},'dot',${cid})`;
 const cl=await claim(o,1);await commit(o,cl,await proposal(o,40,{pending:{resolve_at_tick:9}}),2);await clock(o,3);await o`SELECT g4a7.exit_combat(${cid})`;await settle(o,100);assert.equal((await state(o)).hp,40);assert.equal((await state(o)).eligible_since,null);
 await o`UPDATE g4a6.node_encounter SET next_due_at=${at(100)}`;const clear=await claim(o,101);await commit(o,clear,await proposal(o,40,{status:'ended',effects:[effect]}),102);
 await settle(o,161.999);assert.equal((await state(o)).hp,40);await settle(o,162);assert.equal((await state(o)).hp,40);await settle(o,174);assert.equal((await state(o)).hp,41);
});
test('approved rate edit settles old rate, discards fraction, starts fresh cursor; max edit floors living HP',options,async()=>{
 const {o}=await setup({hp:1});await clock(o,78);await o`SELECT g4a7.edit_rate(${cid},'10.00')`;assert.equal((await state(o)).hp,2);assert.equal((await state(o)).fractional_credit,'0');assert.equal((await state(o)).accounted_through.toISOString(),at(78));
 await settle(o,84);assert.equal((await state(o)).hp,3);assert.equal((await state(o)).fractional_credit,'0');
 const x=await setup({hp:60});await x.o`SELECT g4a7.edit_max(${cid},30)`;assert.equal((await state(x.o)).hp,1);assert.equal((await state(x.o)).is_alive,true);assert.equal((await state(x.o)).spawn_seq,1);assert.equal((await state(x.o)).died_at,null);
});
test('source respawn due-time and real generation trigger: zero rate does not prevent ordinary respawn',options,async()=>{
 const {o}=await setup();await o`SELECT g4a7.edit_rate(${cid},'0')`;await entry(o,0);const cl=await claim(o,1);await commit(o,cl,await proposal(o,0,{status:'ended'}),2);
 await clock(o,301);await o`SELECT g4a7.respawn(${cid})`;assert.equal((await state(o)).is_alive,false);await o`SELECT g4a7.edit_max(${cid},30)`;assert.equal((await state(o)).hp,0);assert.equal((await state(o)).spawn_seq,1);
 await clock(o,302);await o`SELECT g4a7.respawn(${cid})`;await o`SELECT g4a6.combat2_seed_spawns(${enc},${node})`;assert.equal((await state(o)).spawn_seq,2);assert.equal((await state(o)).hp,30);assert.equal((await state(o)).regen_bps,0);
});
test('source generation mirror predicate preserves new life; adapter rejects an old-generation new proposal',options,async()=>{
 const {o}=await setup();await entry(o,0);const cl=await claim(o,1);const old=await proposal(o,0,{status:'ended'});await commit(o,cl,old,2);await clock(o,302);await o`SELECT g4a7.respawn(${cid})`;await o`SELECT g4a6.combat2_seed_spawns(${enc},${node})`;
 const e=(await o`SELECT * FROM g4a6.node_encounter WHERE id=${enc}`)[0];await o`UPDATE g4a6.node_encounter SET claim_token=${cl.claim_token},claimed_tick=2,claim_expires_at=${at(310)} WHERE id=${enc}`;
 const synthetic={...cl,candidate_tick:2,last_committed_tick:1,state_version:Number(e.state_version)};
 assert.equal((await commit(o,synthetic,old,303)).kind,'stale_generation');
 // Controlled metadata fixture to isolate the ORIGINAL mirror predicate only;
 // not evidence an old worker can obtain a fresh valid lease in production.
 await clock(o,303);const r=(await o`SELECT g4a6.src_commit_fragment(${enc},${cl.claim_token},2,1,${e.state_version},ARRAY[]::uuid[],${o.json(old)}) r`)[0].r;
 assert.equal(r.kind,'committed');assert.equal((await state(o)).spawn_seq,2);assert.equal((await state(o)).hp,100);assert.equal((await state(o)).runtime_hp,100);assert.equal((await state(o)).is_alive,true);
});
test('actual source re-entry after partial regeneration retains whole HP and discards fraction',options,async()=>{
 const {o}=await setup();await entry(o,0);const cl=await claim(o,1);await commit(o,cl,await proposal(o,40,{status:'ended'}),2);await clock(o,3);await o`SELECT g4a7.exit_combat(${cid})`;
 // The ended/no-work post-commit state released eligibility at t=2. The
 // subsequent unblocked exit observation must not restart that delay at t=3.
 await settle(o,80);assert.equal((await state(o)).hp,41);assert.equal((await state(o)).fractional_credit,'300000000000');
 const r=(await o`SELECT g4a7.enter(${actor},${effect}) r`)[0].r;assert.equal(r.kind,'reentered');assert.equal((await state(o)).hp,41);assert.equal((await state(o)).runtime_hp,41);assert.equal((await state(o)).fractional_credit,'0');
});
test('actual source regen/wake bodies reproduce durable/projection conflict; proposed bridge does not full-heal',options,async()=>{
 const x=await setup({hp:10});await x.o`SELECT g4a6.src_seed(${enc},${node})`;await x.o`SELECT g4a6.src_regen()`;assert.equal((await state(x.o)).hp,20);assert.equal((await state(x.o)).runtime_hp,10);await assert.rejects(settle(x.o,120),/mismatch/);
 const y=await setup({hp:10});await y.o`SELECT g4a6.src_seed(${enc},${node})`;await y.o`SELECT g4a6.src_wake()`;assert.equal((await state(y.o)).hp,100);assert.equal((await state(y.o)).runtime_hp,10);
 const z=await setup({hp:10});await z.o`SELECT g4a6.src_seed(${enc},${node})`;await clock(z.o,120);await z.o`SELECT g4a7.wake_or_regen(${cid})`;const before=await state(z.o);assert.equal(before.hp,15);assert.equal(before.runtime_hp,15);await z.o`SELECT g4a7.wake_or_regen(${cid})`;assert.deepEqual(await state(z.o),before);
});
test('elapsed sleeping eligibility and fractional replay; real world scheduler not executed',options,async()=>{
 const {o}=await setup({hp:1});await clock(o,0);await o`SELECT g4a7.edit_rate(${cid},'0.01')`;await clock(o,86400);await o`SELECT g4a7.wake_or_regen(${cid})`;assert.equal((await state(o)).hp,15);assert.equal((await state(o)).fractional_credit,'234000000000');const before=await state(o);await settle(o,86400);assert.deepEqual(await state(o),before);
});
test('active edit/reassignment refused; quiescent ended transfer uses base local candidate, not source transfer',options,async()=>{
 const {o}=await setup();await entry(o,0);await assert.rejects(o`SELECT g4a7.edit_rate(${cid},'2')`,/active/);await assert.rejects(o`SELECT g4a6.reassign(${cid},${dest},g4a6.test_now())`,/quiescent/);
 const cl=await claim(o,1);await commit(o,cl,await proposal(o,40,{status:'ended'}),2);await clock(o,3);await o`SELECT g4a7.exit_combat(${cid})`;await o`SELECT g4a6.reassign(${cid},${dest},g4a6.test_now())`;assert.equal((await state(o)).node_id,dest);assert.equal((await state(o)).hp,(await state(o)).runtime_hp);
});

async function race(first,second,check,prepare){const {a,b,o}=await setup();const context=await prepare?.(o);const ap=await pid(a),bp=await pid(b);await a.unsafe('BEGIN');let p;try{const x=await first(a,o,context);p=outcome(second(b,x));await waiting(o,bp,ap);await a.unsafe('COMMIT');await check(o,await p);}finally{await a.unsafe('ROLLBACK');if(p)await p;}}
test('INDEPENDENT: source entry waits for regeneration and receives coherent HP',options,async()=>{
 await race(a=>settle(a,120),b=>entry(b,120),async(o,r)=>{assert.ifError(r.error);assert.equal(r.value.ok,true);assert.equal((await state(o)).hp,45);assert.equal((await state(o)).runtime_hp,45);});
});
test('INDEPENDENT: regeneration waits for adapted full source entry, no combat healing',options,async()=>{
 await race(a=>entry(a,0),b=>settle(b,120),async(o,r)=>{assert.ifError(r.error);assert.equal((await state(o)).hp,40);assert.equal((await state(o)).eligible_since,null);});
});
test('INDEPENDENT: source commit HP fragment blocks regeneration, preserving damage',options,async()=>{
 await race(async(a,o,cl)=>{await commit(a,cl,await proposal(a,30),2);},b=>settle(b,120),async(o,r)=>{assert.ifError(r.error);assert.equal((await state(o)).hp,30);assert.equal((await state(o)).runtime_hp,30);},async o=>{await entry(o,0);return claim(o,1);});
});
test('INDEPENDENT: pre-claim quiet source snapshot becomes stale after expired-claim regeneration',options,async()=>{
 await race(async(a,o,cl)=>{await settle(a,120);return cl;},async(b,cl)=>commit(b,cl,await proposal(b,1),120),async(o,r)=>{assert.ifError(r.error);assert(['stale_claim','stale_snapshot'].includes(r.value.kind));assert.equal((await state(o)).hp,45);},async o=>{await o`SELECT g4a6.src_seed(${enc},${node})`;await o`UPDATE g4a6.node_encounter SET status='active' WHERE id=${enc}`;return claim(o,0);});
});
test('INDEPENDENT: shared sorted-node/party-lifecycle/encounter primitive blocks source entry; full party/movement body NOT executed',options,async()=>{
 await race(async a=>{await a`SELECT pg_advisory_xact_lock(hashtextextended('combat_enter_node:'||n::text,0)) FROM (SELECT unnest(${a.array([node,dest])}::uuid[]) n ORDER BY n) sorted`;await a`SELECT pg_advisory_xact_lock(hashtextextended('party-lifecycle',0))`;await a`SELECT id FROM g4a6.node_encounter ORDER BY id FOR UPDATE`;},b=>entry(b,0),async(o,r)=>{assert.ifError(r.error);assert.equal(r.value.ok,true);});
});
test('INDEPENDENT: source entry first blocks the same party/movement gate primitive',options,async()=>{
 await race(a=>entry(a,0),async b=>{await b.begin(async tx=>{await tx`SELECT pg_advisory_xact_lock(hashtextextended('combat_enter_node:'||n::text,0)) FROM (SELECT unnest(${tx.array([node,dest])}::uuid[]) n ORDER BY n) sorted`;await tx`SELECT pg_advisory_xact_lock(hashtextextended('party-lifecycle',0))`;await tx`SELECT id FROM g4a6.node_encounter ORDER BY id FOR UPDATE`;});},async(o,r)=>{assert.ifError(r.error);assert.equal((await state(o)).hp,40);});
});
