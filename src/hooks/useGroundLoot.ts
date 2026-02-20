import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

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
      }, () => fetchGroundLoot())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [nodeId, fetchGroundLoot]);

  // Also cleanup expired loot client-side periodically
  useEffect(() => {
    const interval = setInterval(() => {
      supabase.rpc('cleanup_ground_loot' as any).then(() => {});
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  const pickUpItem = useCallback(async (groundLootId: string) => {
    if (!characterId) return;
    const item = groundLoot.find(g => g.id === groundLootId);
    if (!item) return;

    // Unique item guard
    if (item.item.rarity === 'unique') {
      const { data: acquired } = await supabase.rpc('try_acquire_unique_item', {
        p_character_id: characterId, p_item_id: item.item_id,
      });
      if (!acquired) return false;
      // Delete from ground
      await supabase.from('node_ground_loot' as any).delete().eq('id', groundLootId);
    } else {
      // Delete from ground first
      await supabase.from('node_ground_loot' as any).delete().eq('id', groundLootId);
      // Insert into inventory
      await supabase.from('character_inventory').insert({
        character_id: characterId, item_id: item.item_id, current_durability: item.item.max_durability,
      });
    }
    fetchGroundLoot();
    return true;
  }, [characterId, groundLoot, fetchGroundLoot]);

  const dropItemToGround = useCallback(async (inventoryItemId: string, itemId: string, currentNodeId: string) => {
    if (!characterId || !currentNodeId) return;
    // Delete from inventory
    await supabase.from('character_inventory').delete().eq('id', inventoryItemId);
    // Insert into ground loot
    await supabase.from('node_ground_loot' as any).insert({
      node_id: currentNodeId,
      item_id: itemId,
      dropped_by: characterId,
    });
    fetchGroundLoot();
  }, [characterId, fetchGroundLoot]);

  return { groundLoot, pickUpItem, dropItemToGround, fetchGroundLoot };
}
