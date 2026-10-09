import { beforeEach, describe, expect, it, vi } from 'vitest';
import { acknowledgeCreation, creationCapacity, pendingCreation, requestCreation } from './creation-client';
const mock = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: mock.rpc } }));
const choices = { name: ' Eldrin ', race: 'human', gender: 'male' as const };
beforeEach(() => { sessionStorage.clear(); mock.rpc.mockReset(); });
describe('C2 creation bridge integration', () => {
  it('sends choices/version only and keeps UUID until authoritative read acknowledgement', async () => {
    mock.rpc.mockResolvedValue({ data: { kind: 'applied', characterId: 'char' }, error: null });
    expect(await requestCreation('actor', choices)).toBe('char');
    const [name, args] = mock.rpc.mock.calls[0];
    expect(name).toBe('character_create_c2');
    expect(Object.keys(args).sort()).toEqual(['_request','_name','_race','_gender','_target','_reason','_expected_revision'].sort());
    expect(args).toMatchObject({ _name: 'Eldrin', _target: null, _reason: null, _expected_revision: 'creation-c2-v1' });
    expect(pendingCreation('actor')).not.toBeNull();
    await requestCreation('actor', choices);
    expect(mock.rpc.mock.calls[1]).toEqual(mock.rpc.mock.calls[0]);
    acknowledgeCreation('actor'); expect(pendingCreation('actor')).toBeNull();
  });
  it('retains lost-response requests and rejects changed payload without an RPC', async () => {
    mock.rpc.mockRejectedValue(new Error('network'));
    await expect(requestCreation('actor', choices)).rejects.toThrow('network');
    const uuid = pendingCreation('actor')!.request;
    await expect(requestCreation('actor', { ...choices, name: 'Other' })).rejects.toThrow('original choices');
    expect(mock.rpc).toHaveBeenCalledTimes(1);
    mock.rpc.mockResolvedValue({ data: { kind: 'applied', characterId: 'char' }, error: null });
    await requestCreation('actor', choices);
    expect(mock.rpc.mock.calls[1][1]._request).toBe(uuid);
  });
  it('clears definite transactional rejection, but preserves unknown/malformed results', async () => {
    mock.rpc.mockResolvedValueOnce({ error: { code: '23505', message: 'name conflict' } });
    await expect(requestCreation('actor', choices)).rejects.toMatchObject({ code: '23505' });
    expect(pendingCreation('actor')).toBeNull();
    mock.rpc.mockResolvedValue({ data: {}, error: null });
    await expect(requestCreation('actor', choices)).rejects.toThrow('Unexpected creation response');
    expect(pendingCreation('actor')).not.toBeNull();
  });
  it('binds delegation and separates actors/targets; purged replay is never success', async () => {
    mock.rpc.mockResolvedValue({ data: { kind: 'purged', characterId: 'char' }, error: null });
    await expect(requestCreation('overlord', { ...choices, targetAccount: 'recipient', reason: ' Approved recovery ' }))
      .rejects.toThrow('permanently purged');
    expect(mock.rpc.mock.calls[0][1]).toMatchObject({ _target: 'recipient', _reason: 'Approved recovery' });
    expect(pendingCreation('overlord', 'recipient')).toBeNull();
    expect(pendingCreation('recipient')).toBeNull();
  });
  it('reads retained quota including tombstones through the authorized capacity RPC', async () => {
    mock.rpc.mockResolvedValue({ data: { retained: 5, limit: 5 }, error: null });
    expect(await creationCapacity()).toEqual({ retained: 5, limit: 5 });
    expect(mock.rpc).toHaveBeenCalledWith('character_creation_capacity', { _target: null });
  });
});
