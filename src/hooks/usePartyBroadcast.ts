import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { logBroadcast } from '@/hooks/useBroadcastDebug';

interface PartyHpEvent {
  character_id: string;
  hp: number;
  max_hp: number;
  source: string;
}

interface PartyMoveEvent {
  character_id: string;
  character_name: string;
  node_id: string;
}

interface PartyCombatMsgEvent {
  id: string;
  message: string;
  node_id: string | null;
  character_name: string | null;
}

interface PartyRewardEvent {
  character_id: string;
  xp: number;
  gold: number;
  source: string;
}

interface PartyRegenBuffEvent {
  healPerTick: number;
  expiresAt: number;
  source: 'healer' | 'bard';
  caster_id: string;
}

/**
 * Hybrid Broadcast channels for party-level events.
 */
export function usePartyBroadcast(partyId: string | null, characterId: string | null) {
  const [hpOverrides, setHpOverrides] = useState<Record<string, { hp: number; max_hp: number }>>({});
  const [moveEvents, setMoveEvents] = useState<PartyMoveEvent[]>([]);
  const [broadcastLogEntries, setBroadcastLogEntries] = useState<PartyCombatMsgEvent[]>([]);
  const [rewardEvents, setRewardEvents] = useState<PartyRewardEvent[]>([]);
  const [incomingPartyRegenBuff, setIncomingPartyRegenBuff] = useState<{ healPerTick: number; expiresAt: number; source: 'healer' | 'bard' } | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  useEffect(() => {
    setHpOverrides({});
    setMoveEvents([]);
    setBroadcastLogEntries([]);
    setRewardEvents([]);
    setIncomingPartyRegenBuff(null);
  }, [partyId]);

  useEffect(() => {
    if (!partyId || !characterId) return;

    const channel = supabase.channel(`party-broadcast-${partyId}`);
    channelRef.current = channel;

    channel
      .on('broadcast', { event: 'party_hp' }, (payload) => {
        const data = payload.payload as PartyHpEvent;
        if (!data?.character_id || data.character_id === characterId) return;
        logBroadcast('in', `party`, 'party_hp');
        setHpOverrides(prev => ({
          ...prev,
          [data.character_id]: { hp: data.hp, max_hp: data.max_hp },
        }));
      })
      .on('broadcast', { event: 'party_move' }, (payload) => {
        const data = payload.payload as PartyMoveEvent;
        if (!data?.character_id || data.character_id === characterId) return;
        logBroadcast('in', `party`, 'party_move');
        setMoveEvents(prev => [...prev.slice(-20), data]);
      })
      .on('broadcast', { event: 'party_combat_msg' }, (payload) => {
        const data = payload.payload as PartyCombatMsgEvent;
        if (!data?.id) return;
        logBroadcast('in', `party`, 'party_combat_msg');
        setBroadcastLogEntries(prev => [...prev.slice(-49), data]);
      })
      .on('broadcast', { event: 'party_reward' }, (payload) => {
        const data = payload.payload as PartyRewardEvent;
        if (!data?.character_id || data.character_id !== characterId) return;
        logBroadcast('in', `party`, 'party_reward');
        setRewardEvents(prev => [...prev.slice(-9), data]);
      })
      .on('broadcast', { event: 'party_regen_buff' }, (payload) => {
        const data = payload.payload as PartyRegenBuffEvent;
        if (!data || data.caster_id === characterId) return;
        logBroadcast('in', `party`, 'party_regen_buff');
        setIncomingPartyRegenBuff({ healPerTick: data.healPerTick, expiresAt: data.expiresAt, source: data.source });
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

  const broadcastReward = useCallback((charId: string, xp: number, gold: number, source: string) => {
    channelRef.current?.send({
      type: 'broadcast',
      event: 'party_reward',
      payload: { character_id: charId, xp, gold, source } satisfies PartyRewardEvent,
    });
  }, []);

  const broadcastPartyRegenBuff = useCallback((healPerTick: number, expiresAt: number, source: 'healer' | 'bard', casterId: string) => {
    channelRef.current?.send({
      type: 'broadcast',
      event: 'party_regen_buff',
      payload: { healPerTick, expiresAt, source, caster_id: casterId } satisfies PartyRegenBuffEvent,
    });
  }, []);

  return {
    hpOverrides,
    moveEvents,
    broadcastLogEntries,
    rewardEvents,
    incomingPartyRegenBuff,
    broadcastHp,
    broadcastMove,
    broadcastCombatMsg,
    broadcastReward,
    broadcastPartyRegenBuff,
  };
}
