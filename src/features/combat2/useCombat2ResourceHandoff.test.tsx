import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCombat2ResourceHandoff } from './useCombat2ResourceHandoff';
import { selectCombat2Character } from './presentation-selectors';
import type { Combat2PresentationModel } from './presentation';
import type { Character } from '@/features/character';
const model = (hp: number,tick=1) => ({ encounterId:'enc',lastAppliedTick:tick,
  character:{id:'character',hp,maxHp:16,cp:30,maxCp:30,mp:90,maxMp:100} } as Combat2PresentationModel);
const props = { enabled:true,characterId:'character',nodeId:'node',sessionStatus:'active' as 'active'|'exited'|'idle',model:model(7),readStartedAt:900 };
beforeEach(() => { vi.spyOn(Date,'now').mockReturnValue(1000); });
afterEach(() => vi.restoreAllMocks());
describe('combat resource release handoff', () => {
 it('does not flash stale HP7 after receiving terminal HP0, then accepts a fresh character read', () => {
   const row={id:'character',hp:7,cp:30,mp:90} as Character;
   const view=renderHook(p => selectCombat2Character(true,useCombat2ResourceHandoff(p),row),{initialProps:props});
   view.rerender({...props,model:model(0,2)}); expect(view.result.current.hp).toBe(0);
   view.rerender({...props,sessionStatus:'exited',model:model(0,2)}); expect(view.result.current.hp).toBe(0);
   view.rerender({...props,sessionStatus:'exited',model:model(0,2),readStartedAt:999}); expect(view.result.current.hp).toBe(0);
   view.rerender({...props,sessionStatus:'exited',model:model(0,2),readStartedAt:1001}); expect(view.result.current).toBe(row);
 });
 it('preserves living terminal resources during an unavailable refresh, then permits ordinary OOC regeneration', () => {
   const view=renderHook(p => useCombat2ResourceHandoff(p),{initialProps:props});
   view.rerender({...props,sessionStatus:'exited',model:model(4,2)}); expect(view.result.current?.character.hp).toBe(4);
   vi.spyOn(Date,'now').mockReturnValue(5000);
   view.rerender({...props,sessionStatus:'idle',model:null}); expect(view.result.current?.character.hp).toBe(4);
   view.rerender({...props,sessionStatus:'idle',model:null,readStartedAt:5001}); expect(view.result.current).toBeNull();
 });
 it('drops retained resources on node/character change, disable or a new active entry', () => {
   const view=renderHook(p => useCombat2ResourceHandoff(p),{initialProps:props});
   view.rerender({...props,sessionStatus:'exited',model:model(0,2)}); expect(view.result.current?.character.hp).toBe(0);
   view.rerender({...props,nodeId:'respawn-node',sessionStatus:'idle',model:null}); expect(view.result.current).toBeNull();
   view.rerender({...props}); expect(view.result.current?.character.hp).toBe(7);
   view.rerender({...props,characterId:'other',sessionStatus:'idle'}); expect(view.result.current).toBeNull();
   view.rerender({...props,enabled:false}); expect(view.result.current).toBeNull();
   view.rerender({...props,model:null}); expect(view.result.current).toBeNull();
 });
});

it('retains a terminal first snapshot when the entry releases before any living snapshot was displayed', () => {
 const view=renderHook(p => useCombat2ResourceHandoff(p),{initialProps:{...props,model:null as Combat2PresentationModel|null}});
 view.rerender({...props,sessionStatus:'exited',model:model(0,2)});expect(view.result.current?.character.hp).toBe(0);
 view.rerender({...props,sessionStatus:'exited',model:model(0,2),readStartedAt:1001});expect(view.result.current).toBeNull();
 view.rerender({...props,sessionStatus:'exited',model:model(0,2),readStartedAt:1002});expect(view.result.current).toBeNull();
});
