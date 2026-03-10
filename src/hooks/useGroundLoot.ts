import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { logBroadcast } from '@/hooks/useBroadcastDebug';

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

export function useGroundLoot(nodeId: string | null, characterId: string | null) {
  const [groundLoot, setGroundLoot] = useState<GroundLootItem[]>([]);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
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

  useEffect(() => {
    fetchGroundLoot();
    if (!nodeId) return;
    const channel = supabase
      .channel(`ground-loot-${nodeId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'node_ground_loot',
        filter: `node_id=eq.${nodeId}`,
      }, () => {
        // Skip refetch if broadcast already handled this update recently
        if (Date.now() < suppressRefetchUntilRef.current) return;
        fetchGroundLoot();
      })
      .on('broadcast', { event: 'loot_picked_up' }, (payload) => {
        const { ground_loot_id, picker_id } = payload.payload as { ground_loot_id: string; picker_id: string };
        if (picker_id === characterId) return;
        if (ground_loot_id) {
          setGroundLoot(prev => prev.filter(g => g.id !== ground_loot_id));
          // Suppress the upcoming Postgres Changes refetch for 3s
          suppressRefetchUntilRef.current = Date.now() + 3000;
        }
      })
      .on('broadcast', { event: 'loot_dropped' }, (payload) => {
        const { dropper_id } = payload.payload as { dropper_id: string };
        if (dropper_id === characterId) return;
        fetchGroundLoot();
        // Suppress the upcoming Postgres Changes refetch for 3s
        suppressRefetchUntilRef.current = Date.now() + 3000;
      })
      .subscribe();
    channelRef.current = channel;
    return () => {
      channelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [nodeId, characterId, fetchGroundLoot]);

  // Cleanup expired loot — only run once per session, not per player on a tight interval
  // A single call on mount + every 5 minutes is sufficient
  useEffect(() => {
    supabase.rpc('cleanup_ground_loot' as any).then(() => {});
    const interval = setInterval(() => {
      supabase.rpc('cleanup_ground_loot' as any).then(() => {});
    }, 300000); // 5 minutes
    return () => clearInterval(interval);
  }, []);

  const pickUpItem = useCallback(async (groundLootId: string) => {
    if (!characterId) return;
    const item = groundLoot.find(g => g.id === groundLootId);
    if (!item) return;

    // Optimistic removal — hide from UI immediately
    setGroundLoot(prev => prev.filter(g => g.id !== groundLootId));
    // Suppress Postgres Changes refetch since we're handling this ourselves
    suppressRefetchUntilRef.current = Date.now() + 3000;

    // Broadcast to other players at this node so item disappears instantly for them
    channelRef.current?.send({
      type: 'broadcast',
      event: 'loot_picked_up',
      payload: { ground_loot_id: groundLootId, picker_id: characterId },
    });

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
  }, [characterId, groundLoot, fetchGroundLoot]);

  const dropItemToGround = useCallback(async (inventoryItemId: string, itemId: string, currentNodeId: string) => {
    if (!characterId || !currentNodeId) return;
    // Suppress Postgres Changes refetch since we broadcast
    suppressRefetchUntilRef.current = Date.now() + 3000;
    await supabase.from('character_inventory').delete().eq('id', inventoryItemId);
    await supabase.from('node_ground_loot' as any).insert({
      node_id: currentNodeId,
      item_id: itemId,
      dropped_by: characterId,
    });
    channelRef.current?.send({
      type: 'broadcast',
      event: 'loot_dropped',
      payload: { dropper_id: characterId },
    });
    fetchGroundLoot();
  }, [characterId, fetchGroundLoot]);

  return { groundLoot, pickUpItem, dropItemToGround, fetchGroundLoot };
}
