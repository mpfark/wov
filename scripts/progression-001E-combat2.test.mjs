/** Reuse the unchanged actual five-layer 001D acceptance harness with 001E growth extension.
 * Disposable local PGlite only; no hosted/runtime/multi-session attestation.
 */
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {read} from './prepare-progression-001E.mjs';
let source=read('scripts/progression-001D-integration.test.mjs');
source=source.replace("'./prepare-progression-001D.mjs'",JSON.stringify(pathToFileURL(resolve('scripts/prepare-progression-001D.mjs')).href));
source=`import {read,definition,dependencies,payload as ePayload} from ${JSON.stringify(pathToFileURL(resolve('scripts/prepare-progression-001E.mjs')).href)};\n`+source;
source=source.replace("await db.exec('COMMIT');",`await db.exec('COMMIT');
 await db.exec(\`ALTER TABLE classes ADD is_pre_class boolean DEFAULT false,ADD is_selectable boolean DEFAULT true,ADD status text DEFAULT 'active';
 ALTER TABLE characters ADD movement_locked_until timestamptz;
 ALTER TABLE node_creature ADD engaged boolean DEFAULT true;
 ALTER TABLE node_intent ADD character_id uuid;
 ALTER TABLE character_stance_request ADD character_id uuid;
 CREATE TABLE nodes(id uuid PRIMARY KEY,is_trainer boolean,class_hall text);
 CREATE TABLE character_class_bonds(character_id uuid,class text,bond integer,PRIMARY KEY(character_id,class));
 ALTER TABLE character_class_bonds ENABLE ROW LEVEL SECURITY;
 CREATE POLICY bond_read ON character_class_bonds FOR SELECT USING(true);
 CREATE TABLE combat2_party_departure_request(request_id uuid,status text);
 CREATE TABLE combat2_party_departure_member(character_id uuid,request_id uuid,status text);
 CREATE TABLE combat_sessions(character_id uuid,party_id uuid);
 CREATE TABLE party_members(character_id uuid,party_id uuid,status text);
 REVOKE ALL ON characters FROM anon,authenticated,custom_default;\`);
 for(const [name,,sql]of dependencies.slice(5))await db.exec(definition(sql,name).sql);
 await db.exec(definition(read('supabase/migrations/20260629080249_d6091f9a-cb36-4b1f-9beb-4966956f5e93.sql'),'restrict_party_leader_updates').sql);
 await db.exec(definition(read('supabase/migrations/20261001130000_combat2_character_persistent_stances.sql'),'combat2_refuse_invalid_stance_class_change').sql);
 await db.exec('CREATE TRIGGER restrict_party_leader_updates BEFORE UPDATE ON characters FOR EACH ROW EXECUTE FUNCTION restrict_party_leader_updates(); CREATE TRIGGER combat2_refuse_invalid_stance_class_change BEFORE UPDATE OF class ON characters FOR EACH ROW EXECUTE FUNCTION combat2_refuse_invalid_stance_class_change();');
 await db.exec('BEGIN');await db.exec(ePayload());await db.exec('COMMIT');`);
source=source.replace("const names=['characters'","const names=['progression_class_growth_milestone','characters'");
source+=`
test('001E actual outer Combat2 reward records every crossed growth destination with durable claim/receipt linkage',async()=>{
 const f=await fixture({level:2},2700);const result=await commit(f);assert.equal(result.ok,true);
 const rows=(await db.query('SELECT * FROM progression_class_growth_milestone WHERE character_id=$1 ORDER BY destination_level',[f.character])).rows;
 assert.deepEqual(rows.map(r=>r.destination_level),[3,6]);assert.ok(rows.every(r=>r.source==='combat2_reward'&&r.class_key==='wizard'&&r.applied_deltas.int===1));
 const reward=await claim(f);assert.ok(rows.every(r=>r.event_id===reward.id));assert.equal((await character(f)).int,12);
});
test('001E conflicting destination failure rolls back actual outer Combat2 reward/economy transaction',async()=>{
 const f=await fixture({level:2},200);
 await db.query("SELECT progression_apply_xp_internal($1,$2,'admin_xp',200,$3)",[f.character,id(),{actorId:id(),reason:'local test'}]);
 await db.query('UPDATE characters SET level=2,xp=0 WHERE id=$1',[f.character]);const pre=await snapshot();
 assert.equal((await commit(f)).kind,'internal_failure');assert.deepEqual(await snapshot(),pre);assert.equal(await claim(f),undefined);
});
`;
await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
