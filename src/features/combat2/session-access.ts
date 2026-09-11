import { supabase } from '@/integrations/supabase/client';
export type SessionAccessResult =
  | { status:'allowed'; scope:'test_arena'|'canary'; nodeId:string }
  | { status:'refused'; classification:'not_authorized'|'not_enabled'|'mode_refused' }
  | { status:'error'; classification:'access_check_failed'|'malformed_response'|'transport_error' };
type Client={rpc(name:'combat2_session_access',args:{_character_id:string;_node_id:string}):PromiseLike<{data:unknown;error:{message?:string}|null}>};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);

export function decodeSessionAccess(value:unknown, requestedNodeId:string):SessionAccessResult {
  if(!object(value)||typeof value.ok!=='boolean'||typeof value.kind!=='string')return {status:'error',classification:'malformed_response'};
  if(value.ok===false&&value.kind==='not_authorized')return {status:'refused',classification:'not_authorized'};
  if(value.ok===false&&(value.kind==='not_enabled'||value.kind==='mode_refused'))return {status:'refused',classification:value.kind};
  if(value.ok===false&&value.kind==='access_check_failed')return {status:'error',classification:'access_check_failed'};
  if(value.ok===true&&value.kind==='allowed'&&(value.scope==='test_arena'||value.scope==='canary')&&
    typeof value.node_id==='string'&&UUID.test(value.node_id)&&value.node_id.toLowerCase()===requestedNodeId.toLowerCase())
    return {status:'allowed',scope:value.scope,nodeId:value.node_id};
  return {status:'error',classification:'malformed_response'};
}

export async function checkCombat2SessionAccess(characterId:string,nodeId:string,client:Client={rpc:(name,args)=>supabase.rpc(name as never,args as never)}):Promise<SessionAccessResult>{
  try{const {data,error}=await client.rpc('combat2_session_access',{_character_id:characterId,_node_id:nodeId});
    return error?{status:'error',classification:'transport_error'}:decodeSessionAccess(data,nodeId);
  }catch{return {status:'error',classification:'transport_error'};}
}

type PreflightClient={rpc(name:'combat2_party_preflight',args:{_character_id:string;_node_id:string}):PromiseLike<{data:unknown;error:{message?:string}|null}>};
export async function checkCombat2SessionPreflight(characterId:string,nodeId:string,client:PreflightClient={rpc:(name,args)=>supabase.rpc(name as never,args as never)}):Promise<boolean>{
  try {
    const {data,error}=await client.rpc('combat2_party_preflight',{_character_id:characterId,_node_id:nodeId});
    return !error&&object(data)&&data.ok===true&&data.kind==='eligible';
  } catch { return false; }
}

type PresenceClient={rpc(name:'combat2_test_presence_heartbeat',args:{_arena_id:string;_character_id:string}):PromiseLike<{data:unknown;error:{message?:string}|null}>};
export async function heartbeatCombat2TestPresence(arenaId:string,characterId:string,client:PresenceClient={rpc:(name,args)=>supabase.rpc(name as never,args as never)}):Promise<boolean>{
  try {
    const {data,error}=await client.rpc('combat2_test_presence_heartbeat',{_arena_id:arenaId,_character_id:characterId});
    return !error&&object(data)&&data.ok===true&&data.kind==='present';
  } catch { return false; }
}
