/** Exact local SQL on disposable PGlite only. No hosted connection or gameplay fixture.
 * node scripts/progression-001G-C2-P2-C-sql.test.mjs <local-pglite-index.js>
 * Queued calls share one backend; they do not prove two-session lock contention. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
if(!process.argv[2]) throw Error('Supply a local PGlite module path');
const {PGlite}=await import(pathToFileURL(resolve(process.argv[2])).href);
const read=p=>readFileSync(p,'utf8');
const sql=read('drizzle/migrations/0009_progression_001g_c2_p2_a_creation_authority.sql');
const manifest=JSON.parse(read('docs/design/progression-001G-C2-P2-A-creation-manifest.json'));
const uid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const actor=uid(1),target=uid(2),node=uid(3),legacy=uid(4);let db,next=100;
const q=async(sql,params=[])=>(await db.query(sql,params)).rows;
const call=async({request=uid(next++),name='Eldrin',race='human',gender='male',owner=null,reason=null,revision='creation-c2-v1'}={})=>
  (await q('SELECT public.character_create_c2_internal($1,$2,$3,$4,$5,$6,$7) AS r',[request,name,race,gender,owner,reason,revision]))[0].r;
const identity=async a=>q("SELECT set_config('app.test_uid',$1,true)",[a??'']);
async function tx(fn){await db.exec('BEGIN');try{await identity(actor);await fn();}finally{await db.exec('ROLLBACK');}}
async function refused(fn,pattern){await db.exec('SAVEPOINT refusal');try{await assert.rejects(fn,pattern);}finally{await db.exec('ROLLBACK TO SAVEPOINT refusal; RELEASE SAVEPOINT refusal');}}
const counts=async()=> (await q(`SELECT (SELECT count(*) FROM characters)::int characters,
  (SELECT count(*) FROM character_materials)::int materials,(SELECT count(*) FROM character_inventory)::int inventory,
  (SELECT count(*) FROM progression_character_state)::int state,(SELECT count(*) FROM character_creation_origin)::int origin,
  (SELECT count(*) FROM character_creation_log)::int log`))[0];
before(async()=>{
  db=new PGlite();
  // Reuse the existing C fixture and exact C authority; extend only isolated dependency tables.
  await db.exec(read('scripts/progression-001C-sql.test.mjs').match(/const fixture=`([\s\S]*?)`;/)[1]);
  await db.exec(`CREATE TABLE auth.users(id uuid PRIMARY KEY); INSERT INTO auth.users VALUES('${actor}'),('${target}');
    CREATE TYPE public.character_gender AS ENUM('male','female'); CREATE TYPE public.app_role AS ENUM('player','steward','overlord');
    CREATE ROLE custom_child; GRANT custom_default TO custom_child;
    CREATE TABLE public.user_roles(user_id uuid,role public.app_role);
    CREATE FUNCTION public.has_role(uuid,public.app_role) RETURNS boolean LANGUAGE sql STABLE
      AS $$ SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=$1 AND role=$2) $$;
    ALTER TABLE classes ADD base_ac integer NOT NULL DEFAULT 10,ADD is_pre_class boolean NOT NULL DEFAULT true,
      ADD is_selectable boolean NOT NULL DEFAULT false,ADD status text NOT NULL DEFAULT 'active';
    INSERT INTO classes(class_key,base_hp,level_bonuses) VALUES('classless',18,'{}');
    CREATE TABLE public.races(race_key text PRIMARY KEY,str integer,dex integer,con integer,int integer,wis integer,cha integer,
      status text NOT NULL DEFAULT 'active',is_selectable boolean NOT NULL DEFAULT true);
    ALTER TABLE characters ADD name text NOT NULL DEFAULT 'Legacy',ADD race text NOT NULL DEFAULT 'human',
      ADD gender public.character_gender NOT NULL DEFAULT 'male',ADD gold integer NOT NULL DEFAULT 200,
      ADD current_node_id uuid,ADD family_id uuid,ADD family_name text,ADD family_changed_after_creation boolean NOT NULL DEFAULT false,
      ADD rp_total_earned integer NOT NULL DEFAULT 0,ADD created_at timestamptz NOT NULL DEFAULT now();
    CREATE TABLE public.nodes(id uuid PRIMARY KEY); INSERT INTO nodes VALUES('${node}');
    CREATE TABLE public.combat2_respawn_config(singleton boolean PRIMARY KEY,default_node_id uuid);
    INSERT INTO combat2_respawn_config VALUES(true,'${node}');
    CREATE TABLE public.combat2_test_arena_node(node_id uuid);
    CREATE TABLE public.character_materials(character_id uuid,material_key text,count integer,PRIMARY KEY(character_id,material_key));
    CREATE TABLE public.character_class_bonds(character_id uuid);
    ALTER TABLE characters ADD movement_locked_until timestamptz;
    ALTER TABLE nodes ADD is_trainer boolean DEFAULT true;
    CREATE TABLE node_encounter(id uuid,node_id uuid,status text,claim_token uuid,claim_expires_at timestamptz);
    CREATE TABLE node_fighter(character_id uuid,encounter_id uuid,present boolean);
    CREATE TABLE node_creature(encounter_id uuid,is_alive boolean,hp integer,engaged boolean);
    CREATE TABLE character_stance(character_id uuid);
    CREATE TABLE character_stance_request(character_id uuid,intent_id uuid,committed_at timestamptz);
    CREATE TABLE node_intent(character_id uuid,status text);
    CREATE TABLE combat2_departure_request(character_id uuid,status text);
    CREATE TABLE combat2_party_departure_request(request_id uuid,status text);
    CREATE TABLE combat2_party_departure_member(character_id uuid,request_id uuid,status text);
    CREATE TABLE combat_sessions(character_id uuid,party_id uuid);
    CREATE TABLE party_members(character_id uuid,party_id uuid,status text);
    ALTER TABLE characters ENABLE ROW LEVEL SECURITY;
    INSERT INTO characters(id,user_id,name,class,level,xp,str) VALUES('${legacy}','${target}','Unchanged Legacy','classless',37,123,42);`);
  for(const [race,delta] of Object.entries(manifest.races)) await q('INSERT INTO races(race_key,str,dex,con,int,wis,cha) VALUES($1,$2,$3,$4,$5,$6,$7)',[race,...['str','dex','con','int','wis','cha'].map(k=>delta[k])]);
  await db.exec(read('docs/operations/progression-001C-authority.sql'));
  await db.exec('CREATE TABLE public.progression_class_growth_milestone(character_id uuid,destination_level integer)');
  const f=read('drizzle/migrations/0005_progression_001f_canonical_renown_respec_authority.sql');
  await db.exec(f.match(/CREATE FUNCTION public\.progression_validate_fresh_internal\([\s\S]*?END \$\$;/)[0]);
  await db.exec(read('supabase/migrations/20260803232302_acc7c4e5-4148-48c0-8f35-8c2299e23944.sql'));
  // Exact installed storage/name dependencies, atomically, on this empty local DB.
  for(const p of ['drizzle/migrations/0007_progression_001g_c2_private_creation_storage.sql','drizzle/migrations/0008_progression_001g_c2_s2_name_identity.sql']){
    await db.exec('BEGIN');try{await db.exec(read(p));await db.exec('COMMIT');}catch(e){await db.exec('ROLLBACK');throw e;}
  }
  const old=await q('SELECT to_jsonb(c) r FROM characters c WHERE id=$1',[legacy]);
  await db.exec('BEGIN');try{await db.exec(sql);await db.exec('COMMIT');}catch(e){await db.exec('ROLLBACK');throw e;}
  assert.deepEqual(await q('SELECT to_jsonb(c) r FROM characters c WHERE id=$1',[legacy]),old);
  await db.exec('GRANT ALL ON character_materials TO anon,authenticated,service_role; GRANT UPDATE(count) ON character_materials TO anon,authenticated');
  await q("INSERT INTO character_materials VALUES($1,'salvage',40)",[uid(999)]); // Old orphan predates installed NOT VALID FK.
  await db.exec(read('drizzle/migrations/0010_progression_001g_c2_p2_b_inactive_integration.sql'));
  await installLifecycleFixture();
});
after(async()=>await db?.close());
// One-time reset uses the same real creation/storage/lifecycle dependencies as cutover.
const resetSql=()=>read('docs/operations/progression-001G-C2-character-reset.sql');
const resetNames=()=>Array.from(resetSql().split('UPDATE c2_reset_allowlist')[0].matchAll(/\('([^']+)','all'\)/g),m=>m[1]);
async function resetFixture(){
  for(const name of resetNames()) if(!(await q('SELECT to_regclass($1) r',['public.'+name]))[0].r){
    await db.exec(`CREATE TABLE public.${name}(id uuid PRIMARY KEY DEFAULT gen_random_uuid());INSERT INTO public.${name} DEFAULT VALUES`);
  }
  // Replace only the minimal registry made above, with the actual runtime location contract.
  await db.exec(`DROP TABLE unique_item_instance;
    CREATE TABLE unique_item_instance(id uuid PRIMARY KEY,item_id uuid UNIQUE REFERENCES items(id) ON DELETE RESTRICT,
      location_kind text NOT NULL CHECK(location_kind IN ('inventory','ground','marketplace','transit')),
      location_id uuid NOT NULL UNIQUE,updated_at timestamptz DEFAULT now());
    ALTER TABLE items ADD weapon_tag text;
    ALTER TABLE character_inventory ADD id uuid UNIQUE DEFAULT gen_random_uuid(), ADD unique_instance_id uuid
      REFERENCES unique_item_instance(id) DEFERRABLE INITIALLY DEFERRED;
    ALTER TABLE node_ground_loot ADD id uuid UNIQUE DEFAULT gen_random_uuid(),ADD item_id uuid REFERENCES items(id),
      ADD unique_instance_id uuid REFERENCES unique_item_instance(id) DEFERRABLE INITIALLY DEFERRED;
    ALTER TABLE marketplace_listings ADD id uuid UNIQUE DEFAULT gen_random_uuid(),ADD item_id uuid REFERENCES items(id),
      ADD unique_instance_id uuid REFERENCES unique_item_instance(id) DEFERRABLE INITIALLY DEFERRED;
    CREATE TABLE combat2_test_run(id uuid PRIMARY KEY,status text,final_summary jsonb);
    CREATE TABLE combat2_test_run_batch(run_id uuid REFERENCES combat2_test_run(id) ON DELETE CASCADE,
      batch_id uuid,encounter_id uuid,seq integer,PRIMARY KEY(run_id,batch_id));
    CREATE TABLE combat2_test_run_event(run_id uuid,batch_id uuid,event_seq integer,event jsonb,
      FOREIGN KEY(run_id,batch_id) REFERENCES combat2_test_run_batch(run_id,batch_id) ON DELETE CASCADE);
    CREATE TABLE profiles(id uuid PRIMARY KEY);INSERT INTO profiles SELECT id FROM auth.users;
    INSERT INTO user_roles VALUES('${actor}','overlord');
    CREATE TABLE configured_world_placement(id uuid PRIMARY KEY,item_id uuid REFERENCES items(id),node_id uuid REFERENCES nodes(id));`);
  for(const [name,path] of [['unique_holder_before_delete','supabase/migrations/20260915190000_combat2_authoritative_reward_model.sql'],
    ['unique_holder_finalize_delete','supabase/migrations/20260915190000_combat2_authoritative_reward_model.sql'],
    ['combat2_refuse_invalid_stance_equipment_change','supabase/migrations/20261001130000_combat2_character_persistent_stances.sql']]){
    await db.exec(read(path).match(new RegExp('CREATE(?: OR REPLACE)? FUNCTION public\\.'+name+'\\([\\s\\S]*?\\$\\$;'))[0]);
  }
  for(const name of ['character_inventory','node_ground_loot','marketplace_listings'])await db.exec(`
    CREATE TRIGGER ${name}_reset_delete BEFORE DELETE ON ${name} FOR EACH ROW EXECUTE FUNCTION unique_holder_before_delete();
    CREATE CONSTRAINT TRIGGER ${name}_reset_finalize AFTER DELETE ON ${name}
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION unique_holder_finalize_delete();`);
  await db.exec(`CREATE TRIGGER fixture_stance_inventory BEFORE DELETE ON character_inventory
    FOR EACH ROW EXECUTE FUNCTION combat2_refuse_invalid_stance_equipment_change()`);
  const c=await call({name:'ResetReusable'}),dead=await call({name:'DeletedReusable'});
  const event=uid(next++);await identity(null);
  await q("SELECT progression_apply_xp_internal($1,$2,'combat2_reward',50::numeric,$3::jsonb)",[c.characterId,event,{rewardClaimId:event}]);
  await identity(actor);
  await q("UPDATE characters SET deleted_at=now(),restore_until=now()+interval '720 hours',lifecycle_version=1 WHERE id=$1",[dead.characterId]);
  for(const [kind,table] of [['inventory','character_inventory'],['ground','node_ground_loot'],['marketplace','marketplace_listings'],['transit',null]]){
    const item=uid(next++),instance=uid(next++),holder=uid(next++);
    await q("INSERT INTO items VALUES($1,'{}','shield')",[item]);
    await q('INSERT INTO unique_item_instance VALUES($1,$2,$3,$4,now())',[instance,item,kind,holder]);
    if(table==='character_inventory')await q("INSERT INTO character_inventory(character_id,item_id,equipped_slot,current_durability,id,unique_instance_id) VALUES($1,$2,'off_hand',1,$3,$4)",[c.characterId,item,holder,instance]);
    if(table==='node_ground_loot')await q('INSERT INTO node_ground_loot(dropped_by,item_id,id,unique_instance_id) VALUES(NULL,$1,$2,$3)',[item,holder,instance]);
    if(table==='marketplace_listings')await q('INSERT INTO marketplace_listings(seller_character_id,item_id,id,unique_instance_id) VALUES($1,$2,$3,$4)',[dead.characterId,item,holder,instance]);
    await q('INSERT INTO configured_world_placement VALUES($1,$2,$3)',[uid(next++),item,node]);
  }
  await q("INSERT INTO character_stance(character_id,ability_key) VALUES($1,'shield_wall')",[c.characterId]);
  await q("INSERT INTO issue_reports VALUES($1,'ResetReusable',$2)",[c.characterId,actor]);
  // Exactly the historical orphan CSV plus the pre-existing local orphan; reset accepts all obsolete material state.
  const csv=read('docs/operations/progression-001G-C2-orphan-materials-snapshot.csv').trim().split(/\r?\n/);
  const headers=csv.shift().split(',');
  // Model rows predating 0010: load obsolete rows before installing its NOT VALID FK.
  // This fixture-only reconstruction never disables a trigger/constraint in reset SQL.
  await db.exec('ALTER TABLE character_materials DROP CONSTRAINT character_materials_character_id_c2_fkey');
  for(const line of csv){const v=line.split(',').map(x=>x.replace(/^"|"$/g,''));await q('INSERT INTO character_materials VALUES($1,$2,$3)',[v[headers.indexOf('character_id')],v[headers.indexOf('material_key')],Number(v[headers.indexOf('count')])]);}
  await db.exec('ALTER TABLE character_materials ADD CONSTRAINT character_materials_character_id_c2_fkey FOREIGN KEY(character_id) REFERENCES characters(id) ON UPDATE RESTRICT ON DELETE CASCADE NOT VALID');
  for(const status of ['recording','completed']){
    const run=uid(next++),batch=uid(next++);
    await q('INSERT INTO combat2_test_run VALUES($1,$2,$3)',[run,status,{historical_character_id:c.characterId}]);
    await q('INSERT INTO combat2_test_run_batch VALUES($1,$2,$3,1)',[run,batch,uid(next++)]);
    await q('INSERT INTO combat2_test_run_event VALUES($1,$2,1,$3)',[run,batch,{actor_id:dead.characterId,actor_name:'Historical'}]);
  }
  return c;
}
test('full reset empties all 72 targets, tombstones, all ground loot, transit and 203 CSV orphans; preserves reports/accounts/world',async()=>tx(async()=>{
  await resetFixture();
  const definitions=await q('SELECT to_jsonb(x) r FROM configured_world_placement x');
  const reports=await q("SELECT to_jsonb(x) r FROM combat2_test_run x WHERE status='completed'");
  await db.exec(resetSql());
  for(const table of resetNames())assert.equal((await q(`SELECT count(*)::int n FROM ${table}`))[0].n,0,table);
  assert.deepEqual(await q('SELECT to_jsonb(x) r FROM configured_world_placement x'),definitions);
  assert.deepEqual(await q('SELECT to_jsonb(x) r FROM combat2_test_run x'),reports);
  assert.equal((await q('SELECT count(*)::int n FROM combat2_test_run_event'))[0].n,1);
  assert.equal((await q('SELECT count(*)::int n FROM auth.users'))[0].n,2);
  assert.equal((await q("SELECT count(*)::int n FROM user_roles WHERE role='overlord'"))[0].n,1);
  assert.deepEqual(await q('SELECT * FROM issue_reports'),[{character_id:null,character_name:null,user_id:actor}]);
  const fresh=await call({name:'ResetReusable'});assert.ok(fresh.characterId);
  assert.equal((await q('SELECT count(*)::int n FROM character_materials'))[0].n,7);
  assert.equal((await q('SELECT count(*)::int n FROM characters'))[0].n,1);
}));
test('reset rejects unknown persistent FK or unlisted sidecar before losing any rows',async()=>tx(async()=>{
  await resetFixture();const before=await counts();
  await db.exec('SAVEPOINT unknown_reset');
  await db.exec('CREATE TABLE persistent_world_dependency(character_id uuid REFERENCES characters(id) ON DELETE CASCADE)');
  await refused(()=>db.exec(resetSql()),/preserved incoming FK/);assert.deepEqual(await counts(),before);
  await db.exec('ROLLBACK TO SAVEPOINT unknown_reset;RELEASE SAVEPOINT unknown_reset');
  await db.exec('CREATE TABLE unlisted_quest_state(character_id uuid)');
  await refused(()=>db.exec(resetSql()),/unlisted character dependency/);assert.deepEqual(await counts(),before);
}));
test('reset refuses unreviewed DELETE triggers and already-active lifecycle fences rather than bypassing them',async()=>tx(async()=>{
  await resetFixture();const before=await counts();
  await db.exec(`CREATE FUNCTION unexpected_reset_trigger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN OLD;END $$;
    CREATE TRIGGER unexpected_reset_trigger BEFORE DELETE ON characters FOR EACH ROW EXECUTE FUNCTION unexpected_reset_trigger()`);
  await refused(()=>db.exec(resetSql()),/unreviewed DELETE/);assert.deepEqual(await counts(),before);
  await db.exec('DROP TRIGGER unexpected_reset_trigger ON characters');await cutover();
  await refused(()=>db.exec(resetSql()),/unreviewed DELETE/);assert.deepEqual(await counts(),before);
}));
test('reset late assertion failure rolls back all deleted character/runtime/material/report data',async()=>tx(async()=>{
  await resetFixture();const before=await counts();
  // Inject failure after deletion, deferred trigger completion and preservation comparison.
  const failing=resetSql().replace('END $reset$;',"RAISE EXCEPTION 'late_reset_assertion'; END $reset$;");
  await refused(()=>db.exec(failing),/late_reset_assertion/);assert.deepEqual(await counts(),before);
  assert.equal((await q('SELECT count(*)::int n FROM combat2_test_run'))[0].n,2);
  assert.equal((await q('SELECT count(*)::int n FROM unique_item_instance'))[0].n,4);
}));
test('same-transaction reset plus unchanged corrected B rolls back reset on cutover failure and then creates only through C2',async()=>tx(async()=>{
  await resetFixture();await support();await familyFixture();
  for(const source of runtimeSources)await db.exec(originalRuntime(source).replace(/CREATE(?: OR REPLACE)? FUNCTION/i,'CREATE OR REPLACE FUNCTION'));
  await db.exec(`INSERT INTO pg_catalog.pg_extension(oid,extname,extowner,extnamespace,extrelocatable,extversion)
    VALUES(900001,'pg_cron','postgres'::regrole,'cron'::regnamespace,false,'fixture');
    CREATE FUNCTION cron.schedule(text,text,text) RETURNS bigint LANGUAGE plpgsql AS $$ BEGIN INSERT INTO cron.job VALUES($1,$2,$3);RETURN 1;END $$;
    INSERT INTO cron.job VALUES('character-c2-receipt-expiry','fixture','fixture')`);
  const combined=read('docs/operations/progression-001G-C2-reset-and-cutover.sql'),before=await counts();
  assert.ok(combined.indexOf(resetSql())<combined.indexOf(read('docs/operations/progression-001G-C2-integrated-cutover.sql')));
  await refused(()=>db.exec(combined),/job already exists/);assert.deepEqual(await counts(),before);
  await db.exec("DELETE FROM cron.job WHERE jobname='character-c2-receipt-expiry'");await db.exec(combined);
  assert.equal((await q('SELECT count(*)::int n FROM characters'))[0].n,0);
  await db.exec('SET LOCAL ROLE authenticated');
  const created=(await q("SELECT character_create_c2($1,'ResetReusable','human','male',NULL,NULL,'creation-c2-v1') r",[uid(next++)]))[0].r;
  await db.exec('RESET ROLE');assert.ok(created.characterId);
  assert.equal((await q('SELECT count(*)::int n FROM character_materials'))[0].n,7);
  assert.equal((await q("SELECT has_table_privilege('service_role','characters','INSERT') allowed"))[0].allowed,false);
}));
async function installLifecycleFixture(){
  for(const table of ['combat_audit_log','combat_soak_access','combat2_respawn_request','combat2_diagnostic_session',
    'combat2_test_arena_access','combat2_test_arena_stance_snapshot_header','encounter_access_grants',
    'encounter_engagements','encounter_participants','node_participation']) await db.exec(`CREATE TABLE ${table}(character_id uuid)`);
  await db.exec(`ALTER TABLE node_intent ADD target_character_id uuid;
    ALTER TABLE node_fighter ADD id uuid UNIQUE DEFAULT gen_random_uuid();
    ALTER TABLE combat2_party_departure_member ADD fighter_id uuid REFERENCES node_fighter(id);
    ALTER TABLE combat2_diagnostic_session ADD id uuid UNIQUE DEFAULT gen_random_uuid();
    CREATE TABLE combat2_diagnostic_server_event(session_id uuid REFERENCES combat2_diagnostic_session(id) ON DELETE CASCADE);
    ALTER TABLE combat2_test_arena_stance_snapshot_header ADD arena_id uuid,ADD PRIMARY KEY(arena_id,character_id);
    CREATE TABLE combat2_test_arena_stance_snapshot(arena_id uuid,character_id uuid,
      FOREIGN KEY(arena_id,character_id) REFERENCES combat2_test_arena_stance_snapshot_header(arena_id,character_id) ON DELETE CASCADE);
    ALTER TABLE combat2_party_departure_request ADD leader_character_id uuid;
    CREATE TABLE parties(leader_id uuid,tank_id uuid);
    CREATE TABLE summon_requests(summoner_id uuid,target_id uuid,status text);
    CREATE TABLE combat_actions(character_id uuid,target_character_id uuid,status text);
    CREATE TABLE node_pending_event(actor_character_id uuid,target_character_id uuid,consumed_at timestamptz);
    CREATE TABLE node_ground_loot(dropped_by uuid);
    CREATE TABLE issue_reports(character_id uuid,character_name text,user_id uuid);`);
  for(const table of ['character_ability_loadout','character_inventory_action_request','character_special_travel_request','character_waymark','character_npc_gifts','character_guide_reads','hidden_path_search_request']) await db.exec(`CREATE TABLE ${table}(character_id uuid)`);
  await db.exec(`CREATE TABLE node_effect(source_character_id uuid,target_character_id uuid);
    CREATE TABLE combat2_player_presence(character_id uuid PRIMARY KEY,user_id uuid,seen_at timestamptz);
    CREATE TABLE combat2_test_presence(arena_id uuid,character_id uuid,user_id uuid,seen_at timestamptz,PRIMARY KEY(arena_id,character_id));`);
  await db.exec(`CREATE TABLE marketplace_listings(seller_character_id uuid,buyer_character_id uuid);
    ALTER TABLE characters ADD CONSTRAINT fixture_account_fk FOREIGN KEY(user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
    CREATE TABLE active_effects(target_id uuid,source_id uuid);
    CREATE TABLE character_visited_nodes(character_id uuid);
    CREATE TABLE node_reward_claim(character_id uuid);
    REVOKE ALL ON characters FROM PUBLIC,anon,authenticated,service_role,custom_default;
    GRANT SELECT ON characters TO authenticated,service_role;
    GRANT UPDATE(gold) ON characters TO service_role;
    ALTER ROLE service_role BYPASSRLS;
    CREATE POLICY fixture_owner_read ON characters FOR SELECT TO authenticated USING(user_id=auth.uid());
    CREATE FUNCTION public.delete_character_cascade(uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
    BEGIN DELETE FROM character_inventory WHERE character_id=$1;DELETE FROM character_materials WHERE character_id=$1;
      DELETE FROM characters WHERE id=$1;RETURN $1;END $$;
    GRANT EXECUTE ON FUNCTION delete_character_cascade(uuid) TO authenticated,service_role;
    GRANT DELETE,TRUNCATE ON characters TO service_role;
    GRANT authenticated,anon TO postgres;`);
  const beforeRows=await q('SELECT to_jsonb(c) r FROM characters c');
  await db.exec('BEGIN');try{await db.exec(read('docs/operations/progression-001G-C2-P2-C-inactive-lifecycle.sql'));await db.exec('COMMIT');}
  catch(e){await db.exec('ROLLBACK');throw e;}
  assert.deepEqual((await q("SELECT to_jsonb(c)-ARRAY['deleted_at','restore_until','lifecycle_version'] r FROM characters c")),beforeRows);
  await installRuntimeFixture();
}
const runtimeSources=[
  ['combat2_presence_heartbeat','supabase/migrations/20260913100000_combat2_production_cutover.sql','c.user_id=caller)','c.user_id=caller AND c.deleted_at IS NULL)'],
  ['combat2_session_access','supabase/migrations/20260913100000_combat2_production_cutover.sql','c.current_node_id=_node_id)','c.current_node_id=_node_id AND c.deleted_at IS NULL)'],
  ['settle_out_of_combat_resources','supabase/migrations/20260923100000_authoritative_ooc_resource_settlement.sql','FROM public.characters ORDER BY id FOR UPDATE','FROM public.characters WHERE deleted_at IS NULL ORDER BY id FOR UPDATE']
];
const installedSettlement=()=>Array.from(read('docs/operations/progression-001G-C2-settlement-installed-definitions.txt').matchAll(/\|(CREATE OR REPLACE FUNCTION [\s\S]*?AS \$function\$[\s\S]*?\$function\$)/g),m=>m[1]+';').join('\n');
const originalRuntime=([name,path])=>name==='settle_out_of_combat_resources'?installedSettlement():read(path).match(new RegExp('CREATE(?: OR REPLACE)? FUNCTION public\\.'+name+'\\([\\s\\S]*?\\$\\$;','i'))[0];
async function installRuntimeFixture(){
  await db.exec(`ALTER TABLE nodes ADD is_inn boolean DEFAULT false;
    ALTER TABLE node_fighter ADD left_at timestamptz;
    ALTER TABLE combat2_departure_request ADD resolved_at timestamptz;
    ALTER TABLE combat2_party_departure_member ADD resolved_at timestamptz;
    ALTER TABLE combat2_test_arena_node ADD arena_id uuid,ADD active boolean;
    CREATE TABLE combat2_test_arena(id uuid,active boolean);
    ALTER TABLE combat2_respawn_request ADD created_at timestamptz;
    CREATE ROLE sandbox_exec_gpclaklkaolyzfnooajt;
    ALTER TABLE character_stance ADD ability_key text,ADD state jsonb DEFAULT '{}',ADD version bigint DEFAULT 0,ADD updated_at timestamptz;
    CREATE TABLE character_resource_settlement_state(singleton boolean PRIMARY KEY,settled_bucket timestamptz,updated_at timestamptz);
    INSERT INTO character_resource_settlement_state VALUES(true,date_bin(interval '4 seconds',clock_timestamp(),timestamptz 'epoch')-interval '4 seconds',clock_timestamp());
    CREATE SCHEMA cron;CREATE TABLE cron.job(jobname text,schedule text,command text);
    INSERT INTO cron.job VALUES('combat2-dispatch-once','2 seconds','SELECT public.combat2_dispatch_scheduler_fire();');
    CREATE FUNCTION world_state_is_awake() RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
    CREATE FUNCTION combat_mode_is_open() RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
    CREATE FUNCTION combat2_test_arena_access_allowed(uuid,uuid,uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
    CREATE TABLE combat_config(key text PRIMARY KEY,value text);INSERT INTO combat_config VALUES('combat_mode','maintenance');
    CREATE TABLE fixture_wake(count integer);INSERT INTO fixture_wake VALUES(0);
    CREATE FUNCTION wake_world() RETURNS void LANGUAGE sql AS $$ UPDATE fixture_wake SET count=count+1 $$;
    CREATE FUNCTION shutdown_world() RETURNS void LANGUAGE sql AS $$ SELECT $$;
    CREATE FUNCTION combat2_dispatch_scheduler_enable() RETURNS jsonb LANGUAGE sql AS $$ SELECT '{"ok":true}'::jsonb $$;
    CREATE FUNCTION combat2_dispatch_scheduler_disable() RETURNS void LANGUAGE sql AS $$ SELECT $$;`);
  for(const source of runtimeSources) await db.exec(originalRuntime(source));
  await db.exec(`REVOKE ALL ON FUNCTION combat2_presence_heartbeat(uuid),combat2_session_access(uuid,uuid),settle_out_of_combat_resources(timestamptz) FROM PUBLIC,anon,authenticated,service_role,custom_default;
    GRANT EXECUTE ON FUNCTION combat2_presence_heartbeat(uuid),combat2_session_access(uuid,uuid) TO authenticated,service_role;
    GRANT EXECUTE ON FUNCTION settle_out_of_combat_resources(timestamptz) TO service_role;`);
  await db.exec(`REVOKE ALL ON FUNCTION settle_out_of_combat_resources(timestamptz),settle_out_of_combat_resources_without_character_stances(timestamptz),combat2_regenerate_force_shields(timestamptz,integer) FROM PUBLIC,anon,authenticated,custom_default;
    GRANT EXECUTE ON FUNCTION settle_out_of_combat_resources(timestamptz),settle_out_of_combat_resources_without_character_stances(timestamptz),combat2_regenerate_force_shields(timestamptz,integer) TO service_role,sandbox_exec_gpclaklkaolyzfnooajt;`);
  const acl=await q("SELECT proname,proowner,proacl::text FROM pg_proc WHERE proname=ANY($1::text[]) ORDER BY proname",[runtimeSources.map(s=>s[0])]);
  await db.exec(read('docs/operations/progression-001G-C2-P2-C-runtime-exclusions.sql'));
  assert.deepEqual(await q("SELECT proname,proowner,proacl::text FROM pg_proc WHERE proname=ANY($1::text[]) ORDER BY proname",[runtimeSources.map(s=>s[0])]),acl);
}
const familySource=()=>read('supabase/migrations/20260610100423_3b7b3bc3-161e-4cb6-a48b-1150b5cd57f3.sql')
  .match(/CREATE OR REPLACE FUNCTION public\.apply_family_to_character\([\s\S]*?\$\$;/)[0];
async function familyFixture(){
  await db.exec(`CREATE TABLE families(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),key text UNIQUE,display_name text,founder_user_id uuid);
    CREATE TABLE family_members(family_id uuid,user_id uuid);
    CREATE FUNCTION _family_name_is_reserved(text) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;`);
  await db.exec(familySource());
}
const lifecycle=async({id=legacy,request=uid(next++),version=0,operation='soft_delete',reason=null}={})=>
  (await q('SELECT character_lifecycle_command($1,$2,$3,$4,$5) r',[id,request,version,operation,reason]))[0].r;
const cutover=()=>db.exec(read('docs/operations/progression-001G-C2-P2-C-lifecycle-cutover.sql'));
const support=()=>db.exec(read('docs/operations/progression-001G-C2-integrated-private-support.sql'));
test('hosted blocker preflight evaluates postgres instead of restricted inspector and distrusts RLS orphan counts',async()=>tx(async()=>{
  await familyFixture();
  await db.exec(`CREATE ROLE supabase_read_only_user;
    GRANT USAGE ON SCHEMA auth,cron TO supabase_read_only_user;
    GRANT SELECT ON characters,character_materials,cron.job TO supabase_read_only_user;
    CREATE FUNCTION cron.schedule(text,text,text) RETURNS bigint LANGUAGE sql AS $$ SELECT 1::bigint $$;
    REVOKE ALL ON FUNCTION cron.schedule(text,text,text) FROM PUBLIC;`);
  await db.exec('SET LOCAL ROLE supabase_read_only_user');
  const results=await db.exec(read('docs/operations/progression-001G-C2-integrated-preflight.sql'));
  const rows=results.flatMap(r=>r.rows??[]);
  const installer=rows.find(r=>r.inspector_role);
  assert.equal(installer.inspector_role,'supabase_read_only_user');assert.equal(installer.installer_auth_trigger,true);
  assert.equal((await q("SELECT has_table_privilege(current_user,'auth.users','TRIGGER') allowed"))[0].allowed,false);
  assert.equal(rows.find(r=>'installer_schedule_execute' in r).installer_schedule_execute,true);
  assert.equal((await q("SELECT has_function_privilege(current_user,'cron.schedule(text,text,text)','EXECUTE') allowed"))[0].allowed,false);
  const orphans=rows.find(r=>'count_reliable' in r);assert.equal(orphans.count_reliable,false);assert.equal(orphans.orphan_material_rows,null);
  await db.exec('RESET ROLE');
}));
test('settlement exact helper guard refuses drift and leaves wrapper unchanged',async()=>tx(async()=>{
  for(const source of runtimeSources) await db.exec(originalRuntime(source).replace(/CREATE(?: OR REPLACE)? FUNCTION/i,'CREATE OR REPLACE FUNCTION'));
  const wrapper=(await q("SELECT prosrc FROM pg_proc WHERE oid='settle_out_of_combat_resources(timestamptz)'::regprocedure"))[0];
  await db.exec("CREATE OR REPLACE FUNCTION combat2_regenerate_force_shields(_now timestamptz,_settlement_steps integer) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN RETURN 21; END $$;");
  await refused(()=>db.exec(read('docs/operations/progression-001G-C2-P2-C-runtime-exclusions.sql')),/runtime source drift: combat2_regenerate_force_shields/);
  assert.deepEqual((await q("SELECT prosrc FROM pg_proc WHERE oid='settle_out_of_combat_resources(timestamptz)'::regprocedure"))[0],wrapper);
}));

test('integrated support is dormant, private and reports retained quota without changing characters',async()=>tx(async()=>{
  const before=await counts();await support();assert.deepEqual(await counts(),before);
  assert.equal((await q("SELECT has_function_privilege('authenticated','character_creation_capacity(uuid)','EXECUTE') allowed"))[0].allowed,false);
  assert.deepEqual((await q('SELECT character_creation_capacity(NULL) r'))[0].r,{retained:0,limit:5});
  const c=await call();await cutover();await lifecycle({id:c.characterId});
  assert.deepEqual((await q('SELECT character_creation_capacity(NULL) r'))[0].r,{retained:1,limit:5});
  await refused(()=>q('SELECT character_creation_capacity($1)',[target]),/not_authorized/);
  await overlord();assert.deepEqual((await q('SELECT character_creation_capacity($1) r',[target]))[0].r,{retained:1,limit:5});
}));
test('creation detail expiry preserves live-account replay and immutable origin',async()=>tx(async()=>{
  await support();const c=await call();const origin=await q('SELECT * FROM character_creation_origin');
  // Local age fixture only: production maintenance cannot rewrite the clocks.
  await db.exec('ALTER TABLE character_creation_log DISABLE TRIGGER character_creation_log_lifecycle');
  await q("UPDATE character_creation_log SET created_at=timestamptz '2020-01-01',details_expires_at=timestamptz '2021-01-01' WHERE result_character_id=$1",[c.characterId]);
  await db.exec('ALTER TABLE character_creation_log ENABLE TRIGGER character_creation_log_lifecycle');
  await q('SELECT character_receipt_maintenance_internal()');
  const log=(await q('SELECT * FROM character_creation_log'))[0];
  assert.equal(log.detailed_receipt,null);assert.equal(log.replay_status,'applied');assert.equal(log.actor_id,actor);
  assert.deepEqual(await q('SELECT * FROM character_creation_origin'),origin);
  assert.equal((await q("SELECT has_function_privilege('service_role','character_receipt_maintenance_internal()','EXECUTE') allowed"))[0].allowed,false);
}));
test('expired purge details keep replay until controlled actor deletion, without automatic character purge',async()=>tx(async()=>{
  await support();await overlord();const c=await call();await cutover();
  await lifecycle({id:c.characterId});await age(c.characterId,721);
  await lifecycle({id:c.characterId,version:1,operation:'purge',reason:'Expired and approved'});
  await db.exec('ALTER TABLE character_creation_log DISABLE TRIGGER character_creation_log_lifecycle');
  await q("UPDATE character_creation_log SET created_at=timestamptz '2020-01-01',details_expires_at=timestamptz '2021-01-01' WHERE result_character_id=$1",[c.characterId]);
  await db.exec('ALTER TABLE character_creation_log ENABLE TRIGGER character_creation_log_lifecycle');
  await db.exec('ALTER TABLE character_lifecycle_receipt DISABLE TRIGGER character_lifecycle_receipt_immutable');
  await q("UPDATE character_lifecycle_receipt SET occurred_at=timestamptz '2020-01-01',details_expires_at=timestamptz '2021-01-01' WHERE character_id=$1",[c.characterId]);
  await db.exec('ALTER TABLE character_lifecycle_receipt ENABLE TRIGGER character_lifecycle_receipt_immutable');
  await q('SELECT character_receipt_maintenance_internal()');
  assert.equal((await q('SELECT reason FROM character_lifecycle_receipt WHERE operation=\'purge\''))[0].reason,null);
  assert.equal((await q('SELECT replay_status FROM character_creation_log'))[0].replay_status,'purged');
  assert.equal((await q('SELECT count(*)::int n FROM characters WHERE id=$1',[legacy]))[0].n,1);
  await db.exec('CREATE TRIGGER fixture_account_cleanup AFTER DELETE ON auth.users FOR EACH ROW EXECUTE FUNCTION character_account_deleted_internal()');
  await q('DELETE FROM auth.users WHERE id=$1',[actor]);
  assert.equal((await q('SELECT count(*)::int n FROM character_creation_log'))[0].n,0);
  assert.equal((await q('SELECT count(*)::int n FROM character_lifecycle_receipt'))[0].n,0);
}));
test('controlled actor deletion retires only its replay and preserves delegated recipient provenance',async()=>tx(async()=>{
  await support();await overlord();const c=await call({owner:target,reason:'delegated'});
  await cutover();
  await db.exec('CREATE TRIGGER fixture_account_cleanup AFTER DELETE ON auth.users FOR EACH ROW EXECUTE FUNCTION character_account_deleted_internal()');
  await refused(()=>q('DELETE FROM auth.users WHERE id=$1',[target]),/lifecycle|creation origin|foreign key/i);
  const origin=await q('SELECT * FROM character_creation_origin WHERE character_id=$1',[c.characterId]);
  await q('DELETE FROM auth.users WHERE id=$1',[actor]);
  const log=(await q('SELECT * FROM character_creation_log'))[0];
  assert.equal(log.replay_status,'retired');assert.equal(log.actor_id,null);assert.equal(log.request_id,null);
  assert.notEqual(log.detailed_receipt,null);
  assert.deepEqual(await q('SELECT * FROM character_creation_origin WHERE character_id=$1',[c.characterId]),origin);
}));
test('coordinated containment refuses orphan data atomically and excludes owner membership',async()=>tx(async()=>{
  await support();
  await refused(()=>db.exec(read('docs/operations/progression-001G-C2-P2-B-cutover-containment.sql')),/foreign key|not present/i);
  assert.equal((await q("SELECT has_function_privilege('authenticated','delete_character_cascade(uuid)','EXECUTE') allowed"))[0].allowed,true);
  // Remove only the deliberately-created orphan inside the disposable rollback fixture.
  await q('DELETE FROM character_materials WHERE character_id=$1',[uid(999)]);
  await db.exec(read('docs/operations/progression-001G-C2-P2-B-cutover-containment.sql'));
  assert.equal((await q("SELECT has_function_privilege('authenticated','delete_character_cascade(uuid)','EXECUTE') allowed"))[0].allowed,false);
  assert.equal((await q("SELECT has_function_privilege('postgres','delete_character_cascade(uuid)','EXECUTE') allowed"))[0].allowed,true);
  assert.equal((await q("SELECT has_function_privilege('authenticated','character_create_c2(uuid,text,text,text,uuid,text,text)','EXECUTE') allowed"))[0].allowed,false);
}));
test('complete composed cutover is atomic, grants only bridges and schedules receipt cleanup only',async()=>tx(async()=>{
  await support();
  await familyFixture();
  for(const source of runtimeSources) await db.exec(originalRuntime(source).replace(/CREATE(?: OR REPLACE)? FUNCTION/i,'CREATE OR REPLACE FUNCTION'));
  await q('DELETE FROM character_materials WHERE character_id=$1',[uid(999)]);
  await db.exec(`CREATE FUNCTION character_create(text) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ SELECT $$;
    GRANT EXECUTE ON FUNCTION character_create(text) TO authenticated;
    GRANT INSERT ON characters TO authenticated,service_role;`);
  // PGlite cannot load pg_cron: this is an explicit catalog/API fixture solely to
  // compile the scheduling branch. It does NOT test a real scheduler or job execution.
  await db.exec(`INSERT INTO pg_catalog.pg_extension(oid,extname,extowner,extnamespace,extrelocatable,extversion)
    VALUES(900001,'pg_cron','postgres'::regrole,'cron'::regnamespace,false,'fixture');
    CREATE FUNCTION cron.schedule(text,text,text) RETURNS bigint LANGUAGE plpgsql AS $$
    BEGIN INSERT INTO cron.job VALUES($1,$2,$3);RETURN 1;END $$;`);
  const composed=read('docs/operations/progression-001G-C2-integrated-cutover.sql');
  // Fail at the last component and prove all earlier writer revocations roll back.
  await db.exec("INSERT INTO cron.job VALUES('character-c2-receipt-expiry','fixture','fixture')");
  await refused(()=>db.exec(composed),/job already exists/);
  assert.equal((await q("SELECT has_function_privilege('authenticated','character_create(text)','EXECUTE') allowed"))[0].allowed,true);
  assert.equal((await q("SELECT count(*)::int n FROM pg_trigger WHERE tgname='character_c2_account_deleted'"))[0].n,0);
  await db.exec("DELETE FROM cron.job WHERE jobname='character-c2-receipt-expiry'");
  await db.exec(composed);
  assert.equal((await q("SELECT has_function_privilege('authenticated','character_create(text)','EXECUTE') allowed"))[0].allowed,false);
  for(const role of ['anon','service_role']) {
    assert.equal((await q("SELECT has_function_privilege($1,'character_create_c2(uuid,text,text,text,uuid,text,text)','EXECUTE') allowed",[role]))[0].allowed,false);
  }
  assert.equal((await q("SELECT has_table_privilege('service_role','characters','INSERT') allowed"))[0].allowed,false);
  assert.equal((await q("SELECT has_function_privilege('authenticated','character_create_c2_internal(uuid,text,text,text,uuid,text,text)','EXECUTE') allowed"))[0].allowed,false);
  const request=uid(next++);
  await db.exec('SET LOCAL ROLE authenticated');
  const created=(await q("SELECT character_create_c2($1,'BridgeOnly','human','male',NULL,NULL,'creation-c2-v1') r",[request]))[0].r;
  const replay=(await q("SELECT character_create_c2($1,'BridgeOnly','human','male',NULL,NULL,'creation-c2-v1') r",[request]))[0].r;
  assert.deepEqual(replay,created);
  await db.exec('RESET ROLE');
  assert.equal((await q('SELECT count(*)::int n FROM character_materials WHERE character_id=$1',[created.characterId]))[0].n,7);
  assert.equal((await q("SELECT count(*)::int n FROM cron.job WHERE jobname='character-c2-receipt-expiry' AND command='SELECT public.character_receipt_maintenance_internal();'"))[0].n,1);
}));
test('family guard enforces L10 founding but preserves L1 joining and existing ACLs',async()=>tx(async()=>{
  await familyFixture();const c=await call();
  const before=(await q("SELECT proacl::text acl FROM pg_proc WHERE oid='apply_family_to_character(uuid,text)'::regprocedure"))[0];
  await db.exec(read('docs/operations/progression-001G-C2-integrated-family-guard.sql'));
  assert.deepEqual((await q("SELECT proacl::text acl FROM pg_proc WHERE oid='apply_family_to_character(uuid,text)'::regprocedure"))[0],before);
  await refused(()=>q("SELECT apply_family_to_character($1,'Newfamily')",[c.characterId]),/level 10/);
  await q("INSERT INTO families(key,display_name,founder_user_id) VALUES('existing','Existing',$1)",[actor]);
  assert.equal((await q("SELECT apply_family_to_character($1,'Existing') r",[c.characterId]))[0].r.ok,true);
  // The fixture legacy character already exceeds L10; no raw progression rewrite.
  await identity(target);assert.equal((await q("SELECT apply_family_to_character($1,'Founded') r",[legacy]))[0].r.ok,true);
  await identity(actor);await cutover();await lifecycle({id:c.characterId});
  await refused(()=>q("SELECT apply_family_to_character($1,'Existing')",[c.characterId]),/Character not found/);
}));
test('runtime exclusions change only four active-character predicates, preserving wrapper and ACLs',async()=>tx(async()=>{
  for(const source of runtimeSources.slice(0,2)){
    const expected=originalRuntime(source).replace(source[2],source[3]).match(/AS \$\$([\s\S]*?)\$\$;/i)[1].replace(/\r\n/g,'\n');
    assert.equal((await q('SELECT replace(prosrc,E\'\\r\\n\',E\'\\n\') body FROM pg_proc WHERE proname=$1',[source[0]]))[0].body,expected);
  }
  for(const m of installedSettlement().matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\([\s\S]*?AS \$function\$([\s\S]*?)\$function\$/g)){
    const expected=m[2].replace('FROM public.characters ORDER BY id FOR UPDATE','FROM public.characters WHERE deleted_at IS NULL ORDER BY id FOR UPDATE').replace("WHERE s.ability_key='force_shield' ORDER BY c.id FOR UPDATE OF c,s LOOP","WHERE s.ability_key='force_shield' AND c.deleted_at IS NULL ORDER BY c.id FOR UPDATE OF c,s LOOP");
    assert.equal((await q('SELECT prosrc FROM pg_proc WHERE proname=$1',[m[1]]))[0].prosrc,expected);
  }
  assert.equal((await q("SELECT has_function_privilege('authenticated','settle_out_of_combat_resources(timestamptz)','EXECUTE') allowed"))[0].allowed,false);
  assert.equal((await q("SELECT has_function_privilege('service_role','settle_out_of_combat_resources(timestamptz)','EXECUTE') allowed"))[0].allowed,true);
}));
test('runtime replacement refuses installed body drift; activation refuses missing exclusions',async()=>tx(async()=>{
  for(const source of runtimeSources) await db.exec(originalRuntime(source).replace(/CREATE(?: OR REPLACE)? FUNCTION/i,'CREATE OR REPLACE FUNCTION'));
  await refused(()=>cutover(),/runtime exclusions must precede/);
  await db.exec(originalRuntime(runtimeSources[0]).replace(/CREATE(?: OR REPLACE)? FUNCTION/i,'CREATE OR REPLACE FUNCTION').replace('END $$;',()=> 'END -- drift\n$$;'));
  await refused(()=>db.exec(read('docs/operations/progression-001G-C2-P2-C-runtime-exclusions.sql')),/runtime source drift/);
}));
test('deleted session and heartbeat entry refuse before world wake or presence creation',async()=>tx(async()=>{
  const c=await call();await cutover();await lifecycle({id:c.characterId});
  for(const statement of ['SELECT combat2_presence_heartbeat($1) r','SELECT combat2_session_access($1,$2) r']){
    const result=(await q(statement,statement.includes('$2')?[c.characterId,node]:[c.characterId]))[0].r;
    assert.equal(result.kind,'not_authorized');assert.equal(result.ok,false);
  }
  assert.equal((await q('SELECT count FROM fixture_wake'))[0].count,0);
  assert.equal((await q('SELECT count(*)::int n FROM combat2_player_presence'))[0].n,0);
}));
test('existing ordinary or Arena presence refuses deletion without removing shared-session state',async()=>tx(async()=>{
  const c=await call();await cutover();
  for(const statement of ['INSERT INTO combat2_player_presence VALUES($1,$2,clock_timestamp())',
    'INSERT INTO combat2_test_presence VALUES($1,$1,$2,clock_timestamp())']){
    await db.exec('SAVEPOINT presence');await q(statement,[c.characterId,actor]);
    await refused(()=>lifecycle({id:c.characterId}),/not_quiescent/);
    assert.equal((await row(c.characterId)).deleted_at,null);
    await db.exec('ROLLBACK TO SAVEPOINT presence; RELEASE SAVEPOINT presence');
  }
}));
test('actual shared resource settlement skips tombstones while active character still regenerates',async()=>tx(async()=>{
  const c=await call(),active=await call({name:'Active'});await cutover();await lifecycle({id:c.characterId});
  await q('UPDATE characters SET hp=1,cp=1,mp=1 WHERE id=$1',[active.characterId]);
  const preserved=await state(c.characterId);
  await db.exec("UPDATE character_resource_settlement_state SET settled_bucket=date_bin(interval '4 seconds',clock_timestamp(),timestamptz 'epoch')-interval '4 seconds'");
  const result=(await q('SELECT settle_out_of_combat_resources(clock_timestamp()) r'))[0].r;
  assert.equal(result.ok,true);assert.equal(result.kind,'settled');assert.equal(result.settled_count,1);
  assert.deepEqual(await state(c.characterId),preserved);
  const after=await row(active.characterId);assert.ok(after.hp>1&&after.cp>1&&after.mp>1);
}));
const overlord=()=>q("INSERT INTO user_roles VALUES($1,'overlord')",[actor]);
const row=async id=>(await q('SELECT * FROM characters WHERE id=$1',[id]))[0];
const state=async id=>(await q('SELECT to_jsonb(c) r FROM characters c WHERE id=$1',[id]))[0]?.r;
// Clock-fixture changes are owner-only and rolled back. Production API takes no clock input.
const age=async(id,hours)=>{
  await db.exec('ALTER TABLE characters DISABLE TRIGGER USER');
  await q("WITH clock AS (SELECT clock_timestamp() t) UPDATE characters SET deleted_at=clock.t-($2::text||' hours')::interval,restore_until=clock.t-($2::text||' hours')::interval+interval '720 hours' FROM clock WHERE id=$1",[id,hours]);
  await db.exec('ALTER TABLE characters ENABLE TRIGGER USER');
};
test('inactive schema/private roles installed; existing values and legacy deletion privileges preserved',async()=>{
  assert.equal((await row(legacy)).lifecycle_version,0);assert.equal((await row(legacy)).deleted_at,null);
  for(const role of ['anon','authenticated','service_role','custom_default','custom_child']){
    assert.equal((await q("SELECT has_function_privilege($1,'character_lifecycle_command(uuid,uuid,bigint,text,text)','EXECUTE') ok",[role]))[0].ok,false);
    assert.equal((await q("SELECT has_table_privilege($1,'character_lifecycle_receipt','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') ok",[role]))[0].ok,false);
  }
  assert.equal((await q("SELECT has_function_privilege('authenticated','delete_character_cascade(uuid)','EXECUTE') ok"))[0].ok,true);
  assert.equal((await q('SELECT count(*)::int n FROM character_lifecycle_receipt'))[0].n,0);
});
test('own deletion only; stale/missing identities, Steward and Overlord cannot delete another owner',async()=>tx(async()=>{
  await refused(()=>lifecycle(),/not_authorized/);await identity(null);await refused(()=>lifecycle(),/not_authorized/);
  await identity(uid(999));await refused(()=>lifecycle(),/not_authorized/);await identity(actor);
  await q("INSERT INTO user_roles VALUES($1,'steward')",[actor]);await refused(()=>lifecycle(),/not_authorized/);
  await overlord();await refused(()=>lifecycle(),/not_authorized/);assert.equal((await row(legacy)).deleted_at,null);
}));
test('owner soft-delete preserves complete data, fixed deadline, repeated requests and binding',async()=>tx(async()=>{
  const c=await call(),before=await state(c.characterId),request=uid(next++);await cutover();
  const r=await lifecycle({id:c.characterId,request});assert.equal(r.kind,'soft_deleted');assert.equal(r.version,1);
  assert.equal(new Date(r.restoreUntil)-new Date(r.deletedAt),720*3600000);
  assert.deepEqual(await lifecycle({id:c.characterId,request}),r);
  const repeated=await lifecycle({id:c.characterId});assert.equal(repeated.kind,'unchanged');assert.equal(repeated.restoreUntil,r.restoreUntil);
  const after=await state(c.characterId);for(const key of Object.keys(before).filter(k=>!['deleted_at','restore_until','lifecycle_version'].includes(k)))assert.deepEqual(after[key],before[key]);
  assert.equal((await q('SELECT count(*)::int n FROM character_lifecycle_receipt'))[0].n,1);
  await refused(()=>lifecycle({id:c.characterId,request,reason:'Different'}),/request_conflict/);
}));
test('five retained rows still include tombstone; name remains reserved; creation stays private',async()=>tx(async()=>{
  const c=await call();await cutover();await lifecycle({id:c.characterId});
  for(let i=0;i<4;i++)await call({name:'Quota '+i});await refused(()=>call({name:'Sixth'}),/quota/);
  assert.equal((await q('SELECT count(*)::int n FROM characters WHERE user_id=$1',[actor]))[0].n,5);
  await refused(()=>q('INSERT INTO characters(id,user_id,name) VALUES($1,$2,$3)',[uid(next++),target,'ELDRIN']),/duplicate key/);
  await db.exec('SET LOCAL ROLE authenticated');await refused(()=>call(),/permission denied/);
}));
test('cutover selection RLS and guarded gameplay deny tombstone writes, transfers and active presence',async()=>tx(async()=>{
  const c=await call();await cutover();await lifecycle({id:c.characterId});
  await db.exec('SET LOCAL ROLE authenticated');assert.equal((await q('SELECT count(*)::int n FROM characters WHERE id=$1',[c.characterId]))[0].n,0);
  await db.exec('RESET ROLE');
  await refused(()=>q('UPDATE characters SET gold=201 WHERE id=$1',[c.characterId]),/soft_deleted/);
  await refused(()=>q('INSERT INTO character_inventory(character_id) VALUES($1)',[c.characterId]),/soft_deleted/);
  await refused(()=>q("UPDATE character_materials SET count=41 WHERE character_id=$1",[c.characterId]),/soft_deleted/);
  await refused(()=>q("INSERT INTO node_intent(character_id,status) VALUES($1,'pending')",[c.characterId]),/soft_deleted/);
  await refused(()=>q('INSERT INTO node_fighter(character_id,present) VALUES($1,true)',[c.characterId]),/soft_deleted/);
  await refused(()=>q('UPDATE progression_character_state SET version=version+1 WHERE character_id=$1',[c.characterId]),/soft_deleted/);
  await refused(()=>q('UPDATE character_materials SET character_id=$1 WHERE character_id=$2',[legacy,c.characterId]),/soft_deleted/);
}));
test('restore requires Overlord and reason; retains identity, gear, materials, original resources and provenance',async()=>tx(async()=>{
  const c=await call();await q('INSERT INTO items VALUES($1,\'{}\')',[uid(700)]);
  await q('INSERT INTO character_inventory(character_id,item_id,equipped_slot) VALUES($1,$2,\'main_hand\')',[c.characterId,uid(700)]);
  await q('UPDATE characters SET hp=0 WHERE id=$1',[c.characterId]); // Does not revive a dead record.
  const before=await state(c.characterId),origin=await q('SELECT * FROM character_creation_origin'),materials=await q('SELECT * FROM character_materials');
  await cutover();await lifecycle({id:c.characterId});
  await refused(()=>lifecycle({id:c.characterId,version:1,operation:'restore',reason:'Recovery'}),/not_authorized/);
  await q("INSERT INTO user_roles VALUES($1,'steward')",[actor]);await refused(()=>lifecycle({id:c.characterId,version:1,operation:'restore',reason:'Recovery'}),/not_authorized/);
  await overlord();await refused(()=>lifecycle({id:c.characterId,version:1,operation:'restore'}),/not_authorized/);
  const request=uid(next++),args={id:c.characterId,version:1,operation:'restore',reason:'Owner requested recovery',request};
  const r=await lifecycle(args);assert.equal(r.kind,'restored');assert.equal(r.version,2);assert.deepEqual(await lifecycle(args),r);
  assert.equal((await lifecycle({...args,request:uid(next++)})).kind,'unchanged');
  const after=await state(c.characterId);for(const key of Object.keys(before).filter(k=>!['deleted_at','restore_until','lifecycle_version'].includes(k)))assert.deepEqual(after[key],before[key]);
  assert.deepEqual(await q('SELECT * FROM character_creation_origin'),origin);assert.deepEqual(await q('SELECT * FROM character_materials'),materials);
  assert.equal((await q('SELECT count(*)::int n FROM character_inventory'))[0].n,1);
  assert.equal((await q('SELECT count(*)::int n FROM character_creation_log'))[0].n,1);
  const receipt=(await q("SELECT * FROM character_lifecycle_receipt WHERE operation='restore'"))[0];
  assert.equal(receipt.actor_id,actor);assert.equal(receipt.owner_account_id,actor);assert.equal(receipt.reason,args.reason);
}));
test('Overlord restores another account; cannot reset or regrant baseline',async()=>tx(async()=>{
  await identity(target);await lifecycle();await identity(actor);await overlord();const before=await state(legacy);
  await lifecycle({version:1,operation:'restore',reason:'Verified recovery'});const after=await state(legacy);
  assert.equal(after.id,before.id);assert.equal(after.user_id,target);assert.equal(after.level,37);assert.equal(after.str,42);
  assert.equal((await q("SELECT owner_account_id FROM character_lifecycle_receipt WHERE operation='restore'"))[0].owner_account_id,target);
}));
test('restoration before 30 days succeeds, at/after expiry refuses and expiry never purges',async()=>tx(async()=>{
  const c=await call();await cutover();await lifecycle({id:c.characterId});await age(c.characterId,719);
  await overlord();await lifecycle({id:c.characterId,version:1,operation:'restore',reason:'Within window'});
  await lifecycle({id:c.characterId,version:2});await age(c.characterId,720);
  await refused(()=>lifecycle({id:c.characterId,version:3,operation:'restore',reason:'Too late'}),/window_expired/);
  assert.ok(await row(c.characterId));assert.equal((await row(c.characterId)).lifecycle_version,3);
}));
test('expired receipt pruning cannot make a prior delete apply again after restore',async()=>tx(async()=>{
  const c=await call(),request=uid(next++);await cutover();await lifecycle({id:c.characterId,request});await overlord();
  await lifecycle({id:c.characterId,version:1,operation:'restore',reason:'Verified recovery'});
  await db.exec('ALTER TABLE character_lifecycle_receipt DISABLE TRIGGER USER');
  await q("UPDATE character_lifecycle_receipt SET occurred_at='2020-01-01',details_expires_at='2021-01-01' WHERE request_id=$1",[request]);
  await db.exec('ALTER TABLE character_lifecycle_receipt ENABLE TRIGGER USER');
  assert.equal((await q('SELECT character_lifecycle_expire_receipts_internal() n'))[0].n,1);
  await refused(()=>lifecycle({id:c.characterId,request}),/stale_version/);assert.equal((await row(c.characterId)).deleted_at,null);
}));
test('unsafe lifecycle refuses instead of deleting dependent state',async()=>tx(async()=>{
  const c=await call();await q("INSERT INTO node_intent VALUES($1,'pending')",[c.characterId]);await cutover();
  await refused(()=>lifecycle({id:c.characterId}),/not_quiescent/);assert.equal((await row(c.characterId)).deleted_at,null);
  assert.equal((await q('SELECT count(*)::int n FROM node_intent'))[0].n,1);
}));
for(const table of ['character_lifecycle_receipt','characters'])test('late '+table+' failure rolls back tombstone and audit',async()=>tx(async()=>{
  const c=await call();await cutover();await db.exec(`CREATE FUNCTION fixture_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'late_failure'; END $$;
    CREATE TRIGGER zz_fixture_fail BEFORE ${table==='characters'?'UPDATE':'INSERT'} ON ${table} FOR EACH ROW EXECUTE FUNCTION fixture_fail()`);
  await refused(()=>lifecycle({id:c.characterId}),/late_failure/);assert.equal((await row(c.characterId)).deleted_at,null);
  assert.equal((await q('SELECT count(*)::int n FROM character_lifecycle_receipt'))[0].n,0);
}));
test('purge preflight reports eligibility/dependencies only; no orphan/account record cleanup',async()=>tx(async()=>{
  const c=await call();await cutover();await lifecycle({id:c.characterId});
  const pre=async()=> (await q('SELECT character_purge_preflight_internal($1) r',[c.characterId]))[0].r;
  assert.equal((await pre()).eligibleByTime,false);await age(c.characterId,721);
  const r=await pre();assert.equal(r.eligibleByTime,true);assert.equal(r.kind,'eligible');assert.equal(r.materials,7);assert.equal(r.origin,1);assert.equal(r.creationReceipts,1);assert.equal(r.progressionState,1);
  await refused(()=>q('DELETE FROM characters WHERE id=$1',[c.characterId]),/purge_not_authorized/);
  assert.equal((await q('SELECT count(*)::int n FROM auth.users'))[0].n,2);
  assert.equal((await q('SELECT replay_status FROM character_creation_log'))[0].replay_status,'applied');
  assert.equal((await q('SELECT count(*)::int n FROM character_materials WHERE character_id=$1',[uid(999)]))[0].n,1);
}));
test('missing C2 origin is a damaged-character case, not ordinary restore',async()=>tx(async()=>{
  const c=await call();await cutover();await lifecycle({id:c.characterId});await overlord();
  await q('DELETE FROM character_creation_origin WHERE character_id=$1',[c.characterId]);
  await refused(()=>lifecycle({id:c.characterId,version:1,operation:'restore',reason:'Recovery'}),/missing_provenance/);
  assert.equal((await row(c.characterId)).lifecycle_version,1);
}));
test('late restore failure leaves original tombstone/audit and all seven material rows',async()=>tx(async()=>{
  const c=await call();await cutover();await lifecycle({id:c.characterId});await overlord();
  await db.exec(`CREATE FUNCTION fixture_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'late_restore_failure'; END $$;
    CREATE TRIGGER zz_fixture_fail BEFORE UPDATE ON characters FOR EACH ROW EXECUTE FUNCTION fixture_fail()`);
  await refused(()=>lifecycle({id:c.characterId,version:1,operation:'restore',reason:'Recovery'}),/late_restore_failure/);
  assert.equal((await row(c.characterId)).lifecycle_version,1);
  assert.equal((await q('SELECT count(*)::int n FROM character_lifecycle_receipt'))[0].n,1);
  assert.equal((await q('SELECT count(*)::int n FROM character_materials WHERE character_id=$1',[c.characterId]))[0].n,7);
}));
test('legacy hard delete and direct DELETE/TRUNCATE contained; raw lifecycle edit denied; creation stays paused',async()=>tx(async()=>{
  await cutover();await db.exec('SET LOCAL ROLE authenticated');
  await refused(()=>q('SELECT delete_character_cascade($1)',[legacy]),/permission denied/);
  await db.exec('RESET ROLE');await db.exec('SET LOCAL ROLE service_role');await refused(()=>q('DELETE FROM characters WHERE id=$1',[legacy]),/permission denied/);
  await refused(()=>db.exec('TRUNCATE characters CASCADE'),/permission denied/);
  await refused(()=>q('UPDATE characters SET lifecycle_version=1 WHERE id=$1',[legacy]),/permission denied/);
  await refused(()=>lifecycle(),/permission denied/);await refused(()=>call(),/permission denied/);
}));
test('queued repeated lifecycle requests have one audit and fixed tombstone; account locks held',async()=>tx(async()=>{
  const c=await call(),request=uid(next++);await cutover();const a=await Promise.all([lifecycle({id:c.characterId,request}),lifecycle({id:c.characterId,request})]);
  assert.deepEqual(a[0],a[1]);assert.equal((await q('SELECT count(*)::int n FROM character_lifecycle_receipt'))[0].n,1);
  assert.ok((await q("SELECT classid::bigint n FROM pg_locks WHERE locktype='advisory' AND granted")).some(x=>Number(x.n)===173202));
}));
test('lifecycle activation refuses exposed legacy creation or raw INSERT instead of bypassing quota',async()=>tx(async()=>{
  await db.exec('GRANT INSERT ON characters TO service_role');
  await refused(()=>cutover(),/prior legacy creation containment/);
  await db.exec('REVOKE INSERT ON characters FROM service_role');
  await db.exec('CREATE FUNCTION character_create() RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ SELECT $$; GRANT EXECUTE ON FUNCTION character_create() TO authenticated');
  await refused(()=>cutover(),/prior legacy creation containment/);
  assert.equal((await q("SELECT count(*)::int n FROM pg_trigger WHERE tgname='character_lifecycle_character_fence'"))[0].n,0);
}));
test('actual canonical XP authority is fenced while deleted and works after restore without changing origin',async()=>tx(async()=>{
  const c=await call();await cutover();await lifecycle({id:c.characterId});await overlord();await identity(null);
  const event=uid(next++);
  const xp=()=>q("SELECT progression_apply_xp_internal($1,$2,'combat2_reward',50::numeric,$3::jsonb) r",[c.characterId,event,{rewardClaimId:event}]);
  await refused(()=>xp(),/soft_deleted/);assert.equal((await q('SELECT count(*)::int n FROM progression_receipt'))[0].n,0);
  await identity(actor);await lifecycle({id:c.characterId,version:1,operation:'restore',reason:'Verified recovery'});
  const origin=await q('SELECT * FROM character_creation_origin');await identity(null);await xp();
  assert.equal((await row(c.characterId)).level,2);assert.equal((await row(c.characterId)).lifecycle_version,2);
  assert.deepEqual(await q('SELECT * FROM character_creation_origin'),origin);
}));
test('account cascade cannot physically delete a retained character or its receipts before approved purge',async()=>tx(async()=>{
  const c=await call();await cutover();await lifecycle({id:c.characterId});
  await refused(()=>q('DELETE FROM auth.users WHERE id=$1',[actor]),/purge_not_authorized/);
  assert.equal((await q('SELECT count(*)::int n FROM auth.users'))[0].n,2);assert.ok(await row(c.characterId));
  assert.equal((await q('SELECT count(*)::int n FROM character_creation_log'))[0].n,1);
}));

test('purge requires a live Overlord, reason, tombstone, matching version and elapsed 30 days',async()=>tx(async()=>{
  const c=await call();await cutover();
  const purge=options=>lifecycle({id:c.characterId,operation:'purge',version:1,reason:'Explicit purge',...options});
  await refused(()=>purge(),/not_authorized/);await overlord();
  await refused(()=>purge({reason:'  '}),/not_authorized/);
  await refused(()=>purge({version:0}),/purge_window_not_elapsed/);
  await lifecycle({id:c.characterId});await age(c.characterId,719);
  await refused(()=>purge(),/purge_window_not_elapsed/);await age(c.characterId,721);
  await refused(()=>purge({version:0}),/stale_version/);
  await identity(null);await refused(()=>purge(),/not_authorized/);await identity(target);
  await refused(()=>purge(),/not_authorized/);assert.ok(await row(c.characterId));
}));
test('eligible purge removes gameplay/origin/progression, preserves other characters and minimal replay, and safely repeats',async()=>tx(async()=>{
  const creationRequest=uid(next++),c=await call({request:creationRequest}),other=await call({name:'Other'});
  await q('INSERT INTO character_inventory(character_id) VALUES($1),($2)',[c.characterId,other.characterId]);
  await q('INSERT INTO combat_audit_log VALUES($1),($2)',[c.characterId,other.characterId]);
  await q('INSERT INTO character_guide_reads VALUES($1),($2)',[c.characterId,other.characterId]);
  await q('INSERT INTO combat_actions VALUES($1,$2,\'consumed\'),($2,$1,\'consumed\')',[c.characterId,other.characterId]);
  await q('INSERT INTO node_ground_loot VALUES($1)',[c.characterId]);
  await q('INSERT INTO issue_reports VALUES($1,\'Eldrin\',$2)',[c.characterId,actor]);
  await q('INSERT INTO node_pending_event VALUES($1,$2,clock_timestamp())',[c.characterId,other.characterId]);
  await cutover();await lifecycle({id:c.characterId});await overlord();await age(c.characterId,721);
  const preserved=await state(other.characterId),details=(await q('SELECT detailed_receipt FROM character_creation_log WHERE result_character_id=$1',[c.characterId]))[0].detailed_receipt;
  const request=uid(next++),purge=()=>lifecycle({id:c.characterId,request,operation:'purge',version:1,reason:'Approved expired-character purge'});
  await db.exec('SAVEPOINT caller');const result=await purge();await db.exec('RELEASE SAVEPOINT caller');
  assert.equal(result.kind,'purged');assert.deepEqual(await purge(),result);assert.equal(await row(c.characterId),undefined);
  assert.deepEqual(await state(other.characterId),preserved);
  for(const table of ['character_materials','character_inventory','character_guide_reads','combat_audit_log','character_creation_origin','progression_character_state','progression_receipt']) assert.equal((await q(`SELECT count(*)::int n FROM ${table} WHERE character_id=$1`,[c.characterId]))[0].n,0);
  assert.equal((await q('SELECT count(*)::int n FROM character_materials WHERE character_id=$1',[uid(999)]))[0].n,1);
  assert.equal((await q('SELECT count(*)::int n FROM auth.users'))[0].n,2);
  const log=(await q('SELECT * FROM character_creation_log WHERE result_character_id=$1',[c.characterId]))[0];assert.equal(log.replay_status,'purged');assert.deepEqual(log.detailed_receipt,details);
  assert.equal((await call({request:creationRequest})).kind,'purged');
  const audit=(await q("SELECT * FROM character_lifecycle_receipt WHERE operation='purge'"))[0];assert.equal(audit.actor_id,actor);assert.equal(audit.reason,'Approved expired-character purge');
  assert.deepEqual(Object.keys(audit.result).sort(),['characterId','kind','version']);
  assert.equal((await q('SELECT dropped_by FROM node_ground_loot'))[0].dropped_by,null);
  assert.equal((await q('SELECT character_name FROM issue_reports'))[0].character_name,'');
  assert.equal((await q('SELECT target_character_id FROM combat_actions WHERE character_id=$1',[other.characterId]))[0].target_character_id,null);
  assert.equal((await q('SELECT target_character_id FROM node_pending_event'))[0].target_character_id,other.characterId);
  await refused(()=>lifecycle({id:c.characterId,request,operation:'purge',version:1,reason:'Changed binding'}),/request_conflict/);
}));
test('purge of canonically progressed character removes complete proof instead of archiving attributes',async()=>tx(async()=>{
  const c=await call(),event=uid(next++);await identity(null);await q("SELECT progression_apply_xp_internal($1,$2,'combat2_reward',50::numeric,$3::jsonb)",[c.characterId,event,{rewardClaimId:event}]);
  assert.equal((await q('SELECT count(*)::int n FROM progression_receipt WHERE character_id=$1',[c.characterId]))[0].n,1);
  await identity(actor);await cutover();await lifecycle({id:c.characterId});await age(c.characterId,721);await overlord();
  await lifecycle({id:c.characterId,operation:'purge',version:1,reason:'Explicit purge'});
  for(const table of ['progression_character_state','progression_receipt','progression_respec_milestone','progression_class_growth_milestone']) assert.equal((await q(`SELECT count(*)::int n FROM ${table} WHERE character_id=$1`,[c.characterId]))[0].n,0);
  await identity(null);const rejected=(await q("SELECT progression_apply_xp_internal($1,$2,'combat2_reward',50::numeric,$3::jsonb) r",[c.characterId,event,{rewardClaimId:event}]))[0].r;
  assert.equal(rejected.kind,'refused');assert.equal(rejected.reason,'character_missing');
}));
test('purge reason expires at 12 months while digest replay remains payload-bound',async()=>tx(async()=>{
  const c=await call();await cutover();await lifecycle({id:c.characterId});await overlord();await age(c.characterId,721);
  const request=uid(next++),purge=reason=>lifecycle({id:c.characterId,request,operation:'purge',version:1,reason});
  const result=await purge('Retention test');
  // Disposable time fixture; production expiry takes no caller clock.
  await db.exec('ALTER TABLE character_lifecycle_receipt DISABLE TRIGGER USER');
  await db.exec("UPDATE character_lifecycle_receipt SET occurred_at=now()-interval '13 months',details_expires_at=((now()-interval '13 months') AT TIME ZONE 'UTC'+interval '12 months') AT TIME ZONE 'UTC'");
  await db.exec('ALTER TABLE character_lifecycle_receipt ENABLE TRIGGER USER');
  await q('SELECT character_lifecycle_expire_receipts_internal()');
  const audit=(await q('SELECT * FROM character_lifecycle_receipt'))[0];assert.equal(audit.operation,'purge');assert.equal(audit.reason,null);assert.equal(audit.reason_digest.length,32);
  assert.deepEqual(await purge('Retention test'),result);await refused(()=>purge('Changed text'),/request_conflict/);
  await refused(()=>q("UPDATE character_lifecycle_receipt SET reason='Recovered text'"),/immutable/);
}));
test('late purge failure atomically restores character, children, origin, log and audit',async()=>tx(async()=>{
  const c=await call();await cutover();await lifecycle({id:c.characterId});await overlord();await age(c.characterId,721);
  const before=await counts();await db.exec(`CREATE FUNCTION fixture_purge_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'late_purge'; END $$;
    CREATE TRIGGER zz_purge_failure BEFORE UPDATE ON character_creation_log FOR EACH ROW EXECUTE FUNCTION fixture_purge_failure()`);
  await refused(()=>lifecycle({id:c.characterId,operation:'purge',version:1,reason:'Explicit purge'}),/late_purge/);
  assert.deepEqual(await counts(),before);assert.ok(await row(c.characterId));assert.equal((await q("SELECT count(*)::int n FROM character_lifecycle_receipt WHERE operation='purge'"))[0].n,0);
  assert.equal((await q('SELECT replay_status FROM character_creation_log'))[0].replay_status,'applied');
}));
test('unknown character FK and shared departure refuse purge rather than deleting unrelated data',async()=>tx(async()=>{
  const c=await call();await cutover();await lifecycle({id:c.characterId});await overlord();await age(c.characterId,721);
  const purge=()=>lifecycle({id:c.characterId,operation:'purge',version:1,reason:'Explicit purge'});
  await db.exec('SAVEPOINT unknown');await db.exec('CREATE TABLE unexpected_child(character_id uuid REFERENCES characters(id) ON DELETE CASCADE)');
  await refused(purge,/dependency_drift/);await db.exec('ROLLBACK TO SAVEPOINT unknown; RELEASE SAVEPOINT unknown');
  await q('INSERT INTO combat2_party_departure_request VALUES($1,\'done\',$2)',[uid(next++),c.characterId]);
  const request=(await q('SELECT request_id FROM combat2_party_departure_request'))[0].request_id;
  await q('INSERT INTO combat2_party_departure_member(character_id,request_id,status) VALUES($1,$2,\'done\')',[legacy,request]);
  await refused(purge,/shared_departure/);assert.ok(await row(c.characterId));
}));
test('purge deletes historical departure before referenced fighter and only its nested diagnostic/Arena rows',async()=>tx(async()=>{
  const c=await call(),other=await call({name:'Kept'}),fighter=uid(next++),request=uid(next++),arena=uid(next++);
  await q('INSERT INTO node_fighter(character_id,present,id) VALUES($1,false,$2)',[c.characterId,fighter]);
  await q('INSERT INTO combat2_party_departure_request VALUES($1,\'done\',$2)',[request,c.characterId]);
  await q('INSERT INTO combat2_party_departure_member(character_id,request_id,status,fighter_id) VALUES($1,$2,\'done\',$3)',[c.characterId,request,fighter]);
  for(const id of [c.characterId,other.characterId]){
    await q('INSERT INTO combat2_diagnostic_session(character_id,id) VALUES($1,$1)',[id]);
    await q('INSERT INTO combat2_diagnostic_server_event VALUES($1)',[id]);
    await q('INSERT INTO combat2_test_arena_stance_snapshot_header(character_id,arena_id) VALUES($1,$2)',[id,arena]);
    await q('INSERT INTO combat2_test_arena_stance_snapshot VALUES($1,$2)',[arena,id]);
  }
  await cutover();await lifecycle({id:c.characterId});await overlord();await age(c.characterId,721);
  await lifecycle({id:c.characterId,operation:'purge',version:1,reason:'Explicit purge'});
  assert.equal((await q('SELECT count(*)::int n FROM node_fighter'))[0].n,0);
  assert.deepEqual(await q('SELECT session_id FROM combat2_diagnostic_server_event'),[{session_id:other.characterId}]);
  assert.deepEqual(await q('SELECT character_id FROM combat2_test_arena_stance_snapshot'),[{character_id:other.characterId}]);
}));
test('unknown nested cascade blocks purge before erasing unrelated records',async()=>tx(async()=>{
  const c=await call();await cutover();await lifecycle({id:c.characterId});await overlord();await age(c.characterId,721);
  await db.exec('CREATE TABLE unexpected_nested(session_id uuid REFERENCES combat2_diagnostic_session(id) ON DELETE CASCADE)');
  await refused(()=>lifecycle({id:c.characterId,operation:'purge',version:1,reason:'Explicit purge'}),/nested_dependency_drift/);
  assert.ok(await row(c.characterId));
}));
test('delegated purge preserves recipient account/other origin; actor retirement is a separate controlled account operation',async()=>tx(async()=>{
  await overlord();const c=await call({owner:target,reason:'Approved delegation'}),kept=await call({owner:target,reason:'Approved delegation',name:'Kept'});
  const preserved=await q('SELECT * FROM character_creation_origin WHERE character_id=$1',[kept.characterId]);
  await cutover();await identity(target);await lifecycle({id:c.characterId});await age(c.characterId,721);await identity(actor);
  await lifecycle({id:c.characterId,operation:'purge',version:1,reason:'Explicit purge'});
  let log=(await q('SELECT * FROM character_creation_log WHERE result_character_id=$1',[c.characterId]))[0];
  assert.equal(log.actor_id,actor);assert.equal(log.target_account_id,target);assert.equal(log.replay_status,'purged');
  assert.equal((await q('SELECT count(*)::int n FROM auth.users WHERE id=$1',[target]))[0].n,1);
  assert.deepEqual(await q('SELECT * FROM character_creation_origin WHERE character_id=$1',[kept.characterId]),preserved);
  // Simulate only the already-approved 0007 account retirement contract, not a new account API.
  await q('DELETE FROM auth.users WHERE id=$1',[actor]);
  await q("UPDATE character_creation_log SET replay_status='retired',actor_id=NULL,request_id=NULL,target_account_id=NULL,result_character_id=NULL,payload_version=NULL,payload_digest=NULL WHERE actor_id=$1",[actor]);
  assert.deepEqual(await q('SELECT * FROM character_creation_origin WHERE character_id=$1',[kept.characterId]),preserved);
  assert.equal((await q('SELECT count(*)::int n FROM character_creation_log WHERE detailed_receipt IS NOT NULL'))[0].n,2);
  await refused(()=>lifecycle({id:kept.characterId,operation:'purge',version:1,reason:'Stale actor'}),/not_authorized/);
}));
test('private purge helper and old hard-delete remain unavailable as bypasses',async()=>tx(async()=>{
  const c=await call();await cutover();await lifecycle({id:c.characterId});await overlord();await age(c.characterId,721);
  await refused(()=>q('SELECT character_lifecycle_purge_internal($1)',[c.characterId]),/purge_not_authorized/);
  await q("SELECT set_config('app.trusted_rpc','true',true)");
  await refused(()=>q('SELECT delete_character_cascade($1)',[c.characterId]),/soft_deleted|purge_not_authorized/);
  await db.exec('SET LOCAL ROLE authenticated');
  await refused(()=>q('SELECT character_lifecycle_purge_internal($1)',[c.characterId]),/permission denied/);
  await db.exec('RESET ROLE');assert.ok(await row(c.characterId));
}));
test('purge releases quota/name but never reuses a purged character UUID',async()=>tx(async()=>{
  const c=await call();await cutover();await lifecycle({id:c.characterId});for(let i=0;i<4;i++)await call({name:'Other '+i});
  await overlord();await age(c.characterId,721);await lifecycle({id:c.characterId,operation:'purge',version:1,reason:'Explicit purge'});
  const replacement=await call();assert.notEqual(replacement.characterId,c.characterId);
  await refused(()=>q('INSERT INTO characters(id,user_id,name) VALUES($1,$2,$3)',[c.characterId,actor,'Reused UUID']),/purged_identity_reserved/);
  assert.equal((await q('SELECT count(*)::int n FROM characters WHERE user_id=$1',[actor]))[0].n,5);
}));

test('settlement preserves wrapper, stale non-present claim correction and actual Force Shield regeneration; tombstones excluded',()=>tx(async()=>{
  const active=await call({name:'Active Shield'}),deleted=await call({name:'Deleted Shield'}),stale=await call({name:'Stale Fighter'}),blocked=await call({name:'Present Claim'});
  await db.exec('ALTER TABLE characters DISABLE TRIGGER USER');
  await q('UPDATE characters SET hp=1,cp=1,mp=1,int=14,wis=14 WHERE id=ANY($1::uuid[])',[[active.characterId,deleted.characterId,stale.characterId,blocked.characterId]]);
  await q("UPDATE characters SET deleted_at=clock_timestamp(),restore_until=clock_timestamp()+interval '720 hours',lifecycle_version=1 WHERE id=$1",[deleted.characterId]);
  await db.exec('ALTER TABLE characters ENABLE TRIGGER USER');
  for(const c of [active,deleted])await q("INSERT INTO character_stance(character_id,ability_key,state,version) VALUES($1,'force_shield','{\"ward_remaining\":0}',0)",[c.characterId]);
  const encounter=uid(next++);await q("INSERT INTO node_encounter(id,node_id,status,claim_token,claim_expires_at) VALUES($1,$2,'active',$1,clock_timestamp()+interval '1 hour')",[encounter,node]);
  await q('INSERT INTO node_fighter(character_id,encounter_id,present) VALUES($1,$2,false)',[stale.characterId,encounter]);
  await q('INSERT INTO node_fighter(character_id,encounter_id,present) VALUES($1,$2,true)',[blocked.characterId,encounter]);
  await db.exec("UPDATE character_resource_settlement_state SET settled_bucket=date_bin(interval '4 seconds',clock_timestamp(),timestamptz 'epoch')-interval '4 seconds'");
  const result=(await q('SELECT settle_out_of_combat_resources(clock_timestamp()) r'))[0].r;assert.equal(result.kind,'settled');assert.equal(result.force_shields_regenerated,1);
  assert.ok((await row(active.characterId)).hp>1);assert.ok((await row(stale.characterId)).hp>1);assert.equal((await row(deleted.characterId)).hp,1);assert.equal((await row(blocked.characterId)).hp,1);
  assert.deepEqual(await q('SELECT character_id,(state->>\'ward_remaining\')::int ward,version::int FROM character_stance ORDER BY character_id'),[{character_id:active.characterId,ward:2,version:1},{character_id:deleted.characterId,ward:0,version:0}].sort((a,b)=>a.character_id.localeCompare(b.character_id)));
}));

test('reset preserves a configured placement pointing at registry by refusing the unexpected incoming FK',async()=>tx(async()=>{
  await resetFixture();const before=await counts();
  await db.exec('CREATE TABLE persistent_unique_placement(instance_id uuid REFERENCES unique_item_instance(id) ON DELETE CASCADE)');
  await refused(()=>db.exec(resetSql()),/preserved incoming FK/);assert.deepEqual(await counts(),before);
}));
test('reset refuses a new persistent registry location rather than interpreting it as disposable runtime',async()=>tx(async()=>{
  await resetFixture();const before=await counts();
  await db.exec("ALTER TABLE unique_item_instance DROP CONSTRAINT unique_item_instance_location_kind_check;UPDATE unique_item_instance SET location_kind='configured_world'");
  await refused(()=>db.exec(resetSql()),/unknown persistent unique location/);assert.deepEqual(await counts(),before);
}));
test('reset guards registry UPDATE triggers invoked by ordinary holder deletion',async()=>tx(async()=>{
  await resetFixture();const before=await counts();
  await db.exec(`CREATE FUNCTION unexpected_registry_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
    CREATE TRIGGER unexpected_registry_update BEFORE UPDATE ON unique_item_instance FOR EACH ROW EXECUTE FUNCTION unexpected_registry_update()`);
  await refused(()=>db.exec(resetSql()),/unreviewed DELETE\/update trigger/);assert.deepEqual(await counts(),before);
}));

test('synthetic one-time physical checkpoint restores complete affected fixture in an isolated PGlite instance',async()=>{
  // Final test: commit disposable fixture only, then export its existing data directory.
  // No production backup, Auth credentials, external connection or persistent backup service.
  await db.exec('BEGIN');try{await identity(actor);await resetFixture();await db.exec('COMMIT');}catch(e){await db.exec('ROLLBACK');throw e;}
  const names=[...resetNames(),'combat2_test_run','combat2_test_run_batch','combat2_test_run_event','issue_reports',
    'configured_world_placement','items','nodes','profiles','user_roles'];
  const capture=async connection=>{const result={};for(const name of names)result[name]=(await connection.query(`SELECT to_jsonb(x) r FROM ${name} x ORDER BY to_jsonb(x)::text`)).rows;
    result.auth_ids=(await connection.query('SELECT id FROM auth.users ORDER BY id')).rows;return result;};
  const before=await capture(db),checkpoint=await db.dumpDataDir();let rehearsal,restored;
  try{
    rehearsal=new PGlite({loadDataDir:checkpoint});
    assert.deepEqual(await capture(rehearsal),before);
    await rehearsal.exec('BEGIN');await rehearsal.exec(resetSql());await rehearsal.exec('COMMIT');
    assert.equal((await rehearsal.query('SELECT count(*)::int n FROM characters')).rows[0].n,0);
    assert.equal((await rehearsal.query('SELECT count(*)::int n FROM combat2_test_run_event')).rows[0].n,1);
    await rehearsal.close();rehearsal=null;
    restored=new PGlite({loadDataDir:checkpoint});assert.deepEqual(await capture(restored),before);
    await restored.exec('BEGIN;SET CONSTRAINTS ALL IMMEDIATE;ROLLBACK');
  }finally{await rehearsal?.close();await restored?.close();}
  // This proves recovery of synthetic data only, not provider/Supabase restore capability.
});
