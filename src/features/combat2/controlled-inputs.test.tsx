import { StrictMode, useState } from 'react';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { supabase } from '@/integrations/supabase/client';
import { useKeyboardMovement } from '@/features/world/hooks/useKeyboardMovement';
import { useCombat2ClientSession } from './Combat2ClientSession';
import { BASIC_ATTACK_UNAVAILABLE, refuseControlledBasicAttack } from './controlled-actions';
import { routeCombat2Action } from './routeCombat2Action';
import { useCombat2Targets } from './useCombat2Targets';
import { Combat2TestStatus } from './Combat2TestStatus';
import type { Combat2DeliverySessionState } from './useCombat2DeliverySession';
import type { ClassAbility } from '@/features/combat/utils/class-abilities';
import { buildCombat2Presentation } from './presentation';

const C = 'aaaaaaaa-0000-4000-8000-000000000001';
const E = 'bbbbbbbb-0000-4000-8000-000000000001';
const T = 'cccccccc-0000-4000-8000-000000000001';
let delivery: Combat2DeliverySessionState;
vi.mock('./useCombat2EntrySession', () => ({ useCombat2EntrySession: () => ({ status: 'entered', encounterId: 'bbbbbbbb-0000-4000-8000-000000000001' }) }));
vi.mock('./useCombat2DeliverySession', () => ({ useCombat2DeliverySession: () => delivery }));

function fixture(): Combat2DeliverySessionState {
  return {
    status: 'live', lastAppliedTick: 0, error: null, batches: [], snapshot: {
      ok: true, kind: 'sync', latest_tick: 0, returned_through_tick: 0, has_more: false, batches: [],
      encounter: { id: E, status: 'active', tick: 0, stateVersion: 0 },
      character: { id: C, hp: 10, maxHp: 10, cp: 10, maxCp: 10, mp: 10, maxMp: 10, level: 1, xp: 0, gold: 0 },
      fighter: { id: 'fighter', characterId: C, present: true, entrySeq: 1 }, effects: [], rewardClaims: [],
      creatures: [{ id: 'life-1', creatureId: T, spawnSeq: 1, name: 'Test creature', hp: 10, maxHp: 10, isAlive: true, engaged: false, tankFighterId: null, pendingAction: null }],
    },
  };
}
const options = { enabled: true, controlled: true, characterId: C, nodeId: T, hasLivingCreatures: true };
const ability = { abilityKey: 'fireball', label: 'Fireball', type: 'spell_attack', targetType: 'enemy' } as ClassAbility;
beforeEach(() => {
  delivery = fixture();
  localStorage.clear();
  vi.spyOn(supabase, 'rpc').mockResolvedValue({ error: null, data: { ok: true, kind: 'queued', intent_id: E, seq: 1 } } as never);
});
afterEach(() => vi.restoreAllMocks());

describe('controlled input and display boundary', () => {
  it('visibly refuses the basic button and real keyboard attack binding without either RPC or legacy combat', () => {
    const legacy = vi.fn();
    const diagnosed = vi.fn();
    function Controls() {
      const [message, setMessage] = useState<string | null>(null);
      const basic = () => refuseControlledBasicAttack(true, value => { diagnosed(value); setMessage(value); }, legacy);
      useKeyboardMovement({ currentNode: undefined, nodes: [], onMove: vi.fn(), disabled: false, onAttackFirst: basic });
      return <><button onClick={basic}>Attack</button><Combat2TestStatus status="Ready" stale={false} diagnostic={message} /></>;
    }
    render(<StrictMode><Controls /></StrictMode>);
    fireEvent.click(screen.getByRole('button', { name: 'Attack' }));
    expect(diagnosed).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert')).toHaveTextContent(BASIC_ATTACK_UNAVAILABLE);
    fireEvent.keyDown(document, { key: ' ' });
    expect(diagnosed).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('alert')).toHaveTextContent(BASIC_ATTACK_UNAVAILABLE);
    expect(legacy).not.toHaveBeenCalled();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('preserves legacy basic attack when off', () => {
    const legacy = vi.fn();
    const diagnose = vi.fn();
    refuseControlledBasicAttack(false, diagnose, legacy);
    expect(legacy).toHaveBeenCalledOnce();
    expect(diagnose).not.toHaveBeenCalled();
  });

  it('routes supported abilities and stance activate/drop through the installed adapter exactly once per action', async () => {
    const { result, rerender } = renderHook(() => useCombat2ClientSession(options), { wrapper: StrictMode });
    const legacy = vi.fn();
    const base = { enabled: true, sessionReady: result.current.actionsReady, targetId: T, livingCreatureIds: new Set([T]), reservedBuffs: {}, legacy, submit: result.current.intents.submit, diagnose: vi.fn() };
    await act(async () => {
      await routeCombat2Action({ ...base, ability });
      await routeCombat2Action({ ...base, ability: { ...ability, abilityKey: 'force_shield', type: 'absorb_buff', targetType: 'self' } });
      await routeCombat2Action({ ...base, reservedBuffs: { force_shield: {} }, ability: { ...ability, abilityKey: 'force_shield', type: 'absorb_buff', targetType: 'self' } });
    });
    rerender();
    const args = vi.mocked(supabase.rpc).mock.calls.map(([, args]) => args as Record<string, unknown>);
    expect(args.map(a => a._intent_kind)).toEqual(['ability', 'stance_activate', 'stance_drop']);
    expect(args.map(a => a._target_creature_id)).toEqual([T, null, null]);
    expect(new Set(args.map(a => a._request_id)).size).toBe(3);
    expect(legacy).not.toHaveBeenCalled();
  });

  it.each(['gap', 'error', 'refused', 'reconnecting', 'syncing'] as const)('disables even saved callbacks for %s and renders stale diagnostics', async status => {
    const { result, rerender } = renderHook(() => useCombat2ClientSession(options));
    const submit = result.current.intents.submit;
    delivery = { ...delivery, status, error: 'untrusted internal payload' };
    rerender();
    expect(result.current.actionsReady).toBe(false);
    await act(async () => { await submit({ kind: 'ability', abilityKey: 'fireball', stanceKey: null, targetCreatureId: T }); });
    expect(supabase.rpc).not.toHaveBeenCalled();
    render(<Combat2TestStatus status={status} stale diagnostic="Combat2 synchronization unavailable." />);
    expect(screen.getByRole('status')).toHaveTextContent('Stale display; actions disabled');
    expect(screen.getByRole('alert')).not.toHaveTextContent('untrusted internal payload');
  });

  it('latches authoritative death, blocks intents and rejects a later living snapshot for the same entry', async () => {
    const { result, rerender } = renderHook(() => useCombat2ClientSession(options));
    const oldSubmit = result.current.intents.submit;
    delivery = { ...delivery, snapshot: { ...delivery.snapshot!, character: { ...delivery.snapshot!.character as object, hp: 0 }, fighter: { ...delivery.snapshot!.fighter as object, present: false, exitState: 'dead' } } };
    rerender();
    expect(result.current.dead).toBe(true);
    await act(async () => { await oldSubmit({ kind: 'ability', abilityKey: 'fireball', stanceKey: null, targetCreatureId: T }); });
    delivery = fixture();
    rerender();
    expect(result.current.dead).toBe(true);
    expect(result.current.presentation.model?.character.hp).toBe(0);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('flee pending disables further actions and exit never invokes a movement continuation', async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({ data: { ok: true, kind: 'queued', event_id: E }, error: null } as never);
    const { result } = renderHook(() => useCombat2ClientSession(options));
    await act(async () => { await result.current.flee.flee(); });
    expect(result.current.pendingFlee).toBe(true);
    expect(result.current.actionsReady).toBe(false);
    await act(async () => { await result.current.intents.submit({ kind: 'ability', abilityKey: 'fireball', stanceKey: null, targetCreatureId: T }); });
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
  });

  it('invalidates selection on death, disappearance, new spawn and new encounter', () => {
    const { result, rerender } = renderHook(() => {
      return useCombat2Targets(buildCombat2Presentation(delivery));
    });
    act(() => result.current.select(T));
    expect(result.current.selectedId).toBe(T);
    delivery = { ...delivery, snapshot: { ...delivery.snapshot!, creatures: [{ ...delivery.snapshot!.creatures[0] as object, spawnSeq: 2 }] } };
    rerender();
    expect(result.current.selectedId).toBeNull();
    act(() => result.current.cycle());
    expect(result.current.selectedId).toBe(T);
    delivery = { ...delivery, snapshot: { ...delivery.snapshot!, creatures: [{ ...delivery.snapshot!.creatures[0] as object, hp: 0, isAlive: false }] } };
    rerender();
    expect(result.current.selectedId).toBeNull();
    expect(result.current.livingIds.size).toBe(0);
    delivery = fixture();
    rerender();
    act(() => result.current.select(T));
    delivery = { ...delivery, snapshot: { ...delivery.snapshot!, creatures: [] } };
    rerender();
    expect(result.current.selectedId).toBeNull();
    delivery = fixture();
    rerender();
    act(() => result.current.select(T));
    delivery = { ...delivery, snapshot: { ...delivery.snapshot!, encounter: { ...delivery.snapshot!.encounter, id: T } } };
    rerender();
    expect(result.current.selectedId).toBeNull();
  });
});
