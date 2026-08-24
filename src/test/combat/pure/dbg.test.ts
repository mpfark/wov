import { it } from 'vitest';
import { resolveTickPure } from '@/shared/combat/pure';
import { creature, participant, snapshot } from '@/test/combat/pure/fixtures';
it('dbg', () => {
  for (const ch of [0.3,0.5,0.7,0.9]) {
    const out = resolveTickPure(snapshot({ participants:[participant()], creatures:[creature({rarity:'boss', bossCast: { abilityKey:'k',castKey:'k',label:'L',castTicks:2,cooldownTicks:5,damage:40,damageAoe:10,damageType:'arcane',targetMode:'tank_preferred',chance:ch,channeling:false,storedPowerCap:0,primaryShare:1,aoeShare:0.4,consumeMode:'all',consumePct:100,consumeFixed:0,pauseAutoattacks:false,lockMs:0,castingText:null,castedText:null } as any })], ticksToSimulate: 60 }));
    console.log(ch, out.events.filter(e=>e.type==='boss_cast_start').length, out.ticksProcessed);
  }
});
