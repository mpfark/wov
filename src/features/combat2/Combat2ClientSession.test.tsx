import { readFileSync } from 'node:fs';
import { act, render, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { supabase } from '@/integrations/supabase/client';
import { Combat2ClientSession, useCombat2ClientSession } from './Combat2ClientSession';

const CHARACTER = 'aaaaaaaa-0000-4000-8000-000000000001';
const NODE = 'eeeeeeee-0000-4000-8000-000000000001';
const NODE_2 = 'eeeeeeee-0000-4000-8000-000000000002';
const ENCOUNTER = 'bbbbbbbb-0000-4000-8000-000000000001';
const ENCOUNTER_2 = 'bbbbbbbb-0000-4000-8000-000000000002';

afterEach(() => vi.restoreAllMocks());

describe('Combat2ClientSession application bridge', () => {
  it('does zero entry and delivery work while the shared gate is disabled', () => {
    const rpc = vi.spyOn(supabase, 'rpc');
    const channel = vi.spyOn(supabase, 'channel');
    const view = render(<Combat2ClientSession enabled={false} characterId={CHARACTER} nodeId={NODE} hasLivingCreatures />);
    expect(rpc).not.toHaveBeenCalled();
    expect(channel).not.toHaveBeenCalled();
    expect(view.container).toBeEmptyDOMElement();
    view.unmount();
  });

  it('unsubscribes old delivery before activating a new node encounter', async () => {
    let entryCount = 0;
    vi.spyOn(supabase, 'rpc').mockImplementation((async (name: string, args: Record<string, unknown>) => {
      if (name === 'combat_enter') {
        entryCount += 1;
        return { data: { ok: true, kind: 'entered', encounter_id: entryCount === 1 ? ENCOUNTER : ENCOUNTER_2 }, error: null };
      }
      if (name === 'combat2_sync') {
        const encounterId = args._encounter_id as string;
        return { data: {
          ok: true, kind: 'sync', latest_tick: 0, returned_through_tick: 0, has_more: false,
          encounter: { id: encounterId, status: 'active', tick: 0, stateVersion: 0 },
          character: {}, fighter: null, creatures: [], effects: [], rewardClaims: [], batches: [],
        }, error: null };
      }
      throw new Error(`unexpected RPC ${name}`);
    }) as never);
    const channels: Array<{ on: ReturnType<typeof vi.fn>; subscribe: ReturnType<typeof vi.fn> }> = [];
    const channelSpy = vi.spyOn(supabase, 'channel').mockImplementation((() => {
      const channel = {
        on: vi.fn(() => channel),
        subscribe: vi.fn(() => channel),
      };
      channels.push(channel);
      return channel;
    }) as never);
    const remove = vi.spyOn(supabase, 'removeChannel').mockResolvedValue('ok');

    const view = render(<Combat2ClientSession enabled characterId={CHARACTER} nodeId={NODE} hasLivingCreatures />);
    await waitFor(() => expect(channels).toHaveLength(1));
    view.rerender(<Combat2ClientSession enabled characterId={CHARACTER} nodeId={NODE_2} hasLivingCreatures />);
    await waitFor(() => expect(channels).toHaveLength(2));
    expect(remove).toHaveBeenCalledWith(channels[0]);
    expect(remove.mock.invocationCallOrder[0]).toBeLessThan(channelSpy.mock.invocationCallOrder[1]);
    view.unmount();
  });

  it('authoritative flee exits only that session, stops delivery, preserves batches, and blocks intents', async () => {
    const eventId = 'cccccccc-0000-4000-8000-000000000001';
    const rpc = vi.spyOn(supabase, 'rpc').mockImplementation((async (name: string, args: Record<string, unknown>) => {
      if (name === 'combat_enter') return { data: { ok: true, kind: 'entered', encounter_id: ENCOUNTER }, error: null };
      if (name === 'combat2_sync') return { data: {
        ok: true, kind: 'sync', latest_tick: 1, returned_through_tick: 1, has_more: false,
        encounter: { id: ENCOUNTER, status: 'active', tick: 1, stateVersion: 1 },
        character: { id: CHARACTER, hp: 9, maxHp: 10, cp: 4, maxCp: 8, mp: 7, maxMp: 10, level: 2, xp: 20, gold: 4 },
        fighter: { id: 'fighter-1', characterId: CHARACTER, entrySeq: 3, present: true },
        creatures: [{
          id: 'node-creature-1', creatureId: 'creature-1', spawnSeq: 2, name: 'Sentinel',
          hp: 10, maxHp: 10, isAlive: true,
          pendingAction: {
            abilityKey: 'granite_slam', abilityLabel: 'Granite Slam', startedAtTick: 1, resolveAtTick: 3,
            targetFighterId: 'fighter-1', targetCharacterId: CHARACTER, targetEntrySeq: 3,
          },
        }], effects: [], rewardClaims: [],
        batches: [{ id: 'batch-1', tick: 1, createdAt: '2026-09-01T00:00:00Z', events: [{ seq: 1, kind: 'attack', amount: 2 }] }],
      }, error: null };
      if (name === 'combat_flee') return { data: { ok: true, kind: 'already_fled', event_id: eventId }, error: null };
      throw new Error(`unexpected RPC ${name}: ${JSON.stringify(args)}`);
    }) as never);
    const channel = { on: vi.fn(() => channel), subscribe: vi.fn(() => channel) };
    vi.spyOn(supabase, 'channel').mockReturnValue(channel as never);
    const remove = vi.spyOn(supabase, 'removeChannel').mockResolvedValue('ok');

    const { result } = renderHook(() => useCombat2ClientSession({
      enabled: true, characterId: CHARACTER, nodeId: NODE, hasLivingCreatures: true,
    }));
    await waitFor(() => expect(result.current.sessionStatus).toBe('active'));
    await waitFor(() => expect(result.current.delivery.batches).toHaveLength(1));
    expect(result.current.presentation.model).toMatchObject({ character: { hp: 9, cp: 4, mp: 7 }, lastAppliedTick: 1 });
    expect(result.current.presentation.model?.events).toHaveLength(1);
    expect(result.current.presentation.model?.telegraphs).toHaveLength(1);
    await act(async () => { expect(await result.current.flee.flee()).toMatchObject({ status: 'fled', classification: 'already_fled' }); });
    await waitFor(() => expect(result.current.sessionStatus).toBe('exited'));
    expect(result.current.encounterId).toBeNull();
    expect(remove).toHaveBeenCalledWith(channel);
    expect(result.current.delivery.batches).toHaveLength(1);
    expect(result.current.presentation.model?.events).toHaveLength(1);
    expect(result.current.sessionStatus === 'active' ? result.current.presentation.model?.telegraphs : []).toEqual([]);
    await expect(result.current.intents.submit({ kind: 'ability', abilityKey: 'fireball', stanceKey: null, targetCreatureId: null }))
      .resolves.toMatchObject({ status: 'local_refusal', classification: 'no_session' });
    expect(rpc.mock.calls.filter(([name]) => name === 'combat_intent')).toHaveLength(0);
  });

  it('passes only authoritative entry identity and contains no prohibited call path', () => {
    const bridge = readFileSync('src/features/combat2/Combat2ClientSession.tsx', 'utf8');
    const entry = readFileSync('src/features/combat2/entry.ts', 'utf8');
    const session = readFileSync('src/features/combat2/useCombat2EntrySession.ts', 'utf8');
    const source = `${bridge}\n${entry}\n${session}`;
    expect(bridge).toMatch(/const enteredEncounterId = entry\.status === 'entered' \? entry\.encounterId : null/);
    expect(source).not.toMatch(/combat_intent|combat_flee|node_tick_claim|node_tick_commit/);
    expect(source).not.toMatch(/setInterval|setTimeout/);
    expect(source).not.toMatch(/\.from\([^)]*\)\.(?:insert|update|delete|upsert)\(/);
  });

  it('mounts from the authoritative roster hint without changing visible gameplay', () => {
    const page = readFileSync('src/pages/GamePage.tsx', 'utf8');
    expect(page).toContain('useCombat2ClientSession({');
    expect(page).toContain('enabled: COMBAT2_CLIENT_ENABLED');
    expect(page).toContain('characterId: character.id');
    expect(page).toContain('nodeId: character.current_node_id');
    expect(page).toMatch(/hasLivingCreatures:\s*rosterActionable \? creatures\.some\(\(creature\) => creature\.is_alive\) : null/);
  });
});
