import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
const UI=readFileSync('src/components/admin/Combat2TestArenaPanel.tsx','utf8');
describe('Combat2 test environment admin panel contract',()=>{
 it('renders authoritative environment state and manual refresh without polling',()=>{
  for(const text of ['Arena status','Combat {status.combatMode}','world {status.worldState}','scheduler {status.schedulerEnabled'])expect(UI).toContain(text);
  expect(UI).toContain('Manual refresh:'); expect(UI).not.toMatch(/setInterval|setTimeout/);
 });
 it('keeps environment controls collapsed, advanced and separate from recording',()=>{
  expect(UI).toContain('<details');expect(UI).toContain('Advanced environment controls');
  expect(UI).toContain('Start test environment'); expect(UI).toContain('Close test environment safely');
  expect(UI).toContain('These global controls are operational prerequisites, not part of diagnostic recording.');
  expect(UI).toContain('api.startEnvironment');expect(UI).toContain('api.closeEnvironment');
  expect(UI).toContain('status.locatedTesterCount<1');
 });
 it('shares the existing operation lock and stable uncertain-request IDs',()=>{
  expect(UI).toContain('if(busyRef.current)return'); expect(UI).toContain('disabled={!status||status.locatedTesterCount<1||!!busy}');
  expect(UI).toContain('api.startEnvironment(idFor(environmentStartRequest))'); expect(UI).toContain('api.closeEnvironment(idFor(environmentCloseRequest))');
  expect(UI).toContain('if(stable&&!response.uncertain)stable.current=null');
  expect(UI).toContain("snapshot!==selection.current");
 });
 it('retains existing arena controls',()=>{
  for(const text of ['Grant exact access','Revoke exact access','Relocate tester','Start recording','Stop and generate report','Reset arena'])expect(UI).toContain(text);
 });
});
