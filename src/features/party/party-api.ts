import { supabase } from '@/integrations/supabase/client';

export const PARTY_OPERATIONS = ['create','invite','accept','decline','cancel','leave','kick','disband','set_tank'] as const;
export type PartyOperation = typeof PARTY_OPERATIONS[number];
export type PartyMutationInput = {
  actorCharacterId:string; operation:PartyOperation; partyId:string|null;
  targetCharacterId:string|null; membershipId:string|null; requestId:string;
};
export type PartyMutationResult = { ok:boolean; kind:string; partyId?:string; membershipId?:string };
export type PartyApiResult<T> = { value?:T; error?:string; uncertain?:boolean };
export type PartyState = {
  party:{id:string;leader_id:string;tank_id:string|null;created_at:string}|null;
  members:Array<{id:string;character_id:string;status:'accepted';is_following:boolean;character:{id:string;name:string;family_name?:string;gender:'male'|'female';race:string;class:string;level:number;hp:number;max_hp:number;current_node_id:string|null;dex:number}}>;
  incomingInvitations:Array<{id:string;party_id:string;leader_name:string}>;
  outgoingInvitations:Array<{id:string;party_id:string;character_id:string;character_name:string}>;
};

type Rpc=(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:{message?:string}|null}>;
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OUTCOMES=new Set(['not_authorized','request_id_conflict','request_in_progress','actor_dead','unknown_operation','invalid_shape','already_in_party','party_created','invitation_not_active','combat_active','invitation_accepted','invitation_already_closed','invitation_declined','party_not_found','leader_required','target_not_available','target_already_in_party','already_invited','party_full','invited','invitation_cancelled','leader_must_disband','already_left','party_left','invalid_target','member_already_absent','member_kicked','invalid_tank','tank_changed','party_already_disbanded','party_disbanded','party_operation_failed']);

export function decodePartyMutation(value:unknown):PartyMutationResult|null {
  if(!object(value)||typeof value.ok!=='boolean'||typeof value.kind!=='string'||!OUTCOMES.has(value.kind))return null;
  if(value.party_id!==undefined&&(!UUID.test(String(value.party_id))))return null;
  if(value.membership_id!==undefined&&(!UUID.test(String(value.membership_id))))return null;
  return {ok:value.ok,kind:value.kind,...(value.party_id?{partyId:String(value.party_id)}:{}),...(value.membership_id?{membershipId:String(value.membership_id)}:{})};
}

export function decodePartyState(value:unknown):PartyState|null {
  if(!object(value)||value.ok!==true||value.kind!=='party_state'||!Array.isArray(value.members)||!Array.isArray(value.incomingInvitations)||!Array.isArray(value.outgoingInvitations))return null;
  let party:PartyState['party']=null;
  if(value.party!==null){if(!object(value.party)||!UUID.test(String(value.party.id))||!UUID.test(String(value.party.leaderId))||typeof value.party.createdAt!=='string'||(value.party.tankId!==null&&!UUID.test(String(value.party.tankId))))return null;party={id:String(value.party.id),leader_id:String(value.party.leaderId),tank_id:value.party.tankId===null?null:String(value.party.tankId),created_at:value.party.createdAt};}
  const members:PartyState['members']=[];
  for(const raw of value.members){if(!object(raw)||!object(raw.character)||!UUID.test(String(raw.id))||!UUID.test(String(raw.characterId))||raw.status!=='accepted'||typeof raw.isFollowing!=='boolean')return null;const c=raw.character;if(!UUID.test(String(c.id))||typeof c.name!=='string'||!['male','female'].includes(String(c.gender))||typeof c.race!=='string'||typeof c.class!=='string'||![c.level,c.hp,c.maxHp,c.dex].every(Number.isFinite)||(c.currentNodeId!==null&&typeof c.currentNodeId!=='string'))return null;members.push({id:String(raw.id),character_id:String(raw.characterId),status:'accepted',is_following:raw.isFollowing,character:{id:String(c.id),name:c.name,...(typeof c.familyName==='string'?{family_name:c.familyName}:{}),gender:c.gender as 'male'|'female',race:c.race,class:c.class,level:c.level as number,hp:c.hp as number,max_hp:c.maxHp as number,current_node_id:c.currentNodeId as string|null,dex:c.dex as number}});}
  const incomingInvitations:PartyState['incomingInvitations']=[];for(const raw of value.incomingInvitations){if(!object(raw)||!UUID.test(String(raw.id))||!UUID.test(String(raw.partyId))||typeof raw.leaderName!=='string')return null;incomingInvitations.push({id:String(raw.id),party_id:String(raw.partyId),leader_name:raw.leaderName});}
  const outgoingInvitations:PartyState['outgoingInvitations']=[];for(const raw of value.outgoingInvitations){if(!object(raw)||!UUID.test(String(raw.id))||!UUID.test(String(raw.partyId))||!UUID.test(String(raw.characterId))||typeof raw.characterName!=='string')return null;outgoingInvitations.push({id:String(raw.id),party_id:String(raw.partyId),character_id:String(raw.characterId),character_name:raw.characterName});}
  return {party,members,incomingInvitations,outgoingInvitations};
}

export function createPartyApi(rpc:Rpc=(name,args)=>supabase.rpc(name as never,args as never)) {
  return {
    async state(characterId:string):Promise<PartyApiResult<PartyState>>{try{const {data,error}=await rpc('party_state',{_character_id:characterId});if(error)return {error:'Party refresh failed.',uncertain:true};const value=decodePartyState(data);return value?{value}:{error:'Party state was malformed.'};}catch{return {error:'Party refresh failed.',uncertain:true};}},
    async mutate(input:PartyMutationInput):Promise<PartyApiResult<PartyMutationResult>>{try{const {data,error}=await rpc('party_mutate',{_actor_character_id:input.actorCharacterId,_operation:input.operation,_party_id:input.partyId,_target_character_id:input.targetCharacterId,_membership_id:input.membershipId,_request_id:input.requestId});if(error)return {error:'Party request outcome is uncertain.',uncertain:true};const value=decodePartyMutation(data);return value?{value}:{error:'Party response was malformed.'};}catch{return {error:'Party request outcome is uncertain.',uncertain:true};}}
  };
}

export type CoordinatedPartyResult=PartyApiResult<PartyMutationResult>&{stale?:boolean};
export function createPartyMutationCoordinator(call:(input:PartyMutationInput)=>Promise<PartyApiResult<PartyMutationResult>>,uuid:()=>string=()=>crypto.randomUUID()) {
  let actor:string|null=null;let epoch=0;const requests=new Map<string,string>();const inFlight=new Map<string,Promise<CoordinatedPartyResult>>();
  return {
    setActor(next:string|null){if(next!==actor){actor=next;epoch++;requests.clear();inFlight.clear();}},
    submit(key:string,input:Omit<PartyMutationInput,'actorCharacterId'|'requestId'>):Promise<CoordinatedPartyResult>{if(!actor)return Promise.resolve({error:'No active character.'});const existing=inFlight.get(key);if(existing)return existing;const capturedActor=actor,capturedEpoch=epoch;const requestId=requests.get(key)??uuid();requests.set(key,requestId);const promise:Promise<CoordinatedPartyResult>=call({...input,actorCharacterId:capturedActor,requestId}).then(result=>{if(capturedEpoch!==epoch||capturedActor!==actor)return {...result,stale:true};if(!result.uncertain)requests.delete(key);return result;}).finally(()=>{if(inFlight.get(key)===promise)inFlight.delete(key);});inFlight.set(key,promise);return promise;},
  };
}
