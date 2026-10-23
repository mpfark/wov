import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { useSpecialTravelRequest } from './useSpecialTravelRequest';
beforeEach(()=>sessionStorage.clear());afterEach(cleanup);
const success=(p:any)=>({data:{ok:true,request_id:p._request_id,account_id:'account',character_id:p._character_id,travel_kind:p._kind,destination_node_id:p._destination_node_id,outcome:'committed',cp_cost:10},error:null});
it('persists before dispatch; remount recovers exact UUID/payload without automatic retry or replacement',async()=>{
 const calls:any[]=[];const h=renderHook(()=>useSpecialTravelRequest('account','character'));
 await act(async()=>{await expect(h.result.current.submit('teleport','city',async p=>{expect(sessionStorage.length).toBe(1);calls.push(p);throw Error('timeout');})).rejects.toThrow('timeout');});h.unmount();
 const next=renderHook(()=>useSpecialTravelRequest('account','character'));expect(next.result.current.pending).toEqual(calls[0]);expect(calls).toHaveLength(1);
 await act(async()=>{await expect(next.result.current.submit('waymark','elsewhere',async p=>success(p))).rejects.toThrow('unresolved');});
 await act(async()=>{await next.result.current.submit('teleport','city',async p=>{calls.push(p);return success(p);});});expect(calls[1]).toEqual(calls[0]);expect(next.result.current.pending).toBeNull();
});
it('only a matching explicit outcome clears pending; a refusal permits a fresh UUID',async()=>{
 const h=renderHook(()=>useSpecialTravelRequest('account','character'));let first:any;
 await act(async()=>{await expect(h.result.current.submit('teleport','city',async p=>{first=p;return {data:{...success(p).data,request_id:'wrong'},error:null};})).rejects.toThrow('uncertain');});
 await act(async()=>{await expect(h.result.current.submit('teleport','city',async()=>({data:null,error:{status:400}}))).rejects.toThrow('uncertain');});expect(h.result.current.pending).toEqual(first);
  await act(async()=>{await expect(h.result.current.submit('teleport','city',async p=>({data:{...success(p).data,account_id:'another-account',outcome:'not_committed'},error:null}))).rejects.toThrow('uncertain');});
 await act(async()=>{await h.result.current.submit('teleport','city',async p=>({data:{...success(p).data,ok:false,outcome:'not_committed',kind:'insufficient_cp'},error:null}));});expect(h.result.current.pending).toBeNull();
 await act(async()=>{await h.result.current.submit('teleport','other',async p=>{expect(p._request_id).not.toBe(first._request_id);return success(p);});});
});
it('isolates accounts and characters; storage failure prevents dispatch',async()=>{
 const h=renderHook(()=>useSpecialTravelRequest('one','character'));
 await act(async()=>{await expect(h.result.current.submit('teleport','city',async()=>{throw Error('lost');})).rejects.toThrow();});
 expect(renderHook(()=>useSpecialTravelRequest('two','character')).result.current.pending).toBeNull();
 expect(renderHook(()=>useSpecialTravelRequest('one','other')).result.current.pending).toBeNull();
 sessionStorage.setItem('wov.special-travel.v1:bad:character','{broken');const bad=renderHook(()=>useSpecialTravelRequest('bad','character'));expect(bad.result.current.recoveryError).toBeTruthy();
 let invoked=false;await act(async()=>{await expect(bad.result.current.submit('teleport','city',async p=>{invoked=true;return success(p);})).rejects.toThrow();});expect(invoked).toBe(false);
});
it('blocks competing clicks on one account/character',async()=>{
 const h=renderHook(()=>useSpecialTravelRequest('account','character'));let finish!:()=>void;let count=0;const gate=new Promise<void>(r=>{finish=r;});
 await act(async()=>{const first=h.result.current.submit('teleport','city',async p=>{count++;await gate;return success(p);});expect(await h.result.current.submit('teleport','other',async p=>{count++;return success(p);})).toBeNull();finish();await first;});expect(count).toBe(1);
});
