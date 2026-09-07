import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
const SQL=readFileSync('supabase/migrations/20260907105500_fa9113ec-a477-4b9b-ba16-4ca58e6eb836.sql','utf8');
describe('Combat2 Test Arena GM island migration',()=>{
 it('moves exactly the registered five-node plus to exact eastern coordinates',()=>{
  expect(SQL).toContain("arena_id='ffff5000-0000-4000-8000-000000000002'");
  for(const [id,x,y] of [['ffff5010',37,0],['ffff5011',37,-1],['ffff5012',38,0],['ffff5013',37,1],['ffff5014',36,0]] as const){
    expect(SQL).toContain(`WHEN '${id}-0000-4000-8000-000000000001' THEN ${x}`);
    expect(SQL).toContain(`WHEN '${id}-0000-4000-8000-000000000001' THEN ${y}`);
  }
  expect(SQL).toContain('IF moved<>5'); expect(SQL).toContain('coordinate collision');
 });
 it('changes only node coordinates without content, connections, characters, or ordinary nodes',()=>{
  expect(SQL).toMatch(/UPDATE public\.nodes SET\s+x=CASE/);
  expect(SQL).not.toMatch(/UPDATE public\.characters|connections\s*=|region_id\s*=|INSERT INTO public\.nodes|DELETE FROM/);
 });
});
