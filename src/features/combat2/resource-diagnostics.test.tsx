import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import NodeView from '@/features/world/components/NodeView';
import StatusBarsStrip from '@/features/character/components/StatusBarsStrip';
import { getEffectiveMaxHp } from '@/lib/game-data';
import type { Character } from '@/features/character/hooks/useCharacter';
import { useCombat2ResourceCapture } from './useCombat2ResourceCapture';
import { startCombat2Recording, stopCombat2Recording, recoverableCombat2Recording, recordCombat2ClientEvent,
  recordCombat2ResourceState as record, buildCombat2DiagnosticExport, diagnosticPlayerResources,
  COMBAT2_DIAGNOSTIC_MAX_RESOURCE_SNAPSHOTS as LIMIT, COMBAT2_DIAGNOSTIC_MAX_RESOURCE_CREATURES as CREATURE_LIMIT,
  type Combat2ResourceInput } from './diagnostics';
const input = (overrides: Partial<Combat2ResourceInput> = {}): Combat2ResourceInput => ({ characterId: 'player',
  nodeId: 'node', source: 'test_receive', layer: 'client_received', player: { hp: 10, maxHp: 20, cp: 50, maxCp: 100, mp: 30, maxMp: 100 }, ...overrides });
const snapshots = () => recoverableCombat2Recording()?.resourceSnapshots ?? [];
beforeEach(() => { sessionStorage.clear(); vi.restoreAllMocks(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); sessionStorage.clear(); });
describe('bounded resource evidence', () => {
  it('does no capture work while inactive and scopes observations to the recorded character', () => {
    const lazy = vi.fn(() => input()); record(lazy); expect(lazy).not.toHaveBeenCalled();
    startCombat2Recording('player','node',null); record(input({ characterId: 'other' })); expect(snapshots()).toHaveLength(0);
    record(input()); stopCombat2Recording(); record(input({ player: { hp: 5 } })); expect(snapshots()).toHaveLength(1);
  });
  it('keeps browser provenance and numeric allowlists, including over-cap values, without raw payloads', () => {
    startCombat2Recording('player','node',null);
    record(input({ player: { ...diagnosticPlayerResources({ hp: 25, max_hp: 20, cp: Infinity }), secret: 'DO_NOT_EXPORT' } as any,
      creatures: [{ id: 'creature', hp: -1, maxHp: 100, secret: 'DO_NOT_EXPORT' } as any] }));
    expect(snapshots()[0]).toMatchObject({ side: 'client', layer: 'client_received', player: { hp: 25, maxHp: 20, cp: null }, creatures: [{ hp: -1 }] });
    expect(JSON.stringify(snapshots())).not.toContain('DO_NOT_EXPORT');
    record(input({ layer: 'authoritative_server' as any })); expect(snapshots()).toHaveLength(1);
  });
  it('deduplicates unchanged samples but preserves node, encounter, tick/version changes and backwards values', () => {
    startCombat2Recording('player','node',null); record(input()); record(input({ sourceUpdatedAt: 'later', readStartedAt: 2 }));
    expect(snapshots()).toHaveLength(1);
    record(input({ encounterId: 'enc', tick: 8, stateVersion: 9, player: { hp: 15 } }));
    record(input({ encounterId: 'enc', tick: 7, stateVersion: 8, player: { hp: 5 } }));
    record(input({ nodeId: 'other-node' }));
    expect(snapshots().map(s => s.player?.hp)).toEqual([10,15,5,10]);
    expect(snapshots()[2]).toMatchObject({ tick: 7, stateVersion: 8, wallTime: expect.any(String), monotonicMs: expect.any(Number) });
  });
  it('bounds resource samples and creatures independently without evicting existing diagnostic events', () => {
    startCombat2Recording('player','node',null); recordCombat2ClientEvent({ event: 'action_clicked' });
    const creatures = Array.from({ length: CREATURE_LIMIT+3 },(_,i) => ({ id: String(i),hp: i,maxHp: 100 }));
    for(let tick=0;tick<LIMIT+2;tick++) record(input({ tick, creatures }));
    expect(snapshots()).toHaveLength(LIMIT); expect(snapshots()[0].omittedCreatures).toBe(3);
    expect(snapshots()[0].creatures).toHaveLength(CREATURE_LIMIT);
    expect(recoverableCombat2Recording()).toMatchObject({ droppedResourceSnapshots: 2, events: { length: 1 } });
  });
  it('retains stopped samples in normal and client-only exports alongside existing events and clock warnings', () => {
    startCombat2Recording('player','node','enc'); recordCombat2ClientEvent({ event: 'action_clicked',requestId: 'req' });
    record(input({ layer: 'ui_displayed', encounterId: 'enc', tick: 1 })); stopCombat2Recording();
    const retained = recoverableCombat2Recording()!;
    const out = buildCombat2DiagnosticExport(retained,[{ side:'server',event:'commit_completed',wallTime:'2020-01-01T00:00:00Z',tick:1,encounterId:'enc' }]);
    expect(out.resourceSnapshots).toHaveLength(1); expect(out.correlatedTimeline).toHaveLength(3);
    expect(out.metadata.resourceEvidence).toContain('not independently verified server state');
    expect(out.metadata.note).toContain('independent');
    expect(buildCombat2DiagnosticExport(retained).resourceSnapshots).toEqual(out.resourceSnapshots);
  });
  it('contains storage and snapshot-builder failures without affecting gameplay or the retained recording', () => {
    startCombat2Recording('player','node',null); const original = sessionStorage.getItem('combat2-diagnostic-recording-v1');
    const spy = vi.spyOn(Storage.prototype,'setItem').mockImplementation(() => { throw Error('quota'); });
    expect(() => record(input())).not.toThrow(); spy.mockRestore();
    expect(sessionStorage.getItem('combat2-diagnostic-recording-v1')).toBe(original);
    expect(() => record(() => { throw Error('observer failed'); })).not.toThrow();
  });
  it('captures current component values at Start and on changes without polling, notifications or render loops', () => {
    const builder = vi.fn((hp: number) => input({ layer: 'ui_displayed',player: {hp} }));
    const { rerender } = renderHook(({hp}) => useCombat2ResourceCapture(() => builder(hp)),{initialProps:{hp:10}});
    expect(builder).not.toHaveBeenCalled(); const listener = vi.fn(); window.addEventListener('combat2-diagnostic-change',listener);
    act(() => { startCombat2Recording('player','node',null); }); expect(snapshots()).toHaveLength(1);
    rerender({hp:10}); expect(snapshots()).toHaveLength(1); rerender({hp:9}); expect(snapshots()).toHaveLength(2);
    expect(listener).toHaveBeenCalledTimes(1); window.removeEventListener('combat2-diagnostic-change',listener);
    act(() => { stopCombat2Recording(); }); rerender({hp:7}); expect(snapshots()).toHaveLength(2);
  });
  it('captures actual status-bar maxima and spendable CP, leaving raw CP distinct from the displayed amount', () => {
    const character = { id:'player',current_node_id:'node',class:'warrior',level:1,con:10,int:10,wis:10,dex:10,
      hp:12,max_hp:999,cp:50,max_cp:999,mp:30,max_mp:999,xp:0,bhp:0 } as Character;
    const renderBars = (hp: number) => <TooltipProvider><StatusBarsStrip character={{...character,hp}} equipmentBonuses={{}}
      reservedCp={5} stanceReservedCp={10} diagnosticContext={{encounterId:'enc',tick:3,stateVersion:4}} /></TooltipProvider>;
    const view = render(renderBars(12)); act(() => { startCombat2Recording('player','node','enc'); });
    expect(screen.getByText('12/'+getEffectiveMaxHp('warrior',10,1,{}))).toBeInTheDocument();
    expect(snapshots()[0]).toMatchObject({ source:'status_bars',layer:'ui_displayed',encounterId:'enc',tick:3,
      player: {hp:12,maxHp:getEffectiveMaxHp('warrior',10,1,{}),cp:50,displayedCp:35,reservedCp:10,queuedCp:5} });
    view.rerender(renderBars(8)); expect(snapshots().at(-1)?.player?.hp).toBe(8);
  });
});

it('captures rendered creature overrides and node transitions rather than mislabelling roster HP as displayed', () => {
  const player = {id:'player',current_node_id:'node',class:'warrior',level:1} as Character;
  const creature = {id:'creature',name:'Wolf',hp:17,max_hp:80,spawn_seq:2,is_alive:true,rarity:'common',level:1,stats:{}};
  const view = (id: string,hp: number) => <TooltipProvider><NodeView node={{id,name:'Room',description:'',connections:[]} as any}
    region={undefined} players={[]} creatures={[creature] as any} character={{...player,current_node_id:id}} eventLog={[]}
    onAttack={() => undefined} onTalkToNPC={() => undefined} creatureHpOverrides={{creature:hp}}
    statusBarsProps={{equipmentBonuses:{},diagnosticContext:{encounterId:'enc',tick:4}}} /></TooltipProvider>;
  const rendered=render(view('node',4)); act(() => { startCombat2Recording('player','node','enc'); });
  expect(screen.getByText('4/80')).toBeInTheDocument();
  expect(snapshots().find(s => s.source==='node_view')).toMatchObject({layer:'ui_displayed',nodeId:'node',tick:4,
    creatures:[{id:'creature',spawnSeq:2,hp:4,maxHp:80}]});
  rendered.rerender(view('destination',3));
  expect(snapshots().filter(s => s.source==='node_view').at(-1)).toMatchObject({nodeId:'destination',creatures:[{hp:3}]});
});
