import { StrictMode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { testIdentityMatches, useCombat2TestOwnership } from './useCombat2TestOwnership';
import { useCombat2EntrySession } from './useCombat2EntrySession';
import { useExecutionFence } from './execution-fence';
import { COMBAT2_TEST_ARENA } from './arena-identity';

const characterId = 'aaaaaaaa-0000-4000-8000-000000000001';
const nodeId: string = COMBAT2_TEST_ARENA.nodes[0].id;
const ordinaryNode = 'bbbbbbbb-0000-4000-8000-000000000001';
const config = { enabled: true, characterId, nodeId, characterSetting: characterId };

describe('restricted cold-entry ownership', () => {
  it.each([[false, characterId], [true, ''], [true, '*'], [true, 'bad'], [true, nodeId]])(
    'denies absent, disabled, malformed or nonmatching character settings', (enabled, c) => {
      expect(testIdentityMatches(enabled as boolean, characterId, nodeId, c)).toBe(false);
    });

  it.each(COMBAT2_TEST_ARENA.nodes)('allows the configured character on $purpose', node => {
    expect(testIdentityMatches(true, characterId, node.id, characterId)).toBe(true);
  });

  it('denies ordinary and arbitrary nodes', () => {
    expect(testIdentityMatches(true, characterId, ordinaryNode, characterId)).toBe(false);
    expect(testIdentityMatches(true, characterId, 'ffff5999-0000-4000-8000-000000000001', characterId)).toBe(false);
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

  it('reserves immediately after authoritative relocation into staging', async () => {
    const check = vi.fn().mockResolvedValue(true);
    const { result, rerender } = renderHook(({ node }) => useCombat2TestOwnership({ ...config, nodeId: node, check }), { initialProps: { node: ordinaryNode } });
    expect(result.current.blocksLegacy).toBe(false);
    rerender({ node: nodeId });
    expect(result.current.blocksLegacy).toBe(true);
    await waitFor(()=>expect(result.current.combat2OwnsSession).toBe(true));
    expect(check).toHaveBeenCalledOnce();
  });

  it('refuses ambiguous/party/active-legacy preflight without restoring legacy', async () => {
    const { result } = renderHook(() => useCombat2TestOwnership({ ...config, check: async () => false }));
    await waitFor(() => expect(result.current.preflight).toBe('refused'));
    expect(result.current.blocksLegacy).toBe(true);
    expect(result.current.combat2OwnsSession).toBe(false);
  });

  it('retains ownership across arena nodes and releases it outside', async () => {
    const { result, rerender } = renderHook(({ node }) => useCombat2TestOwnership({ ...config, nodeId: node, check: async () => true }), { initialProps: { node: nodeId } });
    await waitFor(() => expect(result.current.combat2OwnsSession).toBe(true));
    for (const node of COMBAT2_TEST_ARENA.nodes.slice(1)) {
      rerender({ node: node.id });
      expect(result.current.blocksLegacy).toBe(true);
      expect(result.current.combat2OwnsSession).toBe(true);
    }
    rerender({ node: ordinaryNode });
    expect(result.current.blocksLegacy).toBe(false);
    expect(result.current.combat2OwnsSession).toBe(false);
  });

  it('does not let a late preflight result reclaim ownership after leaving the arena', async () => {
    let finish!: (ok:boolean)=>void;
    const check=vi.fn(()=>new Promise<boolean>(resolve=>{finish=resolve;}));
    const {result,rerender}=renderHook(({node})=>useCombat2TestOwnership({...config,nodeId:node,check}),{initialProps:{node:nodeId}});
    expect(result.current.blocksLegacy).toBe(true);
    rerender({node:ordinaryNode});
    expect(result.current.blocksLegacy).toBe(false);
    await act(async()=>finish(true));
    expect(result.current.combat2OwnsSession).toBe(false);
  });

  it('replays the entry effect without a second RPC', async () => {
    const enter = vi.fn().mockResolvedValue({ status: 'entered', classification: 'entered', encounterId: characterId, fighterId: null, entrySeq: null });
    const adapter = { enter };
    const { result } = renderHook(() => useCombat2EntrySession({ enabled: true, characterId, nodeId, hasLivingCreatures: true, adapter }), { wrapper: StrictMode });
    await waitFor(() => expect(result.current.status).toBe('entered'));
    expect(enter).toHaveBeenCalledOnce();
  });
});
