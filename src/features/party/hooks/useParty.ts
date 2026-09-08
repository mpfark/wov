import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { createPartyApi, createPartyMutationCoordinator, type PartyOperation, type PartyState } from '../party-api';

export interface PartyMember { id:string;character_id:string;status:string;is_following:boolean;character:{id:string;name:string;family_name?:string;gender:'male'|'female';race:string;class:string;level:number;hp:number;max_hp:number;current_node_id:string|null;dex:number}; }
export interface Party { id:string;leader_id:string;tank_id:string|null;created_at:string; }

const api=createPartyApi();
const resultMessage=(ok:boolean,kind:string)=>`${ok?'Party updated':'Party refused'}: ${kind.replaceAll('_',' ')}.`;

export function useParty(characterId:string|null) {
  const [state,setState]=useState<PartyState>({party:null,members:[],incomingInvitations:[],outgoingInvitations:[]});
  const [operationMessage,setOperationMessage]=useState('');
  const mounted=useRef(true);const characterRef=useRef(characterId);const partyVersion=useRef(0);const previousPartyId=useRef<string|null>(null);
  const coordinator=useMemo(()=>createPartyMutationCoordinator(input=>api.mutate(input)),[]);
  characterRef.current=characterId;

  const fetchParty=useCallback(async()=>{const requested=characterId;if(!requested){setState({party:null,members:[],incomingInvitations:[],outgoingInvitations:[]});return;}const response=await api.state(requested);if(!mounted.current||characterRef.current!==requested)return;if(response.value){const next=response.value.party?.id??null;if(next!==previousPartyId.current){previousPartyId.current=next;partyVersion.current++;}setState(response.value);}else setOperationMessage(response.error??'Party refresh failed.');},[characterId]);
  useEffect(()=>{mounted.current=true;coordinator.setActor(characterId);void fetchParty();return()=>{mounted.current=false;coordinator.setActor(null);};},[characterId,coordinator,fetchParty]);

  useEffect(()=>{if(!characterId)return;let cancelled=false,attempt=0;let timer:ReturnType<typeof setTimeout>|null=null;let channel:ReturnType<typeof supabase.channel>|null=null;
    const connect=()=>{if(cancelled)return;const current=supabase.channel(`party-state-${characterId}-${crypto.randomUUID()}`).on('postgres_changes',{event:'*',schema:'public',table:'party_members',filter:`character_id=eq.${characterId}`},()=>void fetchParty()).on('postgres_changes',{event:'*',schema:'public',table:'parties'},()=>void fetchParty());if(state.party?.id)current.on('postgres_changes',{event:'*',schema:'public',table:'party_members',filter:`party_id=eq.${state.party.id}`},()=>void fetchParty());channel=current;current.subscribe(status=>{if(cancelled||channel!==current)return;if(status==='SUBSCRIBED'){attempt=0;void fetchParty();}else if(['CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(status)){channel=null;timer=setTimeout(connect,Math.min(30_000,1000*2**attempt++));}});};
    const reconnect=()=>{if(timer)clearTimeout(timer);timer=null;if(channel)void supabase.removeChannel(channel);channel=null;attempt=0;connect();};const visible=()=>{if(document.visibilityState==='visible')reconnect();};window.addEventListener('online',reconnect);document.addEventListener('visibilitychange',visible);connect();return()=>{cancelled=true;if(timer)clearTimeout(timer);if(channel)void supabase.removeChannel(channel);window.removeEventListener('online',reconnect);document.removeEventListener('visibilitychange',visible);};
  },[characterId,state.party?.id,fetchParty]);

  const run=useCallback(async(key:string,operation:PartyOperation,partyId:string|null,targetCharacterId:string|null,membershipId:string|null)=>{setOperationMessage('');const version=partyVersion.current;const response=await coordinator.submit(key,{operation,partyId,targetCharacterId,membershipId});if(response.stale||version!==partyVersion.current)return;if(response.value)setOperationMessage(resultMessage(response.value.ok,response.value.kind));else setOperationMessage(response.error??'Party request failed.');if(!response.uncertain)await fetchParty();return response.value;},[coordinator,fetchParty]);
  const party=state.party;const members=state.members as PartyMember[];
  const createParty=useCallback(()=>run('create','create',null,null,null),[run]);
  const invitePlayer=useCallback((target:string)=>run(`invite:${party?.id}:${target}`,'invite',party?.id??null,target,null),[run,party?.id]);
  const acceptInvite=useCallback(async(id:string)=>{const value=await run(`accept:${id}`,'accept',null,null,id);return value?.ok?null:value?.kind??'Party request failed.';},[run]);
  const declineInvite=useCallback((id:string)=>run(`decline:${id}`,'decline',null,null,id),[run]);
  const cancelInvite=useCallback((id:string)=>run(`cancel:${party?.id}:${id}`,'cancel',party?.id??null,null,id),[run,party?.id]);
  const leaveParty=useCallback(()=>party&&run(`${party.leader_id===characterId?'disband':'leave'}:${party.id}`,party.leader_id===characterId?'disband':'leave',party.id,null,null),[run,party,characterId]);
  const kickMember=useCallback((target:string)=>run(`kick:${party?.id}:${target}`,'kick',party?.id??null,target,null),[run,party?.id]);
  const setTank=useCallback((target:string|null)=>run(`set_tank:${party?.id}:${target??'none'}`,'set_tank',party?.id??null,target,null),[run,party?.id]);
  const toggleFollow=useCallback(async(following:boolean)=>{if(party)await run(`${following?'follow':'stop_following'}:${party.id}`,following?'follow':'stop_following',party.id,null,null);},[run,party]);
  const isLeader=party?.leader_id===characterId;const isTank=(party?.tank_id??party?.leader_id)===characterId;const myMembership=members.find(member=>member.character_id===characterId);
  return {party,members,pendingInvites:state.incomingInvitations,outgoingInvites:state.outgoingInvitations,isLeader,isTank,myMembership,operationMessage,createParty,invitePlayer,acceptInvite,declineInvite,cancelInvite,leaveParty,kickMember,setTank,toggleFollow,fetchParty};
}
