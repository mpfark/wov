// Disposable localhost cluster only. Reduced schema/auth and cron registration double;
// complete canonical XP/resource/lifecycle functions and actual crafting/sale/consume bodies.
import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,readFile,access} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import net from 'node:net';
import postgres from 'postgres';
import {randomUUID} from 'node:crypto';
if(!process.argv[2])throw Error('Explicit local PostgreSQL bin required; no connection URL accepted');
const exe=n=>join(resolve(process.argv[2]),n+(process.platform==='win32'?'.exe':''));await access(exe('initdb'));
const root=await mkdtemp(join(tmpdir(),'wov-admin-material-'));const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
await promisify(execFile)(exe('initdb'),['-D',join(root,'data'),'-U','postgres','--auth=trust','--no-locale','--encoding=UTF8'],{windowsHide:true});
const ctl=args=>new Promise((res,rej)=>{const p=spawn(exe('pg_ctl'),args,{stdio:'ignore',windowsHide:true});p.once('error',rej);p.once('exit',n=>n===0?res():rej(Error('pg_ctl '+n)));});
await ctl(['-D',join(root,'data'),'-l',join(root,'server.log'),'-o',`-h 127.0.0.1 -p ${port}`,'-w','start']);
const clients=[];const connect=()=>{const c=postgres({host:'127.0.0.1',port,username:'postgres',database:'postgres',max:1,onnotice:()=>{}});clients.push(c);return c;};
const sql=connect();after(async()=>{for(const c of clients)await c.end({timeout:1});await ctl(['-D',join(root,'data'),'-m','immediate','-w','stop']);});
console.log((await sql`SELECT version() v`)[0].v);
const read=p=>readFile(new URL('../../../'+p,import.meta.url),'utf8').then(t=>t.replace(/\r\n/g,'\n'));
const c=await read('drizzle/migrations/0001_progression_001c_dormant_authority.sql'),e=await read('drizzle/migrations/0003_progression_001e_command_authority.sql'),r=await read('drizzle/migrations/0004_progression_001e_r2_xp_body_repair.sql'),f=await read('drizzle/migrations/0005_progression_001f_canonical_renown_respec_authority.sql');
function fn(t,n){const m=t.match(new RegExp('CREATE (?:OR REPLACE )?FUNCTION public\\.'+n+'\\('));assert(m,n);const a=t.slice(m.index),d=a.match(/\bAS (\$[a-z_]*\$)/i)[1],start=a.indexOf(d),end=a.indexOf(d,start+d.length);return a.slice(0,end+d.length)+';';}
function table(t,n){const start=t.indexOf('CREATE TABLE public.'+n+' ('),end=t.indexOf('\n);',start);assert(start>=0&&end>start,n);return t.slice(start,end+3);}
await sql.unsafe(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
CREATE SCHEMA auth;CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.actor',true),'')::uuid $$;
CREATE TABLE public.characters(id uuid PRIMARY KEY,user_id uuid NOT NULL,deleted_at timestamptz,current_node_id uuid,
 level int DEFAULT 1,xp int DEFAULT 0,gold int DEFAULT 100,hp int DEFAULT 24,cp int DEFAULT 30,mp int DEFAULT 100,
 max_hp int DEFAULT 24,max_cp int DEFAULT 30,max_mp int DEFAULT 100,str int DEFAULT 10,dex int DEFAULT 10,con int DEFAULT 10,
 int int DEFAULT 10,wis int DEFAULT 10,cha int DEFAULT 10,class text DEFAULT 'warrior',is_classless bool DEFAULT false,
 unspent_stat_points int DEFAULT 0,respec_points int DEFAULT 0,bhp int DEFAULT 0,bhp_trained int DEFAULT 0,rp_total_earned int DEFAULT 0);
CREATE TABLE public.classes(class_key text PRIMARY KEY,base_hp int,level_bonuses jsonb);
INSERT INTO public.classes VALUES('warrior',24,'{"str":1,"dex":1}');
CREATE TABLE public.nodes(id uuid PRIMARY KEY,is_blacksmith bool,is_jewelcrafter bool);
CREATE TABLE public.items(id uuid PRIMARY KEY,name text,slot text,origin_type text,rarity text,tier int,stats jsonb DEFAULT '{}');
CREATE TABLE public.character_materials(character_id uuid REFERENCES public.characters,material_key text,count int,PRIMARY KEY(character_id,material_key));
CREATE TABLE public.character_inventory(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),character_id uuid REFERENCES public.characters,item_id uuid REFERENCES public.items,current_durability int,applied_gems jsonb,stat_override jsonb,crafted_level int,equipped_slot text);
CREATE TABLE public.character_inventory_action_request(request_id uuid PRIMARY KEY,character_id uuid REFERENCES public.characters,action text NOT NULL,inventory_id uuid,arguments jsonb NOT NULL,result jsonb,created_at timestamptz DEFAULT now());`);
for(const n of ['progression_character_state','progression_receipt','progression_respec_milestone'])await sql.unsafe(table(c,n));
await sql.unsafe(table(e,'progression_class_growth_milestone'));
for(const n of ['progression_snapshot_internal','progression_class_config_internal','character_sync_derived_internal'])await sql.unsafe(fn(c,n));
await sql.unsafe(fn(r,'progression_apply_xp_internal'));
await sql.unsafe('REVOKE ALL ON FUNCTION public.progression_apply_xp_internal(uuid,uuid,text,numeric,jsonb) FROM PUBLIC,anon,authenticated,service_role');
await sql.unsafe(fn(e,'progression_verify_class_growth_internal'));
await sql.unsafe(e.match(/CREATE CONSTRAINT TRIGGER progression_verify_class_growth[\s\S]*?\(\);/)[0]);
await sql.unsafe(fn(f,'progression_refuse_raw_progression_write'));
await sql.unsafe('CREATE TRIGGER progression_refuse_raw_progression_write BEFORE UPDATE ON public.characters FOR EACH ROW EXECUTE FUNCTION public.progression_refuse_raw_progression_write()');
await sql.unsafe(`ALTER TABLE public.characters ADD movement_locked_until timestamptz;
ALTER TABLE public.items ADD item_type text DEFAULT 'equipment',ADD level int DEFAULT 1,ADD is_soulbound boolean DEFAULT false,ADD weapon_tag text;
CREATE TABLE public.node_encounter(id uuid PRIMARY KEY,node_id uuid,status text,claim_token uuid,claim_expires_at timestamptz);
CREATE TABLE public.node_fighter(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),encounter_id uuid,character_id uuid,present boolean);
CREATE TABLE public.node_creature(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),encounter_id uuid,is_alive boolean,hp int,engaged boolean);
CREATE TABLE public.character_stance(character_id uuid,ability_key text);
CREATE TABLE public.character_lifecycle_receipt(character_id uuid,operation text,actor_id uuid,reason text,result jsonb,purge_transaction xid8);
REVOKE ALL ON FUNCTION public.character_sync_derived_internal(uuid,boolean,boolean) FROM PUBLIC,anon,authenticated,service_role;`);
const lifecycle=await read('drizzle/migrations/0013_progression_001g_c2_reset_and_cutover.sql');await sql.unsafe(fn(lifecycle,'character_lifecycle_child_fence'));
for(const n of ['character_inventory','character_materials','character_inventory_action_request','progression_character_state','progression_receipt','progression_respec_milestone','progression_class_growth_milestone','node_fighter'])await sql.unsafe(`CREATE TRIGGER character_lifecycle_child_fence BEFORE INSERT OR UPDATE OR DELETE ON public.${n} FOR EACH ROW EXECUTE FUNCTION public.character_lifecycle_child_fence('character_id')`);
const stance=await read('supabase/migrations/20261001130000_combat2_character_persistent_stances.sql');await sql.unsafe(fn(stance,'combat2_refuse_invalid_stance_equipment_change'));await sql.unsafe('CREATE TRIGGER combat2_refuse_invalid_stance_equipment_change BEFORE UPDATE OF equipped_slot,current_durability OR DELETE ON public.character_inventory FOR EACH ROW EXECUTE FUNCTION public.combat2_refuse_invalid_stance_equipment_change()');
await sql.unsafe(`CREATE TABLE public.user_roles(user_id uuid NOT NULL,role text NOT NULL,UNIQUE(user_id,role));
CREATE TABLE public.materials(key text PRIMARY KEY,name text,tradeable boolean DEFAULT true,value int DEFAULT 1);
ALTER TABLE public.character_materials ALTER count SET NOT NULL;
ALTER TABLE public.character_materials ADD updated_at timestamptz DEFAULT now();
ALTER TABLE public.character_materials ADD CONSTRAINT material_catalogue FOREIGN KEY(material_key) REFERENCES public.materials ON DELETE CASCADE;
CREATE SCHEMA cron;CREATE TABLE cron.job(jobid bigserial PRIMARY KEY,jobname text,schedule text,command text);
CREATE FUNCTION cron.schedule(text,text,text) RETURNS bigint LANGUAGE sql AS $$ INSERT INTO cron.job(jobname,schedule,command) VALUES($1,$2,$3) RETURNING jobid $$;
INSERT INTO public.materials(key,name) SELECT x,x FROM unnest(ARRAY['salvage','garnet','topaz','emerald','sapphire','pearl','amethyst','jade']) x;
REVOKE ALL ON public.character_materials FROM PUBLIC,anon,authenticated;`);
// Local simulation of owner-supplied postgres/public platform defaults; never executed hosted.
await sql.unsafe(`CREATE ROLE sandbox_exec;CREATE ROLE sandbox_exec_gpclaklkaolyzfnooajt;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT,INSERT ON TABLES TO sandbox_exec,sandbox_exec_gpclaklkaolyzfnooajt;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO sandbox_exec_gpclaklkaolyzfnooajt;
CREATE TABLE public.platform_acl_control(id integer);`);
const defaults=()=>sql`SELECT defaclrole::regrole::text owner,defaclnamespace,defaclobjtype,defaclacl::text acl FROM pg_default_acl ORDER BY defaclrole,defaclnamespace,defaclobjtype`;
const originalDefaults=await defaults(),controlAcl=(await sql`SELECT relacl::text acl FROM pg_class WHERE oid='public.platform_acl_control'::regclass`)[0].acl;
const original=(await promisify(execFile)('git',['show','aaf3cd533304a7b56df5b44fbed287567130dece:docs/operations/idea-025-admin-material-grant.sql'])).stdout;
await assert.rejects(sql.begin(t=>t.unsafe(original)),/material_grant_authority_drift/);
assert.equal((await sql`SELECT to_regclass('public.admin_material_grant_replay') id`)[0].id,null);
assert.equal((await sql`SELECT count(*)::int n FROM cron.job`)[0].n,0);
console.log('Original private-table ACL blocker reproduced; installation fully rolled back.');
const candidate=await read('docs/operations/idea-025-admin-material-grant.sql');await sql.begin(t=>t.unsafe(candidate));
assert.equal((await sql`SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') hash FROM pg_proc WHERE oid='public.admin_material_grant(uuid,uuid,uuid,text,integer,text)'::regprocedure`)[0].hash,'dbc3ebacaa629839a3b91bbbe044e094f8f3ea9afe5369effeab22a31cf53c52');
assert.equal((await sql`SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') hash FROM pg_proc WHERE oid='public.admin_material_grant_log_expire_internal()'::regprocedure`)[0].hash,'2f98abe67a7a1a90981817134bea4600b671b1b5c36854f5747702a8b78e42bb');
const catalogue=await read('supabase/migrations/20260511100538_ba7e2e71-28ff-4b13-b12e-c8f98448b8f7.sql');await sql.unsafe(fn(catalogue,'consume_material'));
await sql.unsafe(await read('docs/operations/idea-015-base-crafting.sql'));
await sql.unsafe(await read('docs/operations/legacy-001D3-atomic-material-sale.sql'));
const steward=randomUUID(),overlord=randomUUID(),owner=randomUUID(),node=randomUUID(),item=randomUUID();
await sql`INSERT INTO public.user_roles VALUES(${steward},'steward'),(${overlord},'overlord')`;
await sql`INSERT INTO public.nodes VALUES(${node},true,true)`;await sql`INSERT INTO public.items(id,name,slot,origin_type,rarity,tier) VALUES(${item},'Test helm','head','plain_base','common',1)`;
async function target(count=0,user=owner){const id=randomUUID();await sql`INSERT INTO public.characters(id,user_id,current_node_id) VALUES(${id},${user},${node})`;if(count!==null)await sql`INSERT INTO public.character_materials(character_id,material_key,count) VALUES(${id},'salvage',${count})`;return id;}
async function grant(id,{actor=steward,key='salvage',amount=10,request=randomUUID(),reason='Approved support',db=sql}={}){return (await db`SELECT public.admin_material_grant(${actor},${id},${request},${key},${amount},${reason}) result`)[0].result;}
async function balance(id,key='salvage'){return (await sql`SELECT count FROM public.character_materials WHERE character_id=${id} AND material_key=${key}`)[0]?.count;}
async function waitBlocked(pid){const end=Date.now()+5000;while(Date.now()<end){if((await sql`SELECT cardinality(pg_blocking_pids(${pid}))>0 b`)[0].b)return;await new Promise(r=>setTimeout(r,10));}throw Error('No observed blocking');}
async function pair(){const a=connect(),b=connect();for(const db of [a,b])await db.unsafe("SET statement_timeout='8s';SET lock_timeout='6s';SET default_transaction_isolation='read committed'");return {a,b,pid:(await b`SELECT pg_backend_pid() p`)[0].p};}
test('seven allowed keys, missing rows and approved per-role caps',async()=>{for(const actor of [steward,overlord])for(const key of ['salvage','garnet','topaz','emerald','sapphire','pearl','amethyst']){const id=await target(null),cap=actor===steward?(key==='salvage'?1000:25):(key==='salvage'?100000:1000);await grant(id,{actor,key,amount:cap});assert.equal(await balance(id,key),cap);await assert.rejects(grant(id,{actor,key,amount:cap+1}),/material_grant_cap/);}});
test('role, browser context, self, deleted and missing targets refuse; Overlord own grant flagged',async()=>{const id=await target();await assert.rejects(grant(id,{actor:owner}),/unauthorized/);await sql`SELECT set_config('test.actor',${steward},false)`;await assert.rejects(grant(id),/unauthorized/);await sql`SELECT set_config('test.actor','',false)`;await assert.rejects(grant(await target(0,steward)),/self_denied/);assert.equal((await grant(await target(0,overlord),{actor:overlord})).self_grant,true);await sql`UPDATE public.characters SET deleted_at=now() WHERE id=${id}`;await assert.rejects(grant(id),/inactive_target/);await assert.rejects(grant(randomUUID()),/invalid_target/);});
test('invalid key/quantity/reason, catalogue absence, negative and overflowing balance',async()=>{const id=await target();for(const x of [{key:'jade'},{key:'bogus'},{amount:0},{amount:-1},{reason:''},{reason:'\t\n'},{reason:'x'.repeat(1001)}])await assert.rejects(grant(id,x),/invalid_request/);await sql`DELETE FROM public.materials WHERE key='amethyst'`;await assert.rejects(grant(id,{key:'amethyst'}),/catalogue_missing/);await sql`INSERT INTO public.materials(key,name) VALUES('amethyst','amethyst')`;await assert.rejects(grant(await target(-1)),/invalid_balance/);await assert.rejects(grant(await target(2147483647)),/overflow/);assert.equal(await balance(id),0);});
test('exact result replay, bound actor/target/key/amount/reason conflicts, fresh UUID intentional repeat',async()=>{const id=await target(),request=randomUUID();const first=await grant(id,{request});assert.deepEqual(await grant(id,{request}),first);for(const x of [{actor:overlord},{key:'garnet'},{amount:11},{reason:'different'}])await assert.rejects(grant(id,{request,...x}),/request_conflict/);await assert.rejects(grant(await target(),{request}),/request_conflict/);assert.equal(await balance(id),10);await grant(id);assert.equal(await balance(id),20);});
test('current role/self authority rechecked on replay; successful replay does not require live target state',async()=>{const id=await target(),request=randomUUID();await grant(id,{request});await sql`UPDATE public.user_roles SET role='player' WHERE user_id=${steward}`;await assert.rejects(grant(id,{request}),/unauthorized/);await sql`UPDATE public.user_roles SET role='steward' WHERE user_id=${steward}`;await sql`UPDATE public.characters SET deleted_at=now() WHERE id=${id}`;assert.equal((await grant(id,{request})).grant_outcome,'committed');assert.equal(await balance(id),10);});
test('audit insertion failure rolls back balance and completion; same UUID can retry after rollback',async()=>{const id=await target(),request=randomUUID();await sql.unsafe("CREATE FUNCTION public.fail_grant_log() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture audit failure'; END $$;CREATE TRIGGER fail_grant_log BEFORE INSERT ON public.admin_material_grant_log FOR EACH ROW EXECUTE FUNCTION public.fail_grant_log()");await assert.rejects(grant(id,{request}),/fixture audit failure/);assert.equal(await balance(id),0);assert.equal((await sql`SELECT count(*)::int n FROM public.admin_material_grant_replay WHERE request_id=${request}`)[0].n,0);await sql.unsafe('DROP TRIGGER fail_grant_log ON public.admin_material_grant_log');await grant(id,{request});assert.equal(await balance(id),10);});
test('12-month detail deletion preserves exact replay with no plaintext audit in tombstone',async()=>{const id=await target(),request=randomUUID();const first=await grant(id,{request});await sql`UPDATE public.admin_material_grant_log SET expires_at=now()-interval '1 second' WHERE request_id=${request}`;await sql`SELECT public.admin_material_grant_log_expire_internal()`;assert.equal((await sql`SELECT count(*)::int n FROM public.admin_material_grant_log WHERE request_id=${request}`)[0].n,0);assert.deepEqual(await grant(id,{request}),first);assert.equal(await balance(id),10);assert.deepEqual((await sql`SELECT column_name FROM information_schema.columns WHERE table_name='admin_material_grant_replay' ORDER BY ordinal_position`).map(x=>x.column_name),['request_id','request_digest','self_grant']);});
test('browser/table denial, trusted service RPC and owner-only expiry; duplicate installer refuses',async()=>{const sig='public.admin_material_grant(uuid,uuid,uuid,text,integer,text)';for(const role of ['anon','authenticated']){assert.equal((await sql`SELECT has_function_privilege(${role},${sig},'EXECUTE') ok`)[0].ok,false);for(const table of ['admin_material_grant_log','admin_material_grant_replay','character_materials'])assert.equal((await sql`SELECT has_table_privilege(${role},${table},'INSERT') ok`)[0].ok,false);}assert.equal((await sql`SELECT has_function_privilege('service_role',${sig},'EXECUTE') ok`)[0].ok,true);assert.equal((await sql`SELECT has_function_privilege('service_role','public.admin_material_grant_log_expire_internal()','EXECUTE') ok`)[0].ok,false);await assert.rejects(sql.begin(t=>t.unsafe(candidate)),/exists_reconcile/);assert.equal((await sql`SELECT count(*)::int n FROM cron.job`)[0].n,1);});
test('independent sessions duplicate grant waits and returns exact original result',async()=>{const id=await target(),request=randomUUID(),{a,b,pid}=await pair();await a.unsafe('BEGIN');const first=await grant(id,{request,db:a});const pending=grant(id,{request,db:b});await waitBlocked(pid);await a.unsafe('COMMIT');assert.deepEqual(await pending,first);assert.equal(await balance(id),10);});
test('independent sessions distinct grants serialize character and add without loss, including missing row',async()=>{const id=await target(null),{a,b,pid}=await pair();await a.unsafe('BEGIN');await grant(id,{db:a});const pending=grant(id,{amount:20,db:b});await waitBlocked(pid);await a.unsafe('COMMIT');await pending;assert.equal(await balance(id),30);});
test('independent sessions grant waits for actual consume_material row lock; additive balance preserves consumption',async()=>{const id=await target(20),{a,b,pid}=await pair();await a.unsafe('BEGIN');assert.equal((await a`SELECT public.consume_material(${id},'salvage',7) ok`)[0].ok,true);const pending=grant(id,{db:b});await waitBlocked(pid);await a.unsafe('COMMIT');await pending;assert.equal(await balance(id),23);});
test('independent sessions canonical base craft first, then grant; real XP/inventory and exact material arithmetic',async()=>{const id=await target(20),{a,b,pid}=await pair();await a.unsafe('BEGIN');await a`SELECT public.base_craft_internal(${owner},${id},${item},${randomUUID()})`;const pending=grant(id,{db:b});await waitBlocked(pid);await a.unsafe('COMMIT');await pending;assert.equal(await balance(id),23);assert.equal((await sql`SELECT xp FROM public.characters WHERE id=${id}`)[0].xp,25);assert.equal((await sql`SELECT count(*)::int n FROM public.character_inventory WHERE character_id=${id}`)[0].n,1);});
test('independent sessions grant first, then canonical sale; no stale material or gold overwrite',async()=>{const id=await target(20),{a,b,pid}=await pair();await a.unsafe('BEGIN');await grant(id,{db:a});const pending=b`SELECT public.material_sale_internal(${owner},${id},'salvage',7,${randomUUID()})`.execute();await waitBlocked(pid);await a.unsafe('COMMIT');await pending;assert.equal(await balance(id),23);assert.equal((await sql`SELECT gold FROM public.characters WHERE id=${id}`)[0].gold,107);});
test('independent sessions failed grant releases locks; waiting exact UUID retries once',async()=>{const id=await target(),request=randomUUID(),{a,b,pid}=await pair();await a.unsafe('BEGIN');await grant(id,{request,db:a});const pending=grant(id,{request,db:b});await waitBlocked(pid);await a.unsafe('ROLLBACK');await pending;assert.equal(await balance(id),10);});

test('ambiguous actor roles fail closed, successful direct service call and actual browser denial',async()=>{const id=await target();await sql`INSERT INTO public.user_roles VALUES(${steward},'overlord')`;await assert.rejects(grant(id),/unauthorized/);await sql`DELETE FROM public.user_roles WHERE user_id=${steward} AND role='overlord'`;const service=connect();await service.unsafe('SET ROLE service_role');await grant(id,{db:service});assert.equal(await balance(id),10);const browser=connect();await browser.unsafe('SET ROLE authenticated');await assert.rejects(grant(id,{db:browser}),e=>e.code==='42501');});
test('material grants preserve character resources/progression/inventory, including a dead non-deleted lifecycle target',async()=>{const id=await target();await sql`UPDATE public.characters SET hp=0 WHERE id=${id}`;const before=(await sql`SELECT to_jsonb(c) state FROM public.characters c WHERE id=${id}`)[0].state;await grant(id);assert.deepEqual((await sql`SELECT to_jsonb(c) state FROM public.characters c WHERE id=${id}`)[0].state,before);assert.equal((await sql`SELECT count(*)::int n FROM public.character_inventory WHERE character_id=${id}`)[0].n,0);assert.equal((await sql`SELECT count(*)::int n FROM public.progression_receipt WHERE character_id=${id}`)[0].n,0);});
test('independent sessions character lock permits lifecycle KEY SHARE while catalogue wait blocks grant',async()=>{const id=await target(20),{a,b,pid}=await pair();await a.unsafe('BEGIN');await a`SELECT key FROM public.materials WHERE key='salvage' FOR UPDATE`;const pending=grant(id,{db:b});await waitBlocked(pid);assert.equal((await a`SELECT public.consume_material(${id},'salvage',7) ok`)[0].ok,true);await a.unsafe('COMMIT');await pending;assert.equal(await balance(id),23);});

test('exact platform table grants removed effectively; defaults/unrelated table and anticipated function grants unchanged',async()=>{
 for(const table of ['admin_material_grant_replay','admin_material_grant_log']){
  const meta=(await sql`SELECT relowner::regrole::text owner,relrowsecurity,relacl FROM pg_class WHERE oid=${('public.'+table)}::regclass`)[0];assert.equal(meta.owner,'postgres');assert.equal(meta.relrowsecurity,true);
  for(const role of ['anon','authenticated','service_role','sandbox_exec','sandbox_exec_gpclaklkaolyzfnooajt']){
   assert.equal((await sql`SELECT has_table_privilege(${role},${table},'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') ok`)[0].ok,false);
   assert.equal((await sql`SELECT has_any_column_privilege(${role},${table},'SELECT,INSERT,UPDATE,REFERENCES') ok`)[0].ok,false);
  }
  assert.equal((await sql`SELECT count(*)::int n FROM pg_class r,LATERAL aclexplode(r.relacl) a WHERE r.oid=${('public.'+table)}::regclass AND a.grantee<>r.relowner`)[0].n,0);
  assert.equal((await sql`SELECT count(*)::int n FROM pg_roles role_entry CROSS JOIN pg_class r,LATERAL aclexplode(acldefault('r',r.relowner)) a WHERE role_entry.rolname IN('anon','authenticated','service_role','sandbox_exec','sandbox_exec_gpclaklkaolyzfnooajt') AND r.oid=${('public.'+table)}::regclass AND has_table_privilege(role_entry.oid,r.oid,a.privilege_type)`)[0].n,0);
 }
 assert.deepEqual(await defaults(),originalDefaults);assert.equal((await sql`SELECT relacl::text acl FROM pg_class WHERE oid='public.platform_acl_control'::regclass`)[0].acl,controlAcl);
 for(const f of ['public.admin_material_grant(uuid,uuid,uuid,text,integer,text)','public.admin_material_grant_log_expire_internal()'])assert.equal((await sql`SELECT has_function_privilege('sandbox_exec_gpclaklkaolyzfnooajt',${f},'EXECUTE') ok`)[0].ok,true);
});
test('unexpected inherited table access still stops installation instead of revoking unrelated role membership',async()=>{
 await assert.rejects(sql.begin(async t=>{await t.unsafe(`DROP TABLE public.admin_material_grant_log;DROP TABLE public.admin_material_grant_replay;
DROP FUNCTION public.admin_material_grant(uuid,uuid,uuid,text,integer,text);DROP FUNCTION public.admin_material_grant_log_expire_internal();DELETE FROM cron.job WHERE jobname='wov-admin-material-reason-retention';GRANT pg_read_all_data TO sandbox_exec;`);await t.unsafe(candidate);}),/material_grant_authority_drift/);
 assert.deepEqual(await defaults(),originalDefaults);assert.equal((await sql`SELECT has_table_privilege('sandbox_exec','public.admin_material_grant_log','SELECT') ok`)[0].ok,false);
});
