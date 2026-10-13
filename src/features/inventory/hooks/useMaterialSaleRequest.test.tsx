import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { useMaterialSaleRequest } from './useMaterialSaleRequest';
const success=(amount:number, request_id?:string)=>({data:{request_id,gold_remaining:205,amount_sold:amount,material_key:'salvage'},error:null});
beforeEach(() => sessionStorage.clear());
describe('shared production sale caller state transitions',()=>{
 it('lost response then lower stock replays immutable payload; changed amount cannot create another request',async()=>{
  const {result}=renderHook(()=>useMaterialSaleRequest('account', 'c'));const calls:any[]=[];
  await act(async()=>{await expect(result.current.submit('c',5,5,async p=>{calls.push(p);throw new Error('timeout');})).rejects.toThrow('timeout');});
  const id=result.current.pending!.request_id;
  await act(async()=>{await result.current.submit('c',1,0,async p=>{calls.push(p);return success(5,p.request_id);});});
  expect(calls[1]).toEqual(calls[0]);expect(calls[1].request_id).toBe(id);expect(result.current.pending).toBeNull();
 });
 it('explicit matching refusal clears; new amount gets fresh UUID',async()=>{
  const {result}=renderHook(()=>useMaterialSaleRequest('account', 'c'));let first='';let second='';
  await act(async()=>{await expect(result.current.submit('c',5,10,async p=>{first=p.request_id;return {data:null,error:{message:'refused',context:new Response(JSON.stringify({sale_outcome:'not_committed',request_id:p.request_id,error:'insufficient_materials'}),{status:400})}};})).rejects.toBeDefined();});
  expect(result.current.pending).toBeNull();
  await act(async()=>{await result.current.submit('c',2,10,async p=>{second=p.request_id;return success(2,p.request_id);});});expect(second).not.toBe(first);
 });
 it('HTTP400 alone, mismatched refusal and malformed success retain UUID/payload',async()=>{
  const {result}=renderHook(()=>useMaterialSaleRequest('account', 'c'));
  for(const response of [{data:null,error:{context:new Response('{}',{status:400})}},{data:{sale_outcome:'not_committed',request_id:'wrong',error:'refused'},error:null},{data:{gold_remaining:205},error:null}]){
   await act(async()=>{await expect(result.current.submit('c',5,10,async()=>response)).rejects.toBeDefined();});
   expect(result.current.pending?.amount).toBe(5);
  }
  const pending=result.current.pending;
  await act(async()=>{await expect(result.current.submit('other',1,10,async()=>success(1))).rejects.toThrow('matching character');});expect(result.current.pending).toEqual(pending);
 });
 it('immediate repeated clicks produce one call; new sale validates stock',async()=>{
  const {result}=renderHook(()=>useMaterialSaleRequest('account', 'c'));const invoke=vi.fn();
  await act(async()=>{await expect(result.current.submit('c',6,5,invoke)).rejects.toThrow();});expect(invoke).not.toHaveBeenCalled();expect(result.current.pending).toBeNull();
  let finish!:(v:any)=>void;const deferred=new Promise<any>(r=>finish=r);invoke.mockReturnValue(deferred);
  let first!:Promise<any>;
  await act(async()=>{first=result.current.submit('c',5,5,invoke);expect(await result.current.submit('c',5,5,invoke)).toBeNull();});expect(invoke).toHaveBeenCalledTimes(1);
  await act(async()=>{finish(success(5,invoke.mock.calls[0][0].request_id));await first;});expect(result.current.selling).toBe(false);
 });
 it('both panels use tested state machine and expose retry even with zero stock',()=>{
  for(const name of ['BlacksmithPanel','JewelcrafterPanel']){const s=readFileSync('src/features/inventory/components/'+name+'.tsx','utf8');expect(s).toContain('useMaterialSaleRequest(saleUser?.id ?? null, characterId)');expect(s).toContain('submitSale(characterId, sellAmount, salvage');expect(s.indexOf('Retry pending sale')).toBeLessThan(s.indexOf('{salvage === 0 ?'));}
 });
});

describe('actual Edge refusal contract',()=>{
 it('only known post-replay SQL refusals are definitive; generic errors and ambiguous success are not',async()=>{
  const source=readFileSync('supabase/functions/sell-material/index.ts','utf8').replace(/^import .*createClient.*;\r?\n/m,'');
  const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
  for(const [message,definitive] of [['insufficient_materials',true],['sale_credit_failed',true],['sale_target_not_authorized',false],['request_id_conflict',false],['network_failure',false]] as const){
   let handler!:(request:Request)=>Promise<Response>;
   const client={auth:{getUser:async()=>({data:{user:{id:'verified-actor'}}})},rpc:async()=>({data:null,error:{code:'P0001',message}})};
   new Function('Deno','createClient',code)({env:{get:()=>''},serve:(h:typeof handler)=>{handler=h;}},()=>client);
   const response=await handler(new Request('http://local',{method:'POST',headers:{Authorization:'test'},body:JSON.stringify({character_id:'c',material_key:'salvage',amount:5,request_id:'r'})}));
   const body=await response.json();expect(response.status).toBe(400);expect(body.sale_outcome).toBe(definitive?'not_committed':'uncertain');expect(body.request_id).toBe('r');
  }
 });
});

describe('session recovery and authenticated scope',()=>{
 it('remount/reload recovers without automatic execution and replays original UUID',async()=>{
  let h=renderHook(()=>useMaterialSaleRequest('account','c'));let original:any;
  await act(async()=>{await expect(h.result.current.submit('c',5,5,async p=>{original=p;throw new Error('lost');})).rejects.toThrow();});h.unmount();
  h=renderHook(()=>useMaterialSaleRequest('account','c'));expect(h.result.current.pending).toEqual(original);
  const invoke=vi.fn(async p=>success(p.amount,p.request_id));expect(invoke).not.toHaveBeenCalled();
  await act(async()=>{await h.result.current.submit('c',1,0,invoke);});expect(invoke.mock.calls[0][0]).toEqual(original);expect(sessionStorage.length).toBe(0);h.unmount();
 });
 it('other account/character never inherits a request; original account recovers later',async()=>{
  const h=renderHook(({account,character})=>useMaterialSaleRequest(account,character),{initialProps:{account:'a',character:'c'}});let original:any;
  await act(async()=>{await expect(h.result.current.submit('c',5,5,async p=>{original=p;throw new Error('lost');})).rejects.toThrow();});
  h.rerender({account:'b',character:'c'});expect(h.result.current.pending).toBeNull();
  h.rerender({account:'a',character:'other'});expect(h.result.current.pending).toBeNull();
  h.rerender({account:'a',character:'c'});expect(h.result.current.pending).toEqual(original);h.unmount();
 });
 it('unavailable or corrupted storage blocks invocation rather than replacing UUID',async()=>{
  sessionStorage.setItem('wov.material-sale.v1:account:c','bad');const h=renderHook(()=>useMaterialSaleRequest('account','c'));const invoke=vi.fn();
  await act(async()=>{await expect(h.result.current.submit('c',5,5,invoke)).rejects.toThrow();});expect(invoke).not.toHaveBeenCalled();expect(h.result.current.recoveryError).not.toBeNull();h.unmount();
 });
 it('same-tab second mounted panel cannot compete with an in-flight request',async()=>{
  const a=renderHook(()=>useMaterialSaleRequest('account','c')),b=renderHook(()=>useMaterialSaleRequest('account','c'));let finish!:(v:any)=>void;let payload:any;let first!:Promise<any>;
  await act(async()=>{first=a.result.current.submit('c',5,5,async p=>{payload=p;return new Promise(r=>finish=r);});expect(await b.result.current.submit('c',2,5,vi.fn())).toBeNull();});
  await act(async()=>{finish(success(5,payload.request_id));await first;});a.unmount();b.unmount();
 });
});
