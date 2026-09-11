import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const UI=readFileSync('src/components/admin/Combat2TestArenaPanel.tsx','utf8');
const ADMIN=readFileSync('src/pages/AdminPage.tsx','utf8');

describe('Combat2 Test Arena page-local run workflow',()=>{
 it('uses the available admin width and equal shrinkable desktop columns',()=>{
  expect(UI).not.toMatch(/mx-auto|max-w-/);expect(UI).toContain('grid grid-cols-1 items-start gap-4 lg:grid-cols-2');
  expect(UI).toContain('order-1 min-w-0 space-y-4 lg:sticky');expect(UI).toContain('order-2 min-w-0 space-y-4 lg:order-1');
  expect(ADMIN).toContain('return <Combat2TestArenaPanel />');expect(ADMIN).toContain('<AdminLayout');
 });
 it('keeps recording controls separate from collapsed diagnostics',()=>{
  expect(UI).toContain('Start Recording');expect(UI).toContain('Stop Recording and generate report');
  expect(UI).toContain('<details');expect(UI).toContain('Advanced Diagnostics');
  expect(UI).toMatch(/api\.startRun/);expect(UI).not.toMatch(/api\.startEnvironment/);
 });
 it('uses authoritative run state for controls and retains explicit report pagination',()=>{
  expect(UI).toContain("const recording=report?.status==='recording'");expect(UI).toContain('disabled={recording||!status?.resetEligible||status.activePresenceCount>0||status.arenaLiveClaimCount>0||!!busy}');
  expect(UI).toContain("status.lastDispatcherClassification??'none'");
  expect(UI).toContain('status.arenaLiveClaimCount');
  expect(UI).toContain('Ordered combat report');expect(UI).toContain('Load more');expect(UI).toContain('loadReport(report.runId,report.returnedThroughSeq,true)');
  expect(UI).not.toMatch(/setInterval|setTimeout|\.from\(['"]combat2_test_run/);
 });
 it('keeps controls left, status/report right, and report content locally contained',()=>{
  expect(UI.indexOf('<main')).toBeLessThan(UI.indexOf('Diagnostic recording'));
  expect(UI.indexOf('<aside')).toBeLessThan(UI.indexOf('Current state'));expect(UI.indexOf('<CardTitle>Test Report')).toBeGreaterThan(UI.indexOf('<aside'));
  expect(UI).toContain('min-w-0 overflow-hidden');expect(UI).toContain('min-w-0 break-words border-l-2');
 });
});
