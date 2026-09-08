import { describe,expect,it } from 'vitest';
import { arenaReportEventText } from './Combat2TestArenaPanel';

describe('Combat2 Test Arena final-ability report formatting',()=>{
  it('shows actors, targets and requested/applied/capped restoration evidence',()=>{
    expect(arenaReportEventText({kind:'party_restore',abilityKey:'inspire',actor:{name:'Bard'},target:{name:'Ally'},amount:4,meta:{hpRequested:8,hpApplied:4,hpWasted:4,cpRequested:3,cpApplied:2,cpWasted:1}}))
      .toContain('Bard: party_restore inspire → Ally (4) [hpRequested=8, hpApplied=4, hpWasted=4, cpRequested=3, cpApplied=2, cpWasted=1]');
  });
  it('shows transfer and shield consumption without raw effect state',()=>{
    expect(arenaReportEventText({kind:'hp_transfer',abilityKey:'transfer_health',actor:{name:'Healer'},target:{name:'Ally'},amount:5,meta:{requested:8,applied:5,wasted:3,removedFromCaster:8}})).toContain('removedFromCaster=8');
    expect(arenaReportEventText({kind:'absorb',abilityKey:'divine_aegis',target:{name:'Ally'},amount:7,meta:{remaining:3,depleted:false}})).toContain('remaining=3, depleted=false');
  });
});
