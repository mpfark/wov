import { describe,expect,it,vi } from 'vitest';
import { checkCombat2SessionPreflight } from './session-access';

describe('Combat2 authoritative party preflight',()=>{
  it('accepts only the allowlisted eligible classification',async()=>{
    const rpc=vi.fn().mockResolvedValue({data:{ok:true,kind:'eligible',party_member:true},error:null});
    await expect(checkCombat2SessionPreflight('character','node',{rpc})).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith('combat2_party_preflight',{_character_id:'character',_node_id:'node'});
  });
  it.each([
    {data:{ok:false,kind:'party_not_authorized'},error:null},
    {data:{ok:true,kind:'allowed'},error:null},
    {data:null,error:{message:'private detail'}},
  ])('fails closed for refusal, malformed and transport results',async response=>{
    await expect(checkCombat2SessionPreflight('character','node',{rpc:vi.fn().mockResolvedValue(response)})).resolves.toBe(false);
  });
});
