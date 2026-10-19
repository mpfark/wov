import { readFileSync } from 'node:fs';
import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useCombat2VisibleLog } from './useCombat2VisibleLog';
import type { Combat2PresentationModel } from './presentation';
const event={v:1,id:'live',ts:100,type:'system',message:'this session'} as const;
const model={character:{id:'character'},encounterId:'enc',encounterStatus:'active',events:[event]} as unknown as Combat2PresentationModel;
describe('session-only UI log', () => {
 it('does not connect the game page to persistent archive hydration, writes or infinite scrollback', () => {
   const page=readFileSync('src/pages/GamePage.tsx','utf8');
   expect(page).not.toContain('useLogArchive'); expect(page).not.toContain('logArchive.');
   expect(page).not.toContain('olderEvents={');
   expect(readFileSync('src/pages/GameRoute.tsx','utf8')).toContain('key={character.id}');
 });
 it('retains current-session combat lines but starts empty after remount and character change', () => {
   const first=renderHook(({owner,m}) => useCombat2VisibleLog(owner,true,m,[]),{initialProps:{owner:'character',m:model as Combat2PresentationModel|null}});
   expect(first.result.current.events).toEqual([event]);first.rerender({owner:'character',m:null});expect(first.result.current.events).toEqual([event]);
   first.rerender({owner:'other',m:null});expect(first.result.current.events).toEqual([]);first.unmount();
   const next=renderHook(() => useCombat2VisibleLog('character',true,null,[]));expect(next.result.current.events).toEqual([]);
 });
});
