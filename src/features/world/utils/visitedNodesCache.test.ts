import { beforeEach, expect, it, vi } from 'vitest';
const { seed, upsert, rpc }=vi.hoisted(()=>({seed:vi.fn(),upsert:vi.fn(),rpc:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{from:()=>({select:()=>({eq:seed}),upsert}),rpc}}));
beforeEach(()=>{vi.resetModules();seed.mockReset().mockResolvedValue({data:[{node_id:'city'}],error:null});upsert.mockReset().mockResolvedValue({error:null});rpc.mockReset().mockResolvedValue({data:0,error:null});});
it('server-recorded discovery skips duplicate writes but preserves the existing map callback once per node entry',async()=>{
 const {markNodeVisited}=await import('./visitedNodesCache');
 await markNodeVisited('character','city');await markNodeVisited('character','city');expect(upsert).not.toHaveBeenCalled();expect(rpc).toHaveBeenCalledTimes(1);
 await markNodeVisited('character','other');expect(upsert).toHaveBeenCalledTimes(1);expect(rpc).toHaveBeenCalledTimes(2);
});
it('a refused new discovery does not consume a map or mark the cache permanently',async()=>{
 const {markNodeVisited}=await import('./visitedNodesCache');upsert.mockResolvedValueOnce({error:{message:'discovery_requires_presence'}});
 await markNodeVisited('character','other');expect(rpc).not.toHaveBeenCalled();await markNodeVisited('character','other');expect(upsert).toHaveBeenCalledTimes(2);expect(rpc).toHaveBeenCalledOnce();
});
