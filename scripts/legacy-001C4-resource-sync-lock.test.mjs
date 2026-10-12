import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { PGlite } = await import(pathToFileURL(resolve(process.argv[2])).href);
const source=readFileSync('supabase/migrations/20260922112544_a2d63b3d-4f07-4641-a911-f6cf25ee1b45.sql','utf8').replace(/\r\n/g,'\n');
const fn=source.slice(source.indexOf('CREATE OR REPLACE FUNCTION'),source.indexOf('DO $migration$'));
const sql=readFileSync('docs/operations/legacy-001C4-resource-sync-lock.sql','utf8');
const id='10000000-0000-4000-8000-000000000001',item='20000000-0000-4000-8000-000000000001';
async function fixture(patch=true){const db=new PGlite();await db.exec(`
 CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
 CREATE TABLE characters(id uuid PRIMARY KEY,class text,level integer,str integer,dex integer,con integer,int integer,wis integer,cha integer,
 hp integer,cp integer,mp integer,max_hp integer,max_cp integer,max_mp integer,ac integer);
 CREATE TABLE items(id uuid PRIMARY KEY,stats jsonb);
 CREATE TABLE character_inventory(id uuid PRIMARY KEY,character_id uuid,item_id uuid,equipped_slot text,current_durability integer,stat_override jsonb,applied_gems jsonb);
 CREATE FUNCTION owns_character(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT current_setting('test.owned',true) IS DISTINCT FROM 'false'$$;
 INSERT INTO characters VALUES('${id}','warrior',3,10,12,14,12,14,10,5,7,9,1,1,1,13);
 INSERT INTO items VALUES('${item}','{"con":2,"hp":4,"int":2,"wis":2,"dex":2}');
 ${fn}`);if(patch)await db.exec(sql);return db;}
const sync=async db=>(await db.query('SELECT sync_character_resources($1) result',[id])).rows[0].result;
const row=async db=>(await db.query('SELECT * FROM characters WHERE id=$1',[id])).rows[0];
test('exact body differs only by early character lock; no node/inventory/AC/formula changes',async()=>{const db=await fixture();try{
 const body=(await db.query("SELECT prosrc FROM pg_proc WHERE oid='sync_character_resources(uuid)'::regprocedure")).rows[0].prosrc;
 const original=fn.split('AS $function$')[1].split('$function$;')[0];assert.equal(body.replace('id=p_character_id FOR UPDATE;','id=p_character_id;'),original);
 assert(body.indexOf('FOR UPDATE')<body.indexOf('WITH equipped'));assert(!body.includes('pg_advisory_xact_lock'));assert(!body.includes('FOR SHARE'));
}finally{await db.close();}});
test('prior serialized damage/healing/resource spend is retained; increased maxima never grant resources',async()=>{const db=await fixture();try{
 for(const [hp,cp,mp] of [[3,2,1],[8,12,13]]){await db.exec('BEGIN');await db.query('UPDATE characters SET hp=$1,cp=$2,mp=$3 WHERE id=$4',[hp,cp,mp,id]);await db.exec('COMMIT');
 const result=await sync(db);assert.deepEqual([result.hp,result.cp,result.mp],[hp,cp,mp]);assert.deepEqual([result.max_hp,result.max_cp,result.max_mp],[38,45,114]);}
}finally{await db.close();}});
test('character RowShare lock is retained through transaction end, unlike old unlocked read',async()=>{
 for(const patch of [false,true]){const db=await fixture(patch);try{await db.exec('BEGIN');await sync(db);
 const locks=(await db.query("SELECT mode FROM pg_locks WHERE relation='characters'::regclass AND granted")).rows.map(x=>x.mode);
 assert.equal(locks.includes('RowShareLock'),patch);await db.exec('ROLLBACK');assert.equal((await row(db)).max_hp,1);
 }finally{await db.close();}}
});
test('upper/lower clamping, dead HP and null CP/MP behavior preserved',async()=>{const db=await fixture();try{
 await db.exec('UPDATE characters SET hp=90000,cp=90000,mp=90000');let r=await sync(db);assert.deepEqual([r.hp,r.cp,r.mp],[38,45,114]);
 await db.exec('UPDATE characters SET hp=0,cp=NULL,mp=NULL');r=await sync(db);assert.deepEqual([r.hp,r.cp,r.mp],[0,0,0]);
 await db.exec('UPDATE characters SET hp=-2,cp=-3,mp=-4');r=await sync(db);assert.deepEqual([r.hp,r.cp,r.mp],[0,0,0]);
}finally{await db.close();}});
test('equipped gems and empty override retain SQL semantics; broken gear excluded',async()=>{const db=await fixture();try{
 await db.query('INSERT INTO character_inventory VALUES($1,$2,$3,$4,100,$5,$6)',[item,id,item,'head','{}','{"emerald":2,"sapphire":2,"pearl":2,"topaz":2}']);
 let r=await sync(db);assert.deepEqual([r.max_hp,r.max_cp,r.max_mp],[46,57,134]);
 await db.exec('UPDATE character_inventory SET current_durability=0');r=await sync(db);assert.deepEqual([r.max_hp,r.max_cp,r.max_mp],[38,45,114]);
}finally{await db.close();}});
test('owner check and missing character refusal unchanged, no partial mutation',async()=>{const db=await fixture();try{
 const before=await row(db);await db.exec("SELECT set_config('test.owned','false',false)");await assert.rejects(sync(db),/Not authorized/);assert.deepEqual(await row(db),before);
 await db.exec("SELECT set_config('test.owned','true',false)");await assert.rejects(db.query("SELECT sync_character_resources('10000000-0000-4000-8000-000000000002')"),/Character not found/);
}finally{await db.close();}});
test('AC/attributes/equipment unchanged; injected late trigger failure rolls back resource UPDATE',async()=>{const db=await fixture();try{
 const before=await row(db);await db.exec(`CREATE FUNCTION refuse_sync() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'injected failure'; END$$;
 CREATE TRIGGER refuse_sync BEFORE UPDATE ON characters FOR EACH ROW EXECUTE FUNCTION refuse_sync();`);
 await assert.rejects(sync(db),/injected failure/);assert.deepEqual(await row(db),before);
 await db.exec('DROP TRIGGER refuse_sync ON characters');await sync(db);const after=await row(db);
 for(const k of ['ac','str','dex','con','int','wis','cha','class','level'])assert.equal(after[k],before[k]);
}finally{await db.close();}});
test('ownership/security/ACL and effective grants unchanged including custom grantee',async()=>{const db=await fixture(false);try{
 await db.exec('CREATE ROLE retained_service; GRANT EXECUTE ON FUNCTION sync_character_resources(uuid) TO retained_service;');
 const meta=async()=>(await db.query("SELECT proowner,prosecdef,proconfig,proacl FROM pg_proc WHERE oid='sync_character_resources(uuid)'::regprocedure")).rows[0];const before=await meta();await db.exec(sql);assert.deepEqual(await meta(),before);
 for(const [role,expected] of [['anon',false],['authenticated',true],['service_role',true],['retained_service',true]])assert.equal((await db.query("SELECT has_function_privilege($1,'sync_character_resources(uuid)','EXECUTE') allowed",[role])).rows[0].allowed,expected);
}finally{await db.close();}});
test('source drift aborts without patching or changing grants',async()=>{const db=await fixture(false);try{
 await db.exec(fn.split('REVOKE ALL')[0].replace('BEGIN\n','BEGIN\n -- unexpected change\n'));
 const before=(await db.query("SELECT pg_get_functiondef('sync_character_resources(uuid)'::regprocedure) body")).rows[0].body;
 await assert.rejects(db.exec(sql),/source\/security drift/);await db.exec('ROLLBACK');assert.equal((await db.query("SELECT pg_get_functiondef('sync_character_resources(uuid)'::regprocedure) body")).rows[0].body,before);
}finally{await db.close();}});
