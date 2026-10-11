import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { PGlite } = await import(pathToFileURL(resolve(process.argv[2])).href);
const sql=readFileSync('docs/operations/legacy-001B3-stance-encounter-guard.sql','utf8');
const source=readFileSync('supabase/migrations/20261001130000_combat2_character_persistent_stances.sql','utf8');
const wrapper='CREATE FUNCTION public.node_tick_commit('+source.split('CREATE FUNCTION public.node_tick_commit(')[1].split('END $$;')[0]+'END $$;';
const arrival=readFileSync('supabase/migrations/20260928100000_combat2_authoritative_arrival_hostile_initiation.sql','utf8');
const predecessor='CREATE FUNCTION public.node_tick_commit_without_character_stances('+arrival.split('CREATE FUNCTION public.node_tick_commit(')[1].split('$$;')[0]+'$$;';
const e='10000000-0000-4000-8000-000000000001', a='20000000-0000-4000-8000-000000000001', b='20000000-0000-4000-8000-000000000002', token='30000000-0000-4000-8000-000000000001';
const origin='40000000-0000-4000-8000-000000000002',destination='40000000-0000-4000-8000-000000000001';
async function fixture(applyPatch=true){
 const db=new PGlite();
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE TABLE node_encounter(id uuid PRIMARY KEY,tick int DEFAULT 0,node_id uuid);
 CREATE TABLE node_fighter(id uuid PRIMARY KEY,encounter_id uuid,character_id uuid,present boolean);
 CREATE TABLE character_stance(character_id uuid,ability_key text,state jsonb,version bigint,updated_at timestamptz,PRIMARY KEY(character_id,ability_key));
 CREATE TABLE character_stance_request(encounter_id uuid,intent_id uuid,committed_at timestamptz);
 CREATE TABLE inner_calls(n int); INSERT INTO inner_calls VALUES(0);
 -- Real outer and direct predecessor; deliberately modeled deeper commit.
 CREATE FUNCTION node_tick_commit_without_authoritative_arrival(_encounter_id uuid,_claim_token uuid,_candidate_tick int,_expected_last_tick int,_expected_state_version bigint,_intent_ids uuid[],_proposed jsonb)
 RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN
 IF (SELECT tick FROM node_encounter WHERE id=_encounter_id)>=_candidate_tick THEN
 RETURN jsonb_build_object('ok',true,'kind','already_committed'); END IF;
 UPDATE inner_calls SET n=n+1;
 UPDATE node_encounter SET tick=_candidate_tick WHERE id=_encounter_id;
 UPDATE node_fighter SET present=false WHERE encounter_id=_encounter_id AND (_proposed->>'depart'='true' OR _proposed->>'death'='true');
 RETURN jsonb_build_object('ok',true,'kind','committed'); END $$;
 INSERT INTO node_encounter(id,node_id) VALUES('${e}','${origin}');
 INSERT INTO node_fighter VALUES('${token}','${e}','${a}',true);
 INSERT INTO character_stance VALUES('${a}','force_shield','{"ward_remaining":10}',1,now()),('${b}','force_shield','{"ward_remaining":20}',1,now());
 ${predecessor}
 REVOKE ALL ON FUNCTION node_tick_commit_without_character_stances(uuid,uuid,int,int,bigint,uuid[],jsonb) FROM PUBLIC;
 ${wrapper}
 REVOKE ALL ON FUNCTION node_tick_commit(uuid,uuid,int,int,bigint,uuid[],jsonb) FROM PUBLIC;
 GRANT EXECUTE ON FUNCTION node_tick_commit(uuid,uuid,int,int,bigint,uuid[],jsonb) TO service_role;`);
 if(applyPatch) await db.exec(sql);return db;
}
const update=id=>({character_id:id,ability_key:'force_shield',version:1,state:{ward_remaining:5}});
const fence=id=>({character_id:id,ability_key:'force_shield',version:1});
async function commit(db,p){return (await db.query('SELECT node_tick_commit($1,$2,1,0,0,ARRAY[]::uuid[],$3::jsonb) result',[e,token,JSON.stringify(p)])).rows[0].result;}
async function state(db){return (await db.query(`SELECT (SELECT jsonb_agg(s ORDER BY character_id) FROM character_stance s) stances,
 (SELECT jsonb_agg(f ORDER BY id) FROM node_fighter f) fighters,(SELECT tick FROM node_encounter) tick,(SELECT n FROM inner_calls) calls`)).rows[0];}
test('valid update; same empty-fence retry does not increment or mutate twice',async()=>{const db=await fixture();try{
 const p={stance_updates:[update(a)]};assert.equal((await commit(db,p)).kind,'committed');const before=await state(db);
 assert.equal((await commit(db,p)).kind,'already_committed');assert.deepEqual(await state(db),before);
 assert.equal((await db.query('SELECT version FROM character_stance WHERE character_id=$1',[a])).rows[0].version,2);
}finally{await db.close();}});
for(const cause of ['death','depart'])test(`valid ${cause} clear survives inner presence change`,async()=>{const db=await fixture();try{
 assert.equal((await commit(db,{[cause]:true,stance_fence:[fence(a)],stance_clear_character_ids:[a]})).kind,'committed');
 assert.equal((await db.query('SELECT present FROM node_fighter')).rows[0].present,false);
 assert.deepEqual((await db.query('SELECT character_id FROM character_stance')).rows.map(x=>x.character_id),[b]);
}finally{await db.close();}});
for(const field of ['stance_updates','stance_clear_character_ids','stance_fence'])test(`foreign ${field} rejected before delegate; mixed proposal atomic`,async()=>{const db=await fixture();try{
 const before=await state(db);const values=field==='stance_updates'?[update(a),update(b)]:field==='stance_fence'?[fence(a),fence(b)]:[a,b];
 await assert.rejects(commit(db,{[field]:values}),/stance_target_outside_encounter/);assert.deepEqual(await state(db),before);
}finally{await db.close();}});
test('null/malformed target rejected; departed historical member remains eligible',async()=>{const db=await fixture();try{
 await assert.rejects(commit(db,{stance_fence:[{character_id:null}]}),/stance_target_invalid/);
 await assert.rejects(commit(db,{stance_clear_character_ids:['bad-uuid']}),/invalid input syntax/);
 await db.exec('UPDATE node_fighter SET present=false');assert.equal((await commit(db,{stance_clear_character_ids:[a]})).kind,'committed');
}finally{await db.close();}});
test('late stale update rolls back delegate and earlier valid stance update',async()=>{const db=await fixture();try{
 const before=await state(db);await assert.rejects(commit(db,{stance_updates:[update(a),update(a)]}),/stale stance update/);
 assert.deepEqual(await state(db),before);
}finally{await db.close();}});
test('original stale-fence retry refusal remains intact',async()=>{const db=await fixture();try{
 const p={stance_fence:[fence(a)],stance_updates:[update(a)]};await commit(db,p);const before=await state(db);
 assert.equal((await commit(db,p)).kind,'stale_stance');assert.deepEqual(await state(db),before);
}finally{await db.close();}});
test('only declared variable and pre-fence guard change; SQL stays outside automatic history',async()=>{const db=await fixture();try{
 const body=(await db.query("SELECT prosrc FROM pg_proc WHERE oid='node_tick_commit(uuid,uuid,int,int,bigint,uuid[],jsonb)'::regprocedure")).rows[0].prosrc;
 const original=wrapper.split('AS $$')[1].split('END $$;')[0]+'END ';
 const stripped=body.replace('current_version bigint; stance_target uuid; locked_node uuid; encounter_node uuid;','current_version bigint;').replace(/BEGIN\n -- Match the direct predecessor[\s\S]*? END LOOP;\n FOR row/,'BEGIN\n FOR row');
 assert.equal(stripped,original.replace(/\r\n/g,'\n'));
 assert.equal((await db.query("SELECT has_function_privilege('authenticated','node_tick_commit(uuid,uuid,int,int,bigint,uuid[],jsonb)','EXECUTE') allowed")).rows[0].allowed,false);
 await assert.rejects(db.exec(sql),/source\/security drift/);await db.exec('ROLLBACK');
}finally{await db.close();}});

test('installed guard orders node locks before encounter, membership, stance and delegate',async()=>{const db=await fixture();try{
 const body=(await db.query("SELECT prosrc FROM pg_proc WHERE oid='node_tick_commit(uuid,uuid,int,int,bigint,uuid[],jsonb)'::regprocedure")).rows[0].prosrc;
 const markers=['pg_advisory_xact_lock','PERFORM 1 FROM public.node_encounter','FROM public.node_fighter','FOR row IN SELECT value','result:=public.node_tick_commit_without_character_stances'];
 const offsets=markers.map(m=>body.indexOf(m));assert(offsets.every(n=>n>=0));assert.deepEqual([...offsets].sort((a,b)=>a-b),offsets);
 assert.match(body,/nodes WHERE node_id IS NOT NULL ORDER BY node_id/);
 assert(body.indexOf('stance_encounter_node_changed')>body.indexOf('PERFORM 1 FROM public.node_encounter'));
 assert(body.indexOf('stance_encounter_node_changed')<body.indexOf('FROM public.node_fighter'));
 assert.match(predecessor,/ORDER BY node_id[\s\S]*pg_advisory_xact_lock[\s\S]*node_tick_commit_without_authoritative_arrival/);
 assert.match(body,/SELECT encounter_node AS node_id\s+UNION\s+SELECT \(departure->>'destination_node_id'\)::uuid/);
 assert.match(body,/WHERE departure->>'outcome'='moved'/);
}finally{await db.close();}});

test('moved departure locks exact distinct node set, ignores unmoved destination; clears and retry preserved',async()=>{const db=await fixture();try{
 await db.exec('BEGIN');
 const p={depart:true,departures:[{outcome:'moved',destination_node_id:destination},{outcome:'moved',destination_node_id:destination},
 {outcome:'refused',destination_node_id:b}],stance_clear_character_ids:[a]};
 assert.equal((await commit(db,p)).kind,'committed');
 const locks=(await db.query(`SELECT classid::bigint::text hi,objid::bigint::text lo FROM pg_locks
 WHERE locktype='advisory' AND granted AND objsubid=1 ORDER BY classid,objid`)).rows; // PGlite reports null pid; isolated single session.
 const expected=(await db.query(`SELECT ((k>>32)&4294967295)::text hi,(k&4294967295)::text lo FROM
 (SELECT hashtextextended('combat_enter_node:'||n,0) k FROM (VALUES($1::text),($2::text)) v(n)) hashes ORDER BY ((k>>32)&4294967295),(k&4294967295)`,[origin,destination])).rows;
 assert.deepEqual(locks,expected);const before=await state(db);assert.equal((await commit(db,p)).kind,'already_committed');assert.deepEqual(await state(db),before);
 await db.exec('ROLLBACK');
}finally{await db.close();}});

test('unexpected direct predecessor refuses patch without changing outer function',async()=>{const db=await fixture(false);try{
 const before=(await db.query("SELECT pg_get_functiondef('node_tick_commit(uuid,uuid,int,int,bigint,uuid[],jsonb)'::regprocedure) body")).rows[0].body;
 await db.exec(predecessor.replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION').replace('DECLARE locked_node uuid;','DECLARE locked_node uuid; -- drift'));
 await assert.rejects(db.exec(sql),/direct predecessor lock contract drift/);await db.exec('ROLLBACK');
 assert.equal((await db.query("SELECT pg_get_functiondef('node_tick_commit(uuid,uuid,int,int,bigint,uuid[],jsonb)'::regprocedure) body")).rows[0].body,before);
}finally{await db.close();}});
