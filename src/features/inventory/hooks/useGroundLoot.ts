import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { logBroadcast } from '@/hooks/useBroadcastDebug';
import type { NodeChannelHandle } from '@/features/world';

export interface GroundLootItem {
  id: string;
  node_id: string;
  item_id: string;
  dropped_by: string | null;
  dropped_at: string;
  creature_name: string | null;
  /** Item condition carried with the drop — gems and wear survive the ground. */
  applied_gems: string[];
  stat_override: Record<string, number> | null;
  current_durability: number;
  crafted_level: number | null;
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

export interface GroundLootOptions {
  /** Name broadcast with pickup/drop so co-located players can log the action. */
  characterName?: string | null;
  /**
   * Called when ANOTHER character at this node picks up or drops an item.
   * Party members already receive this through the party log, so the caller
   * is responsible for skipping party mates to avoid duplicate lines.
   */
  onRemoteLootLog?: (info: { actorId: string; actorName: string; itemName: string; kind: 'pickup' | 'drop' }) => void;
}

export function useGroundLoot(
  handle: NodeChannelHandle,
  nodeId: string | null,
  characterId: string | null,
  options: GroundLootOptions = {},
) {
  const [groundLoot, setGroundLoot] = useState<GroundLootItem[]>([]);
  // Suppress Postgres Changes refetch when broadcast already handled the update
  const suppressRefetchUntilRef = useRef(0);
  // Latest options without re-subscribing the node callbacks.
  const optionsRef = useRef(options);
  optionsRef.current = options;


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
      const { ground_loot_id, picker_id, picker_name, item_name } = payload.payload as {
        ground_loot_id: string; picker_id: string; picker_name?: string; item_name?: string;
      };
      if (picker_id === characterId) return;
      logBroadcast('in', `node`, 'loot_picked_up');
      if (ground_loot_id) {
        setGroundLoot(prev => prev.filter(g => g.id !== ground_loot_id));
        suppressRefetchUntilRef.current = Date.now() + 3000;
      }
      if (picker_name) {
        optionsRef.current.onRemoteLootLog?.({
          actorId: picker_id,
          actorName: picker_name,
          itemName: item_name ?? 'an item',
          kind: 'pickup',
        });
      }
    };
    handle.onLootDropped.current = (payload: any) => {
      const { dropper_id, dropper_name, item_name } = payload.payload as {
        dropper_id: string; dropper_name?: string; item_name?: string;
      };
      if (dropper_id === characterId) return;
      logBroadcast('in', `node`, 'loot_dropped');
      fetchGroundLoot();
      suppressRefetchUntilRef.current = Date.now() + 3000;
      if (dropper_name) {
        optionsRef.current.onRemoteLootLog?.({
          actorId: dropper_id,
          actorName: dropper_name,
          itemName: item_name ?? 'an item',
          kind: 'drop',
        });
      }
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
      payload: {
        ground_loot_id: groundLootId,
        picker_id: characterId,
        picker_name: optionsRef.current.characterName ?? null,
        item_name: item.item?.name ?? 'an item',
      },
    });
    logBroadcast('out', `node`, 'loot_picked_up');

    // Atomic pickup via server-side RPC (handles both regular and unique items)
    const { data: success, error } = await supabase.rpc('pickup_ground_loot' as any, {
      p_loot_id: groundLootId,
      p_character_id: characterId,
    });
    if (error || !success) {
      fetchGroundLoot();
      return false;
    }
    fetchGroundLoot();
    return true;
  }, [characterId, groundLoot, fetchGroundLoot, handle]);

  const dropItemToGround = useCallback(async (inventoryItemId: string, _itemId: string, _currentNodeId: string, itemName?: string) => {
    if (!characterId) return;
    suppressRefetchUntilRef.current = Date.now() + 3000;
    // Atomic drop via server-side RPC (verifies ownership, soulbound check, uses character's current node)
    await supabase.rpc('drop_item_to_ground' as any, {
      p_inventory_id: inventoryItemId,
      p_character_id: characterId,
    });
    handle.channelRef.current?.send({
      type: 'broadcast',
      event: 'loot_dropped',
      payload: {
        dropper_id: characterId,
        dropper_name: optionsRef.current.characterName ?? null,
        item_name: itemName ?? 'an item',
      },
    });
    logBroadcast('out', `node`, 'loot_dropped');
    fetchGroundLoot();
  }, [characterId, fetchGroundLoot, handle]);


  return { groundLoot, pickUpItem, dropItemToGround, fetchGroundLoot };
}
