export type Combat2RespawnOutcome =
  | { status: 'respawned'; classification: 'respawned' | 'already_respawned'; destinationNodeId: string; destinationName: string | null; restoredHp: number; goldLost: number }
  | { status: 'not_ready'; classification: 'not_ready'; eligibleAt: string }
  | { status: 'refused'; classification: string; reason: string | null };

export interface Combat2RespawnAdapter {
  respawn(characterId: string, requestId: string): Promise<Combat2RespawnOutcome>;
}

export class Combat2RespawnError extends Error {
  constructor(readonly code: 'uncertain' | 'error', message: string) { super(message); this.name = 'Combat2RespawnError'; }
}

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const record=(value:unknown):Record<string,unknown>|null=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;

export function decodeCombat2Respawn(value:unknown):Combat2RespawnOutcome {
  const row=record(value);
  if(!row||typeof row.ok!=='boolean'||typeof row.kind!=='string') throw new Combat2RespawnError('error','combat2_respawn returned a malformed response');
  if(row.ok&&(row.kind==='respawned'||row.kind==='already_respawned')) {
    if(typeof row.destination_node_id!=='string'||!UUID.test(row.destination_node_id)
      ||typeof row.restored_hp!=='number'||!Number.isSafeInteger(row.restored_hp)||row.restored_hp<1
      ||typeof row.gold_lost!=='number'||!Number.isSafeInteger(row.gold_lost)||row.gold_lost<0)
      throw new Combat2RespawnError('error','combat2_respawn returned an invalid success response');
    return {status:'respawned',classification:row.kind,destinationNodeId:row.destination_node_id,
      destinationName:typeof row.destination_name==='string'?row.destination_name:null,restoredHp:row.restored_hp,goldLost:row.gold_lost};
  }
  if(!row.ok&&row.kind==='not_ready'&&typeof row.eligible_at==='string'&&!Number.isNaN(Date.parse(row.eligible_at)))
    return {status:'not_ready',classification:'not_ready',eligibleAt:row.eligible_at};
  return {status:'refused',classification:row.kind,reason:typeof row.reason==='string'?row.reason:null};
}

export function createCombat2RespawnAdapter(client:{rpc(name:'combat2_respawn',args:Record<string,string>):PromiseLike<{data:unknown;error:{message?:string}|null}>}):Combat2RespawnAdapter {
  return {async respawn(characterId,requestId){
    let response;
    try{response=await client.rpc('combat2_respawn',{_character_id:characterId,_request_id:requestId});}
    catch{throw new Combat2RespawnError('uncertain','Combat2 respawn transport failed');}
    if(response.error)throw new Combat2RespawnError('uncertain','Combat2 respawn transport failed');
    return decodeCombat2Respawn(response.data);
  }};
}
