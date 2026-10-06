/** Local prepared D2 SQL/Edge behavior; no hosted connections or concurrency claim. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const {build}=createRequire(import.meta.resolve('vite'))('esbuild');
const enginePath=process.argv[2];
if(!enginePath)throw Error('Supply pinned local PGlite module path; no network connection mode');
const {PGlite}=await import(pathToFileURL(resolve(enginePath)).href);
const sql=readFileSync('docs/operations/progression-001D-containment.sql','utf8');
const signatures=['apply_crafting_xp(uuid,integer)','stonebinder_commit_fuse(uuid,uuid,uuid,uuid,integer)',
 'commit_encounter_tick_v2(uuid,bigint,uuid,uuid,integer,integer,jsonb,jsonb,jsonb)',
 'award_party_member(uuid,integer,integer)','award_party_member(uuid,integer,integer,integer,integer)'];
async function database(){
 const db=new PGlite();
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
 CREATE ROLE custom_group; CREATE ROLE inherited_client; GRANT custom_group TO inherited_client;
 CREATE TABLE test_mutations(n integer); INSERT INTO test_mutations VALUES(0);`);
 for(const sig of signatures)await db.exec(`CREATE FUNCTION public.${sig} RETURNS void
 LANGUAGE sql SECURITY DEFINER AS 'UPDATE public.test_mutations SET n=n+1';
 GRANT EXECUTE ON FUNCTION public.${sig} TO PUBLIC,anon,authenticated,service_role,custom_group;`);
 return db;
}
test('prepared SQL denies all ordinary/custom/inherited callers, preserves owner and bodies',async()=>{
 const db=await database();try{
  const before=await db.query("SELECT oid,pg_get_functiondef(oid) body FROM pg_proc WHERE pronamespace='public'::regnamespace ORDER BY oid");
  await db.exec(sql);
  assert.deepEqual(await db.query("SELECT oid,pg_get_functiondef(oid) body FROM pg_proc WHERE pronamespace='public'::regnamespace ORDER BY oid"),before);
  for(const sig of signatures){
   for(const role of ['anon','authenticated','service_role','custom_group','inherited_client']){
    assert.equal((await db.query('SELECT has_function_privilege($1,$2,\'EXECUTE\') allowed',[role,'public.'+sig])).rows[0].allowed,false);
   }
   assert.equal((await db.query('SELECT has_function_privilege(\'postgres\',$1,\'EXECUTE\') allowed',['public.'+sig])).rows[0].allowed,true);
  }
  for(const role of ['anon','authenticated','service_role','inherited_client']){
   await db.exec(`SET ROLE ${role}`);
   await assert.rejects(db.query("SELECT public.apply_crafting_xp('00000000-0000-4000-8000-000000000001',100)"),/permission denied/);
   await db.exec('RESET ROLE');
  }
  assert.equal((await db.query('SELECT n FROM test_mutations')).rows[0].n,0);
 }finally{await db.close();}
});
test('missing target aborts earlier revocations; outer rollback restores original ACL',async()=>{
 const db=await database();try{
  await db.exec('DROP FUNCTION public.award_party_member(uuid,integer,integer,integer,integer); CREATE FUNCTION public.award_party_member(text) RETURNS void LANGUAGE sql AS $$ SELECT $$');
  await assert.rejects(db.exec(sql),/target missing/);
  assert.equal((await db.query("SELECT has_function_privilege('anon','public.apply_crafting_xp(uuid,integer)','EXECUTE') allowed")).rows[0].allowed,true);
 }finally{await db.close();}
 const full=await database();try{
  await full.exec('BEGIN');await full.exec(sql);await full.exec('ROLLBACK');
  assert.equal((await full.query("SELECT has_function_privilege('anon','public.apply_crafting_xp(uuid,integer)','EXECUTE') allowed")).rows[0].allowed,true);
 }finally{await full.close();}
});
async function handler(name){
 let captured;let envReads=0;let clientCalls=0;let dbWrites=0;
 globalThis.__capture=value=>{captured=value;};
 globalThis.Deno={serve:globalThis.__capture,env:{get(){envReads++;return 'local-test-value';}}};
 globalThis.__client=()=>{clientCalls++;return {
  auth:{getClaims:async()=>({data:{claims:{sub:'test-admin'}},error:null})},
  from(table){if(table!=='user_roles'){dbWrites++;throw Error('Unexpected DB access '+table);}
   return {select(){return this;},eq(){return this;},maybeSingle:async()=>({data:{role:'steward'}})};},
  rpc(){dbWrites++;throw Error('Unexpected RPC');}
 };};
 const output=await build({entryPoints:[`supabase/functions/${name}/index.ts`],bundle:true,write:false,format:'esm',platform:'node',
  plugins:[{name:'no-network-test-modules',setup(b){b.onResolve({filter:/^https:\/\//},a=>({path:a.path,namespace:'fixture'}));
   b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path.includes('http/server')?
    'export const serve=globalThis.__capture;':'export const createClient=globalThis.__client;'}));}}]});
 await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text+'\n// '+name).toString('base64'));
 return {call:captured,counts:()=>({envReads,clientCalls,dbWrites})};
}
for(const name of ['forge-craft-base','forge-apply-gem','stonebinder-fuse'])test(`${name} actual handler pauses before client/body/economy access`,async()=>{
 const h=await handler(name);
 for(const method of ['POST','GET']){
  const response=await h.call(new Request('https://local.invalid/'+name,{method,headers:{Authorization:'Bearer test'},...(method==='POST'?{body:'invalid JSON'}:{})}));
  assert.equal(response.status,503);assert.equal((await response.json()).code,'crafting_paused');
 }
 assert.equal((await h.call(new Request('https://local.invalid',{method:'OPTIONS'}))).status,200);
 assert.deepEqual(h.counts(),{envReads:0,clientCalls:0,dbWrites:0});
});
test('actual admin grant-xp handler rejects after admin validation without character writes',async()=>{
 const h=await handler('admin-users');
 const response=await h.call(new Request('https://local.invalid/?action=grant-xp',{method:'POST',headers:{Authorization:'Bearer test'},body:'invalid JSON'}));
 assert.equal(response.status,503);assert.equal((await response.json()).code,'progression_awards_paused');
 assert.equal(h.counts().dbWrites,0);assert.equal(h.counts().clientCalls,2);
 const source=readFileSync('supabase/functions/admin-users/index.ts','utf8');
 const block=source.slice(source.indexOf('// GRANT XP'),source.indexOf('if (action === "heal-character"'));
 assert.ok(block.includes('progression_awards_paused'));assert.ok(!block.includes('xpForNext'));
});
