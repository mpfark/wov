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

/** How long a broadcast-only kill hint hides a creature before server truth must take over. */
const SOFT_DEAD_TTL_MS = 8000;

/**
 * Hybrid Broadcast channel for instant creature HP sync at a node.
 * Uses the shared NodeChannel instead of creating its own channel.
 *
 * Also tracks "soft-dead" creature ids — kills observed via broadcast but not yet
 * confirmed by the server. Consumers should hide these creatures; the entries
 * auto-expire after SOFT_DEAD_TTL_MS so server truth always wins eventually.
 */
export function useCreatureBroadcast(
  handle: NodeChannelHandle,
  nodeId: string | null,
  characterId: string | null,
  onOtherPlayerDamage?: (message: string) => void,
  creatureNameResolver?: (creatureId: string) => string | undefined,
) {
  const [broadcastOverrides, setBroadcastOverrides] = useState<Record<string, number>>({});
  const [softDeadIds, setSoftDeadIds] = useState<Set<string>>(() => new Set());
  const softDeadTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const onOtherRef = useRef(onOtherPlayerDamage);
  onOtherRef.current = onOtherPlayerDamage;
  const resolverRef = useRef(creatureNameResolver);
  resolverRef.current = creatureNameResolver;

  const clearAllSoftDead = useCallback(() => {
    softDeadTimersRef.current.forEach(t => clearTimeout(t));
    softDeadTimersRef.current.clear();
    setSoftDeadIds(prev => (prev.size === 0 ? prev : new Set()));
  }, []);

  const removeSoftDead = useCallback((id: string) => {
    const t = softDeadTimersRef.current.get(id);
    if (t) {
      clearTimeout(t);
      softDeadTimersRef.current.delete(id);
    }
    setSoftDeadIds(prev => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const markSoftDead = useCallback((id: string) => {
    // Reset any existing timer
    const existing = softDeadTimersRef.current.get(id);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => removeSoftDead(id), SOFT_DEAD_TTL_MS);
    softDeadTimersRef.current.set(id, timer);
    setSoftDeadIds(prev => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, [removeSoftDead]);

  // Reset overrides when node changes
  useEffect(() => {
    setBroadcastOverrides({});
    clearAllSoftDead();
  }, [nodeId, clearAllSoftDead]);

  // Cleanup all timers on unmount
  useEffect(() => () => clearAllSoftDead(), [clearAllSoftDead]);

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
      if (data.killed) {
        markSoftDead(data.creature_id);
      }
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
  }, [handle, nodeId, characterId, markSoftDead]);

  // Clean up overrides for creatures that no longer exist
  const cleanupOverrides = useCallback((activeCreatureIds: string[]) => {
    const activeSet = new Set(activeCreatureIds);
    setBroadcastOverrides(prev => {
      const keys = Object.keys(prev);
      const stale = keys.filter(k => !activeSet.has(k));
      if (stale.length === 0) return prev;
      const next = { ...prev };
      stale.forEach(k => delete next[k]);
      return next;
    });
    // Also drop soft-dead entries for ids no longer present (server already removed them)
    softDeadTimersRef.current.forEach((timer, id) => {
      if (!activeSet.has(id)) {
        clearTimeout(timer);
        softDeadTimersRef.current.delete(id);
      }
    });
    setSoftDeadIds(prev => {
      let changed = false;
      const next = new Set(prev);
      prev.forEach(id => {
        if (!activeSet.has(id)) { next.delete(id); changed = true; }
      });
      return changed ? next : prev;
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

  return { broadcastOverrides, softDeadIds, broadcastDamage, cleanupOverrides, markSoftDead };
}
