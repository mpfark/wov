/** Local PGlite 0.3.14 only; exact repair SQL, real ACL/DML checks; no command activation. */
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readdirSync} from 'node:fs';
import ts from 'typescript';
import {payload,columns,protectedColumns,unprotectedColumns,browserColumns,read,check} from './prepare-progression-001F-R1.mjs';
import {definition,dependencies,payload as ePayload} from './prepare-progression-001E.mjs';
import {payload as fPayload} from './prepare-progression-001F.mjs';
const {PGlite}=await import(pathToFileURL(resolve(process.argv[2])).href);
let db;const q=async s=>(await db.query(s)).rows;
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
function assertAclOnly(sql){assert.doesNotMatch(sql,/\bUPDATE\s+(?:public\.)?\w+\s+SET\b|\b(?:INSERT|DELETE|TRUNCATE)\s+(?:INTO|FROM|TABLE)\b|\b(?:CREATE|ALTER|DROP)\s+(?:OR REPLACE\s+)?(?:FUNCTION|TABLE|TRIGGER)\b/i);}
async function rollback(fn){await db.exec('BEGIN');try{await fn();}finally{await db.exec('ROLLBACK');}}
async function asService(sql){await db.exec('SAVEPOINT service_dml;SET ROLE service_role');try{return await db.exec(sql);}catch(error){await db.exec('ROLLBACK TO SAVEPOINT service_dml');throw error;}finally{await db.exec('RESET ROLE;RELEASE SAVEPOINT service_dml');}}
const dataTables=['characters','progression_character_state','progression_receipt','progression_class_growth_milestone','progression_respec_milestone','progression_command_control','character_inventory','node_encounter','node_fighter'];
// Never SELECT key rows/material, even in fixture. Trigger sentinel independently detects key DML.
const data=async()=>Object.fromEntries(await Promise.all(dataTables.map(async t=>[t,await q(`SELECT to_jsonb(t) v FROM ${t} t ORDER BY to_jsonb(t)::text`)])));
before(async()=>{
 db=new PGlite();
 await db.exec(read('scripts/progression-001C-sql.test.mjs').match(/const fixture=`([\s\S]*?)`;/)[1]);
 await db.exec(read('scripts/progression-001E-sql.test.mjs').match(/const extra=`([\s\S]*?)`;/)[1]);
 const existing=(await q("SELECT attname FROM pg_attribute WHERE attrelid='characters'::regclass AND attnum>0 AND NOT attisdropped")).map(r=>r.attname);
 const row=read('src/integrations/supabase/types.ts').match(/      characters: \{\n        Row: \{([\s\S]*?)\n        \}/)[1];
 for(const c of columns.filter(c=>!existing.includes(c))){
  const type=row.match(new RegExp(`          ${c}: (.+)`))[1];
  const sqlType=type.includes('number')?'integer':type.includes('boolean')?'boolean':type.includes('Json')?'jsonb':c==='portrait_generated_at'?'timestamptz':'text';
  await db.exec(`ALTER TABLE characters ADD "${c}" ${sqlType}`);
 }
 await db.exec(`GRANT UPDATE(${browserColumns.join(',')}) ON characters TO authenticated`);
 for(const k of ['classless','wizard','warrior'])await db.query('INSERT INTO classes(class_key,base_hp,level_bonuses) VALUES($1,18,$2)',[k,{str:0,dex:0,con:0,int:0,wis:0,cha:0}]);
 await db.exec(read('docs/operations/progression-001C-authority.sql'));
 for(const [name,,sql]of dependencies.slice(5))await db.exec(definition(sql,name).sql);
 for(const [path,name]of [['supabase/migrations/20260629080249_d6091f9a-cb36-4b1f-9beb-4966956f5e93.sql','restrict_party_leader_updates'],['supabase/migrations/20261001130000_combat2_character_persistent_stances.sql','combat2_refuse_invalid_stance_class_change']])await db.exec(definition(read(path),name).sql);
 await db.exec(ePayload());
 await db.exec(read('scripts/progression-001F-sql.test.mjs').match(/const hmacFixture=`([\s\S]*?)`;/)[1]);
 await db.exec(fPayload().replace(/IF NOT EXISTS\(SELECT 1 FROM pg_extension WHERE extname='pgcrypto'[^\n]*\)\n OR /,'IF '));
 // The unchanged historical F payload itself reproduces the supplied hosted failure.
 assert.deepEqual(await q("SELECT has_table_privilege('service_role','characters','UPDATE') table_update,has_any_column_privilege('service_role','characters','UPDATE') any_column_update"),[{table_update:false,any_column_update:false}]);
 await db.exec(`INSERT INTO characters(id,user_id,rp_total_earned) VALUES('${id}','${id}',0);
 CREATE FUNCTION test_no_key_dml() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'key data mutation'; END $$;
 CREATE TRIGGER test_no_key_dml BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON progression_renown_key FOR EACH STATEMENT EXECUTE FUNCTION test_no_key_dml();`);
});
after(async()=>{assert.deepEqual(await q('SELECT enabled FROM progression_command_control'),[{enabled:false}]);await db.close();});
test('01 measure real table-revoke semantics; historical grant/revoke loses effective hp UPDATE',async()=>{
 await rollback(async()=>{
  await db.exec('CREATE ROLE acl_probe;CREATE TABLE acl_probe(hp integer,str integer);GRANT UPDATE ON acl_probe TO acl_probe;GRANT UPDATE(hp) ON acl_probe TO acl_probe;REVOKE UPDATE ON acl_probe FROM acl_probe;');
  const result=await q("SELECT version(),has_table_privilege('acl_probe','acl_probe','UPDATE') table_update,has_column_privilege('acl_probe','acl_probe','hp','UPDATE') hp_update");
  console.log('ACL semantics probe:',JSON.stringify(result));
  assert.equal(result[0].table_update,false);
  // PG clears explicitly granted column UPDATE on table REVOKE. Pin the measured engine result.
  assert.equal(result[0].hp_update,false);
 });
});
test('02 deterministic manifest, inventory and safe ordering; original F rejected by order contract',()=>{
 check();const sql=payload();
 assert.equal(fPayload(),read('docs/operations/progression-001F-cutover.sql'),'historical F deterministic generator still reproduces installed bytes');
 const order=s=>s.indexOf('REVOKE UPDATE ON public.characters FROM service_role;')<s.indexOf('GRANT UPDATE(');
 assert.ok(order(sql));assert.equal(order(read('docs/operations/progression-001F-cutover.sql')),false);
 assert.equal(columns.length,53);assert.equal(protectedColumns.length,15);assert.equal(unprotectedColumns.length,38);
 assert.equal(new Set([...protectedColumns,...unprotectedColumns]).size,53);
 assert.doesNotMatch(sql,/\b(?:INSERT|DELETE|TRUNCATE)\s+(?:INTO|FROM|TABLE)|\bUPDATE\s+public\.|CREATE\s+(?:OR REPLACE\s+)?FUNCTION|ALTER\s|GRANT UPDATE ON/i);
 assert.doesNotMatch(sql,/FROM public\.progression_renown_key\b/);
 assertAclOnly(sql);
});
test('03 repair preserves all non-key fixture data and authority; restores complete effective partition',async()=>{
 await rollback(async()=>{const pre=await data();await db.exec(payload());assert.deepEqual(await data(),pre);
  for(const c of columns){assert.equal((await q(`SELECT has_column_privilege('service_role','characters','${c}','UPDATE') v`))[0].v,unprotectedColumns.includes(c),c);}
  assert.equal((await q("SELECT has_table_privilege('service_role','characters','UPDATE') v"))[0].v,false);
 });
});
test('04 actual service DML gold,hp,node and all three real portrait fields succeeds',async()=>{
 await rollback(async()=>{await db.exec(payload());
  for(const sql of [`UPDATE characters SET gold=17 WHERE id='${id}'`,`UPDATE characters SET hp=0 WHERE id='${id}'`,`UPDATE characters SET current_node_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' WHERE id='${id}'`,`UPDATE characters SET portrait_url='fixture://portrait',portrait_metadata='{"fixture":true}',portrait_generated_at='2026-10-07T00:00:00Z' WHERE id='${id}'`])await asService(sql);
  const r=(await q(`SELECT gold,hp,current_node_id,portrait_url,portrait_metadata,portrait_generated_at FROM characters WHERE id='${id}'`))[0];
  assert.equal(r.gold,17);assert.equal(r.hp,0);assert.equal(r.current_node_id,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');assert.equal(r.portrait_url,'fixture://portrait');assert.deepEqual(r.portrait_metadata,{fixture:true});assert.ok(r.portrait_generated_at);
 });
});
test('05 each protected raw service write is denied',async()=>{
 for(const c of protectedColumns)await rollback(async()=>{await db.exec(payload());await assert.rejects(asService(`UPDATE characters SET "${c}"="${c}" WHERE id='${id}'`),/permission denied/);});
});
test('06 schema drift, browser drift, function identity/ACL drift, key containment and overloaded command abort',async()=>{
 for(const [drift,reason]of [
  ['ALTER TABLE characters ADD future_column integer','inventory drift'],
  ['ALTER TABLE characters DROP COLUMN gold','inventory drift'],
  ['REVOKE UPDATE(portrait_url) ON characters FROM authenticated','browser preference drift'],
  ['GRANT UPDATE(hp) ON characters TO service_role','expected service UPDATE loss'],
  ['GRANT UPDATE ON characters TO service_role','expected service UPDATE loss'],
  ['ALTER FUNCTION progression_validate_fresh_internal(uuid,numeric,text) SECURITY INVOKER','function identity drift'],
  ['GRANT EXECUTE ON FUNCTION progression_validate_fresh_internal(uuid,numeric,text) TO authenticated','function ACL drift'],
  ['GRANT SELECT(key_material) ON progression_renown_key TO service_role','containment drift'],
  ['ALTER TABLE progression_renown_key ADD CONSTRAINT unreviewed_key_check CHECK(key_version<100)','key metadata drift'],
  ['CREATE FUNCTION progression_command(uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT NULL::jsonb $$','command/control drift'],
  ['DROP TRIGGER progression_refuse_raw_progression_write ON characters','fence trigger drift'],
  ['ALTER TABLE characters OWNER TO service_role','character owner drift'],
  ['GRANT EXECUTE ON FUNCTION train_renown_stat(uuid,text) TO authenticated','legacy Renown/receipt drift'],
 ])await rollback(async()=>{await db.exec(drift);await assert.rejects(db.exec(payload()),new RegExp(reason));});
});
test('07 final assertions catch missing unprotected, protected grant, broad grant, authority mutation and activation text',async()=>{
 for(const [extra,reason]of [
  ['REVOKE UPDATE(hp) ON characters FROM service_role;','missing unprotected UPDATE'],
  ['GRANT UPDATE(str) ON characters TO service_role;','protected UPDATE'],
  ['GRANT UPDATE ON characters TO service_role;','table UPDATE restored'],
  ['REVOKE EXECUTE ON FUNCTION progression_command(uuid,uuid,uuid,numeric,text,jsonb,text,text) FROM service_role;','unrelated authority/control/ACL mutation'],
 ])await rollback(async()=>{await assert.rejects(db.exec(payload().replace(' -- E. Effective privileges',extra+'\n -- E. Effective privileges')),new RegExp(reason));});
 // Activation is tested statically; no fixture or actual control row is ever set true.
 assert.match(payload(),/singleton AND enabled=false/g);assert.doesNotMatch(payload(),/SET\s+enabled\s*=\s*true/i);
 assert.ok(payload().includes('NOT EXISTS(SELECT 1 FROM public.progression_command_control WHERE singleton AND enabled=false)'));
 assert.throws(()=>assertAclOnly(payload()+'UPDATE public.progression_command_control SET enabled=true;'));
 assert.throws(()=>assertAclOnly(payload()+'ALTER FUNCTION public.progression_command(uuid,uuid,uuid,numeric,text,jsonb,text,text) SECURITY INVOKER;'));
});
test('08 historical F postconditions missed unrelated privileges; old grant-before-revoke repair fails new checks',async()=>{
 await rollback(async()=>{
  const old=payload().replace(` GRANT UPDATE(${unprotectedColumns.join(',')}) ON public.characters TO service_role;`,'').replace(' REVOKE UPDATE ON public.characters FROM service_role;',` GRANT UPDATE(${unprotectedColumns.join(',')}) ON public.characters TO service_role;\n REVOKE UPDATE ON public.characters FROM service_role;`);
  await assert.rejects(db.exec(old),/missing unprotected UPDATE/);
 });
});
test('09 complete current Edge direct characters UPDATE writer inventory and reviewed payload columns',()=>{
 const writers=[];
 function walk(dir){for(const e of readdirSync(dir,{withFileTypes:true})){const path=dir+'/'+e.name;if(e.isDirectory())walk(path);else if(path.endsWith('.ts')){
  const ast=ts.createSourceFile(path,read(path),ts.ScriptTarget.Latest,true);
  function visit(n){if(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&n.expression.name.text==='update'){
   let base=n.expression.expression;
   while(ts.isCallExpression(base)&&ts.isPropertyAccessExpression(base.expression)){
    if(base.expression.name.text==='from'&&base.arguments[0]&&ts.isStringLiteral(base.arguments[0])&&base.arguments[0].text==='characters')writers.push(path);
    base=base.expression.expression;
   }
  }ts.forEachChild(n,visit);}visit(ast);
 }}}walk('supabase/functions');
 assert.deepEqual(writers.sort(),[...Array(7).fill('supabase/functions/admin-users/index.ts'),'supabase/functions/ai-character-portrait/index.ts','supabase/functions/forge-strip/index.ts','supabase/functions/sell-material/index.ts'].sort());
 for(const c of ['gold','hp','current_node_id','portrait_url','portrait_metadata','portrait_generated_at','name','max_hp','ac','gender','max_cp','cp','max_mp','mp'])assert.ok(unprotectedColumns.includes(c),c);
 const portrait=read('supabase/functions/ai-character-portrait/index.ts').match(/\.update\(\{([\s\S]*?)\}\)/)[1];
 assert.deepEqual([...portrait.matchAll(/^\s*(\w+):/gm)].map(m=>m[1]).sort(),['portrait_generated_at','portrait_metadata','portrait_url']);
});
