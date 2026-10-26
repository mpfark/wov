import {afterEach, describe, expect, it, vi} from 'vitest';
import {cleanup, fireEvent, render, renderHook, screen, waitFor} from '@testing-library/react';
import {deriveCombat2ActionReadiness, deriveCombat2AbilityReadiness, deriveCombat2HostileEntryReadiness} from './action-readiness';
import {routeCombat2Action} from './routeCombat2Action';
import {createCombat2EntryAdapter} from './entry';
import {useCombat2EntrySession} from './useCombat2EntrySession';
import type {ClassAbility} from '@/features/combat/utils/class-abilities';

const character='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',creature='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const base=deriveCombat2ActionReadiness({inputLocked:false,encounterId:null,presentationStatus:'idle',model:null,
 dead:false,pendingFlee:false,fighter:null,characterId:character});
const idle={readiness:base,sessionStatus:'idle',entryStatus:'idle',entryClassification:null,presentationStatus:'idle',encounterId:null,
 hasModel:false,inputLocked:false,dead:false,pendingMovement:false,rosterReady:true};
const ability=(key:string):ClassAbility=>({abilityKey:key,label:key,description:'',tooltip:'',cpCost:10,
 type:'spell_attack',tier:0,levelRequired:1,targetType:'enemy',damageType:'holy'});
afterEach(cleanup);

describe('hostile ability initiation before the first snapshot',()=>{
 it.each(['judgment','fireball','smite'])('routes %s from healthy idle through the real entry adapter',async key=>{
  expect(base).toMatchObject({reason:'delivery_unavailable',message:'Waiting for authoritative state'});
  const session=deriveCombat2HostileEntryReadiness(idle);
  const readiness=deriveCombat2AbilityReadiness({session,levelLocked:false,levelRequired:1,inFlight:false,
   targetValid:true,stanceActive:false,requiredCp:10,availableCp:30});
  const rpc=vi.fn().mockResolvedValue({data:{ok:true,kind:'entered',encounter_id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'},error:null});
  const adapter=createCombat2EntryAdapter({rpc}),submit=vi.fn(),legacy=vi.fn(),diagnose=vi.fn();
  render(<button disabled={!readiness.ready} title={'message' in readiness?readiness.message:undefined}
   onClick={()=>{void routeCombat2Action({enabled:true,sessionReady:false,readiness,ability:ability(key),
    resolveTarget:()=>({ok:false,reason:'no snapshot'}),resolveInitiationTarget:()=>({ok:true,target:{creatureId:creature,name:'Target'}}),
    initiateHostile:(target,k)=>adapter.engageAction!(character,target,k,'dddddddd-dddd-4ddd-8ddd-dddddddddddd'),
    reservedBuffs:{},availableCp:30,submit,legacy,diagnose});}}>Ability</button>);
  const button=screen.getByRole('button',{name:'Ability'});expect(button).toBeEnabled();fireEvent.click(button);
  await waitFor(()=>expect(rpc).toHaveBeenCalledWith('combat2_hostile_action',expect.objectContaining({_character_id:character,_target_creature_id:creature,_ability_key:key})));
  expect(legacy).not.toHaveBeenCalled();expect(submit).not.toHaveBeenCalled();
 });
 it('permits Judgment after the real automatic entry hook receives peaceful no_engagement',async()=>{
  const rpc=vi.fn().mockResolvedValue({data:{ok:false,kind:'no_engagement'},error:null});
  const adapter=createCombat2EntryAdapter({rpc});
  const {result}=renderHook(()=>useCombat2EntrySession({enabled:true,characterId:character,
   nodeId:creature,hasLivingCreatures:true,adapter,generateRequestId:()=>character}));
  await waitFor(()=>expect(result.current.status).toBe('refused'));
  expect(result.current.classification).toBe('no_engagement');
  expect(deriveCombat2HostileEntryReadiness({...idle,entryStatus:result.current.status,
   entryClassification:result.current.classification}).ready).toBe(true);
 });
 it.each(['maintenance','not_authorized','node_changed','no_living_creatures','refused','ability_unavailable','non_hostile_action','invalid_target','future_refusal'])(
  'does not reinterpret server refusal %s as peaceful entry',entryClassification=>{
   expect(deriveCombat2HostileEntryReadiness({...idle,entryStatus:'refused',entryClassification}).ready).toBe(false);
  });
 it.each(['gap','error','refused','reconnecting','syncing'])('does not treat %s as healthy idle',presentationStatus=>{
  const readiness=deriveCombat2HostileEntryReadiness({...idle,presentationStatus});expect(readiness.ready).toBe(false);
 });
 it.each([{inputLocked:true},{pendingMovement:true},{dead:true},{rosterReady:false},
  {sessionStatus:'active'},{entryStatus:'entering'},{entryStatus:'uncertain'},{hasModel:true},{encounterId:'existing'}])(
  'preserves ownership, lifecycle and identity fences %j',change=>{
   expect(deriveCombat2HostileEntryReadiness({...idle,...change}).ready).toBe(false);
  });
 it('retains level, target, in-flight and CP restrictions after allowing entry',()=>{
  const input={session:deriveCombat2HostileEntryReadiness(idle),levelLocked:false,levelRequired:5,inFlight:false,
   targetValid:true,stanceActive:false,requiredCp:10,availableCp:30};
  expect(deriveCombat2AbilityReadiness({...input,levelLocked:true})).toMatchObject({reason:'level_locked'});
  expect(deriveCombat2AbilityReadiness({...input,targetValid:false})).toMatchObject({reason:'invalid_target'});
  expect(deriveCombat2AbilityReadiness({...input,inFlight:true})).toMatchObject({reason:'action_in_flight'});
  expect(deriveCombat2AbilityReadiness({...input,availableCp:9})).toMatchObject({reason:'insufficient_spendable_cp'});
 });
});
