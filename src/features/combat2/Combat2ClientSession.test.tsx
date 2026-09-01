import { readFileSync } from 'node:fs';
import { render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { supabase } from '@/integrations/supabase/client';
import { Combat2ClientSession } from './Combat2ClientSession';

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

  it('passes only authoritative entry identity and contains no prohibited call path', () => {
    const bridge = readFileSync('src/features/combat2/Combat2ClientSession.tsx', 'utf8');
    const entry = readFileSync('src/features/combat2/entry.ts', 'utf8');
    const session = readFileSync('src/features/combat2/useCombat2EntrySession.ts', 'utf8');
    const source = `${bridge}\n${entry}\n${session}`;
    expect(bridge).toMatch(/encounterId:\s*entry\.status === 'entered' \? entry\.encounterId : null/);
    expect(source).not.toMatch(/combat_intent|combat_flee|node_tick_claim|node_tick_commit/);
    expect(source).not.toMatch(/setInterval|setTimeout/);
    expect(source).not.toMatch(/\.from\([^)]*\)\.(?:insert|update|delete|upsert)\(/);
  });

  it('mounts from the authoritative roster hint without changing visible gameplay', () => {
    const page = readFileSync('src/pages/GamePage.tsx', 'utf8');
    expect(page).toContain('enabled={COMBAT2_CLIENT_ENABLED}');
    expect(page).toContain('characterId={character.id}');
    expect(page).toContain('nodeId={character.current_node_id}');
    expect(page).toMatch(/hasLivingCreatures=\{rosterActionable \? creatures\.some\(\(creature\) => creature\.is_alive\) : null\}/);
  });
});
