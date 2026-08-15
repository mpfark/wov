import { describe, it, expect } from 'vitest';
import { resolveTickPure } from '@/shared/combat/pure/resolver';
import { randomSnapshot } from '@/test/combat/pure/fixtures';
describe('sweep counters', () => { it('counts', () => {
  let applied=0, pulses=0, live=0, catchup=0, catchupApplied=0, finite=0, infinite=0;
  for (let s=1;s<=4000;s++){
    const snap = randomSnapshot(s);
    const t = resolveTickPure(snap);
    const rows = t.effectUpserts.filter(e=>e.mechanic==='dot_debuff' && (e.abilityKey==='envenom'||e.abilityKey==='ignite'));
    if (snap.mode==='live') live++; else catchup++;
    if (snap.mode!=='live') catchupApplied += rows.length;
    applied += rows.length;
    pulses += t.events.filter(e=>e.type==='stance_pulse').length;
    for (const r of rows) { if (r.expiresAtMs > snap.nowMs && r.expiresAtMs < snap.nowMs+3_600_000) finite++; else infinite++; }
  }
  console.log(JSON.stringify({applied,pulses,live,catchup,catchupApplied,finite,infinite}));
  expect(catchupApplied).toBe(0); expect(infinite).toBe(0); expect(applied).toBeGreaterThan(0); expect(pulses).toBeGreaterThan(0);
}); });
