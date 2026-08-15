import { describe, it } from 'vitest';
import { resolveTickPure } from '@/shared/combat/pure/resolver';
import { snapshot, participant, creature } from '@/test/combat/pure/fixtures';
const ap = { abilityKey:'ignite', effectType:'ignite', trigger:'successful_pulse_hit' as const, chance:1, dotPerTick:4, durationMs:33000, intervalMs:2000, maxStacks:3, damageType:'fire', pulseDamage:7 };
describe('dbg', () => { it('x', () => {
  const p = participant({ id: 'c1' });
  const snap = snapshot({ participants: [{...p, buffs: {...p.buffs, stackAppliers:[ap]}}], creatures:[creature({id:'m1',hp:400,maxHp:400,ac:1})] });
  const t = resolveTickPure(snap);
  console.log(JSON.stringify(t.events.map(e=>e.type)), JSON.stringify(t.effectUpserts));
}); });
