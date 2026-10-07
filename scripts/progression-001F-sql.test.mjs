/** Disposable embedded PostgreSQL; command control stays false, including behavior tests.
 * Owner-only primitives/validator are exercised directly; public service commands remain paused.
 * PGlite lacks pgcrypto: a SHA256-based fixture HMAC is checked against independent Node crypto.
 * Only the extension-availability guard uses a fixture substitute; production function bodies are exact.
 */
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHmac} from 'node:crypto';
import {read,definition,dependencies,payload as ePayload} from './prepare-progression-001E.mjs';
import {payload,command,validation} from './prepare-progression-001F.mjs';
const {PGlite}=await import(pathToFileURL(resolve(process.argv[2])).href);
let db,n=1;const uid=()=>`00000000-0000-4000-8000-${String(n++).padStart(12,'0')}`;
const actor='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',node='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const stats=['str','dex','con','int','wis','cha'],zero=Object.fromEntries(stats.map(k=>[k,0]));
const key=Buffer.alloc(32,0x42);
const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
const row=async id=>(await q('SELECT * FROM characters WHERE id=$1',[id]))[0];
const state=async id=>(await q('SELECT * FROM progression_character_state WHERE character_id=$1',[id]))[0];
const count=async id=>(await q('SELECT count(*)::int n FROM progression_receipt WHERE character_id=$1',[id]))[0].n;
const normalized=(op,v,stat)=>({...{operation:op,actorId:actor,expectedVersion:v,contractVersion:1,rulesVersion:1},...(op==='renown'?{stat}:{})});
const f=async(id,op='respec',stat=null,v=0,event=uid(),owner=actor,req=normalized(op,v,stat))=>
 (await q('SELECT progression_apply_f_internal($1,$2,$3,$4,$5,$6,$7) r',[id,owner,event,v,op,stat,req]))[0].r;
const publicCommand=async(id,op='respec',stat=null,v=0,event=uid())=>(await q('SELECT progression_command($1,$2,$3,$4,$5,NULL,NULL,$6) r',[id,actor,event,v,op,stat]))[0].r;
const validate=async(id,op='respec',v=0)=>(await q('SELECT progression_validate_fresh_internal($1,$2,$3) r',[id,v,op]))[0].r;
async function character(fields={}){
 const id=uid();await q('INSERT INTO characters(id,user_id,current_node_id,level,bhp,rp_total_earned,hp) VALUES($1,$2,$3,30,100000,100000,3)',[id,actor,node]);
 for(const [k,value]of Object.entries(fields))await q(`UPDATE characters SET "${k}"=$1 WHERE id=$2`,[value,id]);
 await q('SELECT character_sync_derived_internal($1,false,true)',[id]);return id;
}
async function allocate(id,deltas={str:1},v=0,event=uid()){
 return (await q('SELECT progression_apply_permanent_delta_internal($1,$2,$3,$4,$5,$6) r',
 [id,event,'discretionary_allocation',v,deltas,{actorId:actor,command:'allocate'}]))[0].r;
}
function independentRoll(id,event,stat,v=0,rank=0){
 for(let draw=0;draw<128;draw++){
  const fields=['wov.renown.v1',id,event,stat,String(v),String(rank),String(draw)];
  const parts=fields.flatMap(s=>{const b=Buffer.from(s);const size=Buffer.alloc(4);size.writeUInt32BE(b.length);return[size,b];});
  const x=createHmac('sha256',key).update(Buffer.concat(parts)).digest().readUInt32BE();
  if(x<4294967200)return {roll:x%100,drawIndex:draw};
 }throw Error('exhausted');
}
function eventFor(id,stat,success,rank=0,v=0){for(let i=0;i<10000;i++){const event=uid(),r=independentRoll(id,event,stat,v,rank);if((r.roll<Math.max(5,95-10*rank))===success)return event;}throw Error('fixture event search');}
const hmacFixture=`CREATE SCHEMA extensions;
CREATE FUNCTION extensions.gen_random_bytes(integer) RETURNS bytea LANGUAGE sql AS $$ SELECT decode(repeat('42',$1),'hex') $$;
CREATE FUNCTION extensions.hmac(message bytea,secret bytea,algorithm text) RETURNS bytea LANGUAGE plpgsql AS $$
DECLARE k bytea:=secret; padded bytea; inner_pad bytea; outer_pad bytea; i integer;
BEGIN
 IF algorithm<>'sha256' THEN RAISE EXCEPTION 'fixture supports sha256 only'; END IF;
 IF octet_length(k)>64 THEN k:=sha256(k); END IF;
 padded:=k||decode(repeat('00',64-octet_length(k)),'hex');inner_pad:=padded;outer_pad:=padded;
 FOR i IN 0..63 LOOP inner_pad:=set_byte(inner_pad,i,get_byte(padded,i)#54);outer_pad:=set_byte(outer_pad,i,get_byte(padded,i)#92);END LOOP;
 RETURN sha256(outer_pad||sha256(inner_pad||message));
END $$;`;
before(async()=>{
 db=new PGlite();
 await db.exec(read('scripts/progression-001C-sql.test.mjs').match(/const fixture=`([\s\S]*?)`;/)[1]);
 await db.exec(read('scripts/progression-001E-sql.test.mjs').match(/const extra=`([\s\S]*?)`;/)[1]);
 await db.exec('CREATE ROLE custom_child;GRANT custom_default TO custom_child;');
 await db.exec('ALTER TABLE characters ADD rp_total_earned integer NOT NULL DEFAULT 0;');
 for(const [k,d] of Object.entries({classless:zero,wizard:{int:1,wis:1},warrior:{str:1,dex:1}}))await q('INSERT INTO classes(class_key,base_hp,level_bonuses) VALUES($1,$2,$3)',[k,k==='warrior'?24:18,d]);
 await q('INSERT INTO nodes VALUES($1,true,$2)',[node,'wizard']);
 await db.exec(read('docs/operations/progression-001C-authority.sql'));
 for(const [name,,sql]of dependencies.slice(5))await db.exec(definition(sql,name).sql);
 await db.exec(definition(read('supabase/migrations/20260629080249_d6091f9a-cb36-4b1f-9beb-4966956f5e93.sql'),'restrict_party_leader_updates').sql);
 await db.exec(definition(read('supabase/migrations/20261001130000_combat2_character_persistent_stances.sql'),'combat2_refuse_invalid_stance_class_change').sql);
 await db.exec(ePayload());await db.exec(hmacFixture);
 const pre=await character({str:44,bhp_trained:{str:3}}),before=await row(pre);
 const sql=payload().replace(/IF NOT EXISTS\(SELECT 1 FROM pg_extension WHERE extname='pgcrypto'[^\n]*\)\n OR /,'IF ');
 assert.notEqual(sql,payload(),'only extension catalog guard substituted');
 for(const [drift,reason] of [
  ['ALTER FUNCTION progression_snapshot_internal(uuid) SECURITY INVOKER','dependency drift'],
  ["CREATE FUNCTION progression_command(uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$",'command/control drift'],
  ['GRANT SELECT(version) ON progression_character_state TO custom_default','sidecar containment drift'],
  ['DROP TRIGGER progression_refuse_raw_progression_write ON characters','raw fence trigger drift'],
  ["ALTER TABLE progression_receipt DROP CONSTRAINT progression_receipt_operation_check;ALTER TABLE progression_receipt ADD CONSTRAINT progression_receipt_operation_check CHECK(operation IN('xp','permanent','order','other'))",'receipt constraint drift'],
  ['GRANT service_role TO custom_child','final ACL drift'],
 ]){
  await db.exec('BEGIN');try{await db.exec(drift);await assert.rejects(db.exec(sql),new RegExp(reason));}finally{await db.exec('ROLLBACK');}
  assert.equal((await q('SELECT enabled FROM progression_command_control'))[0].enabled,false);
 }
 await db.exec('BEGIN');try{await assert.rejects(db.exec(payload()),/pgcrypto dependency missing/);}finally{await db.exec('ROLLBACK');}
 await db.exec('BEGIN');await db.exec(sql);await db.exec('COMMIT');
 assert.deepEqual(await row(pre),before);assert.equal(await state(pre),undefined);
 // Historical Order behavior fixture: original E body, only public pause gate omitted, owner-only.
 const eCommand=definition(read('scripts/progression-001E-commands.sql'),'progression_command').sql;
 const pause=" IF NOT (SELECT enabled FROM public.progression_command_control WHERE singleton)\n THEN RETURN jsonb_build_object('kind','refused','reason','commands_paused'); END IF;";
 assert.equal(eCommand.split(pause).length,2);
 await db.exec(eCommand.replace('public.progression_command(','public.test_order_owner_only(').replace(pause,'')+
  'REVOKE ALL ON FUNCTION public.test_order_owner_only(uuid,uuid,uuid,numeric,text,jsonb,text) FROM PUBLIC,anon,authenticated,service_role,custom_default;');
});
after(async()=>{if(db){assert.equal((await q('SELECT enabled FROM progression_command_control'))[0].enabled,false);await db.close();}});
test('01 installation preserves opaque history; all public commands remain paused',async()=>{
 const id=await character();for(const op of ['respec','renown'])assert.equal((await publicCommand(id,op,op==='renown'?'str':null)).reason,'commands_paused');
 assert.equal(await state(id),undefined);assert.equal(await count(id),0);
});
test('02 exact six-stat refund preserves opaque stats, historical Renown and lifetime RP',async()=>{
 const id=await character({unspent_stat_points:20,respec_points:2,str:44,bhp_trained:{str:3,dex:2}});
 await allocate(id,{str:1,dex:2,con:3,int:4,wis:2,cha:1});const before=await row(id),opaque=(await state(id)).opaque_baseline;
 const r=await f(id,'respec',null,1);assert.equal(r.kind,'committed');assert.equal(r.receipt.totalRefund,13);
 const after=await row(id);for(const [k,n]of Object.entries({str:1,dex:2,con:3,int:4,wis:2,cha:1}))assert.equal(after[k],before[k]-n);
 assert.deepEqual(after.bhp_trained,before.bhp_trained);assert.equal(after.bhp,before.bhp);assert.equal(after.rp_total_earned,before.rp_total_earned);
 assert.equal(after.unspent_stat_points,20);assert.equal(after.respec_points,1);assert.equal((await state(id)).version,2);
 assert.deepEqual((await state(id)).opaque_baseline,opaque);assert.deepEqual(r.receipt.refundableInvestmentAfter,zero);assert.equal(await count(id),2);
});
test('03 empty refund needs no token and creates no state or receipt',async()=>{
 for(const tokens of [0,2]){const id=await character({respec_points:tokens}),pre=await row(id);assert.equal((await f(id)).reason,'empty_refund');assert.deepEqual(await row(id),pre);assert.equal(await state(id),undefined);assert.equal(await count(id),0);}
});
test('04 nonempty refund requires exactly one token',async()=>{
 const id=await character({unspent_stat_points:1});await allocate(id);assert.equal((await f(id,'respec',null,1)).reason,'insufficient_respec_token');
 assert.equal((await state(id)).version,1);assert.equal(await count(id),1);
});
test('05 pool cap refuses without clipping or mutation',async()=>{
 const id=await character({level:2,unspent_stat_points:200,respec_points:1});await allocate(id,{str:5});
 await q('SELECT progression_apply_xp_internal($1,$2,$3,$4,$5)',[id,uid(),'admin_xp',1450,{actorId:actor,reason:'fixture L5 adds three points'}]);
 const pre=await row(id);assert.equal(pre.unspent_stat_points,198);assert.equal((await f(id,'respec',null,2)).reason,'pool_cap');assert.deepEqual(await row(id),pre);
});
test('06 counter/stat and latest receipt contradictions refuse; no reanchor',async()=>{
 const id=await character({unspent_stat_points:1,respec_points:1});await allocate(id);await q('UPDATE characters SET str=str+1 WHERE id=$1',[id]);
 assert.equal((await f(id,'respec',null,1)).reason,'inconsistent_provenance');assert.equal((await state(id)).version,1);
});
test('07 investment counter contradiction refuses',async()=>{
 const id=await character({unspent_stat_points:1,respec_points:1});await allocate(id);await q('UPDATE progression_character_state SET str_invested=2 WHERE character_id=$1',[id]);
 assert.equal((await f(id,'respec',null,1)).reason,'inconsistent_provenance');
});
test('08 replay exactly once before fresh death/location/version/eligibility',async()=>{
 const id=await character({unspent_stat_points:1,respec_points:1});await allocate(id);const event=uid();const r=await f(id,'respec',null,1,event);
 await q('UPDATE characters SET hp=0,current_node_id=NULL WHERE id=$1',[id]);const again=await f(id,'respec',null,1,event);
 assert.equal(again.kind,'replayed');assert.deepEqual(again.original,r.receipt);assert.equal((await state(id)).version,2);assert.equal(await count(id),2);
 const publicReplay=await publicCommand(id,'respec',null,1,event);assert.equal(publicReplay.kind,'replayed');assert.deepEqual(publicReplay.original,r.receipt);
});
test('09 cross-command UUID collision and changed payload refuse',async()=>{
 const id=await character({unspent_stat_points:1,respec_points:1}),event=uid();await allocate(id,{str:1},0,event);
 assert.equal((await f(id,'respec',null,1,event)).reason,'request_conflict');
 const next=uid();await f(id,'respec',null,1,next);assert.equal((await f(id,'respec',null,0,next)).reason,'request_conflict');
});
test('10 node/trainer/dead/level eligibility',async()=>{
 const id=await character({level:29});assert.equal((await f(id,'renown','str')).reason,'renown_level_required');
 await q('UPDATE characters SET level=30,current_node_id=NULL WHERE id=$1',[id]);assert.equal((await f(id,'renown','str')).reason,'not_at_trainer');
 await q('UPDATE characters SET current_node_id=$1,hp=0 WHERE id=$2',[node,id]);assert.equal((await f(id,'renown','str')).reason,'dead');
});
test('11 stance, pending stance, intent, departure, movement refuse',async()=>{
 for(const sql of ['INSERT INTO character_stance VALUES($1)',"INSERT INTO character_stance_request VALUES($1,'11111111-1111-4111-8111-111111111111',NULL)","INSERT INTO node_intent VALUES($1,'pending')","INSERT INTO combat2_departure_request VALUES($1,'queued')","UPDATE characters SET movement_locked_until=now()+interval '1 hour' WHERE id=$1"]){
  const id=await character();await q(sql,[id]);assert.equal((await f(id,'renown','str')).reason,'unsafe_lifecycle');assert.equal(await state(id),undefined);
 }
});
test('12 active claim/engaged combat refuse',async()=>{
 const id=await character(),encounter=uid();await q("INSERT INTO node_encounter VALUES($1,$2,'active',$3,now()+interval '1 hour')",[encounter,node,uid()]);
 await q('INSERT INTO node_fighter VALUES($1,$2,true)',[id,encounter]);assert.equal((await f(id,'renown','str')).reason,'active_combat');
});
test('13 insufficient RP changes nothing',async()=>{
 const id=await character({bhp:9}),pre=await row(id);assert.equal((await f(id,'renown','str')).reason,'insufficient_rp');assert.deepEqual(await row(id),pre);assert.equal(await state(id),undefined);
});
test('14 six independent ranks and exact success economics',async()=>{
 for(const stat of stats){const ranks={str:2,dex:3,con:4,int:5,wis:6,cha:7},id=await character({bhp_trained:ranks});
  const before=await row(id),event=eventFor(id,stat,true,ranks[stat]);const r=await f(id,'renown',stat,0,event),after=await row(id);
  assert.equal(r.kind,'committed');assert.equal(r.receipt.cost,10*(ranks[stat]+1));assert.equal(r.receipt.chance,Math.max(5,95-10*ranks[stat]));
  assert.equal(r.receipt.roll,independentRoll(id,event,stat,0,ranks[stat]).roll);assert.equal(r.receipt.outcome,'success');
  for(const k of stats){assert.equal(after[k],before[k]+(k===stat?1:0));assert.equal(after.bhp_trained[k],ranks[k]+(k===stat?1:0));}
  assert.equal(after.rp_total_earned,before.rp_total_earned);assert.deepEqual(r.receipt.refundableInvestmentAfter,zero);assert.equal(await count(id),1);
 }
});
test('15 failure spends RP, preserves stats/ranks/investment/resources and lifetime',async()=>{
 const id=await character({unspent_stat_points:1});await allocate(id);const pre=await row(id),event=eventFor(id,'con',false,0,1);
 const r=await f(id,'renown','con',1,event),after=await row(id);assert.equal(r.receipt.outcome,'failure');assert.equal(after.bhp,pre.bhp-10);
 for(const k of [...stats,'hp','cp','mp','max_hp','max_cp','max_mp','rp_total_earned'])assert.equal(after[k],pre[k]);
 assert.deepEqual(after.bhp_trained,pre.bhp_trained);assert.equal((await state(id)).str_invested,1);assert.equal(await count(id),2);
});
test('16 canonical Renown remains nonrefundable after respec',async()=>{
 const id=await character({unspent_stat_points:1,respec_points:1});await allocate(id);const event=eventFor(id,'str',true,0,1);await f(id,'renown','str',1,event);
 assert.equal((await f(id,'respec',null,2)).kind,'committed');assert.equal((await row(id)).str,11);assert.equal((await row(id)).bhp_trained.str,1);
});
test('17 five-percent floor and no gameplay rank cap',async()=>{
 const id=await character({bhp_trained:{str:1000}}),event=eventFor(id,'str',false,1000);
 const r=await f(id,'renown','str',0,event);assert.equal(r.receipt.cost,10010);assert.equal(r.receipt.chance,5);
});
test('18 malformed rank JSON refuses without baseline',async()=>{
 for(const ranks of [null,[],{str:-1},{str:0.5},{str:'1'},{strength:1},{str:2147483648}]){
  const id=await character();if(ranks===null)await q("UPDATE characters SET bhp_trained='null'::jsonb WHERE id=$1",[id]);else await q('UPDATE characters SET bhp_trained=$1 WHERE id=$2',[ranks,id]);
  assert.equal((await f(id,'renown','str')).reason,'inconsistent_provenance');assert.equal(await state(id),undefined);
 }
});
test('19 arithmetic/storage overflow refuses without rank cap policy',async()=>{
 const id=await character({bhp_trained:{str:2147483647}});assert.equal((await f(id,'renown','str')).reason,'arithmetic_overflow');
 const max=await character({str:2147483647});assert.equal((await f(max,'renown','str')).reason,'arithmetic_overflow');
});
test('20 rollback after receipt failure preserves key, deterministic retry and state',async()=>{
 const id=await character(),event=eventFor(id,'str',true),pre=await row(id);
 await db.exec("CREATE FUNCTION f_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture late failure'; END $$;CREATE TRIGGER f_fail BEFORE INSERT ON progression_receipt FOR EACH ROW EXECUTE FUNCTION f_fail();");
 try{await assert.rejects(f(id,'renown','str',0,event));assert.deepEqual(await row(id),pre);assert.equal(await state(id),undefined);}
 finally{await db.exec('DROP TRIGGER f_fail ON progression_receipt;DROP FUNCTION f_fail()');}
 const r=await f(id,'renown','str',0,event);assert.equal(r.receipt.roll,independentRoll(id,event,'str').roll);
 const replay=await f(id,'renown','str',0,event);assert.deepEqual(replay.original,r.receipt);assert.equal(await count(id),1);
});
test('21 resource clamp only; no heal/refill; gear retained',async()=>{
 const id=await character({unspent_stat_points:20,respec_points:1});await allocate(id,{con:10,int:5,wis:5});
 await q('UPDATE characters SET hp=max_hp,cp=max_cp,mp=max_mp WHERE id=$1',[id]);const pre=await row(id);
 await q('INSERT INTO character_inventory(character_id) VALUES($1)',[id]);const r=await f(id,'respec',null,1),after=await row(id);
 assert.equal(r.kind,'committed');for(const k of ['hp','cp','mp']){assert.ok(after[k]<=pre[k]);assert.ok(after[k]<=after['max_'+k]);}
 assert.equal((await q('SELECT * FROM character_inventory WHERE character_id=$1',[id])).length,1);
});
test('22 raised maxima do not refill living resources',async()=>{
 const id=await character({con:11}),pre=await row(id);const event=eventFor(id,'con',true);await f(id,'renown','con',0,event);const after=await row(id);
 assert.ok(after.max_hp>pre.max_hp);assert.equal(after.hp,pre.hp);assert.equal(after.cp,pre.cp);assert.equal(after.mp,pre.mp);
});
test('23 unrelated resource anomaly refuses instead of repairing failure',async()=>{
 const id=await character();await q('UPDATE characters SET cp=max_cp+1 WHERE id=$1',[id]);const pre=await row(id);
 assert.equal((await f(id,'renown','str')).reason,'invalid_state');assert.deepEqual(await row(id),pre);
});
test('24 rank/RP/lifetime continuity contradiction refuses',async()=>{
 for(const sql of ["UPDATE characters SET bhp=bhp+1 WHERE id=$1","UPDATE characters SET bhp_trained='{\"str\":9}' WHERE id=$1","UPDATE characters SET rp_total_earned=rp_total_earned+1 WHERE id=$1"]){
  const id=await character();await f(id,'renown','str',0,eventFor(id,'str',true));await q(sql,[id]);assert.equal((await f(id,'renown','str',1)).reason,'inconsistent_provenance');
 }
});
test('25 wrong owner is refused and server XP UUIDs are not user collisions',async()=>{
 const id=await character(),other=uid();await assert.rejects(f(id,'renown','str',0,uid(),other,{...normalized('renown',0,'str'),actorId:other}));
 const event=uid();await q('SELECT progression_apply_xp_internal($1,$2,$3,$4,$5)',[id,event,'admin_xp',1,{actorId:actor,reason:'fixture'}]);
 assert.equal((await f(id,'renown','str',1,event)).kind,'committed');
});
test('26 key and private/legacy ACLs, service-only entry, inherited defaults contained',async()=>{
 for(const role of ['anon','authenticated','service_role','custom_default','custom_child']){
  for(const name of ['progression_apply_f_internal','progression_renown_draw_internal','progression_validate_fresh_internal','train_renown_stat']){
   assert.equal((await q('SELECT has_function_privilege($1,oid,\'EXECUTE\') ok FROM pg_proc WHERE pronamespace=\'public\'::regnamespace AND proname=$2',[role,name]))[0].ok,false);
  }
  assert.equal((await q("SELECT has_table_privilege($1,'progression_renown_key','SELECT') ok",[role]))[0].ok,false);
 }
 assert.equal((await q("SELECT relrowsecurity secure FROM pg_class WHERE oid='progression_renown_key'::regclass"))[0].secure,true);
 assert.equal((await q("SELECT count(*)::int n FROM pg_policy WHERE polrelid='progression_renown_key'::regclass"))[0].n,0);
 for(const role of ['anon','authenticated'])assert.equal((await q("SELECT has_function_privilege($1,'progression_command(uuid,uuid,uuid,numeric,text,jsonb,text,text)','EXECUTE') ok",[role]))[0].ok,false);
});
test('27 raw service Renown writes and key reads fail',async()=>{
 const id=await character();await db.exec('SET ROLE service_role');
 try{for(const col of ['bhp','bhp_trained','rp_total_earned'])await assert.rejects(q(`UPDATE characters SET ${col}=${col} WHERE id=$1`,[id]));await assert.rejects(q('SELECT * FROM progression_renown_key'));}
 finally{await db.exec('RESET ROLE');}
 // Fence remains a defense when a future owner mistakenly grants a column.
 await db.exec('GRANT UPDATE(bhp) ON characters TO service_role');await db.exec('SET ROLE service_role');
 try{await assert.rejects(q('UPDATE characters SET bhp=bhp+1 WHERE id=$1',[id]),/progression_raw_override/);}
 finally{await db.exec('RESET ROLE;REVOKE UPDATE(bhp) ON characters FROM service_role');}
});
test('28 no secret in projections or receipts; persisted algorithm/key/draw metadata',async()=>{
 const id=await character(),r=await f(id,'renown','str');const json=JSON.stringify(r);
 assert.ok(!json.includes(key.toString('hex')));assert.ok(!json.includes('key_material'));assert.equal(r.receipt.keyVersion,1);assert.ok(r.receipt.algorithm.includes('hmac-sha256'));
});
test('29 literal HMAC parity, rejection sampling bounds, canonical byte encoding',async()=>{
 const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',event='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 for(const [stat,v,rank,golden]of [['str',0,0,34],['dex',123,9,89],['cha',9007199254740991,2147483647,22]]){
  const actual=(await q('SELECT progression_renown_draw_internal($1,$2,$3,$4,$5) r',[id,event,stat,v,rank]))[0].r;
  assert.deepEqual({roll:actual.roll,drawIndex:actual.drawIndex},independentRoll(id,event,stat,v,rank));
  assert.equal(actual.roll,golden);assert.equal(actual.drawIndex,0);
 }
 assert.match(read('scripts/progression-001F-authority.sql'),/FOR draw_i IN 0\.\.127/);assert.match(read('scripts/progression-001F-authority.sql'),/x<4294967200/);
});
test('30 lock choreography, one node lock, actual changed-location refusal, equipment writer assumptions',async()=>{
 const body=command();assert.ok(body.indexOf('pg_advisory_xact_lock')<body.indexOf('FOR UPDATE'));
 assert.equal(body.match(/pg_advisory_xact_lock/g).length,1);assert.ok(body.indexOf('location_changed')<body.indexOf('commands_paused'));
 assert.ok(body.indexOf("kind','replayed")<body.indexOf('commands_paused'));
 assert.match(read('supabase/migrations/20260908213420_bbfa1b05-0000-4dbf-b662-1ab7e37699c9.sql'),/characters WHERE id = _character_id FOR UPDATE/);
 assert.doesNotMatch(definition(read('supabase/migrations/20260306183611_f46928aa-9718-4a27-ab2f-132be32b6837.sql'),'degrade_party_member_equipment').body,/FOR UPDATE/);
 const id=await character(),pre=await row(id);
 const anchor=' SELECT * INTO c FROM public.characters WHERE id=_character FOR UPDATE;';assert.equal(body.split(anchor).length,2);
 const injected=body.replace(anchor,' UPDATE public.characters SET current_node_id=NULL WHERE id=_character;\n'+anchor);
 await db.exec('BEGIN');
 try{await db.exec(injected);assert.equal((await publicCommand(id)).reason,'location_changed');assert.equal(await state(id),undefined);assert.equal(await count(id),0);}
 finally{await db.exec('ROLLBACK');}
 assert.deepEqual(await row(id),pre);assert.equal((await q('SELECT enabled FROM progression_command_control'))[0].enabled,false);
});
test('31 canonical class growth, historical switched-class state and permanent reward are not refunded',async()=>{
 const id=await character({level:29,str:44,int:16,unspent_stat_points:6,respec_points:1});
 await q('SELECT progression_apply_xp_internal($1,$2,$3,$4,$5)',[id,uid(),'admin_xp',42050,{actorId:actor,reason:'fixture L30'}]);
 const growth=await q('SELECT * FROM progression_class_growth_milestone WHERE character_id=$1',[id]);assert.equal(growth.length,1);
 const reward=(await q('SELECT progression_apply_permanent_delta_internal($1,$2,$3,$4,$5,$6) r',[id,uid(),'permanent_reward',1,{cha:2},{reason:'fixture permanent reward'}]))[0].r;
 assert.equal(reward.kind,'committed');await allocate(id,{str:5},2);const pre=await row(id);
 const result=await f(id,'respec',null,3);assert.equal(result.kind,'committed');const after=await row(id);
 assert.equal(after.str,44);assert.equal(after.int,17);assert.equal(after.cha,12);assert.equal(after.class,pre.class);assert.equal(after.level,30);assert.equal(after.xp,0);
 assert.deepEqual(await q('SELECT * FROM progression_class_growth_milestone WHERE character_id=$1',[id]),growth);
});
test('32 L42 F does not earn XP, levels or milestones',async()=>{
 const id=await character({level:42}),event=eventFor(id,'str',true);await f(id,'renown','str',0,event);
 const after=await row(id);assert.equal(after.level,42);assert.equal(after.xp,0);assert.equal(after.respec_points,0);
 assert.equal((await q('SELECT * FROM progression_respec_milestone WHERE character_id=$1',[id])).length,0);
});
test('33 literal threshold outcomes 94/95 and rank9 rolls4/5',async()=>{
 for(const [rank,roll,outcome]of [[0,94,'success'],[0,95,'failure'],[9,4,'success'],[9,5,'failure']]){
  const id=await character({bhp:rank===9?200:50,bhp_trained:{str:rank}});let event;
  for(let i=0;i<5000;i++){const candidate=uid();if(independentRoll(id,candidate,'str',0,rank).roll===roll){event=candidate;break;}}
  assert.ok(event);const r=await f(id,'renown','str',0,event);assert.equal(r.receipt.outcome,outcome);assert.equal(r.receipt.roll,roll);
  assert.equal((await row(id)).bhp,rank===9?100:40);
 }
});
test('34 forced resource-sync failure rolls back full respec',async()=>{
 const id=await character({unspent_stat_points:1,respec_points:1});await allocate(id,{con:1});const pre=await row(id),s=await state(id);
 await db.exec("CREATE FUNCTION f_sync_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture sync failure'; END $$;CREATE TRIGGER f_sync_fail BEFORE UPDATE OF max_hp ON characters FOR EACH ROW EXECUTE FUNCTION f_sync_fail();");
 try{await assert.rejects(f(id,'respec',null,1));assert.deepEqual(await row(id),pre);assert.deepEqual(await state(id),s);assert.equal(await count(id),1);}
 finally{await db.exec('DROP TRIGGER f_sync_fail ON characters;DROP FUNCTION f_sync_fail()');}
});
test('35 rejection sampling advances deterministically; exhaustion fails closed; replay invokes no HMAC',async()=>{
 const id=await character(),event=uid();const restore=hmacFixture.slice(hmacFixture.indexOf('CREATE FUNCTION extensions.hmac')).replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION');
 try{
  await db.exec(`CREATE OR REPLACE FUNCTION extensions.hmac(message bytea,secret bytea,algorithm text) RETURNS bytea LANGUAGE plpgsql AS $$ BEGIN RETURN decode(CASE WHEN get_byte(message,octet_length(message)-1)=48 THEN 'ffffffff' ELSE '00000004' END||repeat('00',28),'hex');END $$;`);
  const result=await f(id,'renown','str',0,event);assert.equal(result.receipt.drawIndex,1);assert.equal(result.receipt.roll,4);
  await db.exec(`CREATE OR REPLACE FUNCTION extensions.hmac(message bytea,secret bytea,algorithm text) RETURNS bytea LANGUAGE plpgsql AS $$ BEGIN RETURN decode('ffffffff'||repeat('00',28),'hex');END $$;`);
  const replay=await f(id,'renown','str',0,event);assert.deepEqual(replay.original,result.receipt);
  const pre=await row(id);await assert.rejects(f(id,'renown','str',1),/renown_rng_exhausted/);assert.deepEqual(await row(id),pre);assert.equal(await count(id),1);
 }finally{await db.exec(restore);}
});
test('36 competing expected versions serialize; version overflow refuses',async()=>{
 const id=await character();assert.equal((await f(id,'renown','str')).kind,'committed');assert.equal((await f(id,'renown','dex')).reason,'stale_state');
 const max=await character();await q("INSERT INTO progression_character_state(character_id,version,opaque_baseline) VALUES($1,9007199254740991,'{}')",[max]);
 assert.equal((await f(max,'renown','str',9007199254740991)).reason,'arithmetic_overflow');
});
test('37 literal one-stat/six-stat refunds and high opaque no-sidecar empty refusal',async()=>{
 const single=await character({unspent_stat_points:5,respec_points:1});await allocate(single,{str:5});assert.equal((await row(single)).str,15);
 assert.equal((await f(single,'respec',null,1)).receipt.totalRefund,5);assert.equal((await row(single)).str,10);assert.equal((await row(single)).unspent_stat_points,5);
 const six=await character({unspent_stat_points:6,respec_points:1});await allocate(six,Object.fromEntries(stats.map(k=>[k,1])));
 const r=await f(six,'respec',null,1);assert.equal(r.receipt.totalRefund,6);for(const k of stats)assert.equal((await row(six))[k],10);
 const opaque=await character({str:44,respec_points:1});assert.equal((await f(opaque)).reason,'empty_refund');assert.equal((await row(opaque)).str,44);assert.equal(await state(opaque),undefined);
});
test('38 actual retained Order switch, both class-growth installments, then proven F refund',async()=>{
 const id=await character({class:'warrior',level:2,unspent_stat_points:5,respec_points:1});
 await q('SELECT progression_apply_xp_internal($1,$2,$3,$4,$5)',[id,uid(),'admin_xp',200,{actorId:actor,reason:'fixture L3'}]);
 const order=(await q("SELECT test_order_owner_only($1,$2,$3,1,'switch',NULL,'wizard') r",[id,actor,uid()]))[0].r;assert.equal(order.kind,'committed');
 await q('SELECT progression_apply_xp_internal($1,$2,$3,$4,$5)',[id,uid(),'admin_xp',2500,{actorId:actor,reason:'fixture L6'}]);
 const growth=await q('SELECT * FROM progression_class_growth_milestone WHERE character_id=$1 ORDER BY destination_level',[id]);
 assert.deepEqual(growth.map(r=>[r.destination_level,r.class_key]),[[3,'warrior'],[6,'wizard']]);
 await allocate(id,Object.fromEntries(stats.map(k=>[k,1])),3);assert.equal((await f(id,'respec',null,4)).kind,'committed');
 const after=await row(id);assert.equal(after.class,'wizard');assert.deepEqual([after.str,after.dex,after.con,after.int,after.wis,after.cha],[11,11,10,11,11,10]);
 assert.deepEqual(await q('SELECT * FROM progression_class_growth_milestone WHERE character_id=$1 ORDER BY destination_level',[id]),growth);
 assert.equal((await q('SELECT enabled FROM progression_command_control'))[0].enabled,false);
});
test('39 contradictory zero-version/duplicate-version proof refuses without reanchor',async()=>{
 for(const drift of ["UPDATE progression_character_state SET version=0,str_invested=0 WHERE character_id=$1",
  "INSERT INTO progression_receipt SELECT character_id,source,'cccccccc-cccc-4ccc-8ccc-cccccccccccc',operation,request,receipt FROM progression_receipt WHERE character_id=$1"]){
  const id=await character({unspent_stat_points:1});await allocate(id);await q(drift,[id]);const v=(await state(id)).version;
  assert.equal((await f(id,'renown','str',v)).reason,'inconsistent_provenance');
 }
});
