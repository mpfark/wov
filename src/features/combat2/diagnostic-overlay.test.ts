import { describe,expect,it } from 'vitest';
import { readFileSync } from 'node:fs';
const GAME=readFileSync('src/pages/GamePage.tsx','utf8');
const OVERLAY=readFileSync('src/components/game/BroadcastDebugOverlay.tsx','utf8');
describe('Combat2 diagnostic overlay boundary',()=>{
 it('is admin-only and replaces the large ordinary gameplay status bar',()=>{
  expect(GAME).toContain('isAdmin && <BroadcastDebugOverlay');
  expect(GAME).not.toContain('<Combat2TestStatus');
 });
 it('keeps a compact state/latency indicator and explicit lifecycle controls',()=>{
  for(const text of ['Recording','Start','Stop','Clear','Export','latency'])expect(OVERLAY).toContain(text);
  expect(OVERLAY).toContain('bottom-3 right-3');
 });
});
