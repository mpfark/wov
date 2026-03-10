import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { logBroadcast } from '@/hooks/useBroadcastDebug';
import { OnlinePlayer } from '@/hooks/useGlobalPresence';
import type { NodeChannelHandle } from '@/hooks/useNodeChannel';

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
  onMessage: (formatted: string) => void;
}

export function useChat({ handle, nodeId, characterId, characterName, onlinePlayers, onMessage }: UseChatOptions) {
  const onMessageRef = useRef(onMessage);
  useEffect(() => { onMessageRef.current = onMessage; }, [onMessage]);

  const whisperChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const tempChannelsRef = useRef<Set<ReturnType<typeof supabase.channel>>>(new Set());

  // Register callback for incoming say messages via shared channel
  useEffect(() => {
    handle.onSay.current = ({ payload }: any) => {
      if (payload.senderId === characterId) return;
      logBroadcast('in', `node`, 'say');
      onMessageRef.current(`💬 ${payload.senderName}: ${payload.text}`);
    };
    return () => { handle.onSay.current = null; };
  }, [handle, characterId]);

  // Subscribe to whisper channel for this character (separate — not node-scoped)
  useEffect(() => {
    const channel = supabase.channel(`chat-whisper-${characterId}`);
    channel
      .on('broadcast', { event: 'whisper' }, ({ payload }) => {
        logBroadcast('in', `chat-whisper`, 'whisper');
        onMessageRef.current(`🤫 ${payload.senderName} whispers: ${payload.text}`);
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
    onMessageRef.current(`💬 ${characterName}: ${text}`);
  }, [handle, characterId, characterName]);

  const sendWhisper = useCallback((targetName: string, text: string): string | null => {
    const target = onlinePlayers.find(p => p.name.toLowerCase() === targetName.toLowerCase());
    if (!target) return `Player "${targetName}" not found online.`;

    const targetChannel = supabase.channel(`chat-whisper-${target.id}`);
    tempChannelsRef.current.add(targetChannel);

    targetChannel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        targetChannel.send({
          type: 'broadcast',
          event: 'whisper',
          payload: { senderId: characterId, senderName: characterName, text },
        });
        logBroadcast('out', `chat-whisper`, 'whisper');
        setTimeout(() => {
          tempChannelsRef.current.delete(targetChannel);
          supabase.removeChannel(targetChannel);
        }, 2000);
      }
    });

    onMessageRef.current(`🤫 To ${target.name}: ${text}`);
    return null;
  }, [characterId, characterName, onlinePlayers]);

  return { sendSay, sendWhisper };
}
