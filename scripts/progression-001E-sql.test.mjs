/** Disposable embedded PostgreSQL only. Full generated payload, frozen dependency bodies and trigger definitions.
 * node scripts/progression-001E-sql.test.mjs ../001C-local-db-tests/node_modules/@electric-sql/pglite/dist/index.js
 * Deterministic interleavings do not constitute true multi-session hosted evidence.
 */
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {read,definition,dependencies,payload,xpDefinition,sha} from './prepare-progression-001E.mjs';
if(!process.argv[2])throw Error('Supply pinned local PGlite 0.3.14 path; no connection strings supported');
const {PGlite}=await import(pathToFileURL(resolve(process.argv[2])).href);
const fixture=read('scripts/progression-001C-sql.test.mjs').match(/const fixture=`([\s\S]*?)`;/)[1];
const extra=`
ALTER TABLE classes ADD is_pre_class boolean DEFAULT false,ADD is_selectable boolean DEFAULT true,ADD status text DEFAULT 'active';
ALTER TABLE characters ADD current_node_id uuid,ADD movement_locked_until timestamptz,ADD portrait_url text;
DROP TRIGGER test_browser_owner_guard ON characters;
CREATE TABLE nodes(id uuid PRIMARY KEY,is_trainer boolean DEFAULT false,class_hall text);
CREATE TABLE character_class_bonds(character_id uuid,class text,bond integer DEFAULT 0,PRIMARY KEY(character_id,class));
ALTER TABLE character_class_bonds ENABLE ROW LEVEL SECURITY;
CREATE POLICY bond_read ON character_class_bonds FOR SELECT USING(true);
CREATE TABLE node_encounter(id uuid PRIMARY KEY,node_id uuid,status text,claim_token uuid,claim_expires_at timestamptz);
CREATE TABLE node_fighter(character_id uuid,encounter_id uuid,present boolean);
CREATE TABLE node_creature(encounter_id uuid,is_alive boolean,engaged boolean,hp integer DEFAULT 10);
CREATE TABLE character_stance(character_id uuid);
CREATE TABLE character_stance_request(character_id uuid,intent_id uuid,committed_at timestamptz);
CREATE TABLE node_intent(character_id uuid,status text);
CREATE TABLE combat2_departure_request(character_id uuid,status text);
CREATE TABLE combat2_party_departure_request(request_id uuid,status text);
CREATE TABLE combat2_party_departure_member(character_id uuid,request_id uuid,status text);
CREATE TABLE combat_sessions(character_id uuid,party_id uuid);
CREATE TABLE party_members(character_id uuid,party_id uuid,status text);
CREATE TABLE character_ability_loadout(character_id uuid,class text,role text);
REVOKE ALL ON characters FROM anon,authenticated,custom_default;
GRANT SELECT ON characters TO authenticated;
GRANT UPDATE(portrait_url) ON characters TO authenticated;
CREATE FUNCTION public.owns_character(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT EXISTS(SELECT 1 FROM characters WHERE id=$1 AND user_id=auth.uid()) $$;
`;
let db,n=1;const uid=()=>`00000000-0000-4000-8000-${String(n++).padStart(12,'0')}`;
const actor='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',node='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const zero={str:0,dex:0,con:0,int:0,wis:0,cha:0};
const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
const row=async id=>(await q('SELECT * FROM characters WHERE id=$1',[id]))[0];
const state=async id=>(await q('SELECT * FROM progression_character_state WHERE character_id=$1',[id]))[0];
async function character(fields={}){
 const id=uid();await q('INSERT INTO characters(id,user_id,current_node_id,unspent_stat_points,hp) VALUES($1,$2,$3,10,3)',[id,actor,node]);
 for(const [key,value]of Object.entries(fields))await q(`UPDATE characters SET "${key}"=$1 WHERE id=$2`,[value,id]);return id;
}
const command=async(id,op='allocate',alloc={str:1},target=null,version=0,event=uid(),owner=actor)=>(await q('SELECT progression_command($1,$2,$3,$4,$5,$6,$7) r',[id,owner,event,version,op,alloc,target]))[0].r;
const xp=async(id,amount,event=uid())=>(await q('SELECT progression_apply_xp_internal($1,$2,$3,$4,$5) r',[id,event,'admin_xp',amount,{actorId:actor,reason:'local test'}]))[0].r;
const growth=async id=>q('SELECT * FROM progression_class_growth_milestone WHERE character_id=$1 ORDER BY destination_level',[id]);
async function role(role,sql,args=[]){await db.exec(`SET ROLE ${role}`);try{return await q(sql,args);}finally{await db.exec('RESET ROLE');}}
before(async()=>{
 db=new PGlite();await db.exec(fixture+extra);
 for(const [key,d] of Object.entries({classless:zero,wizard:{int:1,wis:1},warrior:{str:1,dex:1}}))await q('INSERT INTO classes(class_key,base_hp,level_bonuses) VALUES($1,$2,$3)',[key,key==='warrior'?24:key==='classless'?18:16,d]);
 await q('INSERT INTO nodes VALUES($1,true,$2)',[node,'wizard']);
 await db.exec(read('docs/operations/progression-001C-authority.sql'));
 for(const [name,,sql]of dependencies.slice(5))await db.exec(definition(sql,name).sql);
 await db.exec(definition(read('supabase/migrations/20260629080249_d6091f9a-cb36-4b1f-9beb-4966956f5e93.sql'),'restrict_party_leader_updates').sql);
 await db.exec(definition(read('supabase/migrations/20261001130000_combat2_character_persistent_stances.sql'),'combat2_refuse_invalid_stance_class_change').sql);
 await db.exec('CREATE TRIGGER restrict_party_leader_updates BEFORE UPDATE ON characters FOR EACH ROW EXECUTE FUNCTION restrict_party_leader_updates(); CREATE TRIGGER combat2_refuse_invalid_stance_class_change BEFORE UPDATE OF class ON characters FOR EACH ROW EXECUTE FUNCTION combat2_refuse_invalid_stance_class_change();');
 const existing=await character({level:7,str:44});const pre=await row(existing);
 await db.exec('BEGIN');await db.exec(payload());await db.exec('COMMIT');assert.deepEqual(await row(existing),pre);
 assert.equal((await q('SELECT count(*)::int n FROM progression_character_state'))[0].n,0);
 assert.equal((await q('SELECT count(*)::int n FROM progression_class_growth_milestone'))[0].n,0);
 assert.equal((await command(existing)).reason,'commands_paused');
 await db.exec('UPDATE progression_command_control SET enabled=true');
});
after(async()=>await db?.close());
test('frozen local legacy definitions match supplied hosted H1 full-definition hash abbreviations',async()=>{
 for(const [sig,start,end]of [['join_order(uuid,text)','577d83a2','f6cd369'],['switch_order(uuid,text)','4513b322','5863c1'],['train_renown_stat(uuid,text)','d99eca91','b6f7d'],['award_class_bond(uuid,text,integer)','888f3dcf','5b19d'],['award_class_bond_for_kill(uuid,integer,boolean)','830945cb','a7beb6']]){
  const actual=sha((await q('SELECT pg_get_functiondef($1::regprocedure) d',['public.'+sig]))[0].d);assert.ok(actual.startsWith(start)&&actual.endsWith(end),`${sig}: ${actual}`);
 }
});
test('one stat, multi-stat, repeated allocation; exact lazy opaque boundary and clamp/no refill/no AC',async()=>{
 const id=await character({con:11,int:11,wis:11,dex:11,cha:11,cp:4,mp:7});await q('SELECT character_sync_derived_internal($1,false,true)',[id]);const pre=await row(id);
 let r=await command(id);assert.equal(r.kind,'committed');let s=await state(id);assert.equal(s.str_invested,1);assert.equal(s.version,1);assert.equal(s.opaque_baseline.permanentStats.str,pre.str);
 const opaque=s.opaque_baseline;r=await command(id,'allocate',{con:1,int:1,wis:1,dex:1},null,1);assert.equal(r.kind,'committed');
 const c=await row(id);s=await state(id);assert.equal(c.hp,3);assert.equal(c.cp,4);assert.equal(c.mp,7);assert.equal(c.ac,pre.ac);assert.equal(c.unspent_stat_points,5);assert.equal(s.version,2);assert.deepEqual(s.opaque_baseline,opaque);
 assert.ok(c.max_cp>pre.max_cp);assert.ok(c.max_mp>pre.max_mp);
 assert.deepEqual([c.class,c.xp,c.respec_points],[pre.class,pre.xp,pre.respec_points]);
});
test('invalid allocations and insufficient points never initialize history',async()=>{
 const id=await character({unspent_stat_points:1});for(const d of [null,{str:-1},{str:0},{str:1.5},{str:null},{strength:1},{str:2147483648},[]])assert.equal((await command(id,'allocate',d)).kind,'refused');
 assert.equal((await command(id,'allocate',{str:2})).reason,'insufficient_points');assert.equal(await state(id),undefined);
});
test('replay normalizes payload; conflict and fresh stale request; owner first; replay survives location/config/version changes',async()=>{
 const id=await character(),event=uid();assert.equal((await command(id,'allocate',{str:1},null,0,event)).kind,'committed');
 assert.equal((await command(id,'allocate',{...zero,str:1},null,0,event)).kind,'replayed');
 assert.equal((await command(id,'allocate',{dex:1},null,0,event)).reason,'request_conflict');assert.equal((await command(id)).reason,'stale_state');
 await q('UPDATE characters SET current_node_id=NULL WHERE id=$1',[id]);assert.equal((await command(id,'allocate',{str:1},null,0,event)).kind,'replayed');
 assert.equal((await command(id,'allocate',{str:1},null,0,event,uid())).reason,'unauthorized');assert.equal((await row(id)).unspent_stat_points,9);
});
test('deterministic competing spends serialize through version and only one point is consumed',async()=>{
 const id=await character({unspent_stat_points:1});const results=await Promise.all([command(id),command(id)]);assert.deepEqual(results.map(r=>r.kind),['committed','refused']);assert.equal(results[1].reason,'stale_state');assert.equal((await row(id)).str,11);
});
test('forced post-mutation receipt failure rolls back character, counters, lazy state, bonds',async()=>{
 await db.exec(`CREATE FUNCTION test_e_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced late failure'; END $$; CREATE TRIGGER test_e_fail BEFORE INSERT ON progression_receipt FOR EACH ROW EXECUTE FUNCTION test_e_fail();`);
 try{for(const op of ['allocate','join']){const id=await character(op==='join'?{class:'classless',is_classless:true}:{}),pre=await row(id);assert.equal((await command(id,op,op==='allocate'?{str:1}:null,op==='join'?'wizard':null)).reason,'invalid_transaction');assert.deepEqual(await row(id),pre);assert.equal(await state(id),undefined);assert.equal((await q('SELECT * FROM character_class_bonds WHERE character_id=$1',[id])).length,0);}}
 finally{await db.exec('DROP TRIGGER test_e_fail ON progression_receipt; DROP FUNCTION test_e_fail()');}
});
test('trainer location, ownership, death, provenance contradictions fail closed',async()=>{
 const id=await character({current_node_id:null});assert.equal((await command(id)).reason,'not_at_trainer');await q('UPDATE characters SET current_node_id=$1,hp=0 WHERE id=$2',[node,id]);assert.equal((await command(id)).reason,'dead');
 const proven=await character();await command(proven);await q('UPDATE characters SET str=5 WHERE id=$1',[proven]);assert.equal((await command(proven,'allocate',{str:1},null,1)).reason,'inconsistent_provenance');
});
test('active stance, pending intent/stance/departure/party movement and arrival timer refuse',async()=>{
 for(const sql of ["INSERT INTO character_stance VALUES($1)","INSERT INTO character_stance_request VALUES($1,'11111111-1111-4111-8111-111111111111',NULL)","INSERT INTO node_intent VALUES($1,'pending')","INSERT INTO combat2_departure_request VALUES($1,'queued')","UPDATE characters SET movement_locked_until=now()+interval '1 hour' WHERE id=$1"]){const id=await character();await q(sql,[id]);assert.equal((await command(id)).reason,'unsafe_lifecycle');}
 const id=await character(),request=uid();await q("INSERT INTO combat2_party_departure_request VALUES($1,'queued')",[request]);await q("INSERT INTO combat2_party_departure_member VALUES($1,$2,'waiting')",[id,request]);assert.equal((await command(id)).reason,'unsafe_lifecycle');
});
test('live claim and engaged creature block; inert historical encounter shell does not',async()=>{
 const id=await character(),e=uid();await q("INSERT INTO node_encounter VALUES($1,$2,'active',NULL,NULL)",[e,node]);await q('INSERT INTO node_fighter VALUES($1,$2,true)',[id,e]);assert.equal((await command(id)).kind,'committed');
 await q('UPDATE node_encounter SET claim_token=$1,claim_expires_at=now()+interval \'1 hour\' WHERE id=$2',[uid(),e]);assert.equal((await command(id,'allocate',{str:1},null,1)).reason,'active_combat');
 await q('UPDATE node_encounter SET claim_token=NULL WHERE id=$1',[e]);await q('INSERT INTO node_creature(encounter_id,is_alive,engaged) VALUES($1,true,true)',[e]);assert.equal((await command(id,'allocate',{str:1},null,1)).reason,'active_combat');
});
test('join/switch preserve stats, pools, equipment/loadout/history and intentionally reset all bonds; clamp-only',async()=>{
 const id=await character({class:'classless',is_classless:true,level:7,str:30,cp:999,mp:999});const pre=await row(id);
 await q("INSERT INTO character_class_bonds VALUES($1,'warrior',12)",[id]);await q("INSERT INTO character_ability_loadout VALUES($1,'warrior','attack')",[id]);await q('INSERT INTO character_inventory(character_id) VALUES($1)',[id]);
 const event=uid();assert.equal((await command(id,'join',null,'wizard',0,event)).kind,'committed');
 let c=await row(id);assert.equal(c.str,30);assert.equal(c.hp,3);assert.equal(c.cp,c.max_cp);assert.equal(c.mp,c.max_mp);assert.equal(c.unspent_stat_points,pre.unspent_stat_points);assert.deepEqual(await growth(id),[]);
 assert.equal((await command(id,'join',null,'wizard',0,event)).kind,'replayed');assert.equal((await command(id,'switch',null,'wizard',1)).reason,'already_in_order');
 assert.equal((await command(id,'join',null,'warrior',1)).reason,'wrong_operation');
 await q("UPDATE nodes SET class_hall='warrior' WHERE id=$1",[node]);assert.equal((await command(id,'switch',null,'warrior',1)).kind,'committed');
 assert.deepEqual(await q('SELECT class,bond FROM character_class_bonds WHERE character_id=$1',[id]),[{class:'warrior',bond:0}]);
 await q("UPDATE nodes SET class_hall='wizard' WHERE id=$1",[node]);assert.equal((await command(id,'switch',null,'wizard',2)).kind,'committed');
 assert.equal((await q('SELECT * FROM character_inventory WHERE character_id=$1',[id])).length,1);assert.equal((await q('SELECT * FROM character_ability_loadout WHERE character_id=$1',[id])).length,1);assert.equal((await q('SELECT * FROM progression_receipt WHERE character_id=$1',[id])).length,3);
});
test('wrong operation/hall, unavailable class flags and active stance refuse Order without mutation',async()=>{
 const id=await character({class:'classless',is_classless:true});assert.equal((await command(id,'switch',null,'wizard')).reason,'wrong_operation');assert.equal((await command(id,'join',null,'warrior')).reason,'wrong_class_hall');
 for(const [column,value]of [['status','inactive'],['is_selectable',false],['is_pre_class',true]]){await q(`UPDATE classes SET ${column}=$1 WHERE class_key='wizard'`,[value]);assert.equal((await command(id,'join',null,'wizard')).reason,'class_unavailable');await q("UPDATE classes SET status='active',is_selectable=true,is_pre_class=false WHERE class_key='wizard'");}
 await q('INSERT INTO character_stance VALUES($1)',[id]);assert.equal((await command(id,'join',null,'wizard')).reason,'unsafe_lifecycle');assert.equal(await state(id),undefined);
});
test('classless 3/6 zero proof, late join then 9 target growth, no retroactive backfill',async()=>{
 const id=await character({class:'classless',is_classless:true});await xp(id,2750);let m=await growth(id);assert.deepEqual(m.map(x=>x.destination_level),[3,6]);assert.deepEqual(m.map(x=>x.applied_deltas),[zero,zero]);
 await command(id,'join',null,'wizard',1);await xp(id,7450);m=await growth(id);assert.equal(m.at(-1).destination_level,9);assert.equal(m.at(-1).class_key,'wizard');assert.equal((await row(id)).int,11);
});
test('Warrior then Wizard future growth; multi-level destinations, replay, config capture/equivalence',async()=>{
 const id=await character({level:2,class:'warrior'});const event=uid();await xp(id,200,event);assert.equal((await xp(id,200,event)).kind,'replayed');
 await command(id,'switch',null,'wizard',1);await xp(id,2500);let m=await growth(id);assert.deepEqual(m.map(x=>x.class_key),['warrior','wizard']);assert.deepEqual([(await row(id)).str,(await row(id)).int],[11,11]);
 const fp=m[1].config_fingerprint;await q("UPDATE classes SET level_bonuses=$1 WHERE class_key='wizard'",[{...zero,wis:1,int:1}]);
 const config=(await q("SELECT progression_class_config_internal('wizard',false) c"))[0].c;assert.equal(config.fingerprint,fp);
 await q("UPDATE classes SET level_bonuses=$1 WHERE class_key='wizard'",[{int:2,wis:1}]);await xp(id,7450);m=await growth(id);assert.equal(m.at(-1).applied_deltas.int,2);assert.notEqual(m.at(-1).config_fingerprint,fp);assert.equal(m[1].applied_deltas.int,1);
 await q("UPDATE classes SET level_bonuses=$1 WHERE class_key='wizard'",[{int:1,wis:1}]);
 const multi=await character();await xp(multi,2147483647);assert.deepEqual((await growth(multi)).map(x=>x.destination_level),Array.from({length:14},(_,i)=>(i+1)*3));assert.equal((await row(multi)).level,42);
});
test('different event re-crossing proven destination rolls back whole XP transaction; invalid config rollback',async()=>{
 const id=await character({level:2});await xp(id,200);await q('UPDATE characters SET level=2,xp=0 WHERE id=$1',[id]);const pre=await row(id),s=await state(id);
 await assert.rejects(xp(id,200),/class_growth_destination_conflict/);assert.deepEqual(await row(id),pre);assert.deepEqual(await state(id),s);assert.equal((await growth(id)).length,1);
 await q("UPDATE classes SET level_bonuses=$1 WHERE class_key='wizard'",[{int:-1}]);const fresh=await character({level:2}),before=await row(fresh);const result=await xp(fresh,200);assert.equal(result.kind,'refused');assert.deepEqual(await row(fresh),before);assert.equal(await state(fresh),undefined);await q("UPDATE classes SET level_bonuses=$1 WHERE class_key='wizard'",[{int:1,wis:1}]);
});
test('prepared cutover denies old Order/bond/Renown, generic primitives, direct browser writes, sidecars, admin service override',async()=>{
 const id=await character();for(const roleName of ['anon','authenticated','service_role','custom_default']){
  for(const sql of ["SELECT join_order($1,'wizard')","SELECT switch_order($1,'warrior')","SELECT award_class_bond($1,'wizard',99)","SELECT award_class_bond_for_kill($1,99,false)","SELECT train_renown_stat($1,'str')","SELECT progression_apply_permanent_delta_internal($1,$1,'permanent_reward',0,'{\"str\":1}','{}')",'SELECT * FROM progression_class_growth_milestone WHERE character_id=$1'])await assert.rejects(role(roleName,sql,[id]),/permission denied/);
 }
 for(const col of ['str','unspent_stat_points','class'])await assert.rejects(role('authenticated',`UPDATE characters SET ${col}=${col} WHERE id=$1`,[id]),/permission denied/);
 await assert.rejects(role('authenticated',"INSERT INTO character_class_bonds VALUES($1,'warrior',99)",[id]),/row-level security/);
 await assert.rejects(role('service_role','UPDATE characters SET str=1 WHERE id=$1',[id]),/paused_until_001G/);
 assert.equal((await role('service_role',"SELECT progression_command($1,$2,$3,0,'allocate','{\"str\":1}',NULL) r",[id,actor,uid()]))[0].r.kind,'committed');
 await assert.rejects(role('authenticated',"SELECT progression_command($1,$2,$3,0,'allocate','{\"str\":1}',NULL)",[id,actor,uid()]),/permission denied/);
});
test('owner-filtered projection neither initializes nor leaks another character; browser JWT fails trusted command',async()=>{
 const id=await character();await db.exec(`SET app.test_uid='${actor}'`);try{assert.equal((await role('authenticated','SELECT progression_command_projection($1) r',[id]))[0].r.kind,'current');assert.equal((await role('authenticated','SELECT progression_command_projection($1) r',[uid()]))[0].r.reason,'unauthorized');assert.equal((await command(id)).reason,'unauthorized');}finally{await db.exec("SET app.test_uid=''");}assert.equal(await state(id),undefined);
});
test('one node lock before character row; deterministic changed-location interleaving refuses without second lock',async()=>{
 const original=read('scripts/progression-001E-commands.sql').match(/CREATE FUNCTION public.progression_command\([\s\S]*?END \$\$;/)[0];assert.equal((original.match(/pg_advisory_xact_lock/g)||[]).length,1);assert.ok(original.indexOf('pg_advisory_xact_lock')<original.indexOf('FOR UPDATE'));assert.ok(original.indexOf('location_changed')>original.indexOf('FOR UPDATE'));
 const id=await character();const injected=original.replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION').replace(' SELECT * INTO c FROM public.characters WHERE id=_character FOR UPDATE;'," UPDATE public.characters SET current_node_id=NULL WHERE id=_character;\n SELECT * INTO c FROM public.characters WHERE id=_character FOR UPDATE;");
 await db.exec('BEGIN');try{await db.exec(injected);assert.equal((await command(id)).reason,'location_changed');assert.equal(await state(id),undefined);}finally{await db.exec('ROLLBACK');}assert.equal((await row(id)).current_node_id,node);
});
test('generator is exact; dependency drift guard rejects; growth schema rejects malformed non-normalized evidence',async()=>{
 assert.equal(read('docs/operations/progression-001E-cutover.sql'),payload());assert.ok(xpDefinition().includes('class_growth_destination_conflict'));
 await db.exec('BEGIN');try{await db.exec("ALTER FUNCTION progression_snapshot_internal(uuid) SECURITY INVOKER");await assert.rejects(db.exec(payload()),/dependency body\/security drift/);}finally{await db.exec('ROLLBACK');}
 const id=await character({level:2});await xp(id,200);
 await assert.rejects(q("UPDATE progression_class_growth_milestone SET applied_deltas='{\"int\":1}' WHERE character_id=$1",[id]),/check constraint/);
 await assert.rejects(q("UPDATE progression_class_growth_milestone SET applied_deltas=$2 WHERE character_id=$1",[id,{...zero,int:1.5}]),/check constraint/);
 await assert.rejects(q("UPDATE progression_class_growth_milestone SET applied_deltas=$2 WHERE character_id=$1",[id,{...zero,int:2,wis:1}]),/class_growth_receipt_conflict/);
 await assert.rejects(q("UPDATE progression_class_growth_milestone SET destination_level=6 WHERE character_id=$1",[id]),/class_growth_receipt_conflict/);
});
test('pre-existing accepted 001C baseline/investment survives new commands and intervening XP exactly',async()=>{
 const id=await character();const event=uid();assert.equal((await q("SELECT progression_apply_permanent_delta_internal($1,$2,'discretionary_allocation',0,$3,'{}') r",[id,event,{str:2}]))[0].r.kind,'committed');const baseline=(await state(id)).opaque_baseline;
 await xp(id,50);assert.equal((await command(id,'allocate',{dex:1},null,2)).kind,'committed');const s=await state(id);assert.equal(s.str_invested,2);assert.equal(s.dex_invested,1);assert.deepEqual(s.opaque_baseline,baseline);assert.equal((await q('SELECT count(*)::int n FROM progression_receipt WHERE character_id=$1',[id]))[0].n,3);
});
test('invalid state/config/counters and active legacy combat fail without creating a new receipt',async()=>{
 for(const fields of [{cp:-1},{mp:-1},{respec_points:-1},{level:43},{is_classless:true},{xp:-1}]){const id=await character(fields);assert.equal((await command(id)).reason,'invalid_state');assert.equal(await state(id),undefined);}
 const id=await character();await command(id);await q('UPDATE progression_character_state SET str_invested=50 WHERE character_id=$1',[id]);assert.equal((await command(id,'allocate',{str:1},null,1)).reason,'inconsistent_provenance');
 const legacy=await character();await q('INSERT INTO combat_sessions(character_id) VALUES($1)',[legacy]);assert.equal((await command(legacy)).reason,'unsafe_lifecycle');
 await q("UPDATE classes SET level_bonuses='{\"int\":-1}' WHERE class_key='wizard'");const invalid=await character();assert.equal((await command(invalid)).reason,'invalid_class_config');assert.equal(await state(invalid),undefined);await q("UPDATE classes SET level_bonuses='{\"int\":1,\"wis\":1}' WHERE class_key='wizard'");
});
test('replay survives paused activation and edited config; every new request still pauses',async()=>{
 const id=await character(),event=uid();await command(id,'allocate',{str:1},null,0,event);
 await db.exec("UPDATE progression_command_control SET enabled=false; UPDATE classes SET level_bonuses='{\"int\":-1}' WHERE class_key='wizard'");
 try{assert.equal((await command(id,'allocate',{str:1},null,0,event)).kind,'replayed');assert.equal((await command(id,'allocate',{dex:1},null,1)).reason,'commands_paused');}
 finally{await db.exec("UPDATE progression_command_control SET enabled=true; UPDATE classes SET level_bonuses='{\"int\":1,\"wis\":1}' WHERE class_key='wizard'");}
});
test('no ordinary trainer/Order writer, generic Edge primitive, full respec or Renown mutation remains connected',()=>{
 const hook=read('src/features/character/hooks/useStatAllocation.ts'),trainer=read('src/features/character/components/TrainerPanel.tsx'),order=read('src/features/character/components/OrderRecruiterDialog.tsx'),edge=read('supabase/functions/progression-command/index.ts');
 assert.doesNotMatch(hook,/\.update\(|sync_character_resources|respec_points\s*:/);assert.doesNotMatch(order,/rpc\(['"](?:join_order|switch_order)/);assert.doesNotMatch(trainer,/train_renown_stat|onFullRespec|updateCharacterLocal/);
 assert.doesNotMatch(edge,/progression_apply_(xp|permanent_delta)_internal|trusted_rpc|actorId/);assert.match(edge,/auth\.getClaims/);assert.deepEqual([...edge.matchAll(/\.rpc\('([^']+)'/g)].map(m=>m[1]),['progression_command']);assert.match(trainer,/Respec is temporarily unavailable/);
});
