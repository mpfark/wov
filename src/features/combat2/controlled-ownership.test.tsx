import { StrictMode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { testIdentityMatches, useCombat2TestOwnership } from './useCombat2TestOwnership';
import { useCombat2EntrySession } from './useCombat2EntrySession';
import { useExecutionFence } from './execution-fence';

const characterId = 'aaaaaaaa-0000-4000-8000-000000000001';
const nodeId = 'bbbbbbbb-0000-4000-8000-000000000001';
const config = { enabled: true, characterId, nodeId, characterSetting: characterId, nodeSetting: nodeId };

describe('restricted cold-entry ownership', () => {
  it.each([[false, characterId, nodeId], [true, '', ''], [true, '*', nodeId], [true, characterId, 'bad'], [true, nodeId, nodeId]])(
    'denies absent, disabled, malformed or nonmatching settings', (enabled, c, n) => {
      expect(testIdentityMatches(enabled as boolean, characterId, nodeId, c, n)).toBe(false);
    });

  it('suspends legacy before entry, deduplicates Strict Mode and retains ownership on refusal', async () => {
    let finish!: (ok: boolean) => void;
    const check = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; }));
    const legacy = vi.fn();
    const enter = vi.fn().mockResolvedValue({ status: 'refused', classification: 'maintenance', reason: null });
    const adapter = { enter };
    const { result, rerender } = renderHook(() => {
      const ownership = useCombat2TestOwnership({ ...config, check });
      const fence = useExecutionFence(!ownership.blocksLegacy);
      const entry = useCombat2EntrySession({ enabled: ownership.entryEnabled, characterId, nodeId, hasLivingCreatures: true, adapter });
      return { ownership, entry, legacy: () => { if (fence.allowed()) legacy(); } };
    }, { wrapper: StrictMode });
    result.current.legacy();
    expect(legacy).not.toHaveBeenCalled();
    expect(enter).not.toHaveBeenCalled();
    expect(check).toHaveBeenCalledOnce();
    await act(async () => finish(true));
    await waitFor(() => expect(result.current.entry.status).toBe('refused'));
    rerender();
    expect(enter).toHaveBeenCalledOnce();
    expect(result.current.ownership.combat2OwnsSession).toBe(true);
    result.current.legacy();
    expect(legacy).not.toHaveBeenCalled();
  });

  it('never switches a mounted legacy page into Combat2', () => {
    const check = vi.fn();
    const { result, rerender } = renderHook(({ node }) => useCombat2TestOwnership({ ...config, nodeId: node, check }), { initialProps: { node: characterId } });
    rerender({ node: nodeId });
    expect(result.current.blocksLegacy).toBe(false);
    expect(result.current.combat2OwnsSession).toBe(false);
    expect(check).not.toHaveBeenCalled();
  });

  it('refuses ambiguous/party/active-legacy preflight without restoring legacy', async () => {
    const { result } = renderHook(() => useCombat2TestOwnership({ ...config, check: async () => false }));
    await waitFor(() => expect(result.current.preflight).toBe('refused'));
    expect(result.current.blocksLegacy).toBe(true);
    expect(result.current.combat2OwnsSession).toBe(false);
  });

  it('locks unexpected relocation permanently, even after returning to the original node', async () => {
    const { result, rerender } = renderHook(({ node }) => useCombat2TestOwnership({ ...config, nodeId: node, check: async () => true }), { initialProps: { node: nodeId } });
    await waitFor(() => expect(result.current.combat2OwnsSession).toBe(true));
    rerender({ node: characterId });
    expect(result.current.locked).toBe(true);
    rerender({ node: nodeId });
    expect(result.current.locked).toBe(true);
    expect(result.current.blocksLegacy).toBe(true);
  });

  it('replays the entry effect without a second RPC', async () => {
    const enter = vi.fn().mockResolvedValue({ status: 'entered', classification: 'entered', encounterId: characterId, fighterId: null, entrySeq: null });
    const adapter = { enter };
    const { result } = renderHook(() => useCombat2EntrySession({ enabled: true, characterId, nodeId, hasLivingCreatures: true, adapter }), { wrapper: StrictMode });
    await waitFor(() => expect(result.current.status).toBe('entered'));
    expect(enter).toHaveBeenCalledOnce();
  });
});
