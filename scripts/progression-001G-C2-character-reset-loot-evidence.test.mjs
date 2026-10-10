// Disposable source-shaped preservation/provenance fixtures; no production reset is tested.
import {test,before,after} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {resolve} from 'node:path';import {pathToFileURL} from 'node:url';
const {PGlite}=await import(pathToFileURL(resolve(process.argv[2])).href);let db;
const uid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const q=async(sql,p=[])=>(await db.query(sql,p)).rows;
before(async()=>{db=new PGlite();await db.exec(`CREATE TABLE characters(id uuid PRIMARY KEY);
 CREATE TABLE nodes(id uuid PRIMARY KEY);CREATE TABLE items(id uuid PRIMARY KEY);
 INSERT INTO characters VALUES('${uid(1)}');INSERT INTO nodes VALUES('${uid(2)}');INSERT INTO items VALUES('${uid(3)}');`);
 const source=readFileSync('supabase/migrations/20260220110012_8f7413bd-64ce-4ae1-aed0-4b94f07f79c7.sql','utf8');
 await db.exec(source.match(/CREATE TABLE public\.node_ground_loot[\s\S]*?\);/)[0]);
 await db.exec(`ALTER TABLE node_ground_loot ADD unique_instance_id uuid;
 CREATE TABLE character_inventory(id uuid,item_id uuid,unique_instance_id uuid);
 CREATE TABLE marketplace_listings(id uuid,item_id uuid,unique_instance_id uuid,status text);
 CREATE TABLE unique_item_instance(id uuid,item_id uuid,location_kind text,location_id uuid);
 CREATE TABLE node_death_loot(ground_loot_id uuid,item_id uuid,outcome text);`);
 await q('INSERT INTO node_ground_loot(id,node_id,item_id,dropped_by,dropped_at) VALUES($1,$2,$3,$4,$5),($6,$2,$3,NULL,$5)',[uid(4),uid(2),uid(3),uid(1),'2026-01-01T00:00:00Z',uid(5)]);
});after(async()=>await db?.close());
async function tx(fn){await db.exec('BEGIN');try{await fn();}finally{await db.exec('ROLLBACK');}}
const evidence=readFileSync('docs/operations/progression-001G-C2-character-reset-loot-evidence.sql','utf8');
test('real ground FK loses character-drop ownership and makes NULL insufficient to distinguish a static placement',()=>tx(async()=>{await q('DELETE FROM characters WHERE id=$1',[uid(1)]);const rows=await q('SELECT dropped_by,item_id,node_id,dropped_at,creature_name FROM node_ground_loot ORDER BY id');assert.deepEqual(rows[0],rows[1]);assert.equal(rows[0].dropped_by,null);assert.equal((await q('SELECT count(*)::int n FROM node_ground_loot'))[0].n,2);}));
test('specific evidence SQL is read-only and exposes flags without declaring unlinked ground data disposable',()=>tx(async()=>{await db.exec('SET TRANSACTION READ ONLY');const rows=(await db.exec(evidence)).flatMap(r=>r.rows??[]);const ground=rows.filter(r=>r.ground_loot_id);assert.equal(ground.length,2);assert.equal(ground[0].current_character_exists,true);assert.equal(ground[1].dropped_by,null);assert.equal(ground[1].matching_recorded_creature_drop,false);assert.equal('disposable' in ground[1],false);}));
test('local fixture rollback restores character identity and original loot pointer',async()=>{await tx(async()=>{await q('DELETE FROM characters WHERE id=$1',[uid(1)]);assert.equal((await q('SELECT dropped_by FROM node_ground_loot WHERE id=$1',[uid(4)]))[0].dropped_by,null);});assert.equal((await q('SELECT dropped_by FROM node_ground_loot WHERE id=$1',[uid(4)]))[0].dropped_by,uid(1));});

test('source-defined completed Arena archive retains exact rows and historical character IDs after local character removal',()=>tx(async()=>{
  await db.exec('CREATE TABLE combat2_test_arena(id uuid PRIMARY KEY)');await q('INSERT INTO combat2_test_arena VALUES($1)',[uid(9)]);
  const archiveSource=readFileSync('supabase/migrations/20260907110000_combat2_test_runs.sql','utf8');
  for(const name of ['combat2_test_run','combat2_test_run_batch','combat2_test_run_event'])await db.exec(archiveSource.match(new RegExp('CREATE TABLE public\\.'+name+'\\s*\\([\\s\\S]*?\\);'))[0]);
  await q("INSERT INTO combat2_test_run(id,arena_id,status,initiated_by,start_request_id,stop_request_id,started_at,completed_at,final_seq,final_summary) VALUES($1,$2,'completed',$3,$4,$5,'2026-01-01','2026-01-02',1,$6::jsonb)",[uid(10),uid(9),uid(8),uid(11),uid(12),{characterId:uid(1)}]);
  await q("INSERT INTO combat2_test_run_batch VALUES($1,$2,$3,1,1,'2026-01-01')",[uid(10),uid(13),uid(14)]);
  await q('INSERT INTO combat2_test_run_event VALUES($1,$2,1,$3::jsonb)',[uid(10),uid(13),{actor:{id:uid(1),name:'Historical fixture'}}]);
  const snapshot=async()=>Promise.all(['combat2_test_run','combat2_test_run_batch','combat2_test_run_event'].map(t=>q('SELECT to_jsonb(t) row FROM '+t+' t')));
  const before=await snapshot();await q('DELETE FROM characters WHERE id=$1',[uid(1)]);assert.deepEqual(await snapshot(),before);
}));
