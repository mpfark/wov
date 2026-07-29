import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { logBroadcast } from '@/hooks/useBroadcastDebug';
import { OnlinePlayer } from '@/hooks/useGlobalPresence';
import type { NodeChannelHandle } from '@/features/world';
import { createLogEvent, type GameLogEvent } from '@/features/combat/events/log-event';

export interface ChatMessage {
  type: 'say' | 'whisper-in' | 'whisper-out';
  senderName: string;
  text: string;
  timestamp: number;
}

interface UseChatOptions {
  handle: NodeChannelHandle;
  nodeId: string | null;
  characterId: string;
  characterName: string;
  onlinePlayers: OnlinePlayer[];
  onMessage: (event: GameLogEvent) => void;
}

export function useChat({ handle, nodeId: _nodeId, characterId, characterName, onlinePlayers, onMessage }: UseChatOptions) {
  const onMessageRef = useRef(onMessage);
  useEffect(() => { onMessageRef.current = onMessage; }, [onMessage]);

  const whisperChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const tempChannelsRef = useRef<Set<ReturnType<typeof supabase.channel>>>(new Set());

  // Register callback for incoming say messages via shared channel
  useEffect(() => {
    handle.onSay.current = ({ payload }: any) => {
      if (payload.senderId === characterId) return;
      logBroadcast('in', `node`, 'say');
      onMessageRef.current(createLogEvent({
        type: 'speech',
        message: `${payload.senderName}: ${payload.text}`,
        source: { kind: 'player', id: payload.senderId, name: payload.senderName },
        scope: 'node',
        observed: true,
      }));
    };
    return () => { handle.onSay.current = null; };
  }, [handle, characterId]);

  // Subscribe to whisper channel for this character (separate — not node-scoped)
  useEffect(() => {
    const channel = supabase.channel(`chat-whisper-${characterId}`);
    channel
      .on('broadcast', { event: 'whisper' }, ({ payload }) => {
        logBroadcast('in', `chat-whisper`, 'whisper');
        onMessageRef.current(createLogEvent({
          type: 'whisper',
          message: `${payload.senderName} whispers: ${payload.text}`,
          source: { kind: 'player', id: payload.senderId, name: payload.senderName },
          scope: 'self',
          observed: true,
        }));
      })
      .subscribe();
    whisperChannelRef.current = channel;
    return () => {
      supabase.removeChannel(channel);
      whisperChannelRef.current = null;
    };
  }, [characterId]);

  // Cleanup any leaked temp channels on unmount
  useEffect(() => {
    return () => {
      for (const ch of tempChannelsRef.current) {
        supabase.removeChannel(ch);
      }
      tempChannelsRef.current.clear();
    };
  }, []);

  const sendSay = useCallback((text: string) => {
    if (!handle.channelRef.current) return;
    logBroadcast('out', `node`, 'say');
    handle.channelRef.current.send({
      type: 'broadcast',
      event: 'say',
      payload: { senderId: characterId, senderName: characterName, text },
    });
    onMessageRef.current(createLogEvent({
      type: 'speech',
      message: `${characterName}: ${text}`,
      source: { kind: 'player', id: characterId, name: characterName },
      scope: 'node',
    }));
  }, [handle, characterId, characterName]);

  const sendWhisper = useCallback(async (targetName: string, text: string): Promise<string | null> => {
    // Try presence list first (instant, no DB call)
    let target = onlinePlayers.find(p => p.name.toLowerCase() === targetName.toLowerCase());

    // Fallback: secure RPC lookup if presence hasn't synced yet
    if (!target) {
      const { data: charId } = await supabase.rpc('find_character_id_by_name', { _name: targetName });
      if (charId) {
        target = { id: charId, name: targetName, race: '', class: '', level: 0, gender: 'male' as const };
      }
    }

    if (!target) return `Player "${targetName}" not found.`;

    const targetChannel = supabase.channel(`chat-whisper-${target.id}`);
    tempChannelsRef.current.add(targetChannel);

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      tempChannelsRef.current.delete(targetChannel);
      supabase.removeChannel(targetChannel);
    };
    // Hard safety: tear the channel down after 5s regardless of subscribe status
    // so TIMED_OUT/CHANNEL_ERROR/CLOSED paths don't leak Realtime channels.
    const safety = setTimeout(cleanup, 5000);

    targetChannel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        targetChannel.send({
          type: 'broadcast',
          event: 'whisper',
          payload: { senderId: characterId, senderName: characterName, text },
        });
        logBroadcast('out', `chat-whisper`, 'whisper');
        setTimeout(() => { clearTimeout(safety); cleanup(); }, 2000);
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        clearTimeout(safety);
        cleanup();
      }
    });

    onMessageRef.current(createLogEvent({
      type: 'whisper',
      message: `To ${target.name}: ${text}`,
      source: { kind: 'player', id: characterId, name: characterName },
      target: { kind: 'player', id: target.id, name: target.name },
      scope: 'self',
    }));
    return null;
  }, [characterId, characterName, onlinePlayers]);

  return { sendSay, sendWhisper };
}
