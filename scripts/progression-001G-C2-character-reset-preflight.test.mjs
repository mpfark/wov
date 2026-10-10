// Local metadata fixture only. No reset/deletion package is executed or claimed tested.
import {test,before,after} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {resolve} from 'node:path';import {pathToFileURL} from 'node:url';
const {PGlite}=await import(pathToFileURL(resolve(process.argv[2])).href);let db;
const sql=readFileSync('docs/operations/progression-001G-C2-character-reset-preflight.sql','utf8');
before(async()=>{db=new PGlite();await db.exec(`CREATE ROLE restricted_reset_inspector;
 CREATE TABLE characters(id uuid PRIMARY KEY,deleted_at timestamptz);INSERT INTO characters VALUES('00000000-0000-4000-8000-000000000001',NULL);
 CREATE TABLE character_materials(character_id uuid,material_key text,count integer);INSERT INTO character_materials VALUES('00000000-0000-4000-8000-000000000999','salvage',40);
 CREATE TABLE unexpected_world_definition(id uuid PRIMARY KEY,character_id uuid REFERENCES characters(id) ON DELETE CASCADE);
 CREATE TABLE nested_world_history(id uuid,definition_id uuid REFERENCES unexpected_world_definition(id) ON DELETE CASCADE);
 CREATE TABLE active_effects(id uuid,target_id uuid,source_id uuid);
 CREATE TABLE node_tick_batch(id uuid,events jsonb);INSERT INTO node_tick_batch VALUES('00000000-0000-4000-8000-000000000002','{"private_fixture":"not returned"}');
 CREATE FUNCTION fixture_before_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN OLD;END $$;
 CREATE TRIGGER fixture_before_delete BEFORE DELETE ON characters FOR EACH ROW EXECUTE FUNCTION fixture_before_delete();`);});after(async()=>await db?.close());
async function inspect(){await db.exec('BEGIN READ ONLY');try{return (await db.exec(sql)).flatMap(r=>r.rows??[]);}finally{await db.exec('ROLLBACK');}}
test('preflight executes in a read-only transaction and reports unavailable source candidates without mutation',async()=>{const rows=await inspect();assert.equal(rows.find(r=>r.inspector).characters,1);assert.equal(rows.find(r=>r.inspector).orphan_material_rows,1);assert.equal(rows.find(r=>r.name==='character_creation_origin').relation,null);});
test('actual FK closure exposes unexpected nested persistent-world dependencies',async()=>{const rows=await inspect();assert.ok(rows.some(r=>r.child==='unexpected_world_definition'&&r.parent==='characters'));assert.ok(rows.some(r=>r.child==='nested_world_history'&&r.parent==='unexpected_world_definition'));});
test('polymorphic and JSON columns plus DELETE trigger metadata returned without row payloads or body execution',async()=>{const rows=await inspect();assert.ok(rows.some(r=>r.attname==='target_id'&&r.relation==='active_effects'));assert.ok(rows.some(r=>r.attname==='events'&&r.relation==='node_tick_batch'));assert.ok(rows.some(r=>r.tgname==='fixture_before_delete'));assert.equal(JSON.stringify(rows).includes('not returned'),false);});
test('RLS-restricted inspection cannot report false zero character or orphan counts as reliable',async()=>{await db.exec('BEGIN');try{await db.exec('ALTER TABLE characters ENABLE ROW LEVEL SECURITY;ALTER TABLE character_materials ENABLE ROW LEVEL SECURITY;GRANT SELECT ON characters,character_materials TO restricted_reset_inspector;SET LOCAL ROLE restricted_reset_inspector');const rows=(await db.exec(sql)).flatMap(r=>r.rows??[]),counts=rows.find(r=>r.inspector);assert.equal(counts.materials_visibility_complete,false);assert.equal(counts.characters,null);assert.equal(counts.tombstones,null);assert.equal(counts.orphan_material_rows,null);}finally{await db.exec('ROLLBACK');}});
