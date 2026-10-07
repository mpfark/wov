import {afterEach,describe,it,expect,vi} from 'vitest';
import {renderHook} from '@testing-library/react';
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:vi.fn(),functions:{invoke:vi.fn()}}}));
import {parseProgressionRequest} from '../../../../supabase/functions/_shared/progression-command';
import {createProgressionClient,pendingProgressionAction} from '../progression-command';
import {useStatAllocation} from '../hooks/useStatAllocation';
import {supabase} from '@/integrations/supabase/client';
import type {Character} from '@/features/character';
const characterId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',requestId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const common={characterId,requestId,expectedVersion:0};
afterEach(()=>{sessionStorage.clear();vi.clearAllMocks();});
describe('F strict boundary and stable identities',()=>{
 it('accepts only canonical respec and six selected stats',()=>{
  expect(parseProgressionRequest({...common,operation:'respec'})).toEqual({...common,operation:'respec'});
  for(const stat of ['str','dex','con','int','wis','cha'])expect(parseProgressionRequest({...common,operation:'renown',stat})).toEqual({...common,operation:'renown',stat});
  expect(parseProgressionRequest({...common,operation:'renown',stat:'strength'})).toBeNull();
 });
 it.each(['actor','actorId','refund','delta','cost','chance','roll','key','seed','outcome','rank','resourceResult','rpAmount','tokenAmount'])('rejects client %s on both commands',key=>{
  expect(parseProgressionRequest({...common,operation:'respec',[key]:1})).toBeNull();
  expect(parseProgressionRequest({...common,operation:'renown',stat:'str',[key]:1})).toBeNull();
 });
 it.each([{operation:'respec' as const},{operation:'renown' as const,stat:'dex' as const}])('uncertain %j retries original UUID and version',async action=>{
  const read=vi.fn().mockResolvedValue(0),send=vi.fn().mockRejectedValueOnce(Error('uncertain')).mockResolvedValueOnce({kind:'replayed'}),uuid=vi.fn(()=>requestId);
  const client=createProgressionClient(characterId,{read,send},sessionStorage,uuid);
  await expect(client.execute(action)).rejects.toThrow('uncertain');expect(pendingProgressionAction(characterId)).toEqual(action);
  await client.execute(action);expect(send.mock.calls[1][0]).toEqual(send.mock.calls[0][0]);expect(read).toHaveBeenCalledTimes(1);expect(uuid).toHaveBeenCalledTimes(1);
 });
 it('retains uncertain Renown stat when conflicting respec is attempted',async()=>{
  const send=vi.fn().mockRejectedValue(Error('uncertain'));const client=createProgressionClient(characterId,{read:async()=>0,send},sessionStorage,()=>requestId);
  await expect(client.execute({operation:'renown',stat:'wis'})).rejects.toThrow();await expect(client.execute({operation:'respec'})).rejects.toThrow('pending');expect(send).toHaveBeenCalledTimes(1);
 });
 it('a transient rollback retains the original logical request for deterministic retry',async()=>{
  const send=vi.fn().mockResolvedValueOnce({kind:'refused',reason:'invalid_transaction'}).mockResolvedValueOnce({kind:'committed'});
  const client=createProgressionClient(characterId,{read:async()=>0,send},sessionStorage,()=>requestId);
  await expect(client.execute({operation:'renown',stat:'str'})).rejects.toThrow('rolled back');
  await client.execute({operation:'renown',stat:'str'});expect(send.mock.calls[1][0]).toEqual(send.mock.calls[0][0]);
 });
 it('committed Renown failure reports RP spent and refetches authoritatively',async()=>{
  vi.mocked(supabase.rpc).mockResolvedValue({data:{kind:'current',projection:{progressionVersion:0}},error:null} as never);
  vi.mocked(supabase.functions.invoke).mockResolvedValue({data:{kind:'committed',receipt:{outcome:'failure',cost:10}},error:null} as never);
  const log=vi.fn(),refetch=vi.fn();const {result}=renderHook(()=>useStatAllocation({character:{id:characterId} as Character,addLogEvent:log,onResourcesSynced:refetch}));
  expect(await result.current.handleRenown('str')).toBe(true);expect(JSON.stringify(log.mock.calls)).toContain('failure: 10 RP spent');expect(refetch).toHaveBeenCalledTimes(1);
 });
 it('paused respec displays refusal and no optimistic confirmation',async()=>{
  vi.mocked(supabase.rpc).mockResolvedValue({data:{kind:'current',projection:{progressionVersion:0}},error:null} as never);
  vi.mocked(supabase.functions.invoke).mockResolvedValue({data:{kind:'refused',reason:'commands_paused'},error:null} as never);
  const log=vi.fn();const {result}=renderHook(()=>useStatAllocation({character:{id:characterId} as Character,addLogEvent:log}));
  expect(await result.current.handleFullRespec()).toBe(false);expect(JSON.stringify(log.mock.calls)).toContain('paused');expect(JSON.stringify(log.mock.calls)).not.toContain('Respec confirmed');
 });
});
