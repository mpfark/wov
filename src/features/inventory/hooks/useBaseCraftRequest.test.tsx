import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useBaseCraftRequest } from './useBaseCraftRequest';
const item='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002';
const success=(p:any)=>({data:{...p,craft_outcome:'committed',inventory_id:other,gold_remaining:95},error:null});
beforeEach(()=>sessionStorage.clear());
it('persists before dispatch, recovers after remount, explicitly replays exact payload despite lower stock',async()=>{
 let h=renderHook(()=>useBaseCraftRequest('a','c'));let original:any;
 await act(async()=>{await expect(h.result.current.submit(item,true,async p=>{original=p;expect(JSON.parse(sessionStorage.getItem('wov.base-craft.v1:a:c')!).payload).toEqual(p);throw Error('timeout');})).rejects.toThrow('timeout');});
 h.unmount();const invoke=vi.fn(async (p:any)=>success(p));h=renderHook(()=>useBaseCraftRequest('a','c'));expect(h.result.current.pending).toEqual(original);expect(invoke).not.toHaveBeenCalled();
 await act(async()=>{await h.result.current.submit(null,false,invoke);});expect(invoke).toHaveBeenCalledWith(original);expect(h.result.current.pending).toBeNull();
});
it('only matching explicit refusal clears; next new craft gets a fresh UUID',async()=>{
 const h=renderHook(()=>useBaseCraftRequest('a','c'));let first='';
 await act(async()=>{await expect(h.result.current.submit(item,true,async p=>{first=p.completion_id;return {data:null,error:{context:new Response(JSON.stringify({...p,craft_outcome:'not_committed',error:'craft_insufficient_materials'}),{status:400})}};})).rejects.toThrow('craft_insufficient_materials');});
 expect(h.result.current.pending).toBeNull();
 await act(async()=>{await h.result.current.submit(other,true,async p=>{expect(p.completion_id).not.toBe(first);return success(p);});});
});
it('HTTP status, malformed success and nonmatching refusals retain pending UUID',async()=>{
 const h=renderHook(()=>useBaseCraftRequest('a','c'));let id='';
 for(const response of [{data:null,error:{context:new Response('{}',{status:400})}},{data:{craft_outcome:'not_committed',completion_id:'wrong'},error:null},{data:{gold_remaining:95},error:null}]){
  await act(async()=>{await expect(h.result.current.submit(item,true,async p=>{if(id)expect(p.completion_id).toBe(id);id=p.completion_id;return response;})).rejects.toBeDefined();});expect(h.result.current.pending?.completion_id).toBe(id);
 }
 const invoke=vi.fn();await expect(h.result.current.submit(other,true,invoke)).rejects.toThrow('Resolve');expect(invoke).not.toHaveBeenCalled();
});
it('new crafts validate affordability, account/character scopes never recover another request',async()=>{
 const h=renderHook(({a,c})=>useBaseCraftRequest(a,c),{initialProps:{a:'a',c:'c'}});const invoke=vi.fn();await expect(h.result.current.submit(item,false,invoke)).rejects.toThrow('Insufficient');
 await act(async()=>{await expect(h.result.current.submit(item,true,async()=>{throw Error('network');})).rejects.toThrow();});
 h.rerender({a:'b',c:'c'});expect(h.result.current.pending).toBeNull();h.rerender({a:'a',c:'d'});expect(h.result.current.pending).toBeNull();h.rerender({a:'a',c:'c'});expect(h.result.current.pending).not.toBeNull();
});
it('repeated clicks across mounted callers cannot dispatch competing requests',async()=>{
 const a=renderHook(()=>useBaseCraftRequest('a','c')),b=renderHook(()=>useBaseCraftRequest('a','c'));let finish!:(v:any)=>void;let p:any;let task!:Promise<any>;
 act(()=>{task=a.result.current.submit(item,true,x=>{p=x;return new Promise(r=>{finish=r;});});});
 const invoke=vi.fn();await act(async()=>{await b.result.current.submit(item,true,invoke);});expect(invoke).not.toHaveBeenCalled();await act(async()=>{finish(success(p));await task;});
});
