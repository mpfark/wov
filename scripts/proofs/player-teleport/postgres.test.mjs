// WOV-IDEA-034: fixture bootstrap derived from unchanged WOV-IDEA-025 source at f418b5eb.
// Only the reduced fixture/bootstrap is reused; no test-teleport SQL or endpoints are loaded.
// Disposable localhost only. Complete candidate, 0024 coverage/arrival wrapper and original arrival/cleanup
// bodies. Reduced schema; accounting, mode and legacy scheduler/key dependencies are explicit doubles.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import net from 'node:net';
import postgres from 'postgres';
import { randomUUID, createHash } from 'node:crypto';
if (!process.argv[2]) throw Error('Explicit LOCAL PostgreSQL bin required; no hosted URL accepted');
const exe = n => join(resolve(process.argv[2]), n + (process.platform === 'win32' ? '.exe' : ''));
const root = await mkdtemp(join(tmpdir(), 'wov-player-travel-'));
const listener = net.createServer(); await new Promise(r => listener.listen(0, '127.0.0.1', r));
const port = listener.address().port; await new Promise(r => listener.close(r));
await promisify(execFile)(exe('initdb'), ['-D', join(root, 'data'), '-U', 'postgres', '--auth=trust', '--no-locale', '--encoding=UTF8'], { windowsHide: true });
const ctl = args => new Promise((res, rej) => { const p = spawn(exe('pg_ctl'), args, { stdio: 'ignore', windowsHide: true }); p.once('error', rej); p.once('exit', n => n === 0 ? res() : rej(Error('pg_ctl ' + n))); });
await ctl(['-D', join(root, 'data'), '-l', join(root, 'server.log'), '-o', `-h 127.0.0.1 -p ${port}`, '-w', 'start']);
const emergency = () => spawnSync(exe('pg_ctl'), ['-D', join(root, 'data'), '-m', 'immediate', '-w', 'stop'], { windowsHide: true, stdio: 'ignore' });
process.once('exit', emergency);
const clients = []; const connect = () => { const c = postgres({ host: '127.0.0.1', port, username: 'postgres', database: 'postgres', max: 1, onnotice: () => {} }); clients.push(c); return c; };
const sql = connect(), other = connect(), observer = connect();
after(async () => { for (const c of clients) await c.end({ timeout: 1 }); await ctl(['-D', join(root, 'data'), '-m', 'immediate', '-w', 'stop']); process.removeListener('exit', emergency); });
const read = p => readFile(new URL('../../../' + p, import.meta.url), 'utf8').then(s => s.replace(/\r\n/g, '\n'));
const fn = (text, name) => {
  const start = text.search(new RegExp('CREATE(?: OR REPLACE)? FUNCTION public\\.' + name + '\\(')); assert(start >= 0, name);
  const tail = text.slice(start), m = /\bAS\s+(\$\w*\$)/i.exec(tail); assert(m, name);
  const end = start + tail.indexOf(m[1], m.index + m[0].length) + m[1].length;
  return text.slice(start, end) + ';';
};
console.log((await sql`SELECT version() v`)[0].v);
await sql.unsafe(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE ROLE sandbox_exec; CREATE ROLE sandbox_exec_gpclaklkaolyzfnooajt;
CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
-- Auth is a local dependency fixture, not execution of Supabase GoTrue sign-out.
CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES auth.users(id));
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_object('session_id',nullif(current_setting('test.session_id',true),'')) $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT current_setting('request.jwt.claim.role',true) $$;
CREATE TABLE public.nodes(id uuid PRIMARY KEY,name text,region_id uuid);
CREATE TABLE public.characters(id uuid PRIMARY KEY,user_id uuid,current_node_id uuid REFERENCES public.nodes,hp int DEFAULT 20,cp int DEFAULT 30,mp int DEFAULT 100,deleted_at timestamptz,movement_locked_until timestamptz);
CREATE TABLE public.parties(id uuid PRIMARY KEY,leader_id uuid,tank_id uuid);
CREATE TABLE public.party_members(id uuid PRIMARY KEY,party_id uuid,character_id uuid,status text,is_following bool);
CREATE TABLE public.node_encounter(id uuid PRIMARY KEY,node_id uuid,status text,claim_token uuid);
CREATE TABLE public.node_fighter(id uuid PRIMARY KEY,encounter_id uuid,character_id uuid,present bool);
CREATE TABLE public.creatures(id uuid PRIMARY KEY,node_id uuid,spawn_seq int,is_alive bool,is_aggressive bool);
CREATE TABLE public.node_creature(id uuid PRIMARY KEY,encounter_id uuid,creature_id uuid,spawn_seq int,is_alive bool,engaged bool,pending_action jsonb);
CREATE TABLE public.node_arrival_group(id uuid PRIMARY KEY,encounter_id uuid,party_id uuid,active bool);
CREATE TABLE public.node_pending_event(id uuid PRIMARY KEY,encounter_id uuid,request_id uuid,actor_character_id uuid,event_type text,payload jsonb,consumed_at timestamptz);
CREATE TABLE public.node_intent(encounter_id uuid,status text);
CREATE TABLE public.node_effect(encounter_id uuid);
CREATE TABLE public.encounters(id uuid PRIMARY KEY,node_id uuid,status text,created_at timestamptz DEFAULT now());
CREATE TABLE public.encounter_participants(encounter_id uuid,character_id uuid);
CREATE TABLE public.encounter_engagements(encounter_id uuid,character_id uuid);
CREATE TABLE public.combat_sessions(character_id uuid,node_id uuid);
CREATE TABLE public.combat_actions(character_id uuid,encounter_id uuid,status text,reject_reason text,updated_at timestamptz);
CREATE TABLE public.active_effects(target_id uuid,expires_at bigint);
CREATE TABLE public.combat2_departure_request(character_id uuid,status text);
CREATE TABLE public.combat2_party_departure_member(character_id uuid,status text);
CREATE TABLE public.combat2_test_arena_node(node_id uuid);
CREATE TABLE public.character_lifecycle_receipt(character_id uuid,operation text,actor_id uuid,reason text,result jsonb,purge_transaction xid8);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT null::uuid $$;
ALTER TABLE public.characters ADD restore_until timestamptz,ADD lifecycle_version bigint DEFAULT 0;
CREATE TABLE public.character_creation_log(result_character_id uuid,replay_status text);
CREATE FUNCTION public.creature_regen_settle(uuid,timestamptz) RETURNS void LANGUAGE plpgsql AS $$ BEGIN RETURN; END $$;
CREATE FUNCTION public.combat_mode_is_open() RETURNS bool LANGUAGE sql AS $$ SELECT true $$;
CREATE FUNCTION public.encounter_lock_key(uuid) RETURNS bigint LANGUAGE sql AS $$ SELECT hashtextextended('fixture-legacy:'||$1::text,0) $$;
CREATE FUNCTION public.arm_effects_catchup_for_node(uuid) RETURNS void LANGUAGE plpgsql AS $$ BEGIN RETURN; END $$;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT,INSERT ON TABLES TO sandbox_exec,sandbox_exec_gpclaklkaolyzfnooajt;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO sandbox_exec_gpclaklkaolyzfnooajt;`);
const lifecycle = await read('drizzle/migrations/0013_progression_001g_c2_reset_and_cutover.sql');
for (const name of ['character_lifecycle_child_fence','character_lifecycle_character_fence']) await sql.unsafe(fn(lifecycle,name));
await sql.unsafe('CREATE TRIGGER character_lifecycle_character_fence BEFORE INSERT OR UPDATE OR DELETE ON public.characters FOR EACH ROW EXECUTE FUNCTION public.character_lifecycle_character_fence()');
const hp = await read('drizzle/migrations/0024_g4a21_shared_creature_hp.sql');
for (const name of ['creature_hp_discover', 'creature_hp_cover','creature_hp_account']) await sql.unsafe(fn(hp, name));
await sql.unsafe(`ALTER TABLE public.node_encounter ALTER id SET DEFAULT gen_random_uuid(),ADD next_due_at timestamptz,ADD state_version bigint DEFAULT 0,ADD claimed_tick bigint,ADD claim_expires_at timestamptz,ADD intent_cutoff_seq bigint,ADD updated_at timestamptz,ADD tick bigint DEFAULT 0;
ALTER TABLE public.node_fighter ALTER id SET DEFAULT gen_random_uuid(),ADD entry_seq bigint,ADD joined_at timestamptz,ADD left_at timestamptz,ADD party_id_at_entry uuid,ADD arrival_group_id uuid,ADD exit_request_id uuid,ADD updated_at timestamptz;
ALTER TABLE public.node_arrival_group ALTER id SET DEFAULT gen_random_uuid(),ALTER active SET DEFAULT true,ADD generation bigint,ADD arrival_seq bigserial,ADD deactivated_at timestamptz;
ALTER TABLE public.node_creature ALTER id SET DEFAULT gen_random_uuid(),ADD hp int,ADD tank_fighter_id uuid,ADD updated_at timestamptz,ADD UNIQUE(creature_id,spawn_seq);
ALTER TABLE public.creatures ADD hp int DEFAULT 10,ADD max_hp int DEFAULT 10;
ALTER TABLE public.node_pending_event ALTER id SET DEFAULT gen_random_uuid(),ADD consumed_tick bigint;
ALTER TABLE public.node_intent ADD reject_reason text;
CREATE SEQUENCE public.node_fighter_entry_seq_seq;
CREATE TRIGGER character_lifecycle_child_fence BEFORE INSERT OR UPDATE OR DELETE ON public.node_fighter FOR EACH ROW EXECUTE FUNCTION public.character_lifecycle_child_fence('character_id');`);
await sql.unsafe(fn(await read('supabase/migrations/20260902194101_e3b1caf6-58cf-4028-b292-49cc3c283914.sql'), 'combat2_seed_spawns'));
await sql.unsafe(fn(await read('supabase/migrations/20260902093129_6e2ff6de-db65-4d4d-83e1-dadcfebaa70c.sql'), 'combat2_refresh_tanks'));
const arrival = await read('supabase/migrations/20260928100000_combat2_authoritative_arrival_hostile_initiation.sql');
for (const name of ['combat2_arrive_after_relocation', 'combat2_authoritative_arrival_trigger']) await sql.unsafe(fn(arrival, name));
await sql.unsafe(hp.slice(hp.indexOf('-- combat2_arrive_after_relocation:'), hp.indexOf('-- node_tick_claim:')));
const legacy = await read('supabase/migrations/20260827094512_37a985a4-cb14-4ce8-9a04-43f75cd26184.sql');
for (const name of ['encounter_end_participation', 'characters_end_participation_on_node_change']) await sql.unsafe(fn(legacy, name));
await sql.unsafe(fn(await read('supabase/migrations/20260717131218_b1576dcf-11b7-49b8-ab62-3a5542f80c00.sql'),'trg_character_encounter_lifecycle'));
await sql.unsafe(fn(await read('supabase/migrations/20260629080249_d6091f9a-cb36-4b1f-9beb-4966956f5e93.sql'),'restrict_party_leader_updates'));
await sql.unsafe(`CREATE TRIGGER combat2_authoritative_arrival AFTER UPDATE OF current_node_id ON public.characters FOR EACH ROW EXECUTE FUNCTION public.combat2_authoritative_arrival_trigger();
CREATE TRIGGER restrict_party_leader_character_updates BEFORE UPDATE ON public.characters FOR EACH ROW EXECUTE FUNCTION public.restrict_party_leader_updates();
CREATE TRIGGER trg_characters_encounter_lifecycle AFTER UPDATE OF current_node_id,hp ON public.characters FOR EACH ROW EXECUTE FUNCTION public.trg_character_encounter_lifecycle();
CREATE TRIGGER trg_characters_node_change_participation AFTER UPDATE OF current_node_id ON public.characters FOR EACH ROW WHEN(OLD.current_node_id IS DISTINCT FROM NEW.current_node_id) EXECUTE FUNCTION public.characters_end_participation_on_node_change();`);
console.log('DEPENDENCY BODY PINS '+JSON.stringify(await sql`SELECT oid::regprocedure::text signature,md5(regexp_replace(prosrc,'[[:space:]]+',' ','g')) fingerprint,proconfig FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN('creature_hp_discover','creature_hp_cover','creature_hp_account','combat2_arrive_after_relocation','combat2_seed_spawns','combat2_refresh_tanks','character_lifecycle_child_fence') ORDER BY proname`));
// Complete protection trigger, with reduced fixture columns inferred from the real body.
const protection = await read('supabase/migrations/20260629080249_d6091f9a-cb36-4b1f-9beb-4966956f5e93.sql');
const columns = new Set((await sql`SELECT attname FROM pg_attribute WHERE attrelid='public.characters'::regclass AND attnum>0`).map(r=>r.attname));
for (const [,name] of fn(protection,'restrict_party_leader_updates').matchAll(/(?:NEW|OLD)\.(\w+)/g)) {
  if(columns.has(name))continue;columns.add(name);
  const type=['is_classless','soulforged_item_created','family_changed_after_creation'].includes(name)?'boolean DEFAULT false':
    ['race','class','stance_state','family_name'].includes(name)?'text':
    ['reserved_buffs','active_contract'].includes(name)?'jsonb':
    ['family_id','soulring_inventory_id'].includes(name)?'uuid':name==='king_slayer_at'?'timestamptz':'integer DEFAULT 0';
  await sql.unsafe(`ALTER TABLE public.characters ADD "${name}" ${type}`);
}
await sql.unsafe(`CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE TABLE public.regions(id uuid PRIMARY KEY,min_level int);
ALTER TABLE public.nodes ADD is_teleport bool DEFAULT false,ADD is_public_teleport bool DEFAULT false;
ALTER TABLE public.combat_sessions ADD party_id uuid;
ALTER TABLE public.node_intent ADD character_id uuid,ADD target_character_id uuid;
ALTER TABLE public.node_effect ADD target_character_id uuid;`);
const travelSource=await read('supabase/migrations/20260908175256_2e41c1c0-9b14-40a2-9627-68f6cf7dbc2b.sql');
const table=(text,name)=>{const begin=text.indexOf('CREATE TABLE public.'+name);assert(begin>=0);return text.slice(begin,text.indexOf(');',begin)+2);};
for(const name of ['character_special_travel_request','character_waymark'])await sql.unsafe(table(travelSource,name));
await sql.unsafe(table(await read('supabase/migrations/20260309130156_61ab7d2d-8687-477f-8718-e08d43a5db9b.sql'),'character_visited_nodes'));
await sql.unsafe(fn(await read('supabase/migrations/20260211212345_41f57ff6-5254-4fb2-99cf-eccf43f00fc5.sql'),'owns_character'));
await sql.unsafe(fn(travelSource,'character_special_travel'));
const fenceSource=await read('supabase/migrations/20260915100000_combat2_special_transition_fences.sql');
await sql.unsafe(fn(fenceSource,'combat2_special_transition_conflict'));
const oldSelect=' SELECT * INTO c FROM public.characters WHERE id=_character_id FOR UPDATE;';
const fence=" IF public.combat2_special_transition_conflict(c.id,c.current_node_id) THEN RETURN jsonb_build_object('ok',false,'kind','transition_conflict'); END IF;";
assert(fenceSource.includes(fence.replaceAll("'","''")),'exact historical transition-fence source');
const originalDefinition=(await sql`SELECT pg_get_functiondef('public.character_special_travel(uuid,text,uuid,uuid)'::regprocedure) d`)[0].d;
await sql.unsafe(originalDefinition.replace(oldSelect,oldSelect+'\n'+fence));
await sql.unsafe(`REVOKE ALL ON FUNCTION public.character_special_travel(uuid,text,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.character_special_travel(uuid,text,uuid,uuid) TO authenticated,service_role;
CREATE TRIGGER character_lifecycle_child_fence BEFORE INSERT OR UPDATE OR DELETE ON public.character_special_travel_request FOR EACH ROW EXECUTE FUNCTION public.character_lifecycle_child_fence('character_id');
CREATE TRIGGER character_lifecycle_child_fence BEFORE INSERT OR UPDATE OR DELETE ON public.character_waymark FOR EACH ROW EXECUTE FUNCTION public.character_lifecycle_child_fence('character_id');`);
await sql.unsafe(`CREATE TRIGGER character_lifecycle_child_fence BEFORE INSERT OR UPDATE OR DELETE ON public.character_visited_nodes FOR EACH ROW EXECUTE FUNCTION public.character_lifecycle_child_fence('character_id')`);
const actor=randomUUID(),char=randomUUID(),a=randomUUID(),b=randomUUID(),d=randomUUID(),locked=randomUUID(),r1=randomUUID(),r2=randomUUID();
await sql`INSERT INTO auth.users VALUES(${actor})`;
const session=randomUUID();await sql`INSERT INTO auth.sessions VALUES(${session},${actor})`;
await sql`INSERT INTO public.regions VALUES(${r1},1),(${r2},6)`;
for(const n of [a,b,d,locked])await sql`INSERT INTO public.nodes(id,name,region_id,is_teleport,is_public_teleport) VALUES(${n},'Fixture',${n===d?r2:r1},true,${n!==locked})`;
await sql`INSERT INTO public.characters(id,user_id,current_node_id,hp,cp,mp,level,max_hp,max_cp,max_mp,ac) VALUES(${char},${actor},${a},20,100,100,1,20,100,100,10)`;
for(const c of [sql,other])await c`SELECT set_config('test.session_id',${session},false),set_config('request.jwt.claim.sub',${actor},false),set_config('request.jwt.claim.role','authenticated',false),set_config('statement_timeout','8000',false),set_config('lock_timeout','6000',false)`;
const move=async(c=sql,dest=b,id=randomUUID(),kind='teleport')=>(await c`SELECT public.character_special_travel(${char},${kind},${dest},${id}) result`)[0].result;
const position=async()=>(await sql`SELECT current_node_id,hp,cp,mp FROM public.characters WHERE id=${char}`)[0];
const reset=async()=>{await sql`SELECT set_config('request.jwt.claim.sub','',false),set_config('app.combat2_depart_authorized','',false),set_config('app.creature_hp_coverage','',false)`;await sql`UPDATE public.characters SET current_node_id=${a},cp=100,level=1,movement_locked_until=NULL WHERE id=${char}`;await sql`SELECT set_config('request.jwt.claim.sub',${actor},false)`;};
// Reproduce the existing failure, then prove the dependency is causal using the unwrapped arrival body.
assert.equal((await move()).kind,'travel_failed');assert.equal((await position()).current_node_id,a);assert.equal((await position()).cp,100);
const wrappedArrival=(await sql`SELECT pg_get_functiondef('public.combat2_arrive_after_relocation(uuid,uuid)'::regprocedure) d`)[0].d;
await sql.unsafe(fn(arrival,'combat2_arrive_after_relocation').replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION'));
assert.equal((await move()).ok,true);await sql.unsafe(wrappedArrival);await reset();
console.log('Original travel_failed/rollback reproduced; original arrival succeeds, 0024 wrapper rejects missing early coverage.');
console.log('OLD BODY '+JSON.stringify(await sql`SELECT md5(regexp_replace(prosrc,'[[:space:]]+',' ','g')) md5 FROM pg_proc WHERE oid='public.character_special_travel(uuid,text,uuid,uuid)'::regprocedure`));
const candidate=await read('docs/operations/idea-034-player-teleport.sql');
const metadata=async()=>(await sql`SELECT proowner,prosecdef,proconfig,proacl::text FROM pg_proc WHERE oid='public.character_special_travel(uuid,text,uuid,uuid)'::regprocedure`)[0];
const before=await metadata();
const currentTravel=(await sql`SELECT pg_get_functiondef('public.character_special_travel(uuid,text,uuid,uuid)'::regprocedure) d`)[0].d;
await sql.unsafe(currentTravel.replace('BEGIN','BEGIN\n-- fixture-only source drift'));
await assert.rejects(sql.begin(t=>t.unsafe(candidate)),/player travel source\/settings drift/);
assert.equal((await sql`SELECT to_regprocedure('public.guard_visited_node_location()') id`)[0].id,null);
assert.equal((await sql`SELECT to_regprocedure('public.waymark_live_session()') id`)[0].id,null);
assert.equal((await sql`SELECT count(*)::int n FROM pg_attribute WHERE attrelid='public.character_waymark'::regclass AND attname='auth_session_id' AND NOT attisdropped`)[0].n,0);
await sql.unsafe(currentTravel);
await sql.begin(t=>t.unsafe(candidate));assert.deepEqual(await metadata(),before);
console.log('Candidate SHA256 '+createHash('sha256').update(candidate).digest('hex'));
console.log('EXPECTED POST-INSTALL BODY MD5 '+JSON.stringify(await sql`SELECT oid::regprocedure::text signature,md5(regexp_replace(prosrc,'[[:space:]]+',' ','g')) body_md5 FROM pg_proc WHERE oid IN('public.character_special_travel(uuid,text,uuid,uuid)'::regprocedure,'public.guard_visited_node_location()'::regprocedure,'public.record_character_node_visit()'::regprocedure) ORDER BY proname`));
async function blocked(pid){const deadline=Date.now()+4000;while(Date.now()<deadline){if((await observer`SELECT cardinality(pg_blocking_pids(${pid})) n`)[0].n)return;await new Promise(r=>setTimeout(r,15));}assert.fail('independent-session blocking not observed');}
test('level1 public city travel, correct regional prices, canonical arrival, exact replay and conflict',async()=>{
 const id=randomUUID();const result=await move(sql,b,id);assert.equal(result.ok,true);assert.equal(result.cp_cost,10);assert.equal(result.outcome,'committed');
 assert.deepEqual(await position(),{current_node_id:b,hp:20,cp:90,mp:100});
 assert((await sql`SELECT 1 FROM public.character_visited_nodes WHERE character_id=${char} AND node_id=${b}`).length);
 await reset();await sql`UPDATE public.characters SET cp=0 WHERE id=${char}`;
 assert.equal((await move(other,b,id)).ok,true);assert.equal((await position()).current_node_id,a);assert.equal((await position()).cp,0);
 assert.equal((await move(other,d,id)).kind,'request_id_conflict');
 await reset();assert.equal((await move(sql,d)).cp_cost,20);await reset();
});
test('locked city requires discovery; browser cannot forge a visit but authoritative arrival records one',async()=>{
 assert.equal((await move(sql,locked)).kind,'invalid_destination');assert.equal((await position()).cp,100);
 await assert.rejects(sql`INSERT INTO public.character_visited_nodes(character_id,node_id) VALUES(${char},${locked})`,/discovery_requires_presence/);
 // Fixture-only actual position transition (not a new movement endpoint).
 await sql`UPDATE public.characters SET current_node_id=${locked} WHERE id=${char}`;await reset();
 assert.equal((await move(sql,locked)).ok,true);await reset();
});
test('insufficient CP, ownership, personal level, movement, combat and pending claims refuse without debit',async()=>{
 await sql`UPDATE public.characters SET cp=5 WHERE id=${char}`;assert.equal((await move()).kind,'insufficient_cp');await reset();
 await sql`SELECT set_config('request.jwt.claim.sub',${randomUUID()},false)`;assert.equal((await move()).kind,'not_authorized');await sql`SELECT set_config('request.jwt.claim.sub',${actor},false)`;
 await sql`UPDATE public.nodes SET is_teleport=false WHERE id=${a}`;assert.equal((await move()).kind,'personal_teleport_locked');await sql`UPDATE public.nodes SET is_teleport=true WHERE id=${a}`;
 await sql`UPDATE public.characters SET movement_locked_until=now()+interval '1 minute' WHERE id=${char}`;assert.equal((await move()).kind,'transition_conflict');await reset();
 const enc=randomUUID();await sql`INSERT INTO public.node_encounter(id,node_id,status,claim_token) VALUES(${enc},${a},'active',${randomUUID()})`;
 assert.equal((await move()).kind,'transition_conflict');await sql`DELETE FROM public.node_encounter`;assert.equal((await position()).cp,100);
});
test('personal level22 creates a server waymark only on successful travel; existing waymark return is atomic',async()=>{
 await sql`UPDATE public.nodes SET is_teleport=false WHERE id=${a}`;
 // Privileged fixture seed only; the real owner-facing protection trigger remains enabled.
 await sql`SELECT set_config('request.jwt.claim.sub','',false)`;await sql`UPDATE public.characters SET level=22 WHERE id=${char}`;await sql`SELECT set_config('request.jwt.claim.sub',${actor},false)`;
 assert.equal((await move(sql,b)).ok,true);assert.equal((await sql`SELECT public.character_waymark_state(${char},false) r`)[0].r.node_id,a);assert.equal((await move(sql,a,randomUUID(),'waymark')).ok,true);
 await sql`UPDATE public.characters SET cp=0 WHERE id=${char}`;assert.equal((await move()).kind,'insufficient_cp');assert.equal((await position()).current_node_id,a);
 await sql`UPDATE public.nodes SET is_teleport=true WHERE id=${a}`;await reset();
});
test('failed arrival rolls back CP, position, discovery, waymark and receipt',async()=>{
 await sql.unsafe(`CREATE FUNCTION public.fixture_fail_travel() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF current_setting('test.fail',true)='true' THEN RAISE EXCEPTION 'fixture failure'; END IF; RETURN NEW; END $$;
 CREATE TRIGGER zz_fixture_failure AFTER UPDATE ON public.characters FOR EACH ROW EXECUTE FUNCTION public.fixture_fail_travel()`);
 await sql`SELECT set_config('request.jwt.claim.sub','',false)`;await sql`UPDATE public.characters SET level=22 WHERE id=${char}`;await sql`SELECT set_config('request.jwt.claim.sub',${actor},false)`;
 await sql`UPDATE public.nodes SET is_teleport=false WHERE id=${a}`;await sql`UPDATE public.character_waymark SET node_id=${d} WHERE character_id=${char}`;
 const id=randomUUID();await sql`SELECT set_config('test.fail','true',false)`;assert.equal((await move(sql,b,id)).kind,'travel_failed');await sql`SELECT set_config('test.fail','false',false)`;
 assert.deepEqual(await position(),{current_node_id:a,hp:20,cp:100,mp:100});assert.equal((await sql`SELECT 1 FROM public.character_special_travel_request WHERE request_id=${id}`).length,0);
 assert.equal((await sql`SELECT node_id FROM public.character_waymark WHERE character_id=${char}`)[0].node_id,d);
 assert.equal((await move(sql,b,id)).ok,true);await sql`UPDATE public.nodes SET is_teleport=true WHERE id=${a}`;await reset();
});
test('independent duplicate replay blocks and debits only once',{timeout:15000},async()=>{
 const id=randomUUID(),pid=(await other`SELECT pg_backend_pid() pid`)[0].pid;let release,entered;
 const gate=new Promise(r=>{release=r}),ready=new Promise(r=>{entered=r});
 const first=sql.begin(async t=>{const result=await move(t,b,id);entered();await gate;return result;});await ready;
 const second=move(other,b,id);try{await blocked(pid);}finally{release();}const result=await Promise.all([first,second]);assert.equal(result[0].cp_cost,result[1].cp_cost);assert.equal((await position()).cp,90);await reset();
});
test('independent claim creation wins node gate and waiting travel refuses',{timeout:15000},async()=>{
 const pid=(await other`SELECT pg_backend_pid() pid`)[0].pid;let release,entered;const gate=new Promise(r=>{release=r}),ready=new Promise(r=>{entered=r});
 const first=sql.begin(async t=>{await t`SELECT pg_advisory_xact_lock(hashtextextended('combat_enter_node:'||${a}::text,0))`;entered();await gate;await t`INSERT INTO public.node_encounter(id,node_id,status,claim_token) VALUES(${randomUUID()},${a},'active',${randomUUID()})`;});
 await ready;const second=move(other);try{await blocked(pid);}finally{release();}await first;const result=await second;assert.equal(result.ok,false);assert.equal((await position()).cp,100);await sql`DELETE FROM public.node_encounter`;
});
test('browser discovery key-share completes before waiting character relocation; no child-row lock inversion',{timeout:15000},async()=>{
 const pid=(await other`SELECT pg_backend_pid() pid`)[0].pid;let release,entered;const gate=new Promise(r=>{release=r}),ready=new Promise(r=>{entered=r});
 const first=sql.begin(async t=>{await t`INSERT INTO public.character_visited_nodes(character_id,node_id) VALUES(${char},${a}) ON CONFLICT(character_id,node_id) DO UPDATE SET first_visited_at=character_visited_nodes.first_visited_at`;entered();await gate;});
 await ready;const second=move(other);try{await blocked(pid);}finally{release();}await first;assert.equal((await second).ok,true);await reset();
});
test('READ COMMITTED gate refuses new work but committed replay remains historical',async()=>{
 const id=randomUUID();assert.equal((await move(sql,b,id)).ok,true);await reset();
 const refusal=await sql.begin('isolation level repeatable read',t=>move(t));assert.equal(refusal.kind,'isolation_unsupported');
 const replay=await sql.begin('isolation level repeatable read',t=>move(t,b,id));assert.equal(replay.ok,true);assert.equal((await position()).current_node_id,a);
});
test('personal party teleport uses the existing node-bound RPC; level, following and moved-member restrictions remain',async()=>{
 const party=randomUUID(),peer=randomUUID(),owner=randomUUID();await sql`INSERT INTO auth.users VALUES(${owner})`;
 await sql`INSERT INTO public.characters(id,user_id,current_node_id,hp,max_hp,max_cp,max_mp,level,ac) VALUES(${peer},${owner},${d},20,20,100,100,1,10)`;
 await sql`INSERT INTO public.parties(id,leader_id) VALUES(${party},${char})`;
 await sql`INSERT INTO public.party_members(id,party_id,character_id,status,is_following) VALUES(${randomUUID()},${party},${char},'accepted',false),(${randomUUID()},${party},${peer},'accepted',false)`;
 await sql`UPDATE public.nodes SET is_teleport=false WHERE id=${d}`;
 assert.equal((await move(sql,d)).kind,'invalid_destination');
 await sql`SELECT set_config('request.jwt.claim.sub','',false)`;await sql`UPDATE public.characters SET level=22 WHERE id=${char}`;await sql`SELECT set_config('request.jwt.claim.sub',${actor},false)`;
 await sql`UPDATE public.party_members SET is_following=true WHERE character_id=${peer}`;assert.equal((await move(sql,d)).kind,'party_following');await sql`UPDATE public.party_members SET is_following=false WHERE character_id=${peer}`;
 const id=randomUUID();const result=await move(sql,d,id);assert.equal(result.ok,true);assert.equal(result.cp_cost,20);assert.equal(result.account_id,actor);
 await reset();await sql`SELECT set_config('request.jwt.claim.sub','',false)`;await sql`UPDATE public.characters SET level=22 WHERE id=${char}`;await sql`SELECT set_config('request.jwt.claim.sub',${actor},false)`;
 await sql`UPDATE public.characters SET current_node_id=${b} WHERE id=${peer}`;
 assert.equal((await move(sql,d)).kind,'invalid_destination');assert.equal((await move(sql,d,id)).ok,true);assert.equal((await position()).current_node_id,a);
 await sql`DELETE FROM public.party_members WHERE party_id=${party}`;await sql`DELETE FROM public.parties WHERE id=${party}`;await sql`UPDATE public.nodes SET is_teleport=true WHERE id=${d}`;await reset();
});
const markState=async(c=sql,touch=false)=>(await c`SELECT public.character_waymark_state(${char},${touch}) r`)[0].r;
const personal=async()=>{await reset();await sql`SELECT set_config('request.jwt.claim.sub','',false)`;await sql`UPDATE public.characters SET level=22 WHERE id=${char}`;await sql`SELECT set_config('request.jwt.claim.sub',${actor},false)`;await sql`UPDATE public.nodes SET is_teleport=false WHERE id=${a}`;assert.equal((await move()).ok,true);};
const endPersonal=async()=>{await sql`UPDATE public.nodes SET is_teleport=true WHERE id=${a}`;await reset();};
test('reusable return preserves mark identity, replacement is one-per-character, city travel never replaces',async()=>{
 await personal();const before=(await sql`SELECT node_id,set_at,auth_session_id FROM public.character_waymark WHERE character_id=${char}`)[0];
 assert.equal((await move(sql,a,randomUUID(),'waymark')).ok,true);
 assert.equal((await move(sql,a,randomUUID(),'waymark')).ok,true);
 assert.deepEqual((await sql`SELECT node_id,set_at,auth_session_id FROM public.character_waymark WHERE character_id=${char}`)[0],before);
 await sql`UPDATE public.nodes SET is_teleport=true WHERE id=${a}`;assert.equal((await move(sql,b)).ok,true);assert.equal((await markState()).node_id,a);
 await sql`UPDATE public.nodes SET is_teleport=false WHERE id=${b}`;assert.equal((await move(sql,d)).ok,true);assert.equal((await markState()).node_id,b);
 assert.equal((await sql`SELECT count(*)::int n FROM public.character_waymark WHERE character_id=${char}`)[0].n,1);
 await sql`UPDATE public.nodes SET is_teleport=true WHERE id=${b}`;await endPersonal();
});
test('20-minute server cutoff cannot be revived by touch or stale replay; server received activity extends only live marks',async()=>{
 await personal();const id=randomUUID();assert.equal((await move(sql,a,id,'waymark')).ok,true);
 await sql`UPDATE public.character_waymark SET last_activity_at=clock_timestamp()-interval '19 minutes' WHERE character_id=${char}`;
 assert.equal((await markState(sql,true)).node_id,a);
 assert((await sql`SELECT last_activity_at>clock_timestamp()-interval '1 minute' fresh FROM public.character_waymark WHERE character_id=${char}`)[0].fresh);
 await sql`UPDATE public.character_waymark SET last_activity_at=clock_timestamp()-interval '20 minutes' WHERE character_id=${char}`;
 const cp=(await position()).cp;assert.equal((await markState(sql,true)).node_id,null);
 assert.equal((await move(sql,a,randomUUID(),'waymark')).kind,'waymark_unavailable');assert.equal((await position()).cp,cp);
 assert.equal((await move(sql,a,id,'waymark')).kind,'already_moved');assert.equal((await markState()).node_id,null);
 await endPersonal();
});
test('server sign-out removes session: unexpired JWT cannot recover, create or return a mark; new session cannot inherit it',async()=>{
 await personal();await observer`DELETE FROM auth.sessions WHERE id=${session}`;
 assert.equal((await markState()).kind,'session_unavailable');assert.equal((await move(sql,a,randomUUID(),'waymark')).kind,'session_unavailable');
 // A later login is distinct, not a waymark revival.
 const next=randomUUID();await observer`INSERT INTO auth.sessions VALUES(${next},${actor})`;await sql`SELECT set_config('test.session_id',${next},false)`;
 assert.equal((await markState()).node_id,null);assert.equal((await move(sql,a,randomUUID(),'waymark')).kind,'waymark_unavailable');
 await observer`INSERT INTO auth.sessions VALUES(${session},${actor})`;await sql`SELECT set_config('test.session_id',${session},false)`;
 await endPersonal();
});
test('missing/malformed/foreign sessions and legacy unbound marks fail closed without altering ordinary city travel',async()=>{
 await personal();await sql`UPDATE public.character_waymark SET auth_session_id=NULL WHERE character_id=${char}`;assert.equal((await markState()).node_id,null);
 for(const value of ['', 'not-a-uuid',randomUUID()]){await sql`SELECT set_config('test.session_id',${value},false)`;assert.equal((await markState()).kind,'session_unavailable');assert.equal((await move(sql,a,randomUUID(),'waymark')).kind,'session_unavailable');}
 const foreign=randomUUID(),owner=randomUUID();await observer`INSERT INTO auth.users VALUES(${owner})`;await observer`INSERT INTO auth.sessions VALUES(${foreign},${owner})`;
 await sql`SELECT set_config('test.session_id',${foreign},false)`;assert.equal((await markState()).kind,'session_unavailable');
 await sql`SELECT set_config('test.session_id',${session},false)`;await endPersonal();
});
test('Auth sign-out waits for in-flight return then invalidates later calls',{timeout:15000},async()=>{
 await personal();const pid=(await other`SELECT pg_backend_pid() pid`)[0].pid;let release,entered;
 const gate=new Promise(r=>{release=r}),ready=new Promise(r=>{entered=r});
 const first=sql.begin(async t=>{const result=await move(t,a,randomUUID(),'waymark');assert.equal(result.ok,true);entered();await gate;});
 await ready;const logout=other`DELETE FROM auth.sessions WHERE id=${session}`.execute();try{await blocked(pid);}finally{release();}await Promise.all([first,logout]);
 assert.equal((await move(sql,a,randomUUID(),'waymark')).kind,'session_unavailable');
 await observer`INSERT INTO auth.sessions VALUES(${session},${actor})`;await endPersonal();
});
test('sign-out-first ordering blocks return, then refuses without CP debit',{timeout:15000},async()=>{
 await personal();const cp=(await position()).cp,pid=(await other`SELECT pg_backend_pid() pid`)[0].pid;let release,entered;
 const gate=new Promise(r=>{release=r}),ready=new Promise(r=>{entered=r});
 const first=sql.begin(async t=>{await t`DELETE FROM auth.sessions WHERE id=${session}`;entered();await gate;});await ready;
 const second=move(other,a,randomUUID(),'waymark');try{await blocked(pid);}finally{release();}await first;
 assert.equal((await second).kind,'session_unavailable');assert.equal((await position()).cp,cp);
 await observer`INSERT INTO auth.sessions VALUES(${session},${actor})`;await endPersonal();
});
test('concurrent exact waymark return replay pays once and never relocates or consumes mark',{timeout:15000},async()=>{
 await personal();const cp=(await position()).cp,id=randomUUID(),pid=(await other`SELECT pg_backend_pid() pid`)[0].pid;let release,entered;
 const gate=new Promise(r=>{release=r}),ready=new Promise(r=>{entered=r});
 const first=sql.begin(async t=>{const result=await move(t,a,id,'waymark');entered();await gate;return result;});await ready;
 const second=move(other,a,id,'waymark');try{await blocked(pid);}finally{release();}const results=await Promise.all([first,second]);assert(results.every(r=>r.ok));
 assert.equal((await position()).cp,cp-10);assert.equal((await markState()).node_id,a);await endPersonal();
});
test('waymark helpers preserve strict function authority and expose no Auth session IDs',async()=>{
 assert.equal((await sql`SELECT has_function_privilege('authenticated','public.character_waymark_state(uuid,boolean)','EXECUTE') allowed`)[0].allowed,true);
 for(const role of ['anon','service_role','sandbox_exec','sandbox_exec_gpclaklkaolyzfnooajt'])assert.equal((await sql`SELECT has_function_privilege(${role},'public.character_waymark_state(uuid,boolean)','EXECUTE') allowed`)[0].allowed,false);
 for(const role of ['anon','authenticated','service_role','sandbox_exec','sandbox_exec_gpclaklkaolyzfnooajt'])assert.equal((await sql`SELECT has_function_privilege(${role},'public.waymark_live_session()','EXECUTE') allowed`)[0].allowed,false);
 assert(!JSON.stringify(await markState()).includes(session));
});

test('hostile city arrival uses full canonical entry, spawn and tank source',async()=>{
 await sql`INSERT INTO public.creatures(id,node_id,spawn_seq,is_alive,is_aggressive) VALUES(${randomUUID()},${b},1,true,true)`;
 assert.equal((await move()).ok,true);const rows=await sql`SELECT f.present,n.engaged FROM public.node_fighter f JOIN public.node_creature n ON n.encounter_id=f.encounter_id WHERE f.character_id=${char}`;
 assert.equal(rows.length,1);assert.equal(rows[0].present,true);assert.equal(rows[0].engaged,true);assert.equal((await move(sql,a)).ok,false);
});
