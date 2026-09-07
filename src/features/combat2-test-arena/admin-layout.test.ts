import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const UI=readFileSync('src/components/admin/Combat2TestArenaPanel.tsx','utf8');

describe('Combat2 Test Arena page-local run workflow',()=>{
 it('uses a bounded responsive two-column composition with status first on small screens',()=>{
  expect(UI).toContain('max-w-7xl');expect(UI).toContain('lg:grid-cols-[minmax(0,3fr)_minmax(20rem,2fr)]');
  expect(UI).toContain('order-1 space-y-4 lg:sticky');expect(UI).toContain('order-2 space-y-4 lg:order-1');
 });
 it('keeps recording controls separate from collapsed global controls',()=>{
  expect(UI).toContain('Start recording');expect(UI).toContain('Stop and generate report');
  expect(UI).toContain('<details');expect(UI).toContain('Advanced environment controls');expect(UI).toContain('Start test environment');expect(UI).toContain('Close test environment safely');
  expect(UI).toMatch(/api\.startRun/);expect(UI).toMatch(/api\.startEnvironment/);
 });
 it('uses authoritative run state for controls and retains explicit report pagination',()=>{
  expect(UI).toContain("const recording=report?.status==='recording'");expect(UI).toContain('disabled={recording||!status?.resetEligible||!!busy}');
  expect(UI).toContain('Ordered combat report');expect(UI).toContain('Load more');expect(UI).toContain('loadReport(report.runId,report.returnedThroughSeq,true)');
  expect(UI).not.toMatch(/setInterval|setTimeout|\.from\(['"]combat2_test_run/);
 });
});
