import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { combat2ArenaAccessCheckEnabled, combat2ArenaReservesLegacy } from './test-config';
import { checkCombat2SessionAccess, type SessionAccessResult } from './session-access';

export async function checkSoloColdEntry(characterId: string): Promise<boolean> {
  // Read-only browser preflight, not an authorization boundary. Any ambiguity denies entry.
  const [members, ledParties, sessions] = await Promise.all([
    supabase.from('party_members').select('id').eq('character_id', characterId).eq('status', 'accepted'),
    supabase.from('parties').select('id').eq('leader_id', characterId),
    supabase.from('combat_sessions').select('id').eq('character_id', characterId),
  ]);
  return !members.error && !ledParties.error && !sessions.error
    && Array.isArray(members.data) && members.data.length === 0
    && Array.isArray(ledParties.data) && ledParties.data.length === 0
    && Array.isArray(sessions.data) && sessions.data.length === 0;
}

export function useCombat2TestOwnership(options: {
  enabled: boolean; characterId: string; nodeId: string | null;
  check?: (id: string) => Promise<boolean>;
  accessCheck?: (characterId:string,nodeId:string)=>Promise<SessionAccessResult>;
}) {
  const { characterId, nodeId, check = checkSoloColdEntry, accessCheck=checkCombat2SessionAccess } = options;
  const reserved = combat2ArenaReservesLegacy(nodeId);
  const accessEnabled = combat2ArenaAccessCheckEnabled(options.enabled,nodeId);
  const origin = { characterId, nodeId, reserved };
  const accessKey=`${characterId}:${nodeId??''}`;
  const [accessResult,setAccessResult]=useState<{key:string;status:'allowed'|'refused'|'error'}|null>(null);
  const access:'checking'|'allowed'|'refused'|'error'=!accessEnabled?'refused':accessResult?.key===accessKey?accessResult.status:'checking';
  const [preflight, setPreflight] = useState<'checking' | 'allowed' | 'refused'>('checking');
  const [locked, setLocked] = useState(false);
  const request = useRef<{characterId:string;promise:Promise<boolean>} | null>(null);
  const accessRequest=useRef<{key:string;epoch:number;promise:Promise<SessionAccessResult>}|null>(null);
  const [retryEpoch,setRetryEpoch]=useState(0);
  useEffect(()=>{
    if(!accessEnabled||!nodeId)return;
    let active=true;
    const key=`${characterId}:${nodeId}`;
    if(accessRequest.current?.key!==key||accessRequest.current.epoch!==retryEpoch)
      accessRequest.current={key,epoch:retryEpoch,promise:accessCheck(characterId,nodeId)};
    void accessRequest.current.promise.then(result=>{if(active)setAccessResult({key,status:result.status});}).catch(()=>{if(active)setAccessResult({key,status:'error'});});
    return()=>{active=false;};
  },[accessEnabled,characterId,nodeId,accessCheck,retryEpoch]);
  useEffect(() => {
    if (access!=='allowed') return;
    // Reuse this read-only attempt during Strict Mode effect replay.
    if(request.current?.characterId!==characterId)request.current={characterId,promise:check(characterId)};
    let active = true;
    void request.current.promise.then(ok => { if (active) setPreflight(ok ? 'allowed' : 'refused'); })
      .catch(() => { if (active) setPreflight('refused'); });
    return () => { active = false; };
  }, [access, characterId, check]);
  useEffect(() => { if (!reserved) { request.current=null; setPreflight('checking'); setLocked(false); } }, [reserved, characterId]);
  const blocksLegacy = reserved;
  const combat2OwnsSession = blocksLegacy && access==='allowed' && preflight === 'allowed';
  return {
    blocksLegacy, combat2OwnsSession, preflight, access, rolloutEnabled:accessEnabled,
    locked,
    entryEnabled: combat2OwnsSession && !locked,
    origin,
    lock: () => setLocked(true),
    retryAccess:()=>setRetryEpoch(value=>value+1),
  };
}
