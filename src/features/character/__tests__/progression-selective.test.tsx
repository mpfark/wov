import {afterEach, describe, expect, it, vi} from 'vitest';
import {cleanup, render, renderHook, screen, waitFor} from '@testing-library/react';
vi.mock('@/integrations/supabase/client',()=>({supabase:{auth:{getSession:vi.fn()},rpc:vi.fn(),functions:{invoke:vi.fn()},from:vi.fn(()=>({select:()=>({eq:async()=>({data:[]})})}))}}));
import {supabase} from '@/integrations/supabase/client';
import {createProgressionClient, pendingProgressionAction, progressionClient} from '../progression-command';
import {useProgressionAvailability} from '../useProgressionAvailability';
import OrderRecruiterDialog from '../components/OrderRecruiterDialog';
import TrainerPanel from '../components/TrainerPanel';
import type {Character} from '@/features/character';
const character='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',account='owner',uuid='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const fixture={id:character,user_id:account,class:'classless',level:1,str:10,dex:10,con:10,int:10,wis:10,cha:10,unspent_stat_points:3,respec_points:1} as Character;
function available(flags={join:true,allocate:true,respec:true}) {
 vi.mocked(supabase.auth.getSession).mockResolvedValue({data:{session:{user:{id:account}}}} as never);
 vi.mocked(supabase.rpc).mockResolvedValue({data:{kind:'current',projection:{progressionVersion:0},availability:flags},error:null} as never);
}
afterEach(()=>{cleanup();sessionStorage.clear();vi.resetAllMocks();});
describe('selective progression caller boundaries',()=>{
 it('isolates identical character IDs across accounts and preserves exact payload through remount',async()=>{
  const send=vi.fn().mockRejectedValue(Error('timeout'));const transport={read:async()=>0,send};
  await expect(createProgressionClient(account,character,transport,sessionStorage,()=>uuid).execute({allocations:{str:1}})).rejects.toThrow('timeout');
  expect(pendingProgressionAction('other',character)).toBeNull();
  expect(pendingProgressionAction(account,'different')).toBeNull();
  const original=send.mock.calls[0][0];send.mockResolvedValue({kind:'replayed'});
  await createProgressionClient(account,character,transport,sessionStorage,()=>{throw Error('must not mint');}).execute({allocations:{str:1}});
  expect(send.mock.calls[1][0]).toEqual(original);expect(pendingProgressionAction(account,character)).toBeNull();
 });
 it('does not reuse unscoped legacy storage or replace a pending request with new choices',async()=>{
  sessionStorage.setItem(`wov:progression-request:${character}`,JSON.stringify({characterId:character,requestId:uuid,expectedVersion:0,allocations:{str:9}}));
  expect(pendingProgressionAction(account,character)).toBeNull();
  const send=vi.fn().mockRejectedValue(Error('timeout')),c=createProgressionClient(account,character,{read:async()=>0,send},sessionStorage,()=>uuid);
  await expect(c.execute({operation:'respec'})).rejects.toThrow('timeout');
  await expect(c.execute({allocations:{str:1}})).rejects.toThrow('pending');expect(send).toHaveBeenCalledTimes(1);
 });
 it('refuses dispatch after an authenticated account change',async()=>{
  available();vi.mocked(supabase.auth.getSession).mockResolvedValue({data:{session:{user:{id:'other'}}}} as never);
  await expect(progressionClient(account,character).execute({operation:'respec'})).rejects.toThrow('Account changed');
  expect(supabase.functions.invoke).not.toHaveBeenCalled();
 });
 it('retains the original account request if the account changes during the response',async()=>{
  available();
  vi.mocked(supabase.functions.invoke).mockImplementation(async()=>{
   vi.mocked(supabase.auth.getSession).mockResolvedValue({data:{session:{user:{id:'other'}}}} as never);
   return {data:{kind:'committed'},error:null} as never;
  });
  await expect(progressionClient(account,character).execute({operation:'respec'})).rejects.toThrow('Account changed');
  expect(pendingProgressionAction(account,character)).toEqual({operation:'respec'});
  expect(pendingProgressionAction('other',character)).toBeNull();
 });
 it('availability fails closed on old backend and scopes results to panel identity',async()=>{
  available();vi.mocked(supabase.rpc).mockResolvedValue({data:{kind:'current',projection:{progressionVersion:0}},error:null} as never);
  const {result,rerender}=renderHook(({id})=>useProgressionAvailability(account,id,true),{initialProps:{id:character}});
  await waitFor(()=>expect(supabase.rpc).toHaveBeenCalled());expect(result.current.join).toBe(false);
  available();rerender({id:'new-character'});expect(result.current.allocate).toBe(false);
  await waitFor(()=>expect(result.current.allocate).toBe(true));
 });
 it('Recruiter keeps class switching disabled even when joining is enabled',async()=>{
  available();render(<OrderRecruiterDialog accountId={account} characterId={character} currentClass="warrior" hallClass="wizard" open npc={null} onClose={vi.fn()}/>);
  await waitFor(()=>expect(supabase.rpc).toHaveBeenCalled());expect(screen.getByText('Class switching is disabled.')).toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Switch to Wizard'})).toBeDisabled();expect(supabase.functions.invoke).not.toHaveBeenCalled();
 });
 it('Trainer selects no unavailable command and keeps Renown disabled',async()=>{
  available({join:false,allocate:false,respec:false});render(<TrainerPanel open onClose={vi.fn()} character={fixture} equipmentBonuses={{}} addLogEvent={vi.fn()} onBatchAllocateStats={vi.fn()} onFullRespec={vi.fn()} onRenown={vi.fn()}/>);
  await waitFor(()=>expect(supabase.rpc).toHaveBeenCalled());expect(screen.getByRole('tab',{name:'Renown'})).toBeDisabled();
  expect(screen.getByRole('tab',{name:'Allocate'})).toBeDisabled();
  expect(screen.getByText('Allocation and Respec are currently unavailable. Renown remains disabled.')).toBeInTheDocument();
 });
});
