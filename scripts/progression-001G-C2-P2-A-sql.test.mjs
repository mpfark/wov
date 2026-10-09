/** Exact local SQL on disposable PGlite only. No hosted connection or gameplay fixture.
 * node scripts/progression-001G-C2-P2-A-sql.test.mjs <local-pglite-index.js>
 * Queued calls share one backend; they do not prove two-session lock contention. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
if(!process.argv[2]) throw Error('Supply a local PGlite module path');
const {PGlite}=await import(pathToFileURL(resolve(process.argv[2])).href);
const read=p=>readFileSync(p,'utf8');
const sql=read('docs/operations/progression-001G-C2-P2-A-creation-authority.sql');
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
});
after(async()=>await db?.close());
test('embedded manifest equals immutable source manifest; private ACL closes default/inherited grants',async()=>{
  assert.deepEqual(JSON.parse(sql.match(/\$manifest\$([\s\S]*?)\$manifest\$/)[1]),manifest);
  const r=await q(`SELECT r.rolname,has_function_privilege(r.oid,'public.character_create_c2_internal(uuid,text,text,text,uuid,text,text)','EXECUTE') permitted
    FROM pg_roles r WHERE r.rolname IN('anon','authenticated','service_role','custom_default','custom_child')`);
  assert.equal(r.length,5);assert.ok(r.every(x=>!x.permitted));
  await tx(async()=>{await db.exec('SET LOCAL ROLE authenticated');await refused(()=>call(),/permission denied/);});
});
test('six canonical race vectors, trigger-only materials, immutable origin and exact version0 baseline',async()=>{
  for(const [race,expected] of Object.entries({human:[16,30,100,9],elf:[14,30,100,10],dwarf:[20,30,100,8],halfling:[16,30,100,10],edain:[18,30,100,9],half_elf:[16,30,100,9]})) await tx(async()=>{
    const r=await call({race,name:' '+race+' Hero '});const [c]=await q('SELECT * FROM characters WHERE id=$1',[r.characterId]);
    assert.deepEqual([c.hp,c.cp,c.mp,c.ac],expected);assert.deepEqual([c.max_hp,c.max_cp,c.max_mp],expected.slice(0,3));
    assert.equal(c.level,1);assert.equal(c.xp,0);assert.equal(c.gold,200);assert.equal(c.class,'classless');assert.equal(c.is_classless,true);
    assert.equal(c.family_id,null);assert.equal(c.family_name,null);assert.equal(c.name,race+' Hero');
    const [unchanged]=await q('SELECT level,xp,str FROM characters WHERE id=$1',[legacy]);
    assert.deepEqual(unchanged,{level:37,xp:123,str:42});
    assert.deepEqual((await counts()),{characters:2,materials:7,inventory:0,state:1,origin:1,log:1});
    const [origin]=await q('SELECT * FROM character_creation_origin WHERE character_id=$1',[c.id]);
    assert.deepEqual([origin.creation_version,origin.race_version,origin.class_version,origin.formula_version],Object.values(manifest.versions));
    assert.ok(!JSON.stringify(origin.applied_snapshot).includes(actor));
    const [s]=await q('SELECT * FROM progression_character_state WHERE character_id=$1',[c.id]);
    assert.equal(s.version,0);for(const k of Object.keys(manifest.races.human)) assert.equal(s[k+'_invested'],0);
    await identity(null);assert.deepEqual(s.opaque_baseline,(await q('SELECT progression_snapshot_internal($1) r',[c.id]))[0].r);
    await refused(()=>db.query('UPDATE character_creation_origin SET applied_snapshot=$1 WHERE character_id=$2',[{},c.id]),/immutable/);
  });
});
test('same UUID replay identical at quota and after catalog drift; no duplicate grants; changed payload conflicts',async()=>tx(async()=>{
  const request=uid(next++),r=await call({request});
  for(let i=0;i<4;i++)await call({name:'Quota '+i});
  await db.exec("UPDATE races SET str=50 WHERE race_key='human'");const before=await counts();
  assert.deepEqual(await call({request}),r);assert.deepEqual(await counts(),before);
  await refused(()=>call({request,name:'Other'}),/request_conflict/);
  await refused(()=>call({request,owner:target,reason:'Different intent'}),/not_authorized/);
}));
test('payload binds gender, race, target, reason and revision',async()=>tx(async()=>{
  await db.exec(`INSERT INTO user_roles VALUES('${actor}','overlord')`);
  const request=uid(next++),args={request,owner:target,reason:'Approved recovery'};await call(args);
  for(const change of [{gender:'female'},{race:'elf'},{owner:actor,reason:null},{reason:'Different reason'},{revision:'next'}])
    await refused(()=>call({...args,...change}),/request_conflict/);
}));
test('quota includes tombstones and pre-existing characters; fifth allowed, sixth refused',async()=>tx(async()=>{
  await identity(target);for(let i=0;i<4;i++)await call({name:'Owned '+i});
  await db.exec(`UPDATE characters SET deleted_at=now() WHERE id='${legacy}'`);
  await refused(()=>call({name:'Sixth'}),/quota/);assert.equal((await counts()).characters,5);
}));
test('queued competing requests and lost responses preserve quota/replay; advisory locks held to transaction end',async()=>tx(async()=>{
  const request=uid(next++);const results=await Promise.all([call({request}),call({request}),call({request})]);
  assert.deepEqual(results[0],results[1]);assert.deepEqual(results[1],results[2]);
  assert.equal((await counts()).characters,2);
  const locks=await q("SELECT DISTINCT classid::bigint n FROM pg_locks WHERE locktype='advisory' AND granted");
  assert.ok(locks.some(x=>Number(x.n)===173201));assert.ok(locks.some(x=>Number(x.n)===173202));
}));
test('missing/stale identity, unauthorized delegation and bad reason cannot create',async()=>tx(async()=>{
  const initial=await counts();await identity(null);await refused(()=>call(),/not_authorized/);
  await identity(uid(999));await refused(()=>call(),/not_authorized/);await identity(actor);
  await refused(()=>call({owner:target,reason:'Delegation'}),/not_authorized/);
  await db.exec(`INSERT INTO user_roles VALUES('${actor}','steward')`);
  await refused(()=>call({owner:target,reason:'Delegation'}),/not_authorized/);
  await db.exec(`INSERT INTO user_roles VALUES('${actor}','overlord')`);
  await refused(()=>call({owner:target,reason:'   '}),/not_authorized/);
  await refused(()=>call({owner:target,reason:'\n\t'}),/not_authorized/);
  await refused(()=>call({owner:uid(998),reason:'Delegation'}),/not_authorized/);
  assert.deepEqual(await counts(),initial);
}));
test('Overlord delegates baseline only; audit belongs to receipt and lifetime origin remains private',async()=>tx(async()=>{
  await db.exec(`INSERT INTO user_roles VALUES('${actor}','overlord')`);
  const r=await call({owner:target,reason:' Owner approved recovery '});
  const [c]=await q('SELECT * FROM characters WHERE id=$1',[r.characterId]);assert.equal(c.user_id,target);
  const [log]=await q('SELECT * FROM character_creation_log WHERE result_character_id=$1',[c.id]);
  assert.equal(log.actor_id,actor);assert.equal(log.target_account_id,target);assert.equal(log.detailed_receipt.reason,'Owner approved recovery');
  assert.equal(log.detailed_receipt.mode,'delegated');assert.equal(log.payload_digest.length,32);
  assert.equal((await q("SELECT details_expires_at=((created_at AT TIME ZONE 'UTC')+interval '12 months') AT TIME ZONE 'UTC' ok FROM character_creation_log WHERE log_id=$1",[log.log_id]))[0].ok,true);
}));
test('case uniqueness and accent distinction; invalid choices/revision/catalog drift refuse',async()=>tx(async()=>{
  await call();await refused(()=>call({name:'ELDRIN'}),/duplicate key/);await call({name:'Éldrin'});
  for(const args of [{name:'   '},{name:'x'.repeat(41)},{gender:'unknown'},{revision:'unknown'},{race:'unknown'}])
    await refused(()=>call(args),/invalid_creation|revision_unavailable|race_unavailable/);
  await db.exec("UPDATE races SET str=99 WHERE race_key='human'");await refused(()=>call({name:'Drift'}),/catalog_drift/);
  await db.exec("UPDATE races SET str=1 WHERE race_key='human';UPDATE classes SET base_hp=99 WHERE class_key='classless'");
  await refused(()=>call({name:'Drift'}),/catalog_drift/);
}));
test('unavailable/Test Arena start refuses',async()=>tx(async()=>{
  await db.exec(`INSERT INTO combat2_test_arena_node VALUES('${node}')`);
  await refused(()=>call(),/starting_location/);assert.equal((await counts()).characters,1);
}));
for(const table of ['characters','character_materials','progression_character_state','character_creation_origin','character_creation_log'])
  test('late failure at '+table+' rolls back character and all trigger/sidecar writes',async()=>tx(async()=>{
    await db.exec(`CREATE FUNCTION public.fixture_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected_failure'; END $$;
      CREATE TRIGGER fixture_fail BEFORE INSERT ON public.${table} FOR EACH ROW EXECUTE FUNCTION public.fixture_fail()`);
    const initial=await counts();await refused(()=>call(),/injected_failure/);assert.deepEqual(await counts(),initial);
  }));
test('unexpected equipment/material grants are refused and rolled back',async()=>tx(async()=>{
  await db.exec(`CREATE FUNCTION public.fixture_extra() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    INSERT INTO public.character_inventory(character_id) VALUES(NEW.id);RETURN NEW;END $$;
    CREATE TRIGGER zz_extra AFTER INSERT ON characters FOR EACH ROW EXECUTE FUNCTION public.fixture_extra()`);
  const initial=await counts();await refused(()=>call(),/initialization_drift/);assert.deepEqual(await counts(),initial);
}));
test('unexpected material quantity is refused and all trigger writes roll back',async()=>tx(async()=>{
  await db.exec(`CREATE FUNCTION public.fixture_material_drift() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    UPDATE character_materials SET count=41 WHERE character_id=NEW.id AND material_key='salvage';RETURN NEW;END $$;
    CREATE TRIGGER zz_material_drift AFTER INSERT ON characters FOR EACH ROW EXECUTE FUNCTION public.fixture_material_drift()`);
  const initial=await counts();await refused(()=>call(),/initialization_drift/);assert.deepEqual(await counts(),initial);
}));
test('non READ COMMITTED snapshot refuses; service role has no callable creation authority',async()=>{
  await db.exec('BEGIN ISOLATION LEVEL REPEATABLE READ');try{await identity(actor);await refused(()=>call(),/requires_read_committed/);}finally{await db.exec('ROLLBACK');}
  await tx(async()=>{await identity(null);await db.exec('SET LOCAL ROLE service_role');await refused(()=>call(),/permission denied/);});
});
test('replay survives expired detailed history and catalog changes; purged is terminal; missing result refuses',async()=>tx(async()=>{
  const request=uid(next++);const r=await call({request});
  // Exact storage guard allows physical detail expiry only after12 calendar months.
  const [log]=await q('SELECT * FROM character_creation_log WHERE result_character_id=$1',[r.characterId]);
  await db.exec('ALTER TABLE character_creation_log DISABLE TRIGGER character_creation_log_lifecycle');
  await q("UPDATE character_creation_log SET created_at=now()-interval '2 years',details_expires_at=((now()-interval '2 years') AT TIME ZONE 'UTC')+interval '12 months' WHERE log_id=$1",[log.log_id]);
  await db.exec('ALTER TABLE character_creation_log ENABLE TRIGGER character_creation_log_lifecycle');
  await q('UPDATE character_creation_log SET detailed_receipt=NULL WHERE log_id=$1',[log.log_id]);
  assert.deepEqual(await call({request}),r);
  // Only local lifecycle fixtures delete; the production operation contains no DELETE.
  await q('DELETE FROM character_creation_origin WHERE character_id=$1',[r.characterId]);
  await q('DELETE FROM characters WHERE id=$1',[r.characterId]);
  await refused(()=>call({request}),/result_missing/);
  await q("UPDATE character_creation_log SET replay_status='purged' WHERE log_id=$1",[log.log_id]);
  assert.equal((await call({request})).kind,'purged');assert.equal((await counts()).characters,1);
}));
test('version0 baseline accepts first exact canonical XP event without a synthetic receipt',async()=>tx(async()=>{
  const r=await call();await identity(null);
  assert.equal((await q("SELECT progression_validate_fresh_internal($1,0,'allocate') r",[r.characterId]))[0].r.kind,'valid');
  const result=(await q('SELECT progression_apply_xp_internal($1,$2,$3,$4,$5) r',[r.characterId,uid(next++),'admin_xp',1,{actorId:actor,reason:'local continuity test'}]))[0].r;
  assert.equal(result.kind,'committed');assert.equal((await q('SELECT version FROM progression_character_state WHERE character_id=$1',[r.characterId]))[0].version,1);
  assert.equal((await q("SELECT progression_validate_fresh_internal($1,1,'allocate') r",[r.characterId]))[0].r.kind,'valid');
}));
test('approved race and class pinned values match canonical source constants',()=>{
  const races=read('src/shared/formulas/races.ts').match(/export const RACE_STATS[^=]*=\s*([\s\S]*?);/)[1];
  assert.deepEqual(Function('return ('+races+')')(),manifest.races);
  for(const [name,field] of [['CLASS_BASE_HP','baseHp'],['CLASS_BASE_AC','baseAc']]){
    const table=read('src/shared/formulas/classes.ts').match(new RegExp('export const '+name+'[^=]*=\\s*([\\s\\S]*?);'))[1];
    assert.equal(Function('return ('+table+')')().classless,manifest.class[field]);
  }
  assert.match(read('src/lib/game-data.ts'),/baseStats = \{ str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 \}/);
});
