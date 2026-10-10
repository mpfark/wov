// Disposable local data only; cleanup template is intentionally NOT filled in repository.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
if(!process.argv[2])throw Error('Supply a local PGlite module path');
const {PGlite}=await import(pathToFileURL(resolve(process.argv[2])).href);
const template=readFileSync('docs/operations/progression-001G-C2-orphan-cleanup-template.sql','utf8');
let db;const uid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const q=async(sql,params=[])=>(await db.query(sql,params)).rows;
const snapshot=Array.from({length:203},(_,i)=>`('${uid(i+10)}','salvage',${i+1},'2020-01-01T00:00:00Z')`).join(',');
const filled=()=>template.replace('-- APPROVED_ROW_SNAPSHOT_REQUIRED: empty on purpose.',
  `INSERT INTO pg_temp.c2_approved_orphan_materials VALUES ${snapshot};`);
before(async()=>{
  db=new PGlite();await db.exec(`CREATE TABLE characters(id uuid PRIMARY KEY);
    CREATE TABLE character_materials(character_id uuid,material_key text,count integer,updated_at timestamptz,PRIMARY KEY(character_id,material_key));
    CREATE TABLE character_inventory(character_id uuid);CREATE TABLE progression_character_state(character_id uuid);
    CREATE TABLE character_creation_origin(character_id uuid);CREATE TABLE character_creation_log(result_character_id uuid);
    CREATE TABLE character_lifecycle_receipt(character_id uuid);
    INSERT INTO characters VALUES('${uid(1)}');INSERT INTO character_materials VALUES('${uid(1)}','salvage',400,'2020-01-01');
    INSERT INTO character_materials VALUES ${snapshot};`);
});
after(async()=>await db?.close());
async function tx(fn){await db.exec('BEGIN');try{await fn();}finally{await db.exec('ROLLBACK');}}
async function refused(sql,pattern){await db.exec('SAVEPOINT refusal');try{await assert.rejects(()=>db.exec(sql),pattern);}finally{await db.exec('ROLLBACK TO SAVEPOINT refusal');}}
test('unfilled template always refuses without deleting any material',()=>tx(async()=>{
  await refused(template,/approved203-row snapshot required/);assert.equal((await q('SELECT count(*)::int n FROM character_materials'))[0].n,204);
}));
test('approved fixture snapshot deletes only exact203 missing-character rows and rollback restores all',async()=>{
  await tx(async()=>{await db.exec(filled());assert.deepEqual(await q('SELECT count FROM character_materials'),[{count:400}]);
    assert.equal((await q('SELECT count(*)::int n FROM characters'))[0].n,1);});
  assert.equal((await q('SELECT count(*)::int n FROM character_materials'))[0].n,204);
});
test('changed amount, timestamp, missing row and newly existing character refuse all-or-nothing',()=>tx(async()=>{
  for(const change of ["UPDATE character_materials SET count=999 WHERE character_id=$1",
    "UPDATE character_materials SET updated_at=now() WHERE character_id=$1",
    'DELETE FROM character_materials WHERE character_id=$1','INSERT INTO characters VALUES($1)']){
    await db.exec('SAVEPOINT change');await q(change,[uid(10)]);await refused(filled(),/snapshot drift or live character/);
    await db.exec('ROLLBACK TO SAVEPOINT change');
  }
  assert.equal((await q('SELECT count(*)::int n FROM character_materials'))[0].n,204);
}));
test('surviving inventory/provenance/replay evidence blocks cleanup rather than inventing lost-character policy',()=>tx(async()=>{
  for(const table of ['character_inventory','progression_character_state','character_creation_origin','character_creation_log','character_lifecycle_receipt']){
    await db.exec('SAVEPOINT evidence');await q(`INSERT INTO ${table} VALUES($1)`,[uid(10)]);
    await refused(filled(),/recovery evidence requires separate owner resolution/);await db.exec('ROLLBACK TO SAVEPOINT evidence');
  }
}));
test('incoming FK or enabled user trigger refuses instead of producing unreviewed delete side effects',()=>tx(async()=>{
  await db.exec('SAVEPOINT dependency');
  await db.exec('CREATE TABLE unexpected_material_reference(character_id uuid,material_key text,FOREIGN KEY(character_id,material_key) REFERENCES character_materials(character_id,material_key) ON DELETE CASCADE)');
  await refused(filled(),/unexpected materials delete dependency or trigger/);await db.exec('ROLLBACK TO SAVEPOINT dependency');
  await db.exec(`CREATE FUNCTION unexpected_material_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN OLD;END $$;
    CREATE TRIGGER unexpected_delete BEFORE DELETE ON character_materials FOR EACH ROW EXECUTE FUNCTION unexpected_material_delete();`);
  await refused(filled(),/unexpected materials delete dependency or trigger/);
  assert.equal((await q('SELECT count(*)::int n FROM character_materials'))[0].n,204);
}));
