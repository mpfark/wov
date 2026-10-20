// Disposable localhost cluster only; execute extracted complete canonical bodies, not migrations.
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
const root=await mkdtemp(join(tmpdir(),'wov-craft-'));const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
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
const candidate=await read('docs/operations/idea-015-base-crafting.sql');await sql.begin(t=>t.unsafe(candidate));
const actor=randomUUID(),node=randomUUID(),item=randomUUID();
await sql`INSERT INTO public.nodes VALUES(${node},true,true)`;await sql`INSERT INTO public.items(id,name,slot,origin_type,rarity,tier) VALUES(${item},'Iron Helm','head','plain_base','common',1)`;
async function setup({gold=100,stock=100,level=1,xp=0}={}){const id=randomUUID();await sql`INSERT INTO public.characters(id,user_id,current_node_id,gold,level,xp) VALUES(${id},${actor},${node},${gold},${level},${xp})`;await sql`INSERT INTO public.character_materials VALUES(${id},'salvage',${stock})`;return id;}
async function craft(id,event=randomUUID(),i=item,a=actor,db=sql){return (await db`SELECT public.base_craft_internal(${a},${id},${i},${event}) result`)[0].result;}
async function state(id){return (await sql`SELECT gold,xp,level,(SELECT count FROM public.character_materials WHERE character_id=${id}) stock,(SELECT count(*)::int FROM public.character_inventory WHERE character_id=${id}) inventory,(SELECT count(*)::int FROM public.character_inventory_action_request WHERE character_id=${id}) receipts FROM public.characters WHERE id=${id}`)[0];}
test('level1 tier1 exact costs, canonical craft receipt and replay/conflict',async()=>{const id=await setup(),event=randomUUID();const a=await craft(id,event);assert.equal(a.xp_awarded,25);assert.equal(a.salvage_spent,7);assert.equal(a.crafted_level,1);assert.deepEqual(await state(id),{gold:95,xp:25,level:1,stock:93,inventory:1,receipts:1});assert.equal((await craft(id,event)).inventory_id,a.inventory_id);await assert.rejects(craft(id,event,randomUUID()),/request_id_conflict/);assert.equal((await sql`SELECT source FROM public.progression_receipt WHERE event_id=${event}`)[0].source,'craft_completion');});
test('insufficient/negative/missing salvage and gold refuse atomically',async()=>{for(const stock of [6,-1,0]){const id=await setup({stock});const before=await state(id);await assert.rejects(craft(id),/craft_insufficient_materials/);assert.deepEqual(await state(id),before);}const id=await setup({gold:4});await assert.rejects(craft(id),/craft_insufficient_gold/);assert.equal((await state(id)).inventory,0);});
test('owner, lifecycle, station, item and tier are authoritative',async()=>{const id=await setup();await assert.rejects(craft(id,randomUUID(),item,randomUUID()),/craft_not_authorized/);await sql`UPDATE public.characters SET deleted_at=now() WHERE id=${id}`;await assert.rejects(craft(id),/craft_inactive/);await sql`UPDATE public.characters SET deleted_at=null,hp=0 WHERE id=${id}`;await assert.rejects(craft(id),/craft_inactive/);await sql`UPDATE public.characters SET hp=24,current_node_id=null WHERE id=${id}`;await assert.rejects(craft(id),/craft_wrong_station/);await sql`UPDATE public.characters SET current_node_id=${node} WHERE id=${id}`;const high=randomUUID();await sql`INSERT INTO public.items(id,name,slot,origin_type,rarity,tier) VALUES(${high},'Higher','ring','plain_base','common',2)`;await assert.rejects(craft(id,randomUUID(),high),/craft_tier_locked/);await assert.rejects(craft(id,randomUUID(),randomUUID()),/craft_item_ineligible/);});
test('level gain uses canonical derived resource and milestone machinery',async()=>{const id=await setup({xp:25});await craft(id);const s=await state(id);assert.equal(s.level,2);assert.equal(s.xp,0);assert.equal((await sql`SELECT max_hp FROM public.characters WHERE id=${id}`)[0].max_hp,29);});
test('canonical XP refusal and inventory exception roll back materials, gold and ledger',async()=>{const id=await setup({xp:50});const before=await state(id);await assert.rejects(craft(id),/craft_progression_refused/);assert.deepEqual(await state(id),before);await sql.unsafe("CREATE FUNCTION public.fail_inventory() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture inventory failure'; END $$; CREATE TRIGGER fail_inventory BEFORE INSERT ON public.character_inventory FOR EACH ROW EXECUTE FUNCTION public.fail_inventory()");const other=await setup();const prev=await state(other);await assert.rejects(craft(other),/fixture inventory failure/);assert.deepEqual(await state(other),prev);await sql.unsafe('DROP TRIGGER fail_inventory ON public.character_inventory');await craft(other);});
test('service-only wrapper, private XP and guarded dependency identity',async()=>{for(const role of ['anon','authenticated'])assert.equal((await sql`SELECT has_function_privilege(${role},'public.base_craft_internal(uuid,uuid,uuid,uuid)','EXECUTE') yes`)[0].yes,false);assert.equal((await sql`SELECT has_function_privilege('service_role','public.base_craft_internal(uuid,uuid,uuid,uuid)','EXECUTE') yes`)[0].yes,true);await assert.rejects(sql.begin(t=>t.unsafe(candidate)),/craft_function_already_exists/);});
async function waitBlocked(observer,pid){const deadline=Date.now()+5000;while(Date.now()<deadline){if((await observer`SELECT cardinality(pg_blocking_pids(${pid}))>0 b`)[0].b)return;await new Promise(r=>setTimeout(r,10));}throw Error('Expected observed database blocking');}
test('independent sessions: duplicate UUID blocks then replays exactly once',async()=>{const id=await setup(),event=randomUUID(),a=connect(),b=connect();await a.unsafe("SET statement_timeout='8s'");await b.unsafe("SET statement_timeout='8s'");const pid=(await b`SELECT pg_backend_pid() p`)[0].p;await a.unsafe('BEGIN');const first=await craft(id,event,item,actor,a);const second=craft(id,event,item,actor,b);await waitBlocked(sql,pid);await a.unsafe('COMMIT');assert.equal((await second).inventory_id,first.inventory_id);assert.equal((await state(id)).inventory,1);});
test('independent sessions: different requests serialize stock and additive gold',async()=>{const id=await setup({stock:7}),a=connect(),b=connect();await b.unsafe("SET statement_timeout='8s'");const pid=(await b`SELECT pg_backend_pid() p`)[0].p;await a.unsafe('BEGIN');await craft(id,randomUUID(),item,actor,a);const second=craft(id,randomUUID(),item,actor,b).then(()=>null,e=>e);await waitBlocked(sql,pid);await a.unsafe('COMMIT');assert.match((await second).message,/craft_insufficient_materials/);assert.deepEqual(await state(id),{gold:95,xp:25,level:1,stock:0,inventory:1,receipts:1});});

test('tier prices and historical NULL-tier fallback remain unchanged',async()=>{for(const [tier,level] of [[null,1],[2,10],[3,20],[4,30],[5,40]]){const i=randomUUID();await sql`INSERT INTO public.items(id,name,slot,origin_type,rarity,tier) VALUES(${i},'Base','head','plain_base','common',${tier})`;const id=await setup({level,gold:1000});const r=await craft(id,randomUUID(),i);const il=tier===null?1:(tier-1)*10+1;assert.equal(r.crafted_level,il);assert.equal(r.gold_remaining,1000-5*il);assert.equal(r.salvage_spent,5+2*il);}});
test('canonical cap is respected and missing action receipt never reuses a committed completion',async()=>{const id=await setup({level:42}),event=randomUUID();const result=await craft(id,event);assert.equal(result.xp_offered,25);assert.equal(result.xp_awarded,0);assert.equal((await state(id)).xp,0);await sql`DELETE FROM public.character_inventory_action_request WHERE request_id=${event}`;const before=await state(id);await assert.rejects(craft(id,event),/request_id_conflict/);assert.deepEqual(await state(id),before);});
