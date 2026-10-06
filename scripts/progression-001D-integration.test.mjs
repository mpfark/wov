/** Actual transferred five-layer SQL + prepared payload on local PGlite.
 * Minimal relation fixture, not a production-trigger or hosted concurrency claim.
 */
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {verifiedBodies,payload,replacement,argumentsSql} from './prepare-progression-001D.mjs';
if(!process.argv[2])throw Error('Supply pinned local PGlite module path; no hosted connection mode');
const {PGlite}=await import(pathToFileURL(resolve(process.argv[2])).href);
let db;let seq=100;
const id=()=>`00000000-0000-4000-8000-${String(seq++).padStart(12,'0')}`;
const bodies=verifiedBodies();
const base=readFileSync('scripts/progression-001C-sql.test.mjs','utf8').match(/const fixture=`([\s\S]*?)`;/)[1];
const schema=`
ALTER TABLE characters ADD gold integer NOT NULL DEFAULT 0, ADD current_node_id uuid, ADD last_death_at timestamptz;
ALTER TABLE character_inventory ADD id uuid PRIMARY KEY DEFAULT gen_random_uuid(), ADD crafted_level integer;
ALTER TABLE items ADD rarity text DEFAULT 'common', ADD max_durability integer DEFAULT 10, ADD item_type text DEFAULT 'equipment', ADD weapon_tag text, ADD hands integer, ADD level integer DEFAULT 1, ADD procs jsonb DEFAULT '[]';
CREATE TABLE node_encounter(id uuid PRIMARY KEY,node_id uuid,tick integer DEFAULT 0,state_version bigint DEFAULT 1,
 claim_token uuid,claimed_tick integer DEFAULT 1,claim_expires_at timestamptz DEFAULT now()+interval '1 hour',
 next_due_at timestamptz DEFAULT now(),status text DEFAULT 'active',test_arena_id uuid,intent_cutoff_seq bigint);
CREATE TABLE node_fighter(id uuid PRIMARY KEY,encounter_id uuid,character_id uuid,entry_seq bigint DEFAULT 1,
 present boolean DEFAULT true,left_at timestamptz,arrival_group_id uuid);
CREATE TABLE node_creature(id uuid PRIMARY KEY,encounter_id uuid,creature_id uuid,spawn_seq integer DEFAULT 1,hp integer DEFAULT 5,
 is_alive boolean DEFAULT true,pending_action jsonb,tank_fighter_id uuid,last_damaged_at timestamptz,died_at timestamptz);
CREATE TABLE creatures(id uuid PRIMARY KEY,spawn_seq integer DEFAULT 1,hp integer DEFAULT 5,is_alive boolean DEFAULT true,died_at timestamptz,last_damaged_at timestamptz);
CREATE TABLE node_effect(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),encounter_id uuid,kind text,effect_type text,ability_key text,
 target_character_id uuid,target_creature_id uuid,source_character_id uuid,source_creature_id uuid,stacks integer,magnitude numeric,
 config jsonb,expires_at timestamptz,next_due_at timestamptz,interval_ms integer,last_pulse_tick bigint,is_reservation boolean);
CREATE TABLE node_participation(encounter_id uuid,creature_id uuid,spawn_seq integer,character_id uuid,qualification text,
 qualified_by text,party_id_at_qualification uuid,last_at timestamptz,UNIQUE(encounter_id,creature_id,spawn_seq,character_id));
CREATE TABLE node_reward_claim(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),encounter_id uuid,node_creature_id uuid,creature_id uuid,
 spawn_seq integer,character_id uuid REFERENCES characters(id),xp_awarded integer,gold_awarded integer,is_killer boolean,
 UNIQUE(creature_id,spawn_seq,character_id));
CREATE TABLE node_death_loot(encounter_id uuid,node_creature_id uuid,creature_id uuid,spawn_seq integer,loot_key text,
 item_id uuid,mode text,outcome text,ground_loot_id uuid,UNIQUE(encounter_id,node_creature_id,spawn_seq,loot_key));
CREATE TABLE node_ground_loot(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),node_id uuid,item_id uuid,creature_name text);
CREATE TABLE node_tick_batch(encounter_id uuid,tick integer,events jsonb,UNIQUE(encounter_id,tick));
CREATE TABLE node_pending_event(id uuid PRIMARY KEY,encounter_id uuid,event_type text,actor_character_id uuid,actor_creature_id uuid,
 target_character_id uuid,target_creature_id uuid,payload jsonb,occurred_at timestamptz DEFAULT now(),consumed_at timestamptz,consumed_tick integer);
CREATE TABLE node_intent(id uuid PRIMARY KEY,encounter_id uuid,status text DEFAULT 'pending',seq bigint DEFAULT 1);
CREATE TABLE combat2_departure_request(request_id uuid PRIMARY KEY,encounter_id uuid,character_id uuid,fighter_id uuid,
 fighter_entry_seq bigint,origin_node_id uuid,destination_node_id uuid,cost integer,resource_kind text,status text DEFAULT 'queued',
 arrival_group_id uuid,resolved_tick integer,resolved_at timestamptz);
CREATE TABLE character_stance(character_id uuid,ability_key text,version bigint,state jsonb,updated_at timestamptz);
CREATE TABLE character_stance_request(encounter_id uuid,intent_id uuid,committed_at timestamptz);
CREATE TABLE node_boss_ability_cooldown(encounter_id uuid,node_creature_id uuid,creature_id uuid,spawn_seq bigint,ability_key text,
 next_available_tick bigint,UNIQUE(encounter_id,node_creature_id,spawn_seq,ability_key));
`;
before(async()=>{
 db=new PGlite();await db.exec(base+schema);
 await db.exec("INSERT INTO classes VALUES('wizard',16,'{\"int\":1,\"wis\":1}'),('warrior',24,'{\"str\":1,\"dex\":1}'),('classless',18,'{}')");
 await db.exec(readFileSync('docs/operations/progression-001C-authority.sql','utf8'));
 for(const text of Object.values(bodies))await db.exec(text+';');
 for(const signature of ['apply_crafting_xp(uuid,integer)','stonebinder_commit_fuse(uuid,uuid,uuid,uuid,integer)',
  'commit_encounter_tick_v2(uuid,bigint,uuid,uuid,integer,integer,jsonb,jsonb,jsonb)',
  'award_party_member(uuid,integer,integer)','award_party_member(uuid,integer,integer,integer,integer)'])await db.exec(`CREATE FUNCTION public.${signature} RETURNS void LANGUAGE sql AS 'SELECT';`);
 await db.exec('BEGIN');await db.exec(payload());await db.exec('COMMIT');
});
after(async()=>{await db?.close();});
async function fixture(fields={},xp=50){
 const f={character:id(),fighter:id(),encounter:id(),token:id(),node:id(),creature:id(),nodeCreature:id(),item:id(),intent:id(),pending:id()};
 await db.query('INSERT INTO characters(id,user_id,current_node_id) VALUES($1,$2,$3)',[f.character,id(),f.node]);
 for(const [k,v] of Object.entries(fields))await db.query(`UPDATE characters SET "${k}"=$1 WHERE id=$2`,[v,f.character]);
 await db.query('INSERT INTO node_encounter(id,node_id,claim_token) VALUES($1,$2,$3)',[f.encounter,f.node,f.token]);
 await db.query('INSERT INTO node_fighter(id,encounter_id,character_id) VALUES($1,$2,$3)',[f.fighter,f.encounter,f.character]);
 await db.query('INSERT INTO creatures(id) VALUES($1)',[f.creature]);
 await db.query('INSERT INTO node_creature(id,encounter_id,creature_id) VALUES($1,$2,$3)',[f.nodeCreature,f.encounter,f.creature]);
 await db.query("INSERT INTO node_participation VALUES($1,$2,1,$3,'qualified','test',NULL,NULL)",[f.encounter,f.creature,f.character]);
 await db.query('INSERT INTO items(id,stats) VALUES($1,\'{}\')',[f.item]);
 await db.query('INSERT INTO node_intent(id,encounter_id) VALUES($1,$2)',[f.intent,f.encounter]);
 await db.query("INSERT INTO node_pending_event(id,encounter_id,event_type,payload) VALUES($1,$2,'test','{}')",[f.pending,f.encounter]);
 f.proposal={characters:[],creatures:[{id:f.nodeCreature,creature_id:f.creature,spawn_seq:1,hp:0,is_alive:false}],effects_insert:[],effects_update:[],effects_delete:[],fighters:[],participation:[],equipment_fence:[],durability:[],departures:[],
  pending_event_ids:[f.pending],events:[],rewards:[{node_creature_id:f.nodeCreature,creature_id:f.creature,spawn_seq:1,character_id:f.character,xp_awarded:xp,gold_awarded:7,is_killer:true}],
  loot:[{node_creature_id:f.nodeCreature,creature_id:f.creature,spawn_seq:1,loot_key:'ordinary',item_id:f.item,creature_name:'fixture',mode:'item_pool',outcome:'dropped'}]};
 return f;
}
const commit=async f=>(await db.query(`SELECT public.node_tick_commit($1,$2,1,0,1,$3,$4) result`,[f.encounter,f.token,[f.intent],f.proposal])).rows[0].result;
const character=async f=>(await db.query('SELECT * FROM characters WHERE id=$1',[f.character])).rows[0];
const claim=async f=>(await db.query('SELECT * FROM node_reward_claim WHERE character_id=$1',[f.character])).rows[0];
async function economicFixture(f){
 const inventory=id(),request=id(),destination=id();
 await db.query("INSERT INTO character_inventory(id,character_id,item_id,equipped_slot,current_durability) VALUES($1,$2,$3,'weapon',10)",[inventory,f.character,f.item]);
 f.proposal.equipment_fence=[{inventory_id:inventory,character_id:f.character,fighter_id:f.fighter,entry_seq:1,item_id:f.item,slot:'weapon',durability:10,applied_gems:{},stat_override:null,crafted_level:null,item_present:true,item_type:'equipment',weapon_tag:null,hands:null,item_level:1,rarity:'common',max_durability:10,base_stats:{},procs:[]}];
 f.proposal.durability=[{inventory_id:inventory,character_id:f.character,fighter_id:f.fighter,entry_seq:1,item_id:f.item,slot:'weapon',rarity:'common',durability_before:10,durability_after:9}];
 await db.query("INSERT INTO combat2_departure_request(request_id,encounter_id,character_id,fighter_id,fighter_entry_seq,origin_node_id,destination_node_id,cost,resource_kind) VALUES($1,$2,$3,$4,1,$5,$6,3,'mp')",[request,f.encounter,f.character,f.fighter,f.node,destination]);
 f.proposal.departures=[{request_id:request,fighter_id:f.fighter,fighter_entry_seq:1,origin_node_id:f.node,destination_node_id:destination,cost:3,outcome:'moved'}];
 return {inventory,request,destination};
}
async function snapshot(){
 const names=['characters','node_encounter','node_creature','creatures','node_effect','node_participation','node_reward_claim','progression_character_state','progression_receipt','progression_respec_milestone','node_death_loot','node_ground_loot','character_inventory','node_tick_batch','node_pending_event','node_intent','combat2_departure_request','character_stance','character_stance_request','node_boss_ability_cooldown'];
 return Object.fromEntries(await Promise.all(names.map(async n=>[n,(await db.query(`SELECT to_jsonb(t) value FROM ${n} t ORDER BY to_jsonb(t)::text`)).rows])));
}
test('exact evidence installation and patch preserve outer definitions, paths and ordinary-role denial',async()=>{
 for(const [name,text] of Object.entries(bodies)){
  const actual=(await db.query('SELECT pg_get_functiondef($1::regprocedure) text',[`public.${name}(${argumentsSql})`])).rows[0].text;
  assert.equal(actual,name.endsWith('without_bounded_failure')?replacement(bodies):text);
 }
 for(const name of ['progression_apply_xp_internal(uuid,uuid,text,numeric,jsonb)','combat2_apply_claim_progression_internal(uuid,uuid)',...Object.keys(bodies).filter(n=>n!=='node_tick_commit').map(n=>`${n}(${argumentsSql})`)])
  for(const role of ['anon','authenticated','service_role','custom_default'])assert.equal((await db.query("SELECT has_function_privilege($1,$2,'EXECUTE') allowed",[role,'public.'+name])).rows[0].allowed,false);
});

test('only validated outer service entry works; duplicate within reward loop does not reuse prior UUID',async()=>{
 const f=await fixture({},1);f.proposal.rewards.push({...f.proposal.rewards[0]});
 await db.exec('SET ROLE service_role');
 try{
  await assert.rejects(db.query('SELECT combat2_apply_claim_progression_internal($1,$2)',[id(),f.encounter]),/permission denied/);
  assert.equal((await commit(f)).kind,'committed');
 }finally{await db.exec('RESET ROLE');}
 assert.equal((await character(f)).xp,1);assert.equal((await character(f)).gold,7);
 assert.equal((await db.query('SELECT count(*)::int n FROM progression_receipt WHERE character_id=$1',[f.character])).rows[0].n,1);
});
test('ordinary/exact/multi/cap/classless outcomes use accepted claim identity and actual canonical resources',async()=>{
 for(const [fields,xp,level,remainder,points] of [[{},1,1,1,0],[{},50,2,0,1],[{},250,3,0,2],[{level:41},84050,42,0,1],[{level:41},999999,42,0,1],[{level:42},250,42,0,0],[{class:'classless',is_classless:true},250,3,0,2]]){
  const f=await fixture(fields,xp);assert.equal((await commit(f)).kind,'committed');const c=await character(f);
  assert.equal(c.level,level);assert.equal(c.xp,remainder);assert.equal(c.unspent_stat_points,points);assert.equal(c.ac,10);
  assert.equal(c.hp,points?c.max_hp:1);assert.equal(c.cp,5);assert.equal(c.mp,7);
  if(level===3)assert.equal(c.int,fields.is_classless?10:11);
  const rc=await claim(f);const receipts=(await db.query('SELECT * FROM progression_receipt WHERE character_id=$1',[f.character])).rows;
  assert.equal(receipts.length,1);assert.equal(receipts[0].event_id,rc.id);assert.equal(receipts[0].source,'combat2_reward');
  assert.equal(receipts[0].request.metadata.rewardClaimId,rc.id);
 }
});
test('dead stays zero, combat resource snapshot precedes level-up, CP/MP clamp and switch preserves prior growth',async()=>{
 const f=await fixture({hp:5,cp:200,mp:300},250);f.proposal.characters=[{id:f.character,hp:0,cp:99,mp:99,died:true}];
 assert.equal((await commit(f)).kind,'committed');const c=await character(f);assert.equal(c.hp,0);assert.equal(c.cp,Math.min(99,c.max_cp));assert.equal(c.mp,99);
 const g=await fixture({class:'warrior'},250);await commit(g);assert.equal((await character(g)).str,11);
 await db.query("UPDATE characters SET class='wizard' WHERE id=$1",[g.character]);
 const event=id();await db.query("SELECT progression_apply_xp_internal($1,$2,'admin_xp',2500,jsonb_build_object('actorId',$3::text,'reason','fixture'))",[g.character,event,id()]);
 const switched=await character(g);assert.equal(switched.str,11);assert.equal(switched.dex,11);assert.ok(switched.int>10);
});
test('milestones, committed retry and historical conflicting claim never award twice',async()=>{
 const f=await fixture({level:9},4050);assert.equal((await commit(f)).kind,'committed');assert.equal((await character(f)).respec_points,1);
 const before=await snapshot();assert.equal((await commit(f)).kind,'already_committed');assert.deepEqual(await snapshot(),before);
 const h=await fixture({},50);await db.query('INSERT INTO node_reward_claim(encounter_id,node_creature_id,creature_id,spawn_seq,character_id,xp_awarded,gold_awarded) VALUES($1,$2,$3,1,$4,50,7)',[h.encounter,h.nodeCreature,h.creature,h.character]);
 assert.equal((await commit(h)).kind,'committed');assert.equal((await character(h)).xp,0);assert.equal((await character(h)).level,1);assert.equal((await character(h)).gold,0);
 assert.equal((await db.query('SELECT count(*)::int n FROM progression_receipt WHERE character_id=$1',[h.character])).rows[0].n,0);
});
test('refusal rolls back exact writer protected mutations and retry after corrected fixture commits once',async()=>{
 const f=await fixture({level:9,xp:4050},1);const before=await snapshot();const result=await commit(f);
 assert.equal(result.kind,'internal_failure');assert.deepEqual(await snapshot(),before);
 await db.query('UPDATE characters SET xp=0 WHERE id=$1',[f.character]);assert.equal((await commit(f)).kind,'committed');assert.equal((await character(f)).xp,1);
 assert.equal((await db.query('SELECT count(*)::int n FROM progression_receipt WHERE character_id=$1',[f.character])).rows[0].n,1);
});
test('late layer-three handler rolls back inner success, late outer failure propagates, explicit outer rollback is clean',async()=>{
 const f=await fixture({level:9},4050);f.proposal.boss_cooldowns=[{encounter_id:f.encounter,node_creature_id:f.nodeCreature,creature_id:f.creature,spawn_seq:1,ability_key:'fixture',next_available_tick:1}];
 const economy=await economicFixture(f);
 await db.exec("CREATE FUNCTION fixture_fail_cooldown() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture late boss'; END $$; CREATE TRIGGER fixture_fail_cooldown BEFORE INSERT ON node_boss_ability_cooldown FOR EACH ROW EXECUTE FUNCTION fixture_fail_cooldown()");
 const before=await snapshot();assert.equal((await commit(f)).kind,'internal_failure');assert.deepEqual(await snapshot(),before);
 await db.exec('DROP TRIGGER fixture_fail_cooldown ON node_boss_ability_cooldown');
 f.proposal.boss_cooldowns=[];f.proposal.stance_updates=[{character_id:f.character,ability_key:'missing',version:1,state:{}}];
 await assert.rejects(commit(f),/stale stance update/);assert.deepEqual(await snapshot(),before);
 f.proposal.stance_updates=[];await db.exec('BEGIN');assert.equal((await commit(f)).kind,'committed');await db.exec('ROLLBACK');assert.deepEqual(await snapshot(),before);
 assert.equal((await commit(f)).kind,'committed');
 assert.equal((await character(f)).mp,4);assert.equal((await character(f)).current_node_id,economy.destination);
 assert.equal((await db.query('SELECT current_durability FROM character_inventory WHERE id=$1',[economy.inventory])).rows[0].current_durability,9);
 assert.equal((await db.query('SELECT status FROM combat2_departure_request WHERE request_id=$1',[economy.request])).rows[0].status,'moved');
});

test('conflicting accepted event reuse fails closed and late departure refusal undoes prior durability and batch writes',async()=>{
 const f=await fixture();await commit(f);const rc=await claim(f);
 const before=await snapshot();const original=(await db.query('SELECT combat2_apply_claim_progression_internal($1,$2) r',[rc.id,f.encounter])).rows[0].r;
 assert.equal(original.kind,'replayed');assert.deepEqual(await snapshot(),before);
 await db.query('UPDATE node_reward_claim SET xp_awarded=51 WHERE id=$1',[rc.id]);const changed=await snapshot();
 await assert.rejects(db.query('SELECT combat2_apply_claim_progression_internal($1,$2)',[rc.id,f.encounter]),/combat2_progression_refused/);assert.deepEqual(await snapshot(),changed);
 await db.query('UPDATE node_reward_claim SET xp_awarded=50 WHERE id=$1',[rc.id]);
 const g=await fixture({level:9,mp:2},4050);await economicFixture(g);const failed=await snapshot();
 assert.equal((await commit(g)).kind,'internal_failure');assert.deepEqual(await snapshot(),failed);
 await db.query('UPDATE characters SET mp=7 WHERE id=$1',[g.character]);assert.equal((await commit(g)).kind,'committed');assert.equal((await character(g)).mp,4);
});
test('unqualified reward refused, offscreen durable qualification accepted, arena forbidden, item/gold exactly once',async()=>{
 const f=await fixture();await db.query('DELETE FROM node_participation WHERE character_id=$1',[f.character]);assert.equal((await commit(f)).kind,'foreign_reference');assert.equal(await claim(f),undefined);
 const g=await fixture();await db.query('UPDATE node_fighter SET present=false WHERE id=$1',[g.fighter]);assert.equal((await commit(g)).kind,'committed');assert.equal((await character(g)).gold,7);
 const once=await snapshot();await commit(g);assert.deepEqual(await snapshot(),once);
 const h=await fixture();await db.query('UPDATE node_encounter SET test_arena_id=$1 WHERE id=$2',[id(),h.encounter]);assert.equal((await commit(h)).reason,'test_rewards_forbidden');assert.equal(await claim(h),undefined);
});
