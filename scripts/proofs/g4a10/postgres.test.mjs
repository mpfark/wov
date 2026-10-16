import { test,after,afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn,execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp,readFile,access } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import net from 'node:net';
import postgres from 'postgres';
import { buildAdapters,manifest } from '../g4a7/source-adapters.mjs';
import {buildRequests,manifest as requestManifest,partyRequestDefinition} from '../g4a9/source-adapters.mjs';
import {buildMovement,manifest as movementManifest} from '../g4a8/source-adapters.mjs';

if(!process.argv[2])throw Error('Supply local PostgreSQL bin directory; no URL/fallback');
const exe=n=>join(resolve(process.argv[2]),n+(process.platform==='win32'?'.exe':''));await access(exe('initdb'));
const root=await mkdtemp(join(tmpdir(),'wov-g4a10-')),clients=[];
const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
await promisify(execFile)(exe('initdb'),['-D',join(root,'data'),'-U','postgres','--auth=trust','--no-locale','--encoding=UTF8'],{windowsHide:true});
const ctl=args=>new Promise((res,rej)=>{const p=spawn(exe('pg_ctl'),args,{stdio:'ignore',windowsHide:true});p.once('error',rej);p.once('exit',n=>n===0?res():rej(Error('pg_ctl '+n)));});
await ctl(['-D',join(root,'data'),'-l',join(root,'server.log'),'-o',`-h 127.0.0.1 -p ${port}`,'-w','start']);
const admin=postgres({host:'127.0.0.1',port,username:'postgres',database:'postgres',max:1});
after(async()=>{for(const c of clients)await c.end({timeout:1});await admin.end({timeout:1});await ctl(['-D',join(root,'data'),'-m','immediate','-w','stop']);});
afterEach(async()=>{for(const c of clients.splice(0))await c.end({timeout:1});});
const generated=buildAdapters();console.log('LOCAL '+(await admin`SELECT version() v`)[0].v+'; cluster '+root);console.log('SOURCE MANIFEST '+JSON.stringify(manifest));
const read=p=>readFile(new URL(p,import.meta.url),'utf8');
const files=await Promise.all(['../g4a6/fixture.sql','../g4a6/candidate.sql','../g4a7/fixture.sql','../g4a7/adapters.sql','../g4a8/fixture.sql','../g4a8/adapters.sql','../g4a9/fixture.sql','../g4a9/adapters.sql'].map(read));
const cid='00000000-0000-4000-8000-000000000001',node='00000000-0000-4000-8000-000000000002',dest='00000000-0000-4000-8000-000000000003',enc='00000000-0000-4000-8000-000000000004',enc2='00000000-0000-4000-8000-000000000005';
const actor='00000000-0000-4000-8000-000000000011',user='00000000-0000-4000-8000-000000000012',request='00000000-0000-4000-8000-000000000013',effect='00000000-0000-4000-8000-000000000014';
const at=t=>new Date(Date.UTC(2026,0,1)+t*1000).toISOString();let serial=0;const options={timeout:25000};
async function clock(c,t){await c`SELECT set_config('g4a7.cutoff',${at(t)},false)`;}
const candidate=await read('./candidate.sql');
async function setup({hp=40,aggressive=true,mode='error',corrected=false,functionMode=null}={}){
 assert(['error','use_column','use_variable'].includes(mode));assert(functionMode===null||['error','use_column','use_variable'].includes(functionMode));
 const db='g4a6_fixture_g4a10_'+(++serial);await admin.unsafe('CREATE DATABASE '+db);
 const connect=()=>{const c=postgres({host:'127.0.0.1',port,username:'postgres',database:db,max:1,onnotice:()=>{}});clients.push(c);return c;};
 const a=connect(),b=connect(),o=connect();for(const sql of files.slice(0,3))await o.unsafe(sql);await o.unsafe(generated);await o.unsafe(files[3]);await o.unsafe(files[4]);await o.unsafe(files[6]);await o.unsafe(buildMovement());await o.unsafe(files[5]);await o.unsafe(buildRequests());await o.unsafe(files[7]);
 for(const c of [a,b,o]){await c.unsafe("SET statement_timeout='8s';SET lock_timeout='6s';SET deadlock_timeout='100ms';SET default_transaction_isolation='read committed'");await c`SELECT set_config('g4a7.actor',${user},false)`;await clock(c,0);await c`SELECT set_config('plpgsql.variable_conflict',${mode},false)`;assert.equal((await c`SELECT current_setting('transaction_isolation') v`)[0].v,'read committed');}
 await o.unsafe(partyRequestDefinition(false));
 if(functionMode)await o.unsafe('ALTER FUNCTION g4a6.combat2_party_depart_without_canary_gate(uuid,uuid,uuid) SET plpgsql.variable_conflict TO '+functionMode);
 if(corrected)await apply(o);
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

async function apply(c){const before=(await c`SELECT pg_get_functiondef('g4a6.party_mutate(uuid,text,uuid,uuid,uuid,uuid)'::regprocedure) d`)[0].d;await c.unsafe(candidate);assert.equal((await c`SELECT pg_get_functiondef('g4a6.party_mutate(uuid,text,uuid,uuid,uuid,uuid)'::regprocedure) d`)[0].d,before,'F6 complete body unchanged');}

async function weightedParty(o){await addParty(o);await o`INSERT INTO g4a6.items(id,name,item_type) SELECT gen_random_uuid(),'fixture load','equipment' FROM generate_series(1,13)`;await o`INSERT INTO g4a6.character_inventory(character_id,item_id) SELECT ${follower},id FROM g4a6.items`;}
async function balances(o){return (await o`SELECT id,mp,current_node_id FROM g4a6.characters WHERE id IN(${actor},${follower}) ORDER BY id`);}
function costs(result){return result.members.map(m=>({id:m.character_id,order:m.order,cost:m.cost,status:m.status}));}
function checkResult(r,{followerCost=8,kind='moved'}={}){assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.kind,kind);assert.deepEqual(costs(r),[{id:follower,order:1,cost:followerCost,status:'moved'},{id:actor,order:2,cost:5,status:'moved'}]);assert.deepEqual(Object.keys(r).sort(),['cost','destination_node_id','kind','members','ok','origin_node_id','request_id','resource_kind'].sort());for(const m of r.members)assert.deepEqual(Object.keys(m).sort(),['character_id','cost','display_name','order','status'].sort());}
async function checkSpent(o){const b=await balances(o);assert.equal(b.find(x=>x.id===actor).mp,95);assert.equal(b.find(x=>x.id===follower).mp,92);}
async function resetMovers(o){await o`UPDATE g4a6.characters SET current_node_id=${node},mp=100 WHERE id IN(${actor},${follower})`;}
const fn='g4a6.combat2_party_depart_without_canary_gate(uuid,uuid,uuid)';
const metadata=async c=>(await c`SELECT to_jsonb(p)-'prosrc' m FROM pg_proc p WHERE p.oid=${fn}::regprocedure`)[0].m;
const definition=async c=>(await c`SELECT pg_get_functiondef(${fn}::regprocedure) d`)[0].d;

test('original explicit error: structured refusal/rollback; diagnostic reveals SQLSTATE42702',options,async()=>{
 const {o}=await setup({mode:'error'});await weightedParty(o);const before=await current(o);
 assert.equal((await moving(o,{party:true})).kind,'party_movement_failed');assert.deepEqual(await current(o),before);assert.equal((await o`SELECT count(*)::int n FROM g4a6.combat2_party_departure_request`)[0].n,0);assert.equal((await balances(o)).every(c=>c.mp===100),true);
 // Diagnostic-only surfacing, not the candidate or normal exception contract.
 await o.unsafe(partyRequestDefinition(false).replace("WHEN OTHERS THEN RETURN jsonb_build_object('ok',false,'kind','party_movement_failed');","WHEN OTHERS THEN RAISE;"));
 await assert.rejects(moving(o,{party:true}),e=>{console.log('ORIGINAL DIAGNOSTIC '+e.code+' '+e.message);assert.match(e.internal_query,/cost',cost/);return e.code==='42702';});
});
for(const mode of ['use_column','use_variable'])test('original explicit '+mode+': distinguish reported cost from MP spent',options,async()=>{
 const {o}=await setup({mode});await weightedParty(o);const r=await moving(o,{party:true});checkResult(r,{followerCost:mode==='use_variable'?5:8});await checkSpent(o);
 console.log('ORIGINAL '+mode+' reported follower='+r.members[0].cost+'; actual follower MP cost=8');
});
for(const mode of ['error','use_column','use_variable'])test('corrected explicit '+mode+': compilation and per-member response/cost preserved',options,async()=>{
 const {o}=await setup({mode,corrected:true});await weightedParty(o);checkResult(await moving(o,{party:true}));await checkSpent(o);
});
for(const [mode,functionMode,expected] of [['error','use_column','correct'],['use_column','error','refuse'],['use_column','use_variable','variable']])test('original global '+mode+' / function-level '+functionMode,options,async()=>{
 const {o}=await setup({mode,functionMode});await weightedParty(o);const r=await moving(o,{party:true});
 if(expected==='refuse')assert.equal(r.kind,'party_movement_failed');else{checkResult(r,{followerCost:expected==='variable'?5:8});await checkSpent(o);}
 assert.equal((await o`SELECT current_setting('plpgsql.variable_conflict') v`)[0].v,mode,'function setting restores caller setting');
});
test('candidate preserves function-level use_variable while result columns remain deterministic',options,async()=>{
 const {o}=await setup({mode:'error',functionMode:'use_variable'});const before=await metadata(o);await apply(o);assert.deepEqual(await metadata(o),before);await weightedParty(o);checkResult(await moving(o,{party:true}));
});
test('inline compiler directive overrides global/function setting; candidate refuses changed source',options,async()=>{
 const {o}=await setup({mode:'error',functionMode:'use_column'});await weightedParty(o);
 await o.unsafe(partyRequestDefinition(false).replace('DECLARE caller','\n#variable_conflict use_variable\nDECLARE caller'));checkResult(await moving(o,{party:true}),{followerCost:5});await checkSpent(o);
 await assert.rejects(apply(o),/original fixture source drift/);
});
test('cached compilation is not established by a later session setting; replacement recompiles',options,async()=>{
 const {o}=await setup({mode:'use_column'});await weightedParty(o);checkResult(await moving(o,{party:true}));
 await o`SELECT set_config('plpgsql.variable_conflict','error',false)`;await resetMovers(o);checkResult(await moving(o,{party:true,id:otherRequest}));
 await o.unsafe(partyRequestDefinition(false));await resetMovers(o);assert.equal((await moving(o,{party:true,id:effect})).kind,'party_movement_failed');
 console.log('CACHE: previously compiled use_column survived SET error; replacement reproduced refusal');
});
test('single aggregate replacement preserves all pg_proc metadata and explicit fixture server ACL',options,async()=>{
 const {o}=await setup({mode:'error',functionMode:'error'});
 await admin.unsafe('CREATE ROLE g4a10_server; CREATE ROLE g4a10_client');
 await o.unsafe('ALTER FUNCTION '+fn+' SECURITY DEFINER');await o.unsafe('GRANT EXECUTE ON FUNCTION '+fn+' TO g4a10_server WITH GRANT OPTION');
 await o.unsafe('REVOKE ALL ON FUNCTION '+fn+' FROM PUBLIC,g4a10_client');const before=await metadata(o);await apply(o);assert.deepEqual(await metadata(o),before);
 const rights=(await o`SELECT has_function_privilege('g4a10_server',${fn},'EXECUTE') server,has_function_privilege('g4a10_client',${fn},'EXECUTE') client`)[0];assert.equal(rights.server,true);assert.equal(rights.client,false);
 const actual=(await o`SELECT prosrc FROM pg_proc WHERE oid=${fn}::regprocedure`)[0].prosrc;const d=partyRequestDefinition(true),tag='AS $function$';assert.equal(actual,d.slice(d.indexOf(tag)+tag.length,d.lastIndexOf('$function$')));
 await weightedParty(o);checkResult(await moving(o,{party:true}));
});
test('source drift rejects atomically without changing function metadata/body or F6',options,async()=>{
 const {o}=await setup();await o.unsafe(partyRequestDefinition(false).replace('DECLARE caller','-- deliberate fixture drift\nDECLARE caller'));const before=await definition(o),meta=await metadata(o);
 await assert.rejects(apply(o),/source drift/);assert.equal(await definition(o),before);assert.deepEqual(await metadata(o),meta);
});
test('reapplying candidate refuses original-source mismatch without changing corrected body',options,async()=>{
 const {o}=await setup({corrected:true});const before=await definition(o);await assert.rejects(apply(o),/source drift/);assert.equal(await definition(o),before);
});
test('solo movement unaffected before/after party-only correction',options,async()=>{
 const {o}=await setup();const solo=(await o`SELECT pg_get_functiondef('g4a6.combat2_depart_without_canary_gate(uuid,uuid,uuid)'::regprocedure) d`)[0].d;
 const first=await moving(o,{t:0});assert.equal(first.kind,'moved');assert.equal(first.cost,5);await o`UPDATE g4a6.characters SET current_node_id=${node},mp=100 WHERE id=${actor}`;await apply(o);
 const second=await moving(o,{t:0,id:otherRequest});assert.equal(second.kind,'moved');assert.equal(second.cost,5);assert.equal((await o`SELECT mp FROM g4a6.characters WHERE id=${actor}`)[0].mp,95);assert.equal((await o`SELECT pg_get_functiondef('g4a6.combat2_depart_without_canary_gate(uuid,uuid,uuid)'::regprocedure) d`)[0].d,solo);
});
test('queued leader / waiting follower retains source request IDs, ordering, MP and finalization',options,async()=>{
 const {o}=await setup({corrected:true});await weightedParty(o);await entry(o,0);
 const queued=await moving(o,{party:true,finish:false,t:2});assert.equal(queued.kind,'queued');assert.deepEqual(queued.members.map(m=>[m.character_id,m.status,m.cost]),[[follower,'waiting',8],[actor,'queued',5]]);assert.equal((await balances(o)).every(c=>c.mp===100),true);
 const before=await o`SELECT character_id,departure_request_id FROM g4a6.combat2_party_departure_member ORDER BY movement_order`;
 checkResult(await moving(o,{party:true,t:2}));await checkSpent(o);assert.deepEqual(await o`SELECT character_id,departure_request_id FROM g4a6.combat2_party_departure_member ORDER BY movement_order`,before);
 checkResult(await moving(o,{party:true,t:2}),{kind:'already_moved'});await checkSpent(o);
});
test('corrected exact replay and UUID conflict retain authoritative response/refusal contracts',options,async()=>{
 const {o}=await setup({corrected:true});await weightedParty(o);checkResult(await moving(o,{party:true}));const before=await current(o),b=await balances(o);
 checkResult(await moving(o,{party:true,t:240}),{kind:'already_moved'});assert.deepEqual(await current(o),before);assert.deepEqual(await balances(o),b);
 assert.equal((await moving(o,{party:true,to:node,t:240})).kind,'request_id_conflict');assert.deepEqual(await balances(o),b);assert.deepEqual(await current(o),before);
});
test('insufficient MP matches original use_column and corrected error refusal/rollback',options,async()=>{
 let original;
 for(const corrected of [false,true]){const {o}=await setup({corrected,mode:corrected?'error':'use_column'});await weightedParty(o);await o`UPDATE g4a6.characters SET mp=0 WHERE id=${follower}`;const hp=await current(o),b=await balances(o),r=await moving(o,{party:true});assert.equal(r.kind,'insufficient_resource');if(!corrected)original=r;else assert.deepEqual(r,original);assert.deepEqual(await current(o),hp);assert.deepEqual(await balances(o),b);assert.equal((await o`SELECT count(*)::int n FROM g4a6.combat2_party_departure_request`)[0].n,0);}
});
test('complete successful JSON shape equals original use_column under corrected error',options,async()=>{
 const x=await setup({mode:'use_column'});await weightedParty(x.o);const expected=await moving(x.o,{party:true});
 const y=await setup({corrected:true});await weightedParty(y.o);const actual=await moving(y.o,{party:true});assert.deepEqual(actual,expected);await checkSpent(y.o);
});
test('independent corrected movement versus regeneration preserves HP and explicit coverage retry',options,async()=>{
 const x=await setup({corrected:true});await weightedParty(x.o);
 await race(x,async c=>checkResult(await moving(c,{party:true})),c=>regen(c),async r=>{assert.equal(r.error?.code,'40001');});await regen(x.b);assert.equal((await current(x.o)).hp,45);await checkSpent(x.o);
});
test('independent unchanged F6 mutation serializes corrected movement/frozen mover selection',options,async()=>{
 const x=await setup({corrected:true});await weightedParty(x.o);
 await race(x,async c=>assert.equal((await mutate(c)).kind,'not_following'),c=>moving(c,{party:true}),async r=>{assert.equal(r.error?.code,'40001');});
 const r=await moving(x.b,{party:true});assert.equal(r.ok,true);assert.deepEqual(r.members.map(m=>m.character_id),[actor]);assert.equal((await balances(x.o)).find(c=>c.id===follower).mp,100);
});
test('independent corrected coordinated departure fences old Combat2 claim/commit',options,async()=>{
 const x=await setup({corrected:true});await weightedParty(x.o);await entry(x.o,0);const cl=await claim(x.o,1),p=await proposal(x.o,1);
 await race(x,c=>moving(c,{party:true,t:2}),c=>commit(c,cl,p,3),async r=>{assert.ifError(r.error);assert.equal(r.value.ok,false);assert.equal((await current(x.o)).hp,40);assert.equal((await state(x.o)).runtime_hp,40);});await checkSpent(x.o);
});
