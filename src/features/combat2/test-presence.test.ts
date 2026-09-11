import {describe,expect,it,vi} from 'vitest';
import {heartbeatCombat2TestPresence} from './session-access';

describe('Combat2 Test Arena presence heartbeat',()=>{
 it('sends identity only and accepts the server classification',async()=>{
  const rpc=vi.fn().mockResolvedValue({data:{ok:true,kind:'present'},error:null});
  await expect(heartbeatCombat2TestPresence('aaaaaaaa-0000-4000-8000-000000000001','bbbbbbbb-0000-4000-8000-000000000001',{rpc})).resolves.toBe(true);
  expect(rpc).toHaveBeenCalledWith('combat2_test_presence_heartbeat',{_arena_id:'aaaaaaaa-0000-4000-8000-000000000001',_character_id:'bbbbbbbb-0000-4000-8000-000000000001'});
  expect(JSON.stringify(rpc.mock.calls)).not.toMatch(/seen|timestamp|active/);
 });
 it('fails closed on refusal, malformed data, and transport failure',async()=>{
  for(const result of [{data:{ok:false,kind:'not_authorized'},error:null},{data:{ok:true},error:null},{data:null,error:{message:'no'}}])
   await expect(heartbeatCombat2TestPresence('a','b',{rpc:vi.fn().mockResolvedValue(result)})).resolves.toBe(false);
 });
});
