import { describe, it } from 'vitest';
import { resolveTickPure } from '@/shared/combat/pure/resolver';
import { snapshot, participant, creature } from '@/test/combat/pure/fixtures';
const applier = { abilityKey:'ignite', effectType:'ignite', trigger:'successful_pulse_hit', chance:1, dotPerTick:9, durationMs:33000, intervalMs:2000, maxStacks:5, damageType:'fire', pulseDamage:7 } as any;
describe('probe', () => { it('p', () => {
  const p = participant({ id:'c1' });
  const base = snapshot({ participants:[{...p, buffs:{...p.buffs, stackAppliers:[applier]}}], creatures:[creature({id:'m1',hp:4000,maxHp:4000,ac:1})], engagements:[{creatureId:'m1',characterId:'c1',lastActionAtMs:1_699_999_000_000}] });
  const t1 = resolveTickPure(base);
  console.log('upserts', JSON.stringify(t1.effectUpserts, null, 1));
  console.log('deletes', t1.effectDeleteIds, (t1 as any).effectDeleteTargetIds);
  console.log('nowMs', base.nowMs);
}); });
