/** Exact generated final sidecar predicate on disposable PGlite 0.3.14.
 * Local role analogues only; no hosted role discovery or connection mode.
 */
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {payload,read,sha} from './prepare-progression-001E.mjs';
if(!process.argv[2])throw Error('Supply pinned local PGlite module path');
const {PGlite}=await import(pathToFileURL(resolve(process.argv[2])).href);
const checkpoint='06c888eb790ab9d1797d82f55cb4c2e216cdad6e';
const previous=execFileSync('git',['show',checkpoint+':docs/operations/progression-001E-cutover.sql'],{encoding:'utf8'});
const region=s=>s.match(/ IF EXISTS\(SELECT 1 FROM pg_class rel WHERE rel\.oid IN\('public\.progression_class_growth_milestone'[\s\S]*?THEN RAISE EXCEPTION '001E effective sidecar containment failed'; END IF;/)[0];
const repaired=`DO $$ BEGIN ${region(payload())} END $$;`,old=`DO $$ BEGIN ${region(previous)} END $$;`;
const tables=['progression_class_growth_milestone','progression_command_control'];
let db;
const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
const access=async(role,table)=>(await q("SELECT has_table_privilege($1,$2,'SELECT') allowed",[role,table]))[0].allowed;
async function rollback(fn){await db.exec('BEGIN');try{await fn();}finally{await db.exec('ROLLBACK');}}
before(async()=>{
 db=new PGlite();await db.exec(`
 CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
 CREATE ROLE ordinary_group;CREATE ROLE ordinary_bridge;CREATE ROLE ordinary_leaf;CREATE ROLE ordinary_empty;
 GRANT ordinary_group TO ordinary_bridge;GRANT ordinary_bridge TO ordinary_leaf;
 CREATE ROLE authority_bridge;CREATE ROLE authority_reader LOGIN;
 GRANT pg_read_all_data TO authority_bridge;GRANT authority_bridge TO authority_reader;
 CREATE ROLE authority_writer LOGIN;GRANT pg_write_all_data TO authority_writer;
 CREATE ROLE authority_bypass LOGIN BYPASSRLS;GRANT pg_read_all_data TO authority_bypass;
 CREATE ROLE bypass_without_grant BYPASSRLS;
 CREATE ROLE noinherit_reader NOINHERIT;GRANT pg_read_all_data TO noinherit_reader;
 CREATE ROLE misleading_admin_name;
 CREATE TABLE progression_class_growth_milestone(proof text);CREATE TABLE progression_command_control(enabled boolean);
 ALTER TABLE progression_class_growth_milestone OWNER TO postgres;ALTER TABLE progression_command_control OWNER TO postgres;
 ALTER TABLE progression_class_growth_milestone ENABLE ROW LEVEL SECURITY;ALTER TABLE progression_command_control ENABLE ROW LEVEL SECURITY;
 INSERT INTO progression_class_growth_milestone VALUES('private');INSERT INTO progression_command_control VALUES(false);
 `);
});
after(async()=>await db?.close());
test('R5 exact old identity and payload outside final sidecar assertion remain unchanged',()=>{
 assert.equal(sha(previous),'175d0c15c0f82a79c9682e0dca01c17f360eff88ab48fcf9fd0fedd650930266');
 assert.equal(payload().replace(region(payload()),'<sidecar assertion>'),previous.replace(region(previous),'<sidecar assertion>'));
 const oldManifest=JSON.parse(execFileSync('git',['show',checkpoint+':docs/operations/progression-001E-manifest.json'],{encoding:'utf8'}));
 for(const a of oldManifest.artifacts.filter(a=>!['docs/operations/progression-001E-cutover.sql','scripts/prepare-progression-001E.mjs'].includes(a.path)))assert.equal(sha(read(a.path)),a.sha256,a.path);
});
test('A explicit ordinary table grant fails for either private table',async()=>{
 for(const t of tables)await rollback(async()=>{await db.exec(`GRANT SELECT ON ${t} TO ordinary_leaf`);assert.equal(await access('ordinary_leaf',t),true);await assert.rejects(db.exec(repaired),/effective sidecar containment failed/);});
});
test('B PUBLIC grant fails for either private table',async()=>{
 for(const t of tables)await rollback(async()=>{await db.exec(`GRANT SELECT ON ${t} TO PUBLIC`);assert.equal(await access('anon',t),true);await assert.rejects(db.exec(repaired),/effective sidecar containment failed/);});
});
test('C transitive ordinary-group SELECT inheritance fails, including a NOINHERIT direct grantee',async()=>{
 for(const t of tables)await rollback(async()=>{await db.exec(`GRANT SELECT ON ${t} TO ordinary_group`);assert.equal(await access('ordinary_leaf',t),true);await assert.rejects(db.exec(repaired),/effective sidecar containment failed/);});
 await rollback(async()=>{await db.exec('GRANT SELECT ON progression_command_control TO noinherit_reader');await assert.rejects(db.exec(repaired),/effective sidecar containment failed/);});
});
test('D ordinary roles without capability pass; names confer no authority',async()=>{
 await db.exec(repaired);for(const role of ['anon','authenticated','service_role','ordinary_empty','misleading_admin_name'])for(const t of tables)assert.equal(await access(role,t),false);
 await rollback(async()=>{await db.exec('GRANT SELECT ON progression_command_control TO misleading_admin_name');await assert.rejects(db.exec(repaired),/effective sidecar containment failed/);});
});
test('E transitive global reader/writer and BYPASSRLS analogue pass without table grants; old predicate reproduces false failure',async()=>{
 assert.equal(await access('authority_reader',tables[0]),true);
 assert.equal((await q("SELECT pg_has_role('authority_reader','pg_read_all_data','USAGE') yes"))[0].yes,true);
 assert.equal((await q("SELECT has_table_privilege('authority_writer',$1,'UPDATE') yes",[tables[1]]))[0].yes,true);
 await db.exec(repaired);await assert.rejects(db.exec(old),/effective sidecar containment failed/);
 await db.exec('SET ROLE authority_reader');try{assert.deepEqual(await q('SELECT * FROM progression_class_growth_milestone'),[]);}finally{await db.exec('RESET ROLE');}
 await db.exec('SET ROLE authority_bypass');try{assert.deepEqual(await q('SELECT * FROM progression_class_growth_milestone'),[{proof:'private'}]);}finally{await db.exec('RESET ROLE');}
});
test('E authority analogue still cannot retain explicit table or column grants',async()=>{
 for(const sql of ['GRANT SELECT ON progression_command_control TO authority_reader','GRANT SELECT(enabled) ON progression_command_control TO authority_bypass'])await rollback(async()=>{await db.exec(sql);await assert.rejects(db.exec(repaired),/effective sidecar containment failed/);});
});
test('E BYPASSRLS alone grants no table capability; NOINHERIT global membership is not effective USAGE',async()=>{
 assert.equal(await access('bypass_without_grant',tables[0]),false);assert.equal(await access('noinherit_reader',tables[0]),false);
 assert.equal((await q("SELECT pg_has_role('noinherit_reader','pg_read_all_data','MEMBER') member,pg_has_role('noinherit_reader','pg_read_all_data','USAGE') usable"))[0].member,true);
 assert.equal((await q("SELECT pg_has_role('noinherit_reader','pg_read_all_data','USAGE') usable"))[0].usable,false);await db.exec(repaired);
});
test('F owner-only direct ACL, no policies, RLS enabled and disabled control are required',async()=>{
 for(const t of tables){const r=(await q("SELECT relowner='postgres'::regrole owner,relrowsecurity rls,NOT EXISTS(SELECT 1 FROM pg_policy WHERE polrelid=rel.oid) policy_free,NOT EXISTS(SELECT 1 FROM aclexplode(COALESCE(relacl,acldefault('r',relowner))) a WHERE a.grantee<>relowner) private FROM pg_class rel WHERE oid=$1::regclass",[t]))[0];assert.deepEqual(r,{owner:true,rls:true,policy_free:true,private:true});
  for(const sql of [`ALTER TABLE ${t} DISABLE ROW LEVEL SECURITY`,`CREATE POLICY accidental ON ${t} FOR SELECT USING(true)`,`ALTER TABLE ${t} OWNER TO ordinary_empty`])await rollback(async()=>{await db.exec(sql);await assert.rejects(db.exec(repaired),/effective sidecar containment failed/);});
 }
 assert.equal((await q('SELECT enabled FROM progression_command_control'))[0].enabled,false);
});
test('ordinary owner inheritance fails effective check even with no nonowner ACL; column-only runtime grant fails',async()=>{
 await rollback(async()=>{await db.exec('GRANT postgres TO ordinary_group');assert.equal(await access('ordinary_leaf',tables[0]),true);await assert.rejects(db.exec(repaired),/effective sidecar containment failed/);});
 await rollback(async()=>{await db.exec('GRANT SELECT(enabled) ON progression_command_control TO ordinary_leaf');assert.equal(await access('ordinary_leaf',tables[1]),false);await assert.rejects(db.exec(repaired),/effective sidecar containment failed/);});
});
test('known gameplay principals never inherit the platform exception, including service BYPASSRLS',async()=>{
 for(const role of ['anon','authenticated','service_role'])await rollback(async()=>{await db.exec(`GRANT authority_bridge TO ${role}`);assert.equal(await access(role,tables[0]),true);await assert.rejects(db.exec(repaired),/effective sidecar containment failed/);});
});
