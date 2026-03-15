import { useEffect, useRef, useState, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface PlayerPresence {
  id: string;
  name: string;
  race: string;
  class: string;
  level: number;
  gender: 'male' | 'female';
}

export interface NodeChannelHandle {
  /** The single Supabase Realtime channel for this node */
  channelRef: React.MutableRefObject<ReturnType<typeof supabase.channel> | null>;
  /** Callback ref — set by useCreatureBroadcast */
  onCreatureDamage: React.MutableRefObject<((payload: any) => void) | null>;
  /** Callback ref — set by useGroundLoot */
  onLootPickedUp: React.MutableRefObject<((payload: any) => void) | null>;
  /** Callback ref — set by useGroundLoot */
  onLootDropped: React.MutableRefObject<((payload: any) => void) | null>;
  /** Callback ref — set by useGroundLoot */
  onGroundLootDbChange: React.MutableRefObject<(() => void) | null>;
  /** Callback ref — set by useChat */
  onSay: React.MutableRefObject<((payload: any) => void) | null>;
  /** Callback ref — set by useCreatures for creature DB changes */
  onCreatureUpdate: React.MutableRefObject<((payload: any) => void) | null>;
  onCreatureInsert: React.MutableRefObject<(() => void) | null>;
  onCreatureDelete: React.MutableRefObject<((payload: any) => void) | null>;
  /** Callback ref — set by GamePage for unlock_path broadcasts */
  onUnlockPath: React.MutableRefObject<((payload: any) => void) | null>;
  /** Presence data */
  playersHere: PlayerPresence[];
}

interface PresenceCharacter {
  id: string;
  name: string;
  race: string;
  class: string;
  level: number;
  gender: 'male' | 'female';
}

/**
 * Creates ONE shared Supabase Realtime channel per node.
 * Consolidates: presence, creature-damage broadcast, ground-loot broadcast,
 * ground-loot postgres-changes, creature postgres-changes, and chat-say broadcast.
 *
 * Consuming hooks set the callback refs to receive events.
 */
export function useNodeChannel(
  nodeId: string | null,
  character: PresenceCharacter | null,
): NodeChannelHandle {
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const [playersHere, setPlayersHere] = useState<PlayerPresence[]>([]);

  // Callback refs — consuming hooks set these
  const onCreatureDamage = useRef<((payload: any) => void) | null>(null);
  const onLootPickedUp = useRef<((payload: any) => void) | null>(null);
  const onLootDropped = useRef<((payload: any) => void) | null>(null);
  const onGroundLootDbChange = useRef<(() => void) | null>(null);
  const onSay = useRef<((payload: any) => void) | null>(null);
  const onCreatureUpdate = useRef<((payload: any) => void) | null>(null);
  const onCreatureInsert = useRef<(() => void) | null>(null);
  const onCreatureDelete = useRef<((payload: any) => void) | null>(null);
  const onUnlockPath = useRef<((payload: any) => void) | null>(null);

  // Memoize character data to avoid unnecessary re-subscriptions
  const charData = useMemo(() => {
    if (!character) return null;
    return {
      id: character.id,
      name: character.name,
      race: character.race,
      class: character.class,
      level: character.level,
      gender: character.gender,
    };
  }, [character?.id, character?.name, character?.race, character?.class, character?.level, character?.gender]);

  useEffect(() => {
    if (!nodeId || !charData) {
      setPlayersHere([]);
      channelRef.current = null;
      return;
    }

    const channel = supabase.channel(`node-${nodeId}`, {
      config: { presence: { key: charData.id } },
    });
    channelRef.current = channel;

    channel
      // ── Presence ──
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        const players: PlayerPresence[] = [];
        for (const [key, presences] of Object.entries(state)) {
          if (key === charData.id) continue;
          const p = (presences as any[])[0];
          if (p?.id && p?.name) {
            players.push({ id: p.id, name: p.name, race: p.race, class: p.class, level: p.level, gender: p.gender || 'male' });
          }
        }
        setPlayersHere(players);
      })

      // ── Broadcasts ──
      .on('broadcast', { event: 'creature_damage' }, (payload) => {
        onCreatureDamage.current?.(payload);
      })
      .on('broadcast', { event: 'loot_picked_up' }, (payload) => {
        onLootPickedUp.current?.(payload);
      })
      .on('broadcast', { event: 'loot_dropped' }, (payload) => {
        onLootDropped.current?.(payload);
      })
      .on('broadcast', { event: 'say' }, (payload) => {
        onSay.current?.(payload);
      })
      .on('broadcast', { event: 'unlock_path' }, (payload) => {
        onUnlockPath.current?.(payload);
      })

      // ── Postgres Changes (ground loot) ──
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'node_ground_loot',
        filter: `node_id=eq.${nodeId}`,
      }, () => {
        onGroundLootDbChange.current?.();
      })

      // ── Postgres Changes (creatures) — merged from useCreatures ──
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'creatures',
        filter: `node_id=eq.${nodeId}`,
      }, (payload) => {
        onCreatureUpdate.current?.(payload);
      })
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'creatures',
        filter: `node_id=eq.${nodeId}`,
      }, () => {
        onCreatureInsert.current?.();
      })
      .on('postgres_changes', {
        event: 'DELETE',
        schema: 'public',
        table: 'creatures',
        filter: `node_id=eq.${nodeId}`,
      }, (payload) => {
        onCreatureDelete.current?.(payload);
      })

      // ── Subscribe + track presence ──
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({
            id: charData.id,
            name: charData.name,
            race: charData.race,
            class: charData.class,
            level: charData.level,
            gender: charData.gender,
          });
        }
      });

    return () => {
      channelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [nodeId, charData]);

  return {
    channelRef,
    onCreatureDamage,
    onLootPickedUp,
    onLootDropped,
    onGroundLootDbChange,
    onSay,
    onCreatureUpdate,
    onCreatureInsert,
    onCreatureDelete,
    playersHere,
  };
}
