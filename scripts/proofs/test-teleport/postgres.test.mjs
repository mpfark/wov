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
const root = await mkdtemp(join(tmpdir(), 'wov-test-teleport-'));
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
const candidate = await read('docs/operations/idea-025-test-teleport.sql');
console.log('Candidate normalized LF SHA256 ' + createHash('sha256').update(candidate).digest('hex'));
const originalCover = (await sql`SELECT pg_get_functiondef('public.creature_hp_cover(uuid[],uuid[])'::regprocedure) definition`)[0].definition;
await sql.unsafe(`CREATE OR REPLACE FUNCTION public.creature_hp_cover(input_nodes uuid[],input_actors uuid[]) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$ BEGIN RETURN '{}'::jsonb; END $$`);
await assert.rejects(sql.begin(t=>t.unsafe(candidate)),/dependency drift/);
assert.equal((await sql`SELECT to_regclass('public.gameplay_test_destination') obj`)[0].obj,null);
await sql.unsafe(originalCover);
console.log('Dependency source drift rejected before creating any new object.');
await sql.begin(t => t.unsafe(candidate));
for (const c of [sql, other]) await c`SELECT set_config('request.jwt.claim.role','service_role',false),set_config('statement_timeout','8000',false),set_config('lock_timeout','6000',false)`;
const actor = randomUUID(), char = randomUUID(), a = randomUUID(), b = randomUUID(), d = randomUUID();
await sql`INSERT INTO auth.users VALUES(${actor})`;
for (const n of [a, b, d]) await sql`INSERT INTO public.nodes VALUES(${n},'fixture',${randomUUID()})`;
await sql`INSERT INTO public.characters(id,user_id,current_node_id) VALUES(${char},${actor},${a})`;
for (const n of [a, b, d]) await sql`INSERT INTO public.gameplay_test_destination VALUES(${actor},${char},${n})`;
const teleport = async (c = sql, dest = b, request = randomUUID(), who = actor) => (await c`SELECT public.gameplay_test_teleport_internal(${who},${char},${dest},${request}) result`)[0].result;
const reset = async () => { await sql`UPDATE public.characters SET current_node_id=${a},movement_locked_until=NULL WHERE id=${char}`; };
const position = async () => (await sql`SELECT current_node_id,hp,cp,mp FROM public.characters WHERE id=${char}`)[0];
async function blocked(pid) {
  const until = Date.now() + 4000;
  while (Date.now() < until) { if ((await observer`SELECT cardinality(pg_blocking_pids(${pid})) n`)[0].n > 0) return; await new Promise(r => setTimeout(r, 15)); }
  assert.fail('No observed independent-session blocking');
}
test('authorized teleport uses complete 0024-wrapped peaceful arrival/cleanup and preserves resources; replay never moves again', async () => {
  const request = randomUUID(), before = await position(); const result = await teleport(sql, b, request);
  assert.equal(result.outcome, 'committed'); assert.deepEqual(await position(), { ...before, current_node_id: b });
  await reset(); assert.deepEqual(await teleport(sql, b, request), result); assert.equal((await position()).current_node_id, a);
  await assert.rejects(teleport(sql, d, request), /request_id_conflict/);
});
test('ownership, empty destination authorization, service context and Arena are refused', async () => {
  await assert.rejects(teleport(sql, b, randomUUID(), randomUUID()), /not_authorized/);
  await assert.rejects(teleport(sql, randomUUID()), /destination_not_approved/);
  await sql`SELECT set_config('request.jwt.claim.role','authenticated',false)`;
  await assert.rejects(teleport(), /not_authorized/);
  await sql`SELECT set_config('request.jwt.claim.role','service_role',false)`;
  await sql`INSERT INTO public.combat2_test_arena_node VALUES(${b})`;
  await assert.rejects(teleport(), /destination_not_approved/); await sql`DELETE FROM public.combat2_test_arena_node`;
});
test('dead and soft-deleted characters cannot move', async () => {
  await sql`UPDATE public.characters SET hp=0 WHERE id=${char}`;
  await assert.rejects(teleport(),/character_state_changed/);
  await sql`UPDATE public.characters SET hp=20 WHERE id=${char}`;
  // Fixture-only tombstone setup, not a production lifecycle or bypass test.
  await sql.unsafe(`ALTER TABLE public.characters DISABLE TRIGGER character_lifecycle_character_fence;
    UPDATE public.characters SET deleted_at=now() WHERE id='${char}';
    ALTER TABLE public.characters ENABLE TRIGGER character_lifecycle_character_fence;`);
  await assert.rejects(teleport(),/not_authorized/);
  await sql.unsafe(`ALTER TABLE public.characters DISABLE TRIGGER character_lifecycle_character_fence;
    UPDATE public.characters SET deleted_at=NULL WHERE id='${char}';
    ALTER TABLE public.characters ENABLE TRIGGER character_lifecycle_character_fence;`);
});
test('party/invitation, movement, active encounter, retained claim and pending work refuse atomically', async () => {
  const fixtures = [
    [`INSERT INTO public.party_members VALUES('${randomUUID()}','${randomUUID()}','${char}','invited',false)`, 'DELETE FROM public.party_members', /party_state_unsafe/],
    [`INSERT INTO public.combat2_departure_request VALUES('${char}','queued')`, 'DELETE FROM public.combat2_departure_request', /movement_pending/],
    [`INSERT INTO public.node_encounter(id,node_id,status,claim_token) VALUES('${randomUUID()}','${a}','active',NULL)`, 'DELETE FROM public.node_encounter', /encounter_unresolved/],
    [`INSERT INTO public.node_encounter(id,node_id,status,claim_token) VALUES('${randomUUID()}','${a}','ended','${randomUUID()}')`, 'DELETE FROM public.node_encounter', /encounter_unresolved/],
    [`INSERT INTO public.combat_actions VALUES('${char}',NULL,'pending',NULL,NULL)`, 'DELETE FROM public.combat_actions', /encounter_unresolved/],
  ];
  for (const [setup, cleanup, error] of fixtures) {
    await sql.unsafe(setup); await assert.rejects(teleport(), error); assert.equal((await position()).current_node_id, a); await sql.unsafe(cleanup);
  }
});
test('arrival failure rolls back position and receipt; same UUID can safely retry', async () => {
  await sql.unsafe(`CREATE FUNCTION public.fixture_fail_arrival() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF current_setting('test.fail',true)='true' THEN RAISE EXCEPTION 'fixture failure'; END IF; RETURN NEW; END $$;
  CREATE TRIGGER zz_fixture_fail AFTER UPDATE ON public.characters FOR EACH ROW EXECUTE FUNCTION public.fixture_fail_arrival()`);
  const id = randomUUID(); await sql`SELECT set_config('test.fail','true',false)`;
  await assert.rejects(teleport(sql, b, id), /fixture failure/); assert.equal((await position()).current_node_id, a);
  assert.equal((await sql`SELECT count(*)::int n FROM public.gameplay_test_teleport_receipt WHERE request_id=${id}`)[0].n, 0);
  await sql`SELECT set_config('test.fail','false',false)`; await teleport(sql, b, id); await reset();
});
test('independent-session exact duplicate waits and returns a single receipt/result', async () => {
  const id = randomUUID(), pid = (await other`SELECT pg_backend_pid() pid`)[0].pid;
  let finish, entered; const gate = new Promise(r => { finish = r; }), ready = new Promise(r => { entered = r; });
  const first = sql.begin(async t => { const result = await teleport(t, b, id); entered(); await gate; return result; });
  await ready; const second = teleport(other, b, id); await blocked(pid); finish();
  const results = await Promise.all([first, second]); assert.deepEqual(results[0], results[1]);
  assert.equal((await sql`SELECT count(*)::int n FROM public.gameplay_test_teleport_receipt WHERE request_id=${id}`)[0].n, 1); await reset();
});
test('independent-session destination activation wins node gate; waiting teleport refuses new encounter', async () => {
  const pid = (await other`SELECT pg_backend_pid() pid`)[0].pid; let finish, entered;
  const gate = new Promise(r => { finish = r; }), ready = new Promise(r => { entered = r; });
  const first = sql.begin(async t => {
    await t`SELECT pg_advisory_xact_lock(hashtextextended('combat_enter_node:'||${b}::text,0))`;
    entered(); await gate; await t`INSERT INTO public.node_encounter(id,node_id,status,claim_token) VALUES(${randomUUID()},${b},'active',NULL)`;
  });
  await ready; const second = teleport(other).then(() => assert.fail('must refuse'), e => assert.match(e.message, /coverage changed|encounter_unresolved/));
  await blocked(pid); finish(); await Promise.all([first, second]); assert.equal((await position()).current_node_id, a);
  await sql`DELETE FROM public.node_encounter`;
});
test('independent-session distinct requests cannot overwrite a stale origin', async () => {
  const pid = (await other`SELECT pg_backend_pid() pid`)[0].pid; let finish, entered;
  const gate = new Promise(r => { finish = r; }), ready = new Promise(r => { entered = r; });
  const first = sql.begin(async t => { await teleport(t, b); entered(); await gate; });
  await ready; const id = randomUUID(); const second = teleport(other, d, id).then(() => assert.fail('stale discovery must refuse'), e => assert.match(e.message, /coverage changed|character_state_changed/));
  await blocked(pid); finish(); await Promise.all([first, second]); assert.equal((await position()).current_node_id, b);
  await teleport(other, d, id); assert.equal((await position()).current_node_id, d); await reset();
});
test('browser, service and exact platform principals have no direct private table authority', async () => {
  for (const role of ['anon','authenticated','service_role','sandbox_exec','sandbox_exec_gpclaklkaolyzfnooajt']) {
    assert.equal((await sql`SELECT has_table_privilege(${role},'public.gameplay_test_destination','SELECT,INSERT,UPDATE,DELETE') allowed`)[0].allowed, false);
    assert.equal((await sql`SELECT has_function_privilege(${role},'public.gameplay_test_teleport_internal(uuid,uuid,uuid,uuid)','EXECUTE') allowed`)[0].allowed, role === 'service_role');
  }
});
test('full source hostile arrival creates one fighter, creature projection and entry event; replay does not duplicate', async () => {
  const creature = randomUUID(), request = randomUUID();
  await sql`INSERT INTO public.creatures(id,node_id,spawn_seq,is_alive,is_aggressive) VALUES(${creature},${b},1,true,true)`;
  await teleport(sql,b,request);
  const state = await sql`SELECT e.id,e.state_version,f.present,nc.engaged,nc.hp FROM public.node_encounter e JOIN public.node_fighter f ON f.encounter_id=e.id JOIN public.node_creature nc ON nc.encounter_id=e.id WHERE e.node_id=${b}`;
  assert.equal(state.length,1); assert.equal(state[0].present,true); assert.equal(state[0].engaged,true); assert.equal(state[0].hp,10);
  await teleport(other,b,request);
  assert.equal((await sql`SELECT count(*)::int n FROM public.node_pending_event WHERE event_type='fighter_entered'`)[0].n,1);
  await assert.rejects(teleport(sql,a),/encounter_unresolved/);
});
test('non READ COMMITTED transaction fails closed before mutation', async () => {
  await assert.rejects(sql.begin('isolation level repeatable read',t=>teleport(t)),/requires read committed/);
});
