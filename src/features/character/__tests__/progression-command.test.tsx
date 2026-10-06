import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, renderHook, screen, waitFor, act } from '@testing-library/react';
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: vi.fn(), functions: { invoke: vi.fn() }, from: vi.fn(() => ({ select: () => ({ eq: async () => ({ data: [] }) }) })) } }));
import { createProgressionClient, pendingAllocation } from '../progression-command';
import { parseProgressionRequest, createProgressionCommandHandler } from '../../../../supabase/functions/_shared/progression-command';
import { StatPlannerBody } from '../components/StatPlannerDialog';
import OrderRecruiterDialog from '../components/OrderRecruiterDialog';
import { useStatAllocation } from '../hooks/useStatAllocation';
import { supabase } from '@/integrations/supabase/client';
import type { Character } from '@/features/character';
const characterId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const requestId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const actor = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const base = { characterId, requestId, expectedVersion: 0 };
const character = { id: characterId, class: 'classless', level: 1, str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, unspent_stat_points: 3 } as Character;
afterEach(() => { cleanup(); sessionStorage.clear(); vi.clearAllMocks(); });
describe('strict authenticated Edge boundary', () => {
  it('normalizes only six allocation stats; accepts narrow Order schema', () => {
    expect(parseProgressionRequest({ ...base, allocations: { con: 1 } })).toEqual({ ...base, allocations: { str: 0, dex: 0, con: 1, int: 0, wis: 0, cha: 0 } });
    expect(parseProgressionRequest({ ...base, operation: 'join', targetClass: 'wizard' })).toEqual({ ...base, operation: 'join', targetClass: 'wizard' });
  });
  it.each([null, [], { ...base, allocations: {} }, { ...base, allocations: { str: 0 } }, { ...base, allocations: { str: -1 } }, { ...base, allocations: { str: 0.1 } }, { ...base, allocations: { str: null } }, { ...base, allocations: { strength: 1 } }, { ...base, allocations: { str: 2147483648 } }, { ...base, allocations: { str: 1 }, actorId: actor }, { ...base, allocations: { str: 1 }, source: 'permanent_reward' }, { ...base, allocations: { str: 1 }, refill: true }, { ...base, operation: 'allocate', targetClass: 'wizard' }, { ...base, operation: 'join', targetClass: null }, { ...base, expectedVersion: -1, allocations: { str: 1 } }])('rejects malformed/unknown trusted inputs %j', value => {
    expect(parseProgressionRequest(value)).toBeNull();
  });
  it('derives actor from verified JWT and calls command only after verification', async () => {
    const verifyActor = vi.fn().mockResolvedValue(actor), command = vi.fn().mockResolvedValue({ kind: 'committed' });
    const handler = createProgressionCommandHandler({ verifyActor, command });
    const req = (body: unknown, auth?: string) => new Request('https://local.invalid', { method: 'POST', headers: { ...(auth ? { Authorization: auth } : {}), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    expect((await handler(req({ ...base, allocations: { str: 1 } }))).status).toBe(401);expect(command).not.toHaveBeenCalled();
    expect((await handler(req({ ...base, allocations: { str: 1 }, actorId: actor }, 'Bearer verified'))).status).toBe(400);
    const response = await handler(req({ ...base, allocations: { str: 1 } }, 'Bearer verified'));expect(response.status).toBe(200);expect(command.mock.calls[0][1]).toBe(actor);
    verifyActor.mockResolvedValue(null);expect((await handler(req({ ...base, allocations: { str: 1 } }, 'Bearer bad'))).status).toBe(401);
  });
  it('transport uncertainty is distinct from a structured command refusal', async () => {
    const command = vi.fn().mockResolvedValue({ kind: 'refused', reason: 'stale_state' });const handler = createProgressionCommandHandler({ verifyActor: async () => actor, command });
    const req = () => new Request('https://local.invalid', { method: 'POST', headers: { Authorization: 'Bearer verified' }, body: JSON.stringify({ ...base, allocations: { str: 1 } }) });
    expect(await (await handler(req())).json()).toEqual({ kind: 'refused', reason: 'stale_state' });command.mockRejectedValue(Error('network'));expect((await handler(req())).status).toBe(503);
    expect((await handler(new Request('https://local.invalid'))).status).toBe(405);
  });
});
describe('stable browser requests', () => {
  it('uncertain retry after remount preserves UUID/version/payload; changed choice cannot replace it', async () => {
    const read = vi.fn().mockResolvedValue(7), send = vi.fn().mockRejectedValueOnce(Error('uncertain')).mockResolvedValue({ kind: 'replayed' });
    const first = createProgressionClient(characterId, { read, send }, sessionStorage, () => requestId);
    await expect(first.execute({ allocations: { str: 1 } })).rejects.toThrow('uncertain');expect(pendingAllocation(characterId).str).toBe(1);
    const remount = createProgressionClient(characterId, { read, send }, sessionStorage, () => actor);
    await expect(remount.execute({ allocations: { dex: 1 } })).rejects.toThrow('Retry the pending');
    await expect(remount.execute({ allocations: { str: 1 } })).resolves.toEqual({ kind: 'replayed' });expect(read).toHaveBeenCalledTimes(1);expect(send.mock.calls[1][0]).toEqual(send.mock.calls[0][0]);expect(pendingAllocation(characterId)).toEqual({});
  });
  it('refused fresh command clears pending; next attempt fetches current version', async () => {
    const read = vi.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(1), send = vi.fn().mockResolvedValueOnce({ kind: 'refused', reason: 'stale_state' }).mockResolvedValueOnce({ kind: 'committed' });
    const client = createProgressionClient(characterId, { read, send }, sessionStorage, () => requestId);await client.execute({ allocations: { str: 1 } });await client.execute({ allocations: { str: 1 } });expect(send.mock.calls[1][0].expectedVersion).toBe(1);
  });
  it('simultaneous duplicate clicks and malformed responses cannot discard an uncertain request', async () => {
    let finish!: (value: { kind: 'committed' }) => void;const send = vi.fn(() => new Promise<{ kind: 'committed' }>(r => { finish = r; }));
    const client = createProgressionClient(characterId, { read: async () => 0, send }, sessionStorage, () => requestId);const first = client.execute({ allocations: { str: 1 } });await expect(client.execute({ allocations: { str: 1 } })).rejects.toThrow('already pending');const anotherPanel = createProgressionClient(characterId, { read: async () => 0, send }, sessionStorage, () => actor);await expect(anotherPanel.execute({ operation: 'join', targetClass: 'wizard' })).rejects.toThrow('already pending');await waitFor(() => expect(send).toHaveBeenCalledTimes(1));finish({ kind: 'committed' });await first;
    const malformed = createProgressionClient(characterId, { read: async () => 1, send: async () => null! }, sessionStorage, () => actor);await expect(malformed.execute({ allocations: { dex: 1 } })).rejects.toThrow('uncertain');expect(pendingAllocation(characterId).dex).toBe(1);
  });
});
describe('planner acknowledgment and refresh', () => {
  it('awaits result, disables duplicate submit and retains plan on unconfirmed failure', async () => {
    let finish!: (v: boolean) => void;const onCommit = vi.fn((_allocations: Record<string, number>) => new Promise<boolean>(r => { finish = r; }));
    render(<StatPlannerBody character={character} equipmentBonuses={{}} onCommit={onCommit} />);
    fireEvent.click(screen.getAllByRole('button').find(b => b.querySelector('svg.lucide-plus'))!);
    fireEvent.click(screen.getByRole('button', { name: /Commit/i }));expect(onCommit).toHaveBeenCalledWith({ str: 1 });expect(screen.getByRole('button', { name: /Commit/i })).toBeDisabled();
    await act(async () => finish(false));expect(screen.getByRole('alert')).toBeInTheDocument();expect(screen.getByRole('button', { name: /Commit/i })).toBeEnabled();fireEvent.click(screen.getByRole('button', { name: /Commit/i }));expect(onCommit.mock.calls[1][0]).toEqual({ str: 1 });await act(async () => finish(true));expect(screen.getByRole('button', { name: /Commit/i })).toBeDisabled();
  });
  it('rehydrates the uncertain allocation when reopened', () => {
    sessionStorage.setItem(`wov:progression-request:${characterId}`, JSON.stringify({ ...base, allocations: { str: 1, dex: 0, con: 0, int: 0, wis: 0, cha: 0 } }));render(<StatPlannerBody character={character} equipmentBonuses={{}} onCommit={vi.fn()} />);expect(screen.getByRole('button', { name: /Commit/i })).toBeEnabled();
  });
  it('confirmed spend remains acknowledged if refresh fails; uncertain outcome logs no success', async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({ data: { kind: 'current', projection: { progressionVersion: 0 } }, error: null } as never);
    vi.mocked(supabase.functions.invoke).mockResolvedValue({ data: { kind: 'committed' }, error: null } as never);
    const addLogEvent = vi.fn(), refresh = vi.fn().mockRejectedValue(Error('refresh failed'));const { result } = renderHook(() => useStatAllocation({ character, addLogEvent, onResourcesSynced: refresh }));
    expect(await result.current.handleBatchAllocateStats({ str: 1 })).toBe(true);expect(refresh).toHaveBeenCalled();expect(pendingAllocation(characterId)).toEqual({});
    addLogEvent.mockClear();vi.mocked(supabase.functions.invoke).mockResolvedValue({ data: null, error: Error('transport') } as never);expect(await result.current.handleBatchAllocateStats({ dex: 1 })).toBe(false);expect(JSON.stringify(addLogEvent.mock.calls)).not.toContain('Stat allocation confirmed');expect(pendingAllocation(characterId).dex).toBe(1);
  });
});
describe('Order caller selection', () => {
  it('can replay an uncertain join after current class or hall changes', async () => {
    sessionStorage.setItem(`wov:progression-request:${characterId}`, JSON.stringify({ ...base, operation: 'join', targetClass: 'wizard' }));
    vi.mocked(supabase.functions.invoke).mockResolvedValue({ data: { kind: 'replayed' }, error: null } as never);
    const onJoined = vi.fn();render(<OrderRecruiterDialog open npc={null} hallClass="warrior" characterId={characterId} currentClass="wizard" onClose={vi.fn()} onJoined={onJoined} />);
    const button = screen.getByRole('button', { name: 'Retry pending Order change' });await waitFor(() => expect(button).toBeEnabled());fireEvent.click(button);await waitFor(() => expect(onJoined).toHaveBeenCalledTimes(1));expect(vi.mocked(supabase.functions.invoke).mock.calls[0][1]?.body).toEqual({ ...base, operation: 'join', targetClass: 'wizard' });expect(supabase.rpc).not.toHaveBeenCalled();
  });
  it.each(['classless', 'warrior'])('uses canonical operation for %s and awaits acknowledgment', async currentClass => {
    vi.mocked(supabase.rpc).mockResolvedValue({ data: { kind: 'current', projection: { progressionVersion: 0 } }, error: null } as never);
    vi.mocked(supabase.functions.invoke).mockResolvedValue({ data: { kind: 'committed' }, error: null } as never);
    let finish!: () => void;const onJoined = vi.fn(() => new Promise<void>(resolve => { finish = resolve; })), onClose = vi.fn();render(<OrderRecruiterDialog open npc={null} hallClass="wizard" characterId={characterId} currentClass={currentClass} onClose={onClose} onJoined={onJoined} />);
    const button = screen.getByRole('button', { name: currentClass === 'classless' ? /Join the Wizard Order/ : /Switch to Wizard/ });await waitFor(() => expect(button).toBeEnabled());fireEvent.click(button);
    await waitFor(() => expect(onJoined).toHaveBeenCalledTimes(1));expect(vi.mocked(supabase.functions.invoke).mock.calls[0][1]?.body).toMatchObject({ operation: currentClass === 'classless' ? 'join' : 'switch', targetClass: 'wizard' });expect(onClose).not.toHaveBeenCalled();expect(button).toBeDisabled();await act(async () => finish());expect(onClose).toHaveBeenCalledTimes(1);
  });
});
