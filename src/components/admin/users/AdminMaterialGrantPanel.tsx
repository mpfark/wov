import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { ADMIN_MATERIAL_KEYS, materialGrantCap } from '../../../../supabase/functions/_shared/admin-material-grant';

export type MaterialGrantPayload = { character_id:string; request_id:string; material_key:string; amount:number; reason:string };
const active = new Set<string>();
const changed = 'wov-admin-material-grant';
const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export default function AdminMaterialGrantPanel({ actorId, role, characterId, ownerId, deleted, send, refresh }: {
  actorId:string | null; role:'steward'|'overlord'; characterId:string; ownerId:string; deleted:boolean;
  send:(payload:MaterialGrantPayload)=>Promise<{body:any;ok:boolean}>; refresh:()=>Promise<unknown>;
}) {
  const [material,setMaterial]=useState<string>('salvage'),[amount,setAmount]=useState(1),[reason,setReason]=useState('');
  const [pending,setPending]=useState<MaterialGrantPayload|null>(null),[busy,setBusy]=useState(false);
  const [message,setMessage]=useState(''),[storageError,setStorageError]=useState(false),[balances,setBalances]=useState<Record<string,number>>({});
  const key=actorId?`wov.admin-material-grant.v1:${actorId}`:null;
  const scope=useRef(key);scope.current=key;
  const visibleTarget=useRef(characterId);visibleTarget.current=characterId;
  function read() {
    if(!key)return null;
    const raw=sessionStorage.getItem(key);if(!raw)return null;
    const entry=JSON.parse(raw),p=entry.payload;
    if(entry.actor!==actorId||!p||!uuid.test(p.character_id)||!uuid.test(p.request_id)||!ADMIN_MATERIAL_KEYS.includes(p.material_key)
      ||!Number.isInteger(p.amount)||p.amount<1||p.amount>100000||typeof p.reason!=='string'||!p.reason.trim()||p.reason.length>1000)
      throw Error('Invalid pending grant storage.');
    return p as MaterialGrantPayload;
  }
  useEffect(()=>{const recover=()=>{try{setPending(read());setStorageError(false);}catch{setStorageError(true);}};
    setBusy(key?active.has(key):false);setMessage('');recover();window.addEventListener(changed,recover);
    return()=>window.removeEventListener(changed,recover);},[key]);
  async function loadBalances(){
    const target=characterId;
    const {data,error}=await supabase.from('character_materials').select('material_key,count').eq('character_id',target);
    if(error)throw Error('Material balances could not be refreshed.');
    return Object.fromEntries((data||[]).map(x=>[x.material_key,x.count]));
  }
  useEffect(()=>{let alive=true;setBalances({});void loadBalances().then(x=>{if(alive)setBalances(x);}).catch(()=>{if(alive)setMessage('Material balances unavailable.');});return()=>{alive=false;};},[characterId,actorId]);
  const cap=materialGrantCap(role,material),selfDenied=role==='steward'&&actorId===ownerId;
  async function submit(){
    if(!key||active.has(key))return;
    const requestScope=key;
    let payload:MaterialGrantPayload|null;
    try{
      payload=read();
      if(payload&&payload.character_id!==characterId)throw Error(`Select character ${payload.character_id} to retry the original grant.`);
      if(!payload){
        if(deleted||selfDenied||!Number.isInteger(amount)||amount<1||amount>cap||!reason.trim()||reason.trim().length>1000)throw Error('Check grant target, quantity and reason.');
        payload={character_id:characterId,request_id:crypto.randomUUID(),material_key:material,amount,reason:reason.trim()};
        sessionStorage.setItem(key,JSON.stringify({actor:actorId,payload}));window.dispatchEvent(new Event(changed));
      }
    }catch(e){setMessage(e instanceof Error?e.message:'Grant recovery unavailable.');return;}
    active.add(key);setBusy(true);setMessage('');
    try{
      const {body,ok}=await send({...payload});
      const matches=body?.request_id===payload.request_id&&body.character_id===payload.character_id&&body.material_key===payload.material_key&&body.amount===payload.amount;
      if(matches&&body.grant_outcome==='not_committed'){
        sessionStorage.removeItem(key);window.dispatchEvent(new Event(changed));throw Error(body.error||'Grant refused; nothing was granted.');
      }
      if(!ok||!matches||body.error||body.grant_outcome!=='committed'||typeof body.self_grant!=='boolean')throw Error(body?.error||'Grant outcome unknown. Retry the original pending grant.');
      sessionStorage.removeItem(key);window.dispatchEvent(new Event(changed));
      if(scope.current!==requestScope||visibleTarget.current!==payload.character_id)return;
      setMessage(`Grant confirmed: ${payload.amount} ${payload.material_key}${body.self_grant?' (own character, recorded)':''}.`);setReason('');
      try{await refresh();const next=await loadBalances();if(scope.current===requestScope&&visibleTarget.current===payload.character_id)setBalances(next);}
      catch{if(scope.current===requestScope&&visibleTarget.current===payload.character_id)setMessage('Grant committed; balance refresh failed. Refresh Admin data, do not grant again to retry the refresh.');}
    }catch(e){if(scope.current===requestScope)setMessage(e instanceof Error?e.message:'Grant outcome unknown. Retry the pending grant.');}
    finally{active.delete(requestScope);if(scope.current===requestScope)setBusy(false);}
  }
  return <section aria-label="Canonical material grants" className="space-y-2">
    <p className="text-xs">Material grants — {role}. Limit: {cap.toLocaleString()} per action. Known balance: {balances[material]??'unavailable'}.</p>
    {selfDenied&&<p role="alert">Stewards cannot grant materials to their own characters.</p>}
    {storageError&&<p role="alert">Pending grant storage unavailable. New grants are blocked.</p>}
    {pending&&<p>Pending: {pending.amount} {pending.material_key} for {pending.character_id}. Resolve this grant before starting another.</p>}
    <select aria-label="Material" value={material} disabled={!!pending||busy||storageError} onChange={e=>setMaterial(e.target.value)}>
      {ADMIN_MATERIAL_KEYS.map(k=><option key={k} value={k}>{k}</option>)}
    </select>
    <Input aria-label="Material quantity" type="number" min={1} max={cap} value={amount} disabled={!!pending||busy||storageError} onChange={e=>setAmount(Number(e.target.value))}/>
    <Input aria-label="Material grant reason" maxLength={1000} value={reason} disabled={!!pending||busy||storageError} onChange={e=>setReason(e.target.value)}/>
    <Button onClick={()=>void submit()} disabled={!actorId||busy||storageError||(!pending&&(selfDenied||deleted))||(pending?pending.character_id!==characterId:!reason.trim()||!Number.isInteger(amount)||amount<1||amount>cap)}>
      {pending?'Retry pending material grant':'Grant material'}
    </Button>
    {message&&<p role="status">{message}</p>}
  </section>;
}
