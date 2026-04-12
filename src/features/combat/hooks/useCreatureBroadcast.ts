import { useState, useEffect, useCallback, useRef } from 'react';
import { logBroadcast } from '@/hooks/useBroadcastDebug';
import type { NodeChannelHandle } from '@/features/world';

interface CreatureDamageEvent {
  creature_id: string;
  new_hp: number;
  damage: number;
  attacker_name: string;
  killed: boolean;
  sender_id?: string;
}

/**
 * Hybrid Broadcast channel for instant creature HP sync at a node.
 * Uses the shared NodeChannel instead of creating its own channel.
 */
export function useCreatureBroadcast(
  handle: NodeChannelHandle,
  nodeId: string | null,
  characterId: string | null,
  onOtherPlayerDamage?: (message: string) => void,
  creatureNameResolver?: (creatureId: string) => string | undefined,
) {
  const [broadcastOverrides, setBroadcastOverrides] = useState<Record<string, number>>({});
  const onOtherRef = useRef(onOtherPlayerDamage);
  onOtherRef.current = onOtherPlayerDamage;
  const resolverRef = useRef(creatureNameResolver);
  resolverRef.current = creatureNameResolver;
  // Reset overrides when node changes
  useEffect(() => {
    setBroadcastOverrides({});
  }, [nodeId]);

  // Register callback for incoming creature damage events
  useEffect(() => {
    handle.onCreatureDamage.current = (payload: any) => {
      const data = payload.payload as CreatureDamageEvent;
      if (!data || !data.creature_id) return;
      // Self-filter
      if (data.sender_id === characterId) return;
      logBroadcast('in', `node-${nodeId}`, 'creature_damage');
      setBroadcastOverrides(prev => ({
        ...prev,
        [data.creature_id]: data.killed ? 0 : data.new_hp,
      }));
      // Emit a log message for same-node cooperation
      if (onOtherRef.current) {
        const creatureName = resolverRef.current?.(data.creature_id) ?? 'a creature';
        const msg = data.killed
          ? `⚔️ ${data.attacker_name} slays ${creatureName}! (remote)`
          : `⚔️ ${data.attacker_name} hits ${creatureName} for ${data.damage} damage. (remote)`;
        onOtherRef.current(msg);
      }
    };
    return () => { handle.onCreatureDamage.current = null; };
  }, [handle, nodeId, characterId]);

  // Clean up overrides for creatures that no longer exist
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
    if (!handle.channelRef.current) return;
    logBroadcast('out', `node`, 'creature_damage');
    handle.channelRef.current.send({
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
  }, [handle, characterId]);

  /** Transient hint: a player attacked a creature (for animation/visual feedback only) */
  const broadcastAttackHint = useCallback((creatureId: string, attackerName: string) => {
    if (!handle.channelRef.current) return;
    logBroadcast('out', `node`, 'creature_attacked');
    handle.channelRef.current.send({
      type: 'broadcast',
      event: 'creature_attacked',
      payload: { creature_id: creatureId, attacker_name: attackerName, sender_id: characterId },
    });
  }, [handle, characterId]);

  return { broadcastOverrides, broadcastDamage, broadcastAttackHint, cleanupOverrides };
}
