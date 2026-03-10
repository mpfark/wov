import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { logBroadcast } from '@/hooks/useBroadcastDebug';
import type { NodeChannelHandle } from '@/hooks/useNodeChannel';

export interface GroundLootItem {
  id: string;
  node_id: string;
  item_id: string;
  dropped_by: string | null;
  dropped_at: string;
  creature_name: string | null;
  item: {
    id: string;
    name: string;
    description: string;
    item_type: string;
    rarity: string;
    slot: string | null;
    stats: Record<string, number>;
    value: number;
    max_durability: number;
    hands: number | null;
  };
}

export function useGroundLoot(handle: NodeChannelHandle, nodeId: string | null, characterId: string | null) {
  const [groundLoot, setGroundLoot] = useState<GroundLootItem[]>([]);
  // Suppress Postgres Changes refetch when broadcast already handled the update
  const suppressRefetchUntilRef = useRef(0);

  const fetchGroundLoot = useCallback(async () => {
    if (!nodeId) { setGroundLoot([]); return; }
    const { data } = await supabase
      .from('node_ground_loot' as any)
      .select('*, item:items(*)')
      .eq('node_id', nodeId)
      .order('dropped_at', { ascending: false });
    if (data) setGroundLoot(data as unknown as GroundLootItem[]);
  }, [nodeId]);

  // Initial fetch when node changes
  useEffect(() => {
    fetchGroundLoot();
  }, [fetchGroundLoot]);

  // Register callbacks for incoming events via shared channel
  useEffect(() => {
    handle.onGroundLootDbChange.current = () => {
      if (Date.now() < suppressRefetchUntilRef.current) return;
      fetchGroundLoot();
    };
    handle.onLootPickedUp.current = (payload: any) => {
      const { ground_loot_id, picker_id } = payload.payload as { ground_loot_id: string; picker_id: string };
      if (picker_id === characterId) return;
      logBroadcast('in', `node`, 'loot_picked_up');
      if (ground_loot_id) {
        setGroundLoot(prev => prev.filter(g => g.id !== ground_loot_id));
        suppressRefetchUntilRef.current = Date.now() + 3000;
      }
    };
    handle.onLootDropped.current = (payload: any) => {
      const { dropper_id } = payload.payload as { dropper_id: string };
      if (dropper_id === characterId) return;
      logBroadcast('in', `node`, 'loot_dropped');
      fetchGroundLoot();
      suppressRefetchUntilRef.current = Date.now() + 3000;
    };

    return () => {
      handle.onGroundLootDbChange.current = null;
      handle.onLootPickedUp.current = null;
      handle.onLootDropped.current = null;
    };
  }, [handle, characterId, fetchGroundLoot]);

  // Cleanup expired loot — single call on mount + every 5 minutes
  useEffect(() => {
    supabase.rpc('cleanup_ground_loot' as any).then(() => {});
    const interval = setInterval(() => {
      supabase.rpc('cleanup_ground_loot' as any).then(() => {});
    }, 300000);
    return () => clearInterval(interval);
  }, []);

  const pickUpItem = useCallback(async (groundLootId: string) => {
    if (!characterId) return;
    const item = groundLoot.find(g => g.id === groundLootId);
    if (!item) return;

    // Optimistic removal
    setGroundLoot(prev => prev.filter(g => g.id !== groundLootId));
    suppressRefetchUntilRef.current = Date.now() + 3000;

    // Broadcast to other players
    handle.channelRef.current?.send({
      type: 'broadcast',
      event: 'loot_picked_up',
      payload: { ground_loot_id: groundLootId, picker_id: characterId },
    });
    logBroadcast('out', `node`, 'loot_picked_up');

    // Unique item guard
    if (item.item.rarity === 'unique') {
      const { data: acquired } = await supabase.rpc('try_acquire_unique_item', {
        p_character_id: characterId, p_item_id: item.item_id,
      });
      if (!acquired) {
        fetchGroundLoot();
        return false;
      }
      await supabase.from('node_ground_loot' as any).delete().eq('id', groundLootId);
    } else {
      const { data: deleted } = await supabase.from('node_ground_loot' as any).delete().eq('id', groundLootId).select();
      if (!deleted || (deleted as any[]).length === 0) {
        fetchGroundLoot();
        return false;
      }
      await supabase.from('character_inventory').insert({
        character_id: characterId, item_id: item.item_id, current_durability: 100,
      });
    }
    fetchGroundLoot();
    return true;
  }, [characterId, groundLoot, fetchGroundLoot, handle]);

  const dropItemToGround = useCallback(async (inventoryItemId: string, itemId: string, currentNodeId: string) => {
    if (!characterId || !currentNodeId) return;
    suppressRefetchUntilRef.current = Date.now() + 3000;
    await supabase.from('character_inventory').delete().eq('id', inventoryItemId);
    await supabase.from('node_ground_loot' as any).insert({
      node_id: currentNodeId,
      item_id: itemId,
      dropped_by: characterId,
    });
    handle.channelRef.current?.send({
      type: 'broadcast',
      event: 'loot_dropped',
      payload: { dropper_id: characterId },
    });
    logBroadcast('out', `node`, 'loot_dropped');
    fetchGroundLoot();
  }, [characterId, fetchGroundLoot, handle]);

  return { groundLoot, pickUpItem, dropItemToGround, fetchGroundLoot };
}
