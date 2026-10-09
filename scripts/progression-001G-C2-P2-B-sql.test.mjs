/** Exact local SQL on disposable PGlite only. No hosted connection or gameplay fixture.
 * node scripts/progression-001G-C2-P2-B-sql.test.mjs <local-pglite-index.js>
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
      ADD rp_total_earned integer NOT NULL DEFAULT 0,ADD deleted_at timestamptz,ADD created_at timestamptz NOT NULL DEFAULT now();
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
  await db.exec(read('docs/operations/progression-001G-C2-P2-B-inactive-integration.sql'));
});
after(async()=>await db?.close());
const bridge=async({request=uid(next++),name='Bridge Hero',race='human',gender='male',owner=null,reason=null,revision='creation-c2-v1'}={})=>
  (await q('SELECT public.character_create_c2($1,$2,$3,$4,$5,$6,$7) r',[request,name,race,gender,owner,reason,revision]))[0].r;
const grantFixture=()=>db.exec('GRANT EXECUTE ON FUNCTION public.character_create_c2(uuid,text,text,text,uuid,text,text) TO authenticated');
const fixtureLegacy=()=>db.exec(`
  CREATE FUNCTION public.character_create() RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ INSERT INTO characters(id,user_id,name) VALUES(gen_random_uuid(),'${actor}','Bypass') $$;
  CREATE FUNCTION public.c2_harness_run() RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ SELECT public.character_create() $$;
  CREATE FUNCTION public.c2_harness_run_c() RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ SELECT public.character_create() $$;
  CREATE FUNCTION public.delete_character_cascade(uuid) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ DELETE FROM characters WHERE id=$1 $$;
  GRANT EXECUTE ON FUNCTION public.character_create(),public.c2_harness_run(),public.c2_harness_run_c(),public.delete_character_cascade(uuid) TO authenticated,service_role;
  GRANT INSERT,DELETE ON characters TO service_role;
  GRANT INSERT(name) ON characters TO authenticated;
  GRANT UPDATE(gold) ON characters TO service_role;
  GRANT UPDATE(name) ON characters TO authenticated;
`);

test('inactive bridge/private function owner-only; FK future-write guard; material reads and service writes preserved',async()=>{
  for(const f of ['character_create_c2','character_create_c2_internal']) for(const role of ['anon','authenticated','service_role','custom_default','custom_child'])
    assert.equal((await q(`SELECT has_function_privilege($1,$2,'EXECUTE') ok`,[role,`public.${f}(uuid,text,text,text,uuid,text,text)`]))[0].ok,false);
  assert.equal((await q("SELECT convalidated FROM pg_constraint WHERE conname='character_materials_character_id_c2_fkey'"))[0].convalidated,false);
  assert.equal((await q("SELECT has_table_privilege('authenticated','character_materials','SELECT') ok"))[0].ok,true);
  for(const role of ['anon','authenticated']) assert.equal((await q("SELECT has_table_privilege($1,'character_materials','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') ok",[role]))[0].ok,false);
  for(const privilege of ['SELECT','INSERT','UPDATE','DELETE'])
    assert.equal((await q("SELECT has_table_privilege('service_role','character_materials',$1) ok",[privilege]))[0].ok,true);
  await tx(async()=>{await db.exec('SET LOCAL ROLE authenticated');await refused(()=>bridge(),/permission denied/);});
});
test('authorized fixture bridge reaches exact installed authority; returns ID/kind only and server baseline',async()=>tx(async()=>{
  await grantFixture();await db.exec('SET LOCAL ROLE authenticated');const r=await bridge();
  assert.deepEqual(Object.keys(r).sort(),['characterId','kind']);assert.equal(r.kind,'applied');
  await db.exec('RESET ROLE');const [c]=await q('SELECT level,xp,gold,hp,cp,mp,ac,class,is_classless FROM characters WHERE id=$1',[r.characterId]);
  assert.deepEqual(c,{level:1,xp:0,gold:200,hp:16,cp:30,mp:100,ac:9,class:'classless',is_classless:true});
  assert.deepEqual(await counts(),{characters:2,materials:7,inventory:0,state:1,origin:1,log:1});
}));
test('JWT actor preserved: own-only, steward denied, Overlord needs reason and receipt records caller',async()=>tx(async()=>{
  await grantFixture();await db.exec('SET LOCAL ROLE authenticated');await refused(()=>bridge({owner:target,reason:'Recovery'}),/not_authorized/);
  await db.exec('RESET ROLE');await q('INSERT INTO user_roles VALUES($1,\'steward\')',[actor]);
  await db.exec('SET LOCAL ROLE authenticated');await refused(()=>bridge({owner:target,reason:'Recovery'}),/not_authorized/);
  await db.exec('RESET ROLE');await q('INSERT INTO user_roles VALUES($1,\'overlord\')',[actor]);
  await db.exec('SET LOCAL ROLE authenticated');await refused(()=>bridge({owner:target}),/not_authorized/);
  const r=await bridge({owner:target,reason:'Recovery'});await db.exec('RESET ROLE');
  const [log]=await q('SELECT actor_id,target_account_id,detailed_receipt FROM character_creation_log WHERE result_character_id=$1',[r.characterId]);
  assert.equal(log.actor_id,actor);assert.equal(log.target_account_id,target);assert.equal(log.detailed_receipt.reason,'Recovery');
  await identity(null);await db.exec('SET LOCAL ROLE authenticated');await refused(()=>bridge(),/not_authorized/);
}));
test('bridge replay, payload conflict, names, queued quota and material-once behavior',async()=>tx(async()=>{
  await grantFixture();await db.exec('SET LOCAL ROLE authenticated');const request=uid(next++);
  const [a,b]=await Promise.all([bridge({request,name:'Eldrin'}),bridge({request,name:'Eldrin'})]);assert.deepEqual(a,b);
  await refused(()=>bridge({request,name:'Other'}),/request_conflict/);
  await refused(()=>bridge({name:'ELDRIN'}),/duplicate key/);await bridge({name:'Éldrin'});
  for(let i=0;i<3;i++)await bridge({name:'Other '+i});await refused(()=>bridge({name:'Sixth'}),/quota/);
  assert.deepEqual(await bridge({request,name:'Eldrin'}),a);await db.exec('RESET ROLE');
  assert.deepEqual(await counts(),{characters:6,materials:35,inventory:0,state:5,origin:5,log:5});
}));
test('bridge late failure rolls back all creation/grants/sidecars',async()=>tx(async()=>{
  await db.exec(`CREATE FUNCTION public.fixture_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'late_failure'; END $$;
    CREATE TRIGGER fixture_fail BEFORE INSERT ON character_creation_log FOR EACH ROW EXECUTE FUNCTION fixture_fail()`);
  await grantFixture();const initial=await counts();await db.exec('SET LOCAL ROLE authenticated');await refused(()=>bridge(),/late_failure/);
  await db.exec('RESET ROLE');assert.deepEqual(await counts(),initial);
}));
test('cutover denies legacy RPC/harness/direct INSERT/delete; preserves unrelated column UPDATE and private bridge',async()=>tx(async()=>{
  await fixtureLegacy();const before=(await q("SELECT relacl::text acl FROM pg_class WHERE oid='characters'::regclass"))[0].acl;
  const priorUpdate=(await q("SELECT has_table_privilege('service_role','characters','UPDATE') ok"))[0].ok;
  await db.exec(read('docs/operations/progression-001G-C2-P2-B-cutover-containment.sql'));
  for(const role of ['authenticated','service_role']) {
    await db.exec(`SET LOCAL ROLE ${role}`);
    await refused(()=>q('SELECT character_create()'),/permission denied/);
    await refused(()=>q('SELECT c2_harness_run()'),/permission denied/);
    await refused(()=>q('SELECT c2_harness_run_c()'),/permission denied/);
    await refused(()=>q('SELECT delete_character_cascade($1)',[legacy]),/permission denied/);
    await refused(()=>q('INSERT INTO characters(id,user_id,name) VALUES($1,$2,$3)',[uid(next++),actor,'Bypass']),/permission denied/);
    await refused(()=>q('DELETE FROM characters WHERE id=$1',[legacy]),/permission denied/);
    await refused(()=>bridge(),/permission denied/);await db.exec('RESET ROLE');
  }
  assert.equal((await q("SELECT has_column_privilege('service_role','characters','gold','UPDATE') ok"))[0].ok,true);
  assert.equal((await q("SELECT has_column_privilege('authenticated','characters','name','UPDATE') ok"))[0].ok,true);
  assert.equal((await q("SELECT has_table_privilege('service_role','characters','UPDATE') ok"))[0].ok,priorUpdate);
  assert.ok(before); // C test fixture has older broad UPDATE; P2-B does not grant/change UPDATE.
}));
test('FK rejects new orphan; owner permanent legacy purge cascades materials; immutable new origin blocks bare deletion',async()=>tx(async()=>{
  await refused(()=>q("INSERT INTO character_materials VALUES($1,'salvage',40)",[uid(999)]),/foreign key/);
  await q("INSERT INTO character_materials VALUES($1,'salvage',40)",[legacy]);await q('DELETE FROM characters WHERE id=$1',[legacy]);
  assert.equal((await q('SELECT count(*)::int n FROM character_materials'))[0].n,0);
  const r=await bridge();await refused(()=>q('DELETE FROM characters WHERE id=$1',[r.characterId]),/foreign key/);
  // No restore function/lifecycle is implemented or claimed here.
}));
test('old orphan preserved by inactive NOT VALID FK; activation validation refuses without data repair',async()=>tx(async()=>{
  await db.exec('ALTER TABLE character_materials DROP CONSTRAINT character_materials_character_id_c2_fkey');
  await q("INSERT INTO character_materials VALUES($1,'salvage',40)",[uid(999)]);
  await db.exec('DROP FUNCTION public.character_create_c2(uuid,text,text,text,uuid,text,text)');
  await db.exec(read('docs/operations/progression-001G-C2-P2-B-inactive-integration.sql'));
  await fixtureLegacy();await refused(()=>db.exec(read('docs/operations/progression-001G-C2-P2-B-cutover-containment.sql')),/foreign key/);
  assert.equal((await q('SELECT count(*)::int n FROM character_materials'))[0].n,1);
  assert.equal((await q("SELECT has_function_privilege('authenticated','character_create()','EXECUTE') ok"))[0].ok,true);
}));
test('inherited INSERT bypass makes cutover fail closed without rewriting memberships',async()=>tx(async()=>{
  await fixtureLegacy();await db.exec('GRANT INSERT ON characters TO custom_default; GRANT custom_default TO authenticated');
  await refused(()=>db.exec(read('docs/operations/progression-001G-C2-P2-B-cutover-containment.sql')),/inherited direct creation/);
  assert.equal((await q("SELECT has_function_privilege('authenticated','character_create()','EXECUTE') ok"))[0].ok,true);
}));
test('simulated cutover followed by fixture-only public grant creates through bridge while internal stays private',async()=>tx(async()=>{
  await fixtureLegacy();await db.exec(read('docs/operations/progression-001G-C2-P2-B-cutover-containment.sql'));
  await grantFixture();await db.exec('SET LOCAL ROLE authenticated');
  await refused(()=>call(),/permission denied/);await refused(()=>q('SELECT character_create()'),/permission denied/);
  const r=await bridge();assert.equal(r.kind,'applied');await db.exec('RESET ROLE');assert.equal((await counts()).materials,7);
}));
const reinstallInactive=async()=>{
  await db.exec('DROP FUNCTION public.character_create_c2(uuid,text,text,text,uuid,text,text); ALTER TABLE character_materials DROP CONSTRAINT character_materials_character_id_c2_fkey');
  await db.exec(read('docs/operations/progression-001G-C2-P2-B-inactive-integration.sql'));
};
test('hosted owner membership in authenticated/anon is not browser authority; full inactive SQL succeeds',async()=>tx(async()=>{
  await db.exec('GRANT authenticated,anon TO postgres; GRANT ALL ON character_materials TO PUBLIC,anon,authenticated');
  assert.equal((await q(`SELECT count(*)::int n FROM pg_auth_members
    WHERE member='postgres'::regrole AND roleid IN ('authenticated'::regrole,'anon'::regrole)`))[0].n,2);
  await reinstallInactive();
  for(const r of ['anon','authenticated']) {
    assert.equal((await q("SELECT has_table_privilege($1,'character_materials','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') ok",[r]))[0].ok,false);
    assert.equal((await q("SELECT has_any_column_privilege($1,'character_materials','INSERT,UPDATE,REFERENCES') ok",[r]))[0].ok,false);
  }
  assert.equal((await q("SELECT has_table_privilege('postgres','character_materials','UPDATE') ok"))[0].ok,true);
}));
for(const [label,grant] of [
  ['browser inherits parent table grant','GRANT INSERT ON character_materials TO custom_default; GRANT custom_default TO authenticated'],
  ['browser inherits parent column grant','GRANT UPDATE(count) ON character_materials TO custom_default; GRANT custom_default TO anon'],
  ['ordinary browser member has direct write','GRANT authenticated TO custom_child; GRANT DELETE ON character_materials TO custom_child'],
  ['browser inherits database owner','GRANT postgres TO authenticated'],
]) test('owner exemption still refuses '+label,async()=>tx(async()=>{
  await db.exec(grant);await refused(()=>reinstallInactive(),/materials inherited browser write privilege|private authority privilege drift/);
}));
test('materials assertion independently catches PUBLIC table/column grants introduced after revoke',async()=>tx(async()=>{
  const block=read('docs/operations/progression-001G-C2-P2-B-inactive-integration.sql').match(/DO \$materials_acl\$[\s\S]*?END \$materials_acl\$;/)[0];
  // Table PUBLIC leak survives this block and is refused (outer migration removes it).
  await db.exec('GRANT INSERT ON character_materials TO PUBLIC');
  await refused(()=>db.exec(block),/materials inherited browser write privilege/);
  await db.exec('REVOKE INSERT ON character_materials FROM PUBLIC; GRANT UPDATE(count) ON character_materials TO PUBLIC');
  // Column PUBLIC grant is explicitly removed by the exact assertion block first.
  await db.exec(block);
  assert.equal((await q("SELECT has_any_column_privilege('anon','character_materials','INSERT,UPDATE,REFERENCES') ok"))[0].ok,false);
}));
