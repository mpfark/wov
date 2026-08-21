import { describe, it } from 'vitest';
import { resolveTickPure } from '@/shared/combat/pure/resolver';
import { snapshot, participant, creature } from '@/test/combat/pure/fixtures';
const applier = { abilityKey:'ignite', effectType:'ignite', trigger:'successful_pulse_hit', chance:1, dotPerTick:9, durationMs:33000, intervalMs:2000, maxStacks:5, damageType:'fire', pulseDamage:7 } as any;
describe('probe', () => { it('p', () => {
  const p = participant({ id:'c1' });
  const base = snapshot({ participants:[{...p, buffs:{...p.buffs, stackAppliers:[applier]}}], creatures:[creature({id:'m1',hp:4000,maxHp:4000,ac:1})], engagements:[{creatureId:'m1',characterId:'c1',lastActionAtMs:1_699_999_000_000}] });
  const row: any = { id:'eff-1', lifetime:'timed', targetKind:'creature', targetId:'m1', effectType:'ignite', stacks:1, amountPerTick:9, expiresAtMs: base.nowMs+33000, intervalMs:2000, nextTickAtMs: base.nowMs+2000, damageType:'fire', sourceCharacterId:'c1', isPeriodic:true, ampPct:0, mechanic:'dot_debuff', abilityKey:'ignite', maxStacks:5 };
  const t2 = resolveTickPure({ ...base, nowMs: base.nowMs+2000, tickNumber: base.tickNumber+1, effects:[row] });
  console.log('ticks?', (base as any).ticks, base.mode);
  console.log('upserts2', JSON.stringify(t2.effectUpserts));
  console.log('deletes2', t2.effectDeleteIds);
  console.log('events2', t2.events.map(e=>e.type+':'+e.message));
}); });
