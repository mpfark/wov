import { supabase } from '@/integrations/supabase/client';
import { COMBAT2_TEST_ARENA } from '@/features/combat2/arena-identity';
export { COMBAT2_TEST_ARENA } from '@/features/combat2/arena-identity';

export const ARENA_RPC_NAMES = [
  'combat2_test_status', 'combat2_test_grant', 'combat2_test_revoke',
  'combat2_test_admin_relocate', 'combat2_test_stop', 'combat2_test_reset',
  'combat2_test_environment_start', 'combat2_test_environment_close',
] as const;

export type ArenaNode = { id: string; purpose: 'staging'|'low'|'equal'|'high_damage'|'boss'; label: string; active: boolean };
export type ArenaAccess = { userId: string; characterId: string; characterName: string; active: boolean; revoked: boolean };
export type ArenaStatus = {
  ok: true; kind: 'status'; arenaId: string; arenaKey: string; label: string; active: boolean; stopped: boolean;
  resetEligible: boolean; nodeCount: number; creatureCount: number; testerCount: number; activeEncounterCount: number;
  claimedEncounterCount: number; pendingIntentCount: number; pendingEventCount: number; diagnosticHistoryExists: boolean;
  combatMode: 'maintenance'|'open'; worldState: 'asleep'|'awake'; schedulerEnabled: boolean; cronJobCount: number;
  locatedTesterCount: number; ordinaryEncounterCount: number; liveClaimCount: number; ordinaryLiveClaimCount: number;
  recentOrdinaryPlayerCount: number;
  nodes: ArenaNode[]; access: ArenaAccess[]; lastOperation?: string;
  lastStartClassification?: string; lastCloseClassification?: string;
};
export type ArenaResult = { ok: boolean; kind: string; counts: Record<string, number>; ids: Record<string, string> };
export type EnvironmentResult = { ok: boolean; kind: 'started'|'already_started'|'closed'|'already_closed'|'arena_stopped_world_left_open'; combatMode?:'maintenance'|'open'; worldState?:'asleep'|'awake'; schedulerEnabled?:boolean; counts:Record<string,number>; ids:Record<string,string> };
export type ArenaApiResult<T> = { value?: T; error?: string; uncertain?: boolean };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const count = (v: unknown): v is number => Number.isFinite(v) && Number.isInteger(v) && (v as number) >= 0;
const bool = (v: unknown): v is boolean => typeof v === 'boolean';

export function decodeArenaStatus(v: unknown): ArenaStatus | null {
  if (!object(v) || v.ok !== true || v.kind !== 'status' || typeof v.arena_id !== 'string' || !UUID.test(v.arena_id) ||
      typeof v.arena_key !== 'string' || typeof v.label !== 'string') return null;
  const booleanKeys = ['active','stopped','reset_eligible','diagnostic_history_exists','scheduler_enabled'] as const;
  const countKeys = ['node_count','creature_count','tester_count','located_tester_count','active_encounter_count','ordinary_encounter_count','claimed_encounter_count','live_claim_count','ordinary_live_claim_count','recent_ordinary_player_count','pending_intent_count','pending_event_count','cron_job_count'] as const;
  if (booleanKeys.some(k=>!bool(v[k])) || countKeys.some(k=>!count(v[k])) || !Array.isArray(v.nodes) || !Array.isArray(v.access)) return null;
  if (!['maintenance','open'].includes(String(v.combat_mode)) || !['asleep','awake'].includes(String(v.world_state))) return null;
  const nodes: ArenaNode[] = [];
  for (const n of v.nodes) {
    if (!object(n) || typeof n.id !== 'string' || !UUID.test(n.id) || !['staging','low','equal','high_damage','boss'].includes(String(n.purpose)) || typeof n.label !== 'string' || !bool(n.active)) return null;
    nodes.push({ id:n.id, purpose:n.purpose as ArenaNode['purpose'], label:n.label, active:n.active });
  }
  const access: ArenaAccess[] = [];
  for (const a of v.access) {
    if (!object(a) || typeof a.user_id !== 'string' || !UUID.test(a.user_id) || typeof a.character_id !== 'string' || !UUID.test(a.character_id) || typeof a.character_name !== 'string' || !bool(a.active) || !bool(a.revoked)) return null;
    access.push({ userId:a.user_id, characterId:a.character_id, characterName:a.character_name, active:a.active, revoked:a.revoked });
  }
  return { ok:true, kind:'status', arenaId:v.arena_id, arenaKey:v.arena_key, label:v.label, active:v.active as boolean,
    stopped:v.stopped as boolean, resetEligible:v.reset_eligible as boolean, nodeCount:v.node_count as number,
    creatureCount:v.creature_count as number, testerCount:v.tester_count as number, activeEncounterCount:v.active_encounter_count as number,
    claimedEncounterCount:v.claimed_encounter_count as number, pendingIntentCount:v.pending_intent_count as number,
    pendingEventCount:v.pending_event_count as number, diagnosticHistoryExists:v.diagnostic_history_exists as boolean,
    combatMode:v.combat_mode as ArenaStatus['combatMode'],worldState:v.world_state as ArenaStatus['worldState'],schedulerEnabled:v.scheduler_enabled as boolean,
    cronJobCount:v.cron_job_count as number,locatedTesterCount:v.located_tester_count as number,ordinaryEncounterCount:v.ordinary_encounter_count as number,
    liveClaimCount:v.live_claim_count as number,ordinaryLiveClaimCount:v.ordinary_live_claim_count as number,recentOrdinaryPlayerCount:v.recent_ordinary_player_count as number,
    nodes, access, ...(typeof v.last_operation==='string'?{lastOperation:v.last_operation}:{}),
    ...(typeof v.last_start_classification==='string'?{lastStartClassification:v.last_start_classification}:{}),
    ...(typeof v.last_close_classification==='string'?{lastCloseClassification:v.last_close_classification}:{}) };
}

export function decodeEnvironmentResult(v:unknown):EnvironmentResult|null {
 const kinds=['started','already_started','closed','already_closed','arena_stopped_world_left_open'] as const;
 if(!object(v)||v.ok!==true||!kinds.includes(v.kind as typeof kinds[number]))return null;
 if(v.combatMode!==undefined&&!['maintenance','open'].includes(String(v.combatMode)))return null;
 if(v.worldState!==undefined&&!['asleep','awake'].includes(String(v.worldState)))return null;
 if(v.schedulerEnabled!==undefined&&!bool(v.schedulerEnabled))return null;
 const counts:Record<string,number>={};
 for(const [key,value] of Object.entries(v))if(key.endsWith('Count')){if(!count(value))return null;counts[key]=value;}
 return {ok:true,kind:v.kind as EnvironmentResult['kind'],counts,ids:{},...(v.combatMode?{combatMode:v.combatMode as EnvironmentResult['combatMode']}:{}),...(v.worldState?{worldState:v.worldState as EnvironmentResult['worldState']}:{}),...(v.schedulerEnabled!==undefined?{schedulerEnabled:v.schedulerEnabled as boolean}:{})};
}

export function decodeArenaResult(v: unknown): ArenaResult | null {
  if (!object(v) || !bool(v.ok) || typeof v.kind !== 'string' || !/^[a-z][a-z0-9_]*$/.test(v.kind)) return null;
  const counts: Record<string,number> = {}; const ids: Record<string,string> = {};
  for (const [k,x] of Object.entries(v)) {
    if (k==='ok'||k==='kind') continue;
    if (count(x)) counts[k]=x; else if (typeof x==='string' && UUID.test(x)) ids[k]=x;
  }
  return { ok:v.ok, kind:v.kind, counts, ids };
}

type Rpc = (name: string, args: Record<string, unknown>) => PromiseLike<{data:unknown;error:{message?:string}|null}>;
export function createArenaAdminApi(rpc: Rpc = (name,args)=>supabase.rpc(name as never,args as never)) {
  const call = async <T>(name: typeof ARENA_RPC_NAMES[number], args: Record<string,unknown>, decode:(v:unknown)=>T|null): Promise<ArenaApiResult<T>> => {
    try { const {data,error}=await rpc(name,args); if(error) return {error:'Arena request failed.',uncertain:true}; const value=decode(data); if(value)return {value};
      if(object(data)&&data.ok===false&&typeof data.kind==='string'&&/^[a-z][a-z0-9_]*$/.test(data.kind))return {error:`Arena refused: ${data.kind}.`};
      return {error:'Arena returned a malformed response.'}; }
    catch { return {error:'Arena request failed.',uncertain:true}; }
  };
  return {
    status:()=>call('combat2_test_status',{_arena_id:COMBAT2_TEST_ARENA.id},decodeArenaStatus),
    grant:(userId:string,characterId:string)=>call('combat2_test_grant',{_arena_id:COMBAT2_TEST_ARENA.id,_user_id:userId,_character_id:characterId},decodeArenaResult),
    revoke:(userId:string,characterId:string)=>call('combat2_test_revoke',{_arena_id:COMBAT2_TEST_ARENA.id,_user_id:userId,_character_id:characterId},decodeArenaResult),
    relocate:(characterId:string,nodeId:string)=>call('combat2_test_admin_relocate',{_arena_id:COMBAT2_TEST_ARENA.id,_character_id:characterId,_destination_node_id:nodeId},decodeArenaResult),
    stop:(requestId:string)=>call('combat2_test_stop',{_arena_id:COMBAT2_TEST_ARENA.id,_request_id:requestId},decodeArenaResult),
    reset:(requestId:string)=>call('combat2_test_reset',{_arena_id:COMBAT2_TEST_ARENA.id,_request_id:requestId,_confirm_destroy_diagnostics:true},decodeArenaResult),
    startEnvironment:(requestId:string)=>call('combat2_test_environment_start',{_arena_id:COMBAT2_TEST_ARENA.id,_request_id:requestId},decodeEnvironmentResult),
    closeEnvironment:(requestId:string)=>call('combat2_test_environment_close',{_arena_id:COMBAT2_TEST_ARENA.id,_request_id:requestId},decodeEnvironmentResult),
  };
}
