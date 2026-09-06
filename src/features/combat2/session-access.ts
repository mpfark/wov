import { supabase } from '@/integrations/supabase/client';
import { COMBAT2_TEST_ARENA, isCombat2TestArenaNode } from './arena-identity';

export type SessionAccessResult =
  | { status:'allowed'; arenaId:string; nodeId:string }
  | { status:'refused'; classification:'not_authorized'|'not_test_node' }
  | { status:'error'; classification:'access_check_failed'|'malformed_response'|'transport_error' };
type Client={rpc(name:'combat2_test_session_access',args:{_character_id:string;_node_id:string}):PromiseLike<{data:unknown;error:{message?:string}|null}>};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);

export function decodeSessionAccess(value:unknown, requestedNodeId:string):SessionAccessResult {
  if(!object(value)||typeof value.ok!=='boolean'||typeof value.kind!=='string')return {status:'error',classification:'malformed_response'};
  if(value.ok===false&&value.kind==='not_authorized')return {status:'refused',classification:'not_authorized'};
  if(value.ok===false&&value.kind==='not_test_node')return {status:'refused',classification:'not_test_node'};
  if(value.ok===false&&value.kind==='access_check_failed')return {status:'error',classification:'access_check_failed'};
  if(value.ok===true&&value.kind==='allowed'&&typeof value.arena_id==='string'&&UUID.test(value.arena_id)&&
    value.arena_id.toLowerCase()===COMBAT2_TEST_ARENA.id&&typeof value.node_id==='string'&&UUID.test(value.node_id)&&
    value.node_id.toLowerCase()===requestedNodeId.toLowerCase()&&isCombat2TestArenaNode(value.node_id))
    return {status:'allowed',arenaId:value.arena_id,nodeId:value.node_id};
  return {status:'error',classification:'malformed_response'};
}

export async function checkCombat2SessionAccess(characterId:string,nodeId:string,client:Client={rpc:(name,args)=>supabase.rpc(name as never,args as never)}):Promise<SessionAccessResult>{
  try{const {data,error}=await client.rpc('combat2_test_session_access',{_character_id:characterId,_node_id:nodeId});
    return error?{status:'error',classification:'transport_error'}:decodeSessionAccess(data,nodeId);
  }catch{return {status:'error',classification:'transport_error'};}
}
