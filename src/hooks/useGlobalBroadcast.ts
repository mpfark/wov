/**
 * useGlobalBroadcast — single shared `world-global` Supabase Realtime channel.
 *
 * Replaces per-feature broadcast channels (e.g. `marketplace-global`) with one
 * unified channel that any feature can publish to. Currently used for:
 *   - market_listed  — marketplace listing flavor
 *   - player_death   — player has fallen
 *   - boss_death     — admin-authored boss death cry
 *
 * The channel is reference-counted so that mounting many subscribers/senders
 * keeps a single underlying channel and tears it down only when the last
 * consumer unmounts.
 */
import { useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { RealtimeChannel } from '@supabase/supabase-js';

export type GlobalBroadcastKind = 'market_listed' | 'player_death' | 'boss_death';

export interface GlobalBroadcastPayload {
  kind: GlobalBroadcastKind;
  /** Emoji prefix, ready-to-display (📜, 💀, 👑, …) */
  icon: string;
  /** Pre-formatted display text, no icon prefix */
  text: string;
  /** Sender's character name — used for self-skip on the receiver side */
  actor?: string;
  /** Optional dedupe key */
  nonce?: string;
}

const CHANNEL_NAME = 'world-global';
const EVENT_NAME = 'world';

// Singleton state
let channelRef: RealtimeChannel | null = null;
let refCount = 0;
const listeners = new Set<(payload: GlobalBroadcastPayload) => void>();

function ensureChannel(): RealtimeChannel {
  if (channelRef) return channelRef;
  const ch = supabase.channel(CHANNEL_NAME);
  ch.on('broadcast', { event: EVENT_NAME }, ({ payload }) => {
    const p = payload as GlobalBroadcastPayload | undefined;
    if (!p || !p.kind || !p.text) return;
    for (const fn of listeners) {
      try { fn(p); } catch (e) { console.error('[world-global] listener threw', e); }
    }
  });
  ch.subscribe();
  channelRef = ch;
  return ch;
}

function acquireChannel() {
  refCount++;
  ensureChannel();
}

function releaseChannel() {
  refCount = Math.max(0, refCount - 1);
  if (refCount === 0 && channelRef) {
    supabase.removeChannel(channelRef);
    channelRef = null;
  }
}

/**
 * Returns a stable `send(payload)` function. Holding a sender mounts the
 * channel even if no listeners are attached, so the very first send isn't
 * lost to a race against subscribe.
 */
export function useGlobalBroadcastSender() {
  useEffect(() => {
    acquireChannel();
    return () => releaseChannel();
  }, []);

  return useCallback((payload: GlobalBroadcastPayload) => {
    const ch = ensureChannel();
    ch.send({ type: 'broadcast', event: EVENT_NAME, payload });
  }, []);
}

/**
 * Subscribe to incoming `world-global` events. The latest callback is always
 * used (no stale closures), and the underlying subscription is stable.
 */
export function useGlobalBroadcastListener(
  onMessage: (payload: GlobalBroadcastPayload) => void,
) {
  const cbRef = useRef(onMessage);
  cbRef.current = onMessage;

  useEffect(() => {
    const handler = (p: GlobalBroadcastPayload) => cbRef.current(p);
    listeners.add(handler);
    acquireChannel();
    return () => {
      listeners.delete(handler);
      releaseChannel();
    };
  }, []);
}
