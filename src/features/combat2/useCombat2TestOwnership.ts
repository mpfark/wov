import { useEffect, useRef, useState } from 'react';
import { combat2ArenaAccessCheckEnabled, combat2ArenaReservesLegacy } from './test-config';
import { checkCombat2SessionAccess, checkCombat2SessionPreflight, type SessionAccessResult } from './session-access';

export function useCombat2TestOwnership(options: {
  enabled: boolean; characterId: string; nodeId: string | null;
  check?: (id: string,nodeId:string) => Promise<boolean>;
  accessCheck?: (characterId:string,nodeId:string)=>Promise<SessionAccessResult>;
}) {
  const { characterId, nodeId, check = checkCombat2SessionPreflight, accessCheck=checkCombat2SessionAccess } = options;
  const reserved = combat2ArenaReservesLegacy(nodeId);
  const accessEnabled = combat2ArenaAccessCheckEnabled(options.enabled,nodeId);
  const origin = { characterId, nodeId, reserved };
  const accessKey=`${characterId}:${nodeId??''}`;
  const [accessResult,setAccessResult]=useState<{key:string;status:'allowed'|'refused'|'error'}|null>(null);
  const access:'checking'|'allowed'|'refused'|'error'=!accessEnabled?'refused':accessResult?.key===accessKey?accessResult.status:'checking';
  const [preflightResult,setPreflightResult]=useState<{key:string;status:'allowed'|'refused'}|null>(null);
  const preflight:'checking'|'allowed'|'refused'=preflightResult?.key===accessKey?preflightResult.status:'checking';
  const [locked, setLocked] = useState(false);
  const request = useRef<{key:string;promise:Promise<boolean>} | null>(null);
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
    if(!nodeId)return;
    const key=`${characterId}:${nodeId}`;
    if(request.current?.key!==key)request.current={key,promise:check(characterId,nodeId)};
    let active = true;
    const settle=(status:'allowed'|'refused')=>setPreflightResult(previous=>previous?.key===key&&previous.status===status?previous:{key,status});
    void request.current.promise.then(ok => { if (active) settle(ok?'allowed':'refused'); })
      .catch(() => { if (active) settle('refused'); });
    return () => { active = false; };
  }, [access, characterId, check]);
  useEffect(() => { if (!reserved) { request.current=null; setPreflightResult(null); setLocked(false); } }, [reserved, characterId]);
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
