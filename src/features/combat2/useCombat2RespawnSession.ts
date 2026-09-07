import {useCallback,useEffect,useRef,useState} from 'react';
import {supabase} from '@/integrations/supabase/client';
import {Combat2RespawnError,createCombat2RespawnAdapter,type Combat2RespawnAdapter,type Combat2RespawnOutcome} from './respawn';

export type Combat2RespawnResult=Combat2RespawnOutcome|{status:'local_refusal'|'stale'|'uncertain'|'error';classification?:string;reason:string};

export function useCombat2RespawnSession(options:{enabled:boolean;canSubmit:boolean;characterId:string|null;nodeId:string|null;
  adapter?:Combat2RespawnAdapter;generateRequestId?:()=>string;onAccepted?(result:Extract<Combat2RespawnOutcome,{status:'respawned'}>):void}) {
  const adapter=options.adapter??createCombat2RespawnAdapter({rpc:(name,args)=>supabase.rpc(name as never,args as never)});
  const generate=options.generateRequestId??(()=>crypto.randomUUID());
  const key=options.enabled&&options.characterId&&options.nodeId?`${options.characterId}:${options.nodeId}`:null;
  const keyRef=useRef(key); keyRef.current=key;
  const [pending,setPending]=useState(false);
  const attempt=useRef<{key:string;requestId:string;inFlight:boolean;uncertain:boolean}|null>(null);
  useEffect(()=>{attempt.current=null;setPending(false);},[key]);
  const run=useCallback(async(current:{key:string;requestId:string;inFlight:boolean;uncertain:boolean}):Promise<Combat2RespawnResult>=>{
    if(!options.canSubmit||!key||!options.characterId)return {status:'local_refusal',classification:'no_session',reason:'Combat2 respawn is not ready'};
    if(current.inFlight)return {status:'local_refusal',classification:'pending',reason:'Combat2 respawn is already pending'};
    current.inFlight=true;setPending(true);
    try{
      const result=await adapter.respawn(options.characterId,current.requestId);
      if(keyRef.current!==current.key)return {status:'stale',reason:'Combat2 respawn response is stale'};
      current.inFlight=false;current.uncertain=false;setPending(false);
      if(result.status==='respawned')options.onAccepted?.(result);
      return result;
    }catch(error){
      current.inFlight=false;current.uncertain=error instanceof Combat2RespawnError&&error.code==='uncertain';setPending(false);
      return {status:current.uncertain?'uncertain':'error',reason:error instanceof Error?error.message:'combat2_respawn failed'};
    }
  },[adapter,key,options.canSubmit,options.characterId,options.onAccepted]);
  const submit=useCallback(()=>{
    if(!key)return Promise.resolve({status:'local_refusal',classification:'no_session',reason:'Combat2 respawn is not ready'} as Combat2RespawnResult);
    if(attempt.current?.inFlight)return Promise.resolve({status:'local_refusal',classification:'pending',reason:'Combat2 respawn is already pending'} as Combat2RespawnResult);
    if(attempt.current?.uncertain)return run(attempt.current);
    const current={key,requestId:generate(),inFlight:false,uncertain:false};attempt.current=current;return run(current);
  },[generate,key,run]);
  const retry=useCallback(()=>attempt.current?.uncertain?run(attempt.current):Promise.resolve({status:'local_refusal',classification:'no_retry',reason:'No uncertain Combat2 respawn can be retried'}),[run]);
  return {submit,retry,pending};
}
