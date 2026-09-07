import {act,renderHook} from '@testing-library/react';
import {describe,expect,it,vi} from 'vitest';
import {useCombat2RespawnSession} from './useCombat2RespawnSession';
import {Combat2RespawnError,type Combat2RespawnOutcome} from './respawn';

const C='11111111-1111-4111-8111-111111111111',R='22222222-2222-4222-8222-222222222222';
describe('Combat2 respawn session',()=>{
  it('submits once and refuses duplicate in-flight clicks',async()=>{
    let resolve!:(value:Combat2RespawnOutcome)=>void;
    const respawn=vi.fn(()=>new Promise<Combat2RespawnOutcome>(r=>{resolve=r;}));
    const {result}=renderHook(()=>useCombat2RespawnSession({enabled:true,canSubmit:true,characterId:C,nodeId:'node',adapter:{respawn},generateRequestId:()=>R}));
    let first!:Promise<any>; await act(async()=>{first=result.current.submit();expect((await result.current.submit()).status).toBe('local_refusal');});
    await act(async()=>{resolve({status:'refused',classification:'not_ready',reason:null});await first;});
    expect(respawn).toHaveBeenCalledOnce();
  });
  it('reuses an uncertain request',async()=>{
    const respawn=vi.fn().mockRejectedValueOnce(new Combat2RespawnError('uncertain','offline')).mockResolvedValueOnce({status:'refused',classification:'not_dead',reason:null});
    const {result,rerender}=renderHook(({characterId})=>useCombat2RespawnSession({enabled:true,canSubmit:true,characterId,nodeId:'node',adapter:{respawn},generateRequestId:()=>R}),{initialProps:{characterId:C}});
    await act(async()=>{expect((await result.current.submit()).status).toBe('uncertain');});
    await act(async()=>{expect((await result.current.submit()).status).toBe('refused');});
    expect(respawn).toHaveBeenNthCalledWith(1,C,R);expect(respawn).toHaveBeenNthCalledWith(2,C,R);
    rerender({characterId:'33333333-3333-4333-8333-333333333333'});
  });
  it('discards a late response after a character change',async()=>{
    let resolve!:(value:Combat2RespawnOutcome)=>void;const respawn=vi.fn(()=>new Promise<Combat2RespawnOutcome>(r=>{resolve=r;}));
    const {result,rerender}=renderHook(({characterId})=>useCombat2RespawnSession({enabled:true,canSubmit:true,characterId,nodeId:'node',adapter:{respawn},generateRequestId:()=>R}),{initialProps:{characterId:C}});
    let pending!:Promise<any>;act(()=>{pending=result.current.submit();});
    rerender({characterId:'33333333-3333-4333-8333-333333333333'});
    await act(async()=>{resolve({status:'refused',classification:'not_dead',reason:null});expect((await pending).status).toBe('stale');});
  });
});
