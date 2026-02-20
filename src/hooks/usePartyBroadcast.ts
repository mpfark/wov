import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface PartyHpEvent {
  character_id: string;
  hp: number;
  max_hp: number;
  source: string; // who caused the change (e.g. creature name or "regen")
}

interface PartyMoveEvent {
  character_id: string;
  character_name: string;
  node_id: string;
}

interface PartyCombatMsgEvent {
  id: string; // unique message id to deduplicate
  message: string;
  node_id: string | null;
  character_name: string | null;
}

/**
 * Hybrid Broadcast channels for party-level events:
 * 1. Party member HP changes — instant HP bar updates across party
 * 2. Movement — instant map indicator updates  
 * 3. Combat log messages — instant log display before DB round-trip
 * 
 * All three use Broadcast (~50ms) with Postgres Changes as correction layer.
 */
export function usePartyBroadcast(partyId: string | null, characterId: string | null) {
  const [hpOverrides, setHpOverrides] = useState<Record<string, { hp: number; max_hp: number }>>({});
  const [moveEvents, setMoveEvents] = useState<PartyMoveEvent[]>([]);
  const [broadcastLogEntries, setBroadcastLogEntries] = useState<PartyCombatMsgEvent[]>([]);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // Reset when party changes
  useEffect(() => {
    setHpOverrides({});
    setMoveEvents([]);
    setBroadcastLogEntries([]);
  }, [partyId]);

  useEffect(() => {
    if (!partyId || !characterId) return;

    const channel = supabase.channel(`party-broadcast-${partyId}`);
    channelRef.current = channel;

    channel
      .on('broadcast', { event: 'party_hp' }, (payload) => {
        const data = payload.payload as PartyHpEvent;
        if (!data?.character_id || data.character_id === characterId) return;
        setHpOverrides(prev => ({
          ...prev,
          [data.character_id]: { hp: data.hp, max_hp: data.max_hp },
        }));
      })
      .on('broadcast', { event: 'party_move' }, (payload) => {
        const data = payload.payload as PartyMoveEvent;
        if (!data?.character_id || data.character_id === characterId) return;
        setMoveEvents(prev => [...prev.slice(-20), data]);
        // Also update HP overrides to clear stale node data
      })
      .on('broadcast', { event: 'party_combat_msg' }, (payload) => {
        const data = payload.payload as PartyCombatMsgEvent;
        if (!data?.id) return;
        setBroadcastLogEntries(prev => [...prev.slice(-49), data]);
      })
      .subscribe();

    return () => {
      channelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [partyId, characterId]);

  const broadcastHp = useCallback((charId: string, hp: number, maxHp: number, source: string) => {
    channelRef.current?.send({
      type: 'broadcast',
      event: 'party_hp',
      payload: { character_id: charId, hp, max_hp: maxHp, source } satisfies PartyHpEvent,
    });
  }, []);

  const broadcastMove = useCallback((charId: string, charName: string, nodeId: string) => {
    channelRef.current?.send({
      type: 'broadcast',
      event: 'party_move',
      payload: { character_id: charId, character_name: charName, node_id: nodeId } satisfies PartyMoveEvent,
    });
  }, []);

  const broadcastCombatMsg = useCallback((id: string, message: string, nodeId: string | null, characterName: string | null) => {
    channelRef.current?.send({
      type: 'broadcast',
      event: 'party_combat_msg',
      payload: { id, message, node_id: nodeId, character_name: characterName } satisfies PartyCombatMsgEvent,
    });
  }, []);

  return {
    hpOverrides,
    moveEvents,
    broadcastLogEntries,
    broadcastHp,
    broadcastMove,
    broadcastCombatMsg,
  };
}
