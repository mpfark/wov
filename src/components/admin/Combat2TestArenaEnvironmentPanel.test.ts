import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
const UI=readFileSync('src/components/admin/Combat2TestArenaPanel.tsx','utf8');
describe('Combat2 test environment admin panel contract',()=>{
 it('renders authoritative environment state and manual refresh without polling',()=>{
  for(const text of ['Current state','Combat {status.combatMode}','world {status.worldState}','scheduler {status.schedulerEnabled'])expect(UI).toContain(text);
  expect(UI).toContain('Refresh'); expect(UI).not.toMatch(/setInterval|setTimeout/);
 });
 it('removes manual lifecycle controls and collapses diagnostics',()=>{
  expect(UI).toContain('<details');expect(UI).toContain('Advanced Diagnostics');
  for(const text of ['Start test environment','Close test environment safely','api.startEnvironment','api.closeEnvironment','api.stop('])expect(UI).not.toContain(text);
 });
 it('shares the existing operation lock and stable uncertain-request IDs',()=>{
  expect(UI).toContain('if(busyRef.current)return');
  expect(UI).toContain('if(!response.uncertain)stable.current=null');
  expect(UI).toContain('finally{busyRef.current=false;if(mounted.current)setBusy(null);}');
 });
 it('keeps emergency stop available during recording and independently structured',()=>{
  expect(UI).toContain("api.emergencyShutdown(idFor(emergencyRequest))");
  expect(UI).toContain('disabled={!!busy}');
 });
 it('retains existing arena controls',()=>{
  for(const text of ['Start Recording','Stop Recording and generate report','Reset Arena','Emergency Shutdown'])expect(UI).toContain(text);
 });
 it('describes recording stop as report-only and keeps terminal cleanup in finally',()=>{
  expect(UI).toContain('finally{busyRef.current=false;if(mounted.current)setBusy(null);}');
  expect(UI).toContain("previous?.status==='completed'");
  expect(UI).toContain("if(name==='run-stop')");
  expect(UI).toContain("status:'completed'");
 });
});
