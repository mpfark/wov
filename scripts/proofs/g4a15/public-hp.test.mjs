// Execute the authored public-function composition in the existing disposable
// schema. Only namespace/Auth/clock/security-fixture substitutions are made.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {targets,patch,commitPatch,buildPublicHP,legacyTargets,legacyPatch} from './prepare-public-hp.mjs';
import {fixture} from './admin-boundary.test.mjs';
import {clock,row,state,race,proposal,cid,node,dest,enc,enc2,actor,user,request,at} from './postgres.test.mjs';
const root=new URL('../../../',import.meta.url),read=p=>fs.readFileSync(new URL(p,root),'utf8').replace(/\r\n/g,'\n');
const adapt=s=>s.replaceAll('public.','g4a6.').replaceAll('auth.uid()','g4a9.actor_uid()').replaceAll('auth.role()','g4a9.actor_role()')
 .replace(/\b(?:now|clock_timestamp)\(\)/g,'g4a6.test_now()').replaceAll('SECURITY DEFINER','SECURITY INVOKER')
 .replace(/SET search_path\s*(?:TO|=)[^\n]*?(?=\s+AS\b|$)/gm,'SET search_path TO pg_catalog,g4a6,pg_temp');
const candidate=buildPublicHP();assert.equal(candidate,read('docs/operations/legacy-001G4A21-shared-hp-candidate.sql'));
console.log('G4A21 EXACT CANDIDATE SHA256 '+createHash('sha256').update(candidate).digest('hex'));
const opts={timeout:30000};
async function wired(){const x=await fixture('');const ts=targets();
 const archive=JSON.parse(read('docs/operations/legacy-001F5-party-parity-envelope.json'));
 // Remove fixture-only aliases whose argument names differ from real source.
 await x.o`DROP FUNCTION g4a6.combat_enter_without_engagement_gate(uuid,uuid)`;
 await x.o`DROP FUNCTION g4a6.combat2_seed_spawns(uuid,uuid)`;
 for(const n of ['combat_enter_without_canary_gate','combat_enter_without_engagement_gate'])
 await x.o.unsafe(adapt(archive.functions.find(f=>f.requested_identity.startsWith('public.'+n+'(')).definition));
 for(const t of ts)await x.o.unsafe(adapt(t[2]).replace(/^CREATE FUNCTION/,'CREATE OR REPLACE FUNCTION'));
 for(const t of legacyTargets())await x.o.unsafe(adapt(t[2]));
 // Replace the old local seed wrapper with the complete real source body.
 const seed=read('supabase/migrations/20260902194101_e3b1caf6-58cf-4028-b292-49cc3c283914.sql').split('REVOKE ALL')[0];
 await x.o.unsafe(adapt(seed));
 // Execute the entire consolidated transaction, including drift/metadata guards.
 // Recalculate only guards whose source text changes under declared fixture
 // substitutions. Production candidate identity is asserted above, unchanged.
 let native=candidate.replace(commitPatch(),()=>commitPatch(adapt));
 for(const t of ts)native=native.replace(patch(t).sql,()=>patch(t,adapt).sql);
 for(const t of legacyTargets())native=native.replace(legacyPatch(t),()=>legacyPatch(t,adapt));
 await x.o.unsafe(adapt(native));
 // G4A24 executes the actual appended revocation in this fixture transaction.
 for(const role of ['anon','authenticated'])assert.equal((await x.o`SELECT has_function_privilege(${role},'g4a6.heal_creatures_on_wake()','EXECUTE') allowed`)[0].allowed,false);
 assert.equal((await x.o`SELECT has_function_privilege('postgres','g4a6.heal_creatures_on_wake()','EXECUTE') allowed`)[0].allowed,true);
 await x.o`SELECT set_config('g4a7.actor','',false)`;
 return x;
}
async function claim(x,t){await clock(x.o,t);return(await x.o`SELECT g4a6.node_tick_claim(${node},5000) r`)[0].r;}
async function commit(x,cl,p,t,c=x.o){await clock(c,t);await c`SELECT set_config('g4a7.actor','',false)`;return(await c`SELECT g4a6.node_tick_commit(${enc},${cl.claim_token},${cl.candidate_tick},${cl.last_committed_tick},${cl.state_version},${p.intent_ids},${c.json(p)}) r`)[0].r;}
async function tick(x,t){const cl=await claim(x,t);assert.equal(cl.kind,'claimed',JSON.stringify(cl));const p=proposal(cl);const r=await commit(x,cl,p,t);assert.equal(r.kind,'committed',JSON.stringify(r));return {cl,p,r};}
async function regen(x,t,c=x.o){await clock(c,t);await c`SELECT g4a6.regen_creature_hp()`;}
async function enter(x,t=0){await clock(x.o,t);await x.o`SELECT set_config('g4a7.actor',${user},false)`;await x.o`UPDATE g4a6.creatures SET is_aggressive=true`;
 const r=(await x.o`SELECT g4a6.combat_enter(${actor},${request}) r`)[0].r;assert.equal(r.ok,true,JSON.stringify(r));return r;}
async function leave(x,t=0,party=false){await clock(x.o,t);await x.o`SELECT set_config('g4a7.actor',${user},false)`;
 const r=party?(await x.o`SELECT g4a6.combat2_party_depart(${actor},${dest},gen_random_uuid()) r`)[0].r:(await x.o`SELECT g4a6.combat2_depart(${actor},${dest},gen_random_uuid()) r`)[0].r;
 assert.equal(r.ok,true,JSON.stringify(r));return r;}

test('G4A21 real public solo departure -> resolver quiescence -> 4/8/20s -> re-entry',opts,async()=>{
 const x=await wired();await enter(x);await leave(x);assert.equal((await row(x.o)).hp,40);
 const end=await tick(x,0);assert.equal(end.p.status,'ended');assert.equal((await x.o`SELECT engaged FROM g4a6.node_creature WHERE creature_id=${cid}`)[0].engaged,false);
 for(const [t,hp]of [[3,40],[4,42],[8,44],[20,50]]){await regen(x,t);assert.equal((await row(x.o)).hp,hp);assert.equal((await state(x.o)).projection_hp,hp);}
 await x.o`SELECT set_config('g4a7.actor',${user},false)`;await x.o`SELECT set_config('app.combat2_depart_authorized','true',false)`;
 // Fixture location restoration is setup for a second supported entry, not a
 // claimed test of a second movement route. Arrival is still the real trigger.
 await x.o`ALTER TABLE g4a6.characters DISABLE TRIGGER g4a8_arrival`;await x.o`UPDATE g4a6.characters SET current_node_id=${node} WHERE id=${actor}`;await x.o`ALTER TABLE g4a6.characters ENABLE TRIGGER g4a8_arrival`;
 await clock(x.o,21);const r=(await x.o`SELECT g4a6.combat_enter(${actor},gen_random_uuid()) r`)[0].r;assert.equal(r.ok,true,JSON.stringify(r));assert.equal((await row(x.o)).hp,50);assert.equal((await row(x.o)).regen_eligible_since,null);
});
test('G4A21 actual public party departure removes final followers before quiescence',opts,async()=>{
 const x=await wired();const follower='00000000-0000-4000-8000-000000000021',party='00000000-0000-4000-8000-000000000022';
 await x.o`INSERT INTO g4a6.characters(id,user_id,current_node_id,race) VALUES(${follower},${user},${node},'human')`;
 await x.o`INSERT INTO g4a6.parties(id,leader_id,tank_id) VALUES(${party},${actor},${actor})`;
 await x.o`INSERT INTO g4a6.party_members(party_id,character_id,status,is_following) VALUES(${party},${actor},'accepted',false),(${party},${follower},'accepted',true)`;
 await enter(x);await leave(x,0,true);await tick(x,0);await regen(x,4);assert.equal((await row(x.o)).hp,42);
 assert.equal((await x.o`SELECT count(*)::int n FROM g4a6.node_fighter WHERE encounter_id=${enc} AND present`)[0].n,0);
});
test('G4A21 pending DoT survives departure; expiry starts a fresh four-second interval',opts,async()=>{
 const x=await wired();await enter(x);await leave(x);const nc=(await x.o`SELECT id FROM g4a6.node_creature WHERE creature_id=${cid}`)[0].id;
 await x.o`INSERT INTO g4a6.node_effect(encounter_id,kind,effect_type,target_creature_id,source_character_id,magnitude,config,expires_at,next_due_at,interval_ms)
 VALUES(${enc},'dot','damage',${cid},${actor},7,${x.o.json({node_creature_id:nc,spawn_seq:1,activated_at_tick:0,expires_after_tick:1,interval_ticks:1,next_pulse_tick:1})},${at(180)},${at(0)},2000)`;
 const pulse=await tick(x,0);assert.notEqual(pulse.p.status,'ended');assert.equal((await row(x.o)).hp,33);
 await tick(x,2);await regen(x,5);assert.equal((await row(x.o)).hp,33);await regen(x,6);assert.equal((await row(x.o)).hp,35);
});
test('G4A21 public commit/maintenance observed blocking preserves death and exact replay',opts,async()=>{
 const x=await wired();await enter(x);const nc=(await x.o`SELECT id FROM g4a6.node_creature WHERE creature_id=${cid}`)[0].id;
 await x.o`INSERT INTO g4a6.node_effect(encounter_id,kind,effect_type,target_creature_id,source_character_id,magnitude,config,expires_at,next_due_at,interval_ms)
 VALUES(${enc},'dot','damage',${cid},${actor},40,${x.o.json({node_creature_id:nc,spawn_seq:1,activated_at_tick:0,expires_after_tick:1,interval_ticks:1,next_pulse_tick:1})},${at(180)},${at(0)},2000)`;
 const cl=await claim(x,0),p=proposal(cl);await race(x,c=>commit(x,cl,p,0,c),c=>regen(x,20,c),async r=>{assert.ifError(r.error);assert.equal((await row(x.o)).hp,0);});
 const xp=(await x.o`SELECT xp FROM g4a6.characters WHERE id=${actor}`)[0].xp;assert.equal(xp,'10');
 assert.equal((await commit(x,cl,p,20)).kind,'already_committed');assert.equal((await x.o`SELECT xp FROM g4a6.characters WHERE id=${actor}`)[0].xp,xp);
});

test('G4A21 departure preserves telegraph until due; no target resolves under existing cast rules',opts,async()=>{
 const x=await wired();await enter(x);
 const cast={enabled:true,ability_key:'fixture_cast',label:'fixture',cast_ms:4000,cooldown_ms:4000,chance:1,base_amount:7,target_mode:'aoe',damage_type:'physical'};
 const pending={ability_key:'fixture_cast',ability_label:'fixture',started_at_tick:0,resolve_at_tick:2,target_mode:'all_present_at_resolution',primary_magnitude:7,secondary_magnitude:0,damage_type:'physical',target_fighter_id:null,target_character_id:null,target_entry_seq:null};
 await x.o`UPDATE g4a6.creatures SET boss_cast=${x.o.json(cast)}`;await x.o`UPDATE g4a6.node_creature SET pending_action=${x.o.json(pending)}`;
 await leave(x);const waiting=await tick(x,0);assert.notEqual(waiting.p.status,'ended');await regen(x,3);assert.equal((await row(x.o)).hp,40);
 const resolved=await tick(x,4);assert(resolved.p.events.some(e=>e.kind==='boss_cast_evaded'&&e.outcomeReason==='no_target'));assert.equal(resolved.p.status,'ended');
 await regen(x,7);assert.equal((await row(x.o)).hp,40);await regen(x,8);assert.equal((await row(x.o)).hp,42);
});
test('G4A21 claim lease versus maintenance has observed blocking and no blocked-time credit',opts,async()=>{
 const x=await wired();await enter(x);await leave(x);
 // The departure's real pending events keep this encounter claimable until its
 // next authoritative commit; no fabricated encounter/lease is needed.
 await race(x,async c=>{await clock(c,3);return(await c`SELECT g4a6.node_tick_claim(${node},10000) r`)[0].r;},c=>regen(x,8,c),async(r,cl)=>{
 assert.ifError(r.error);assert.equal(cl.kind,'claimed');assert.equal((await row(x.o)).hp,40);assert.equal((await row(x.o)).regen_eligible_since,null);
 assert.equal((await commit(x,cl,proposal(cl),8)).kind,'committed');});
 await regen(x,11);assert.equal((await row(x.o)).hp,40);await regen(x,12);assert.equal((await row(x.o)).hp,42);
});
test('G4A21 ordinary public respawn changes generation, fences stale claims and cannot retro-heal',opts,async()=>{
 const x=await wired();await x.o`UPDATE g4a6.creatures SET hp=0,is_alive=false,died_at=${at(0)}`;
 await x.o`UPDATE g4a6.node_creature SET hp=0,is_alive=false`;
 await clock(x.o,400);await x.o`SELECT g4a6.respawn_creatures()`;
 assert.equal((await row(x.o)).spawn_seq,2);assert.equal((await row(x.o)).hp,100);assert.equal((await row(x.o)).regen_generation,2);
 await enter(x,401);assert.equal((await x.o`SELECT count(*)::int n FROM g4a6.node_creature WHERE creature_id=${cid} AND spawn_seq=2 AND hp=100`)[0].n,1);
 const cl=await claim(x,401),version=(await state(x.o)).state_version;
 await clock(x.o,402);await x.o`SELECT g4a6.respawn_creatures()`;
 assert.equal((await state(x.o)).state_version,version);assert.equal((await state(x.o)).claim_token,cl.claim_token);
});
test('G4A21 full queued in-tick departure holds destination coverage through public commit/arrival',opts,async()=>{
 const x=await wired(),target='00000000-0000-4000-8000-000000000091';
 await x.o`INSERT INTO g4a6.creatures(id,node_id,hp,max_hp,is_alive,is_aggressive) VALUES(${target},${dest},40,100,true,false)`;
 await enter(x);await x.o`UPDATE g4a6.creatures SET is_aggressive=false WHERE id=${target}`;
 await x.o`SELECT set_config('g4a7.actor',${user},false)`;
 const queued=(await x.o`SELECT g4a6.combat2_depart_without_immediate_transition(${actor},${dest},gen_random_uuid()) r`)[0].r;assert.equal(queued.kind,'queued');
 const result=await tick(x,0);assert.equal(result.p.departures.length,1);assert.equal((await x.o`SELECT current_node_id FROM g4a6.characters WHERE id=${actor}`)[0].current_node_id,dest);
 await regen(x,4);assert.equal((await row(x.o)).hp,42);
 const before=await row(x.o,target);assert.equal((await commit(x,result.cl,result.p,20)).kind,'already_committed');assert.deepEqual(await row(x.o,target),before);
});
test('G4A21 maintenance versus real public re-entry has observed blocking and preserved wounds',opts,async()=>{
 const x=await wired();await tick(x,0);await x.o`UPDATE g4a6.creatures SET is_aggressive=true`;
 await race(x,c=>regen(x,8,c),async c=>{await clock(c,8);await c`SELECT set_config('g4a7.actor',${user},false)`;return(await c`SELECT g4a6.combat_enter(${actor},${request}) r`)[0].r;},async r=>{
 assert.ifError(r.error);assert.equal(r.value.ok,true,JSON.stringify(r.value));assert.equal((await row(x.o)).hp,44);assert.equal((await row(x.o)).regen_eligible_since,null);});
});
test('G4A21 stale retained projection refuses atomically instead of restoring its old HP',opts,async()=>{
 const x=await wired();await x.o`UPDATE g4a6.node_encounter SET status='ended'`;
 await x.o`UPDATE g4a6.node_creature SET hp=99`;
 await assert.rejects(enter(x),/HP parity requires disposition/);assert.equal((await row(x.o)).hp,40);
});
test('G4A21 exact source drift aborts consolidated installation and leaves accounting columns absent',opts,async()=>{
 // Reuse the fixture with a deliberately different original source; a failing
 // installation transaction must not leave its bootstrap half applied.
 const x=await fixture('');await assert.rejects(x.o.unsafe(adapt(candidate)),/source drift|missing .*HP dependency|commit source drift/);
 await x.o.unsafe('ROLLBACK');assert.equal((await x.o`SELECT count(*)::int n FROM information_schema.columns WHERE table_schema='g4a6' AND table_name='creatures' AND column_name='regen_percent_4s'`)[0].n,0);
});
test('G4A21 canonical progression refusal rolls back death/gold/loot; concurrent exact retry pays once',opts,async()=>{
 const x=await wired();await enter(x);await x.o`SELECT set_config('g4a7.actor','',false)`;
 await x.o`UPDATE g4a6.characters SET level=2,xp=199 WHERE id=${actor}`;
 assert.equal((await x.o`SELECT xp FROM g4a6.characters WHERE id=${actor}`)[0].xp,'199');
 await x.o`SELECT set_config('g4a7.actor',${user},false)`;
 await x.o`UPDATE g4a6.creatures SET level=2`;
 const baseline=await row(x.o),fields=['gold_enabled','gold_min','gold_max','gold_chance','salvage_enabled','item_source','loot_table_id','drop_chance','unique_item_id','unique_drop_chance'];
 const expected=Object.fromEntries(fields.map(k=>[k,['gold_chance','drop_chance','unique_drop_chance'].includes(k)&&baseline[k]!==null?Number(baseline[k]):baseline[k]]));
 const desired={...expected,gold_enabled:true,gold_min:3,gold_max:3,gold_chance:1,item_source:'world_pool',drop_chance:1};
 assert.equal((await x.o`SELECT g4a6.admin_set_creature_rewards(${cid},${x.o.json(expected)},${x.o.json(desired)},gen_random_uuid()) r`)[0].r.ok,true);
 await x.o`INSERT INTO g4a6.items(id,name,item_type,world_drop) VALUES(${request},'fixture ordinary sword','equipment',true)`;
 const nc=(await x.o`SELECT id FROM g4a6.node_creature WHERE creature_id=${cid}`)[0].id;
 await x.o`INSERT INTO g4a6.node_effect(encounter_id,kind,effect_type,target_creature_id,source_character_id,magnitude,config,expires_at,next_due_at,interval_ms)
 VALUES(${enc},'dot','damage',${cid},${actor},40,${x.o.json({node_creature_id:nc,spawn_seq:1,activated_at_tick:0,expires_after_tick:1,interval_ticks:1,next_pulse_tick:1})},${at(180)},${at(0)},2000)`;
 const cl=await claim(x,0),p=proposal(cl);assert.equal(p.rewards.length,1);assert(p.rewards[0].xp_awarded>0);
 await x.o`UPDATE g4a6.classes SET level_bonuses='{"unknown":1}'`;const before=await state(x.o);
 assert.equal((await commit(x,cl,p,0)).kind,'internal_failure');assert.deepEqual(await state(x.o),before);
 assert.equal((await x.o`SELECT count(*)::int n FROM g4a6.progression_receipt`)[0].n,0);assert.equal((await x.o`SELECT count(*)::int n FROM g4a6.node_ground_loot`)[0].n,0);
 await x.o`UPDATE g4a6.classes SET level_bonuses='{"dex":1,"str":1}'`;
 await race(x,c=>commit(x,cl,p,0,c),c=>commit(x,cl,p,0,c),async(r,first)=>{
 assert.equal(first.kind,'committed');assert.ifError(r.error);assert.equal(r.value.kind,'already_committed');});
 const ch=(await x.o`SELECT xp,gold FROM g4a6.characters WHERE id=${actor}`)[0],receipt=(await x.o`SELECT receipt FROM g4a6.progression_receipt WHERE character_id=${actor}`)[0].receipt;
 assert.equal(receipt.before.xp,199);assert(receipt.crossedLevels.includes(3));assert.equal(ch.xp,String(receipt.after.xp));assert.equal(receipt.offeredXp,p.rewards[0].xp_awarded);assert.equal(ch.gold,3);
 for(const table of ['progression_receipt','node_reward_claim','node_ground_loot'])assert.equal((await x.o.unsafe('SELECT count(*)::int n FROM g4a6.'+table))[0].n,1);
});
test('G4A21 original legacy encounter/session/effect exclusions still suppress ordinary regeneration',opts,async()=>{
 for(const kind of ['encounter','session','effect']){const x=await wired();await tick(x,0);
 if(kind==='encounter'){await x.o`INSERT INTO g4a6.encounters(id,status) VALUES(${request},'active')`;await x.o`INSERT INTO g4a6.encounter_creatures(encounter_id,creature_id) VALUES(${request},${cid})`;}
 if(kind==='session')await x.o`INSERT INTO g4a6.combat_sessions(node_id,engaged_creature_ids) VALUES(${node},ARRAY[${cid}]::uuid[])`;
 if(kind==='effect')await x.o`INSERT INTO g4a6.active_effects(target_id,expires_at) VALUES(${cid},${Date.parse(at(180))})`;
 await regen(x,20);assert.equal((await row(x.o)).hp,40);assert.equal((await row(x.o)).regen_eligible_since,null);
 await x.o`DELETE FROM g4a6.encounter_creatures`;await x.o`DELETE FROM g4a6.combat_sessions`;await x.o`DELETE FROM g4a6.active_effects`;
 await regen(x,20);await regen(x,23);assert.equal((await row(x.o)).hp,40);await regen(x,24);assert.equal((await row(x.o)).hp,42);}
});
test('G4A21 naked post-row arrival fails closed without early coverage',opts,async()=>{
 const x=await wired();await assert.rejects(x.o`SELECT g4a6.combat2_arrive_after_relocation(${actor},${request})`,e=>e.code==='40001'&&/early HP coverage/.test(e.message));assert.equal((await row(x.o)).hp,40);
});
