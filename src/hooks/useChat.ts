import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { OnlinePlayer } from '@/hooks/useGlobalPresence';

export interface ChatMessage {
  type: 'say' | 'whisper-in' | 'whisper-out';
  senderName: string;
  text: string;
  timestamp: number;
}

interface UseChatOptions {
  nodeId: string | null;
  characterId: string;
  characterName: string;
  onlinePlayers: OnlinePlayer[];
  onMessage: (formatted: string) => void;
}

export function useChat({ nodeId, characterId, characterName, onlinePlayers, onMessage }: UseChatOptions) {
  const onMessageRef = useRef(onMessage);
  useEffect(() => { onMessageRef.current = onMessage; }, [onMessage]);

  const nodeChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const whisperChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // Subscribe to node-scoped say channel
  useEffect(() => {
    if (!nodeId) return;
    const channel = supabase.channel(`chat-node-${nodeId}`);
    channel
      .on('broadcast', { event: 'say' }, ({ payload }) => {
        if (payload.senderId === characterId) return; // skip own
        onMessageRef.current(`💬 ${payload.senderName}: ${payload.text}`);
      })
      .subscribe();
    nodeChannelRef.current = channel;
    return () => {
      supabase.removeChannel(channel);
      nodeChannelRef.current = null;
    };
  }, [nodeId, characterId]);

  // Subscribe to whisper channel for this character
  useEffect(() => {
    const channel = supabase.channel(`chat-whisper-${characterId}`);
    channel
      .on('broadcast', { event: 'whisper' }, ({ payload }) => {
        onMessageRef.current(`🤫 ${payload.senderName} whispers: ${payload.text}`);
      })
      .subscribe();
    whisperChannelRef.current = channel;
    return () => {
      supabase.removeChannel(channel);
      whisperChannelRef.current = null;
    };
  }, [characterId]);

  const sendSay = useCallback((text: string) => {
    if (!nodeChannelRef.current) return;
    nodeChannelRef.current.send({
      type: 'broadcast',
      event: 'say',
      payload: { senderId: characterId, senderName: characterName, text },
    });
    // Show own message locally
    onMessageRef.current(`💬 ${characterName}: ${text}`);
  }, [characterId, characterName]);

  const sendWhisper = useCallback((targetName: string, text: string): string | null => {
    const target = onlinePlayers.find(p => p.name.toLowerCase() === targetName.toLowerCase());
    if (!target) return `Player "${targetName}" not found online.`;

    // Create a temporary channel to send the whisper
    const targetChannel = supabase.channel(`chat-whisper-${target.id}`);
    targetChannel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        targetChannel.send({
          type: 'broadcast',
          event: 'whisper',
          payload: { senderId: characterId, senderName: characterName, text },
        });
        // Clean up after a short delay
        setTimeout(() => supabase.removeChannel(targetChannel), 2000);
      }
    });

    // Show own outgoing whisper locally
    onMessageRef.current(`🤫 To ${target.name}: ${text}`);
    return null;
  }, [characterId, characterName, onlinePlayers]);

  return { sendSay, sendWhisper };
}
