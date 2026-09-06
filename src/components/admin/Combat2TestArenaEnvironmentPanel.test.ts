import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
const UI=readFileSync('src/components/admin/Combat2TestArenaPanel.tsx','utf8');
describe('Combat2 test environment admin panel contract',()=>{
 it('renders authoritative environment state and manual refresh without polling',()=>{
  for(const text of ['Test environment','Combat mode:','World:','Combat2 scheduler:','ordinary encounters','Last start:','Last close:'])expect(UI).toContain(text);
  expect(UI).toContain('manual refresh only'); expect(UI).not.toMatch(/setInterval|setTimeout/);
 });
 it('uses semantic confirmed start and safe-close controls',()=>{
  expect(UI).toContain('Start test environment'); expect(UI).toContain('Close test environment safely');
  expect(UI).toContain('This globally opens Combat2, wakes the world and starts the two-second dispatcher.');
  expect(UI).toContain('Global maintenance and sleep occur only when there is no ordinary activity');
  expect(UI).toContain('status.locatedTesterCount<1');
 });
 it('shares the existing operation lock and stable uncertain-request IDs',()=>{
  expect(UI).toContain('if(busyRef.current)return'); expect(UI).toContain('disabled={!status||status.locatedTesterCount<1||!!busy}');
  expect(UI).toContain('api.startEnvironment(idFor(startRequest))'); expect(UI).toContain('api.closeEnvironment(idFor(closeRequest))');
  expect(UI).toContain('if(!response.uncertain&&stable)stable.current=null');
  expect(UI).toContain("snapshot!==selection.current");
 });
 it('retains existing arena controls',()=>{
  for(const text of ['Grant exact access','Revoke exact access','Relocate tester','Stop test run and preserve evidence','Reset test arena'])expect(UI).toContain(text);
 });
});
