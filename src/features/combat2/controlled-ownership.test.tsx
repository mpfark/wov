import { StrictMode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useCombat2TestOwnership } from './useCombat2TestOwnership';
import { combat2ArenaAccessCheckEnabled, combat2ArenaReservesLegacy } from './test-config';
import { useCombat2EntrySession } from './useCombat2EntrySession';
import { useExecutionFence } from './execution-fence';
import { COMBAT2_TEST_ARENA } from './arena-identity';
import type { SessionAccessResult } from './session-access';

const characterId = 'aaaaaaaa-0000-4000-8000-000000000001';
const nodeId: string = COMBAT2_TEST_ARENA.nodes[0].id;
const ordinaryNode = 'bbbbbbbb-0000-4000-8000-000000000001';
const allowed = async (_characterId:string,node:string) => ({status:'allowed' as const,arenaId:COMBAT2_TEST_ARENA.id,nodeId:node});
const config = { enabled: true, characterId, nodeId, accessCheck:allowed };

describe('restricted cold-entry ownership', () => {
  it.each(COMBAT2_TEST_ARENA.nodes)('recognizes $purpose as reserved and checkable', node => {
    expect(combat2ArenaReservesLegacy(node.id)).toBe(true);
    expect(combat2ArenaAccessCheckEnabled(true,node.id)).toBe(true);
  });

  it('denies ordinary and arbitrary nodes', () => {
    expect(combat2ArenaReservesLegacy(ordinaryNode)).toBe(false);
    expect(combat2ArenaAccessCheckEnabled(true,'ffff5999-0000-4000-8000-000000000001')).toBe(false);
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
    await waitFor(()=>expect(check).toHaveBeenCalledOnce());
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

  it('keeps an arena node fenced when the feature is disabled without checking access', () => {
    const accessCheck=vi.fn();
    const {result}=renderHook(()=>useCombat2TestOwnership({...config,enabled:false,accessCheck}));
    expect(result.current.blocksLegacy).toBe(true);
    expect(result.current.access).toBe('refused');
    expect(result.current.combat2OwnsSession).toBe(false);
    expect(accessCheck).not.toHaveBeenCalled();
  });

  it('leaves ordinary nodes on legacy without checking access', () => {
    const accessCheck=vi.fn();
    const {result}=renderHook(()=>useCombat2TestOwnership({...config,nodeId:ordinaryNode,accessCheck}));
    expect(result.current.blocksLegacy).toBe(false);
    expect(accessCheck).not.toHaveBeenCalled();
  });

  it.each(['refused','error'] as const)('fails closed on %s access',async status=>{
    const accessCheck=vi.fn().mockResolvedValue(status==='refused'?{status,classification:'not_authorized'}:{status,classification:'transport_error'});
    const {result}=renderHook(()=>useCombat2TestOwnership({...config,accessCheck}));
    expect(result.current.blocksLegacy).toBe(true);
    await waitFor(()=>expect(result.current.access).toBe(status));
    expect(result.current.combat2OwnsSession).toBe(false);
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
      expect(result.current.access).toBe('checking');
      await waitFor(()=>expect(result.current.combat2OwnsSession).toBe(true));
    }
    rerender({ node: ordinaryNode });
    expect(result.current.blocksLegacy).toBe(false);
    expect(result.current.combat2OwnsSession).toBe(false);
  });

  it('discards a late access response for a previous character and node',async()=>{
    const finishes:((value:any)=>void)[]=[];
    const accessCheck=vi.fn(()=>new Promise<SessionAccessResult>(resolve=>finishes.push(resolve)));
    const secondCharacter='cccccccc-0000-4000-8000-000000000001';
    const secondNode=COMBAT2_TEST_ARENA.nodes[1].id;
    const {result,rerender}=renderHook(({character,node})=>useCombat2TestOwnership({...config,characterId:character,nodeId:node,accessCheck,check:async()=>true}),{initialProps:{character:characterId,node:nodeId}});
    await waitFor(()=>expect(finishes).toHaveLength(1));
    rerender({character:secondCharacter,node:secondNode});
    await waitFor(()=>expect(finishes).toHaveLength(2));
    await act(async()=>finishes[0]({status:'allowed',arenaId:COMBAT2_TEST_ARENA.id,nodeId}));
    expect(result.current.access).toBe('checking');
    await act(async()=>finishes[1]({status:'allowed',arenaId:COMBAT2_TEST_ARENA.id,nodeId:secondNode}));
    await waitFor(()=>expect(result.current.combat2OwnsSession).toBe(true));
    expect(accessCheck).toHaveBeenNthCalledWith(2,secondCharacter,secondNode);
  });

  it('does not let a late preflight result reclaim ownership after leaving the arena', async () => {
    let finish!: (ok:boolean)=>void;
    const check=vi.fn(()=>new Promise<boolean>(resolve=>{finish=resolve;}));
    const {result,rerender}=renderHook(({node})=>useCombat2TestOwnership({...config,nodeId:node,check}),{initialProps:{node:nodeId}});
    expect(result.current.blocksLegacy).toBe(true);
    await waitFor(()=>expect(check).toHaveBeenCalledOnce());
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
