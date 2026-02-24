import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface CreatureDamageEvent {
  creature_id: string;
  new_hp: number;
  damage: number;
  attacker_name: string;
  killed: boolean;
  sender_id?: string; // character id of the sender for self-filtering
}

/**
 * Hybrid Broadcast channel for instant creature HP sync at a node.
 * - Sends damage events via Broadcast for ~50ms latency to other players
 * - Receives events from other players and merges into local HP overrides
 * - Self-filtering: ignores broadcasts from own character (local overrides handle that)
 * - Postgres Changes on the creatures table acts as a correction layer
 */
export function useCreatureBroadcast(nodeId: string | null, characterId: string | null) {
  const [broadcastOverrides, setBroadcastOverrides] = useState<Record<string, number>>({});
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // Reset overrides when node changes
  useEffect(() => {
    setBroadcastOverrides({});
  }, [nodeId]);

  useEffect(() => {
    if (!nodeId || !characterId) return;

    const channel = supabase.channel(`creature-combat-${nodeId}`);
    channelRef.current = channel;

    channel
      .on('broadcast', { event: 'creature_damage' }, (payload) => {
        const data = payload.payload as CreatureDamageEvent;
        if (!data || !data.creature_id) return;
        // Self-filter: skip broadcasts from own character (local creatureHpOverrides handles it)
        if (data.sender_id === characterId) return;
        setBroadcastOverrides(prev => ({
          ...prev,
          [data.creature_id]: data.killed ? 0 : data.new_hp,
        }));
      })
      .subscribe();

    return () => {
      channelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [nodeId, characterId]);

  // Clean up overrides for creatures that no longer exist (respawned with new state, etc.)
  const cleanupOverrides = useCallback((activeCreatureIds: string[]) => {
    setBroadcastOverrides(prev => {
      const activeSet = new Set(activeCreatureIds);
      const keys = Object.keys(prev);
      const stale = keys.filter(k => !activeSet.has(k));
      if (stale.length === 0) return prev;
      const next = { ...prev };
      stale.forEach(k => delete next[k]);
      return next;
    });
  }, []);

  const broadcastDamage = useCallback((
    creatureId: string,
    newHp: number,
    damage: number,
    attackerName: string,
    killed: boolean,
  ) => {
    if (!channelRef.current) return;
    channelRef.current.send({
      type: 'broadcast',
      event: 'creature_damage',
      payload: {
        creature_id: creatureId,
        new_hp: newHp,
        damage,
        attacker_name: attackerName,
        killed,
        sender_id: characterId,
      } as CreatureDamageEvent,
    });
  }, [characterId]);

  return { broadcastOverrides, broadcastDamage, cleanupOverrides };
}
