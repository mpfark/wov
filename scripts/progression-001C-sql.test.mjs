/** Actual SQL on disposable embedded PostgreSQL; never hosted/network DB access.
 * node scripts/progression-001C-sql.test.mjs /absolute/path/to/@electric-sql/pglite/dist/index.js
 * Pinned test engine: @electric-sql/pglite 0.3.14, installed outside application.
 * Fixture is deliberately minimal, not a production-schema/trigger attestation.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const { build }=createRequire(import.meta.resolve('vite'))('esbuild');
const modulePath=process.argv[2];
if (!modulePath) throw new Error('Supply the local pinned PGlite module path; no connection-string mode exists');
const { PGlite }=await import(pathToFileURL(resolve(modulePath)).href);
const compiled=await build({stdin:{contents:"export * from './src/shared/progression/reference'; export * from './src/shared/progression/golden-vectors';",resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'node'});
const oracle=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
let db;let nextId=1;let installPreserved=false;
const uid=()=>`00000000-0000-4000-8000-${String(nextId++).padStart(12,'0')}`;
const fixture=`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE ROLE custom_default;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $fn$ SELECT nullif(current_setting('app.test_uid',true),'')::uuid $fn$;
GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon,authenticated,service_role,custom_default;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role,custom_default;
CREATE TABLE classes(class_key text PRIMARY KEY,base_hp integer NOT NULL,level_bonuses jsonb NOT NULL);
CREATE TABLE characters(id uuid PRIMARY KEY,user_id uuid NOT NULL,level integer NOT NULL DEFAULT 1 CHECK(level BETWEEN 1 AND 100),xp integer NOT NULL DEFAULT 0,
 class text NOT NULL DEFAULT 'wizard' REFERENCES classes(class_key),is_classless boolean NOT NULL DEFAULT false,
 str integer NOT NULL DEFAULT 10,dex integer NOT NULL DEFAULT 10,con integer NOT NULL DEFAULT 10,int integer NOT NULL DEFAULT 10,wis integer NOT NULL DEFAULT 10,cha integer NOT NULL DEFAULT 10,
 unspent_stat_points integer NOT NULL DEFAULT 0 CHECK(unspent_stat_points BETWEEN 0 AND 200),respec_points integer NOT NULL DEFAULT 0,
 bhp integer NOT NULL DEFAULT 0,bhp_trained jsonb NOT NULL DEFAULT '{}',hp integer NOT NULL DEFAULT 1 CHECK(hp>=0),
 cp integer NOT NULL DEFAULT 5,mp integer NOT NULL DEFAULT 7,max_hp integer NOT NULL DEFAULT 20 CHECK(max_hp>=1),max_cp integer NOT NULL DEFAULT 100,max_mp integer NOT NULL DEFAULT 100,ac integer NOT NULL DEFAULT 10 CHECK(ac BETWEEN 0 AND 50));
CREATE TABLE items(id uuid PRIMARY KEY,stats jsonb NOT NULL);
CREATE TABLE character_inventory(character_id uuid,item_id uuid REFERENCES items(id),equipped_slot text,current_durability integer,stat_override jsonb,applied_gems jsonb NOT NULL DEFAULT '{}');
CREATE FUNCTION test_browser_owner_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$ BEGIN
 IF auth.uid()=NEW.user_id THEN NEW.level:=OLD.level;NEW.xp:=OLD.xp; END IF; RETURN NEW; END $fn$;
CREATE TRIGGER test_browser_owner_guard BEFORE UPDATE ON characters FOR EACH ROW EXECUTE FUNCTION test_browser_owner_guard();
`;
before(async()=>{
 db=new PGlite(); await db.exec(fixture);
 for(const [key,bonuses] of Object.entries(oracle.ORDER_GROWTH_FIXTURE)) {
  await db.query('INSERT INTO classes VALUES($1,$2,$3)',[key,key==='warrior'?24:key==='classless'?18:16,bonuses]);
 }
 await db.exec("INSERT INTO characters(id,user_id,level,xp,hp,max_hp,str) VALUES('ffffffff-ffff-4fff-8fff-fffffffffff1','ffffffff-ffff-4fff-8fff-fffffffffff2',100,99,33,20,47)");
 await db.exec('BEGIN');
 const beforeInstall=await db.query('SELECT to_jsonb(characters) value FROM characters');
 await db.exec(readFileSync('docs/operations/progression-001C-authority.sql','utf8'));
 await db.exec('COMMIT');
 assert.deepEqual(await db.query('SELECT to_jsonb(characters) value FROM characters'),beforeInstall);
 assert.equal((await db.query('SELECT count(*)::int n FROM progression_character_state')).rows[0].n,0);installPreserved=true;
});
after(async()=>{await db?.close();});
async function character(fields={}) {
 const id=uid();const values={level:1,xp:0,class:'wizard',...fields};
 await db.query('INSERT INTO characters(id,user_id) VALUES($1,$2)',[id,uid()]);
 for(const [key,value] of Object.entries(values)) await db.query(`UPDATE characters SET "${key}"=$1 WHERE id=$2`,[value,id]);
 return id;
}
const row=async id=>(await db.query('SELECT * FROM characters WHERE id=$1',[id])).rows[0];
const xp=async(id,amount,event=uid(),source='admin_xp',metadata={})=>(await db.query('SELECT progression_apply_xp_internal($1,$2,$3,$4::numeric,$5::jsonb) r',[id,event,source,amount,source==='admin_xp'?{actorId:'ffffffff-ffff-4fff-8fff-fffffffffff3',reason:'test',...metadata}:source==='combat2_reward'?{rewardClaimId:event,...metadata}:{completionId:event,...metadata}])).rows[0].r;
const delta=async(id,deltas,event=uid(),source='permanent_reward',version=0)=>(await db.query('SELECT progression_apply_permanent_delta_internal($1,$2,$3,$4,$5,$6) r',[id,event,source,version,deltas,{}])).rows[0].r;

test('install preserves existing anomalous values and creates no provenance rows',()=>assert.equal(installPreserved,true));
test('001A literal XP golden vectors have actual SQL parity',async()=>{
 for(const v of oracle.XP_GOLDEN_VECTORS){
  const id=await character({level:v.level,xp:v.xp});const result=await xp(id,v.award);
  assert.equal(result.kind,'committed',v.name);const r=result.receipt;
  assert.deepEqual([r.after.level,r.after.xp],v.after,v.name);
  assert.deepEqual([r.discretionaryPointsGranted,r.thresholdsPaid,r.appliedXp,r.discardedXp],[v.points,v.paid,v.applied,v.discarded],v.name);
  assert.deepEqual(r.respecMilestonesGranted,v.milestones,v.name);
  assert.equal(r.permanentDeltas.int,v.growthLevels.length,v.name); assert.equal(r.permanentDeltas.wis,v.growthLevels.length,v.name);
  assert.equal(r.offeredXp,r.appliedXp+r.discardedXp);
 }
});
test('one and multiple levels, every class growth destination and classless behavior',async()=>{
 for(let target=3;target<=42;target+=3){const level=target-1;const id=await character({level});const r=await xp(id,50*level*level);assert.equal(r.receipt.after.permanentStats.int,11);}
 const id=await character({class:'classless',is_classless:true});const r=await xp(id,4500);
 assert.equal(r.receipt.after.permanentStats.int,10);assert.equal(r.receipt.discretionaryPointsGranted,5);
});
test('late class join never catches up; future-only switching preserves past growth',async()=>{
 const late=await character({level:4,class:'classless',is_classless:true});await db.query("UPDATE characters SET class='wizard',is_classless=false WHERE id=$1",[late]);
 const r=await xp(late,50*16+50*25);assert.equal(r.receipt.after.permanentStats.int,11);
 const id=await character({level:2,class:'warrior'});await xp(id,200);
 await db.query("UPDATE characters SET class='wizard' WHERE id=$1",[id]);await xp(id,450+800+1250);
 const c=await row(id);assert.deepEqual([c.str,c.dex,c.int,c.wis],[11,11,11,11]);
});
test('10/20/30/40 milestone tokens are durable, unique, no material rewards',async()=>{
 const id=await character();const event=uid();const r=await xp(id,2147483647,event);assert.deepEqual(r.receipt.respecMilestonesGranted,[10,20,30,40]);
 assert.equal((await row(id)).respec_points,4);await xp(id,2147483647,event);
 assert.equal((await db.query('SELECT count(*)::int n FROM progression_respec_milestone WHERE character_id=$1',[id])).rows[0].n,4);
 assert.equal((await row(id)).respec_points,4);
});
test('living refill once, dead stays dead, CP/MP preserved or clamped, no-level does not heal',async()=>{
 const living=await character({hp:3,cp:4,mp:6});await xp(living,250);let c=await row(living);assert.deepEqual([c.hp,c.max_hp,c.cp,c.mp],[26,26,4,6]);
 const dead=await character({hp:0,cp:9999,mp:9999});await xp(dead,50);c=await row(dead);assert.deepEqual([c.hp,c.cp,c.mp],[0,c.max_cp,c.max_mp]);
 const nolevel=await character({hp:33,max_hp:20,cp:1234});const before=await row(nolevel);await xp(nolevel,1);c=await row(nolevel);assert.deepEqual([c.hp,c.cp,c.mp,c.max_hp],[before.hp,before.cp,before.mp,before.max_hp]);
});
test('class baseHP comes from config, classless verified 18, AC untouched',async()=>{
 await db.exec("UPDATE classes SET base_hp=27 WHERE class_key='wizard'");const id=await character({ac:37});await xp(id,50);const c=await row(id);assert.equal(c.max_hp,32);assert.equal(c.ac,37);
 await db.exec("UPDATE classes SET base_hp=16 WHERE class_key='wizard'");
 const cl=await character({class:'classless',is_classless:true});await xp(cl,50);assert.equal((await row(cl)).max_hp,23);
});
test('equipment fallback, gems, broken exclusion and all verified caps',async()=>{
 const id=await character();const item=uid();await db.query('INSERT INTO items VALUES($1,$2)',[item,{hp:10,con:2,int:2,wis:2,dex:2}]);
 await db.query("INSERT INTO character_inventory VALUES($1,$2,'body',1,'{}',$3)",[id,item,{emerald:2,sapphire:2,pearl:2,topaz:2}]);
 await xp(id,50);let c=await row(id);assert.deepEqual([c.max_hp,c.max_cp,c.max_mp],[35,45,122]);
 await db.query('UPDATE character_inventory SET current_durability=0 WHERE character_id=$1',[id]);assert.equal((await delta(id,{str:1},uid(),'permanent_reward',1)).kind,'committed');c=await row(id);assert.deepEqual([c.max_hp,c.max_cp,c.max_mp],[21,33,102]);
 const high=await character({con:2147483647,int:2147483647,wis:2147483647,dex:2147483647});await xp(high,50);c=await row(high);assert.deepEqual([c.max_hp,c.max_cp,c.max_mp],[10000,5000,5000]);
});
test('semantic config fingerprint normalizes key ordering, absent zeros and numeric formatting',async()=>{
 const id=await character();const e=uid();const first=await xp(id,1,e);
 await db.exec(`UPDATE classes SET level_bonuses='{"wis":1.0,"str":0,"int":1}' WHERE class_key='wizard'`);
 const second=await xp(await character(),1);assert.equal(first.receipt.classConfig.fingerprint,second.receipt.classConfig.fingerprint);
 await db.exec("UPDATE classes SET level_bonuses='{\"int\":2,\"wis\":1}' WHERE class_key='wizard'");
 const replay=await xp(id,1,e);assert.deepEqual(replay.original,first.receipt);
 assert.notEqual((await xp(await character(),1)).receipt.classConfig.fingerprint,first.receipt.classConfig.fingerprint);
 await db.exec("UPDATE classes SET level_bonuses='{\"int\":1,\"wis\":1}' WHERE class_key='wizard'");
});
test('XP replay returns original receipt after later changes; changed payload conflicts',async()=>{
 const id=await character();const e=uid();const a=await xp(id,50,e);await xp(id,200);
 assert.deepEqual((await xp(id,50,e)).original,a.receipt);assert.equal((await xp(id,51,e)).reason,'request_conflict');
 assert.equal((await xp(id,50,e,'admin_xp',{reason:'changed'})).reason,'request_conflict');
});
test('permanent replay, refundable counters, version refusal and opaque baseline preservation',async()=>{
 const id=await character({str:23,bhp:81,bhp_trained:{str:4},unspent_stat_points:5});const baseline=await row(id);const e=uid();
 const first=await delta(id,{str:2,dex:1},e,'discretionary_allocation');assert.equal(first.kind,'committed');
 assert.deepEqual(first.receipt.refundableInvestmentAfter,{str:2,dex:1,con:0,int:0,wis:0,cha:0});
 assert.equal((await row(id)).unspent_stat_points,2);assert.deepEqual((await delta(id,{dex:1,str:2},e,'discretionary_allocation')).original,first.receipt);
 assert.equal((await delta(id,{str:3},e,'discretionary_allocation')).reason,'request_conflict');
 assert.equal((await delta(id,{str:1})).reason,'stale_version');
 await delta(id,{str:1},uid(),'permanent_reward',1);
 const s=(await db.query('SELECT * FROM progression_character_state WHERE character_id=$1',[id])).rows[0];
 assert.equal(s.str_invested,2);assert.equal(s.opaque_baseline.permanentStats.str,baseline.str);assert.equal(s.opaque_baseline.renownBalance,81);
 assert.deepEqual(s.opaque_baseline.trainedRanks,{str:4});assert.equal((await row(id)).bhp,81);
});
test('invalid state, fractional/negative awards, overflow and invalid config refuse without side effects',async()=>{
 for(const amount of [-1,1.5,'2147483648']){const id=await character();const before=await row(id);assert.equal((await xp(id,amount)).kind,'refused');assert.deepEqual(await row(id),before);}
 for(const fields of [{level:42,xp:1},{level:1,xp:50},{level:43},{xp:-1}]){const id=await character(fields);assert.equal((await xp(id,0)).kind,'reconciliation_required');}
 for(const cfg of [{int:null},{unknown:1},{int:-1},{int:0.5},[]]){
  await db.query("UPDATE classes SET level_bonuses=$1 WHERE class_key='wizard'",[cfg]);const id=await character();assert.equal((await xp(id,1)).reason,'invalid_class_config');
  assert.equal((await db.query('SELECT count(*)::int n FROM progression_character_state WHERE character_id=$1',[id])).rows[0].n,0);
 }
 await db.exec("UPDATE classes SET level_bonuses='{\"int\":1,\"wis\":1}' WHERE class_key='wizard'");
 const overflow=await character({level:2,int:2147483647});assert.equal((await xp(overflow,200)).reason,'arithmetic_overflow');
 const pool=await character({unspent_stat_points:200});assert.equal((await xp(pool,50)).reason,'arithmetic_overflow');
 assert.equal((await delta(await character(),{str:-1})).reason,'invalid_delta');
});
test('SQL statement rollback is atomic even after stats changed and resource JSON fails',async()=>{
 const id=await character();const item=uid();await db.query('INSERT INTO items VALUES($1,$2)',[item,{con:'malformed'}]);await db.query("INSERT INTO character_inventory VALUES($1,$2,'body',1,NULL,'{}')",[id,item]);
 const before=await row(id);await assert.rejects(()=>xp(id,50));assert.deepEqual(await row(id),before);
 assert.equal((await db.query('SELECT count(*)::int n FROM progression_character_state WHERE character_id=$1',[id])).rows[0].n,0);
});
test('browser/service/custom default grants denied, RLS enabled, owner JWT guarded',async()=>{
 const functions=(await db.query("SELECT oid::regprocedure::text name,prosecdef,proconfig FROM pg_proc WHERE proname LIKE 'progression_%' OR proname='character_sync_derived_internal'" )).rows;
 assert.equal(functions.length,5);
 for(const f of functions){assert.equal(f.prosecdef,true);assert.deepEqual(f.proconfig,['search_path=pg_catalog, public']);
  for(const role of ['anon','authenticated','service_role','custom_default'])assert.equal((await db.query('SELECT has_function_privilege($1,$2,\'EXECUTE\') allowed',[role,f.name])).rows[0].allowed,false);
 }
 for(const name of ['progression_character_state','progression_receipt','progression_respec_milestone']){
  assert.equal((await db.query('SELECT relrowsecurity FROM pg_class WHERE oid=$1::regclass',[name])).rows[0].relrowsecurity,true);
  for(const role of ['anon','authenticated','service_role','custom_default'])assert.equal((await db.query('SELECT has_table_privilege($1,$2,\'SELECT,INSERT,UPDATE,DELETE\') allowed',[role,name])).rows[0].allowed,false);
 }
 const id=await character();await db.query("SELECT set_config('app.test_uid',$1,false)",[id]);assert.equal((await xp(id,1)).reason,'unauthorized');await db.exec("RESET app.test_uid");
 for(const role of ['anon','authenticated','service_role']){await db.exec('SET ROLE '+role);await assert.rejects(()=>xp(id,1),/permission denied/);await db.exec('RESET ROLE');}
});
test('outer transaction rollback restores character/provenance/receipt, queued retries apply once',async()=>{
 const id=await character();const before=await row(id);await db.exec('BEGIN');await xp(id,50);await db.exec('ROLLBACK');assert.deepEqual(await row(id),before);
 const e=uid();const results=await Promise.all([xp(id,50,e),xp(id,50,e)]);assert.deepEqual(results.map(x=>x.kind),['committed','replayed']);assert.equal((await row(id)).level,2);
 // PGlite serializes queries. This verifies replay, NOT two hosted backend lock contention.
});
test('no ordinary source caller, no trigger or legacy-writer edit in SQL payload',()=>{
 const walk=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(resolve(dir,e.name)):/\.[cm]?[jt]sx?$/.test(e.name)?[resolve(dir,e.name)]:[]);
 for(const file of [...walk('src'),...walk('supabase/functions')]) {
  if(/\.(test|spec)\./.test(file))continue;
  assert.doesNotMatch(readFileSync(file,'utf8'),/progression_apply_(?:xp|permanent_delta)_internal|character_sync_derived_internal/);
 }
 const sql=readFileSync('docs/operations/progression-001C-authority.sql','utf8');
 assert.doesNotMatch(sql,/CREATE\s+TRIGGER|ALTER\s+TABLE\s+public\.characters|UPDATE\s+public\.characters\s+SET\s+ac\b/i);
 assert.doesNotMatch(sql,/apply_crafting_xp\s*\(|sync_character_resources\s*\(|soulmarked_ember|corebound_fragment/);
});
