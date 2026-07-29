/**
 * partyCombatLogBatcher — client-side buffer for party_combat_log inserts.
 *
 * The single-row insert was the #10 DB hotspot (~12k calls). The row is
 * read back only for cosmetic combat-log scroll, so latency to disk is
 * not gameplay-critical. The realtime broadcast that drives other
 * clients' panels is fired *immediately* in GamePage — this module only
 * defers the durable insert.
 *
 * The row id is the event's own id (minted once by the emitter) so the
 * broadcast pipeline that dedupes against ownLogIdsRef gets a stable id
 * without waiting for the DB round-trip.
 */
import { supabase } from '@/integrations/supabase/client';
import type { GameLogEvent } from '@/features/combat/events/log-event';

interface PendingRow {
  id: string;
  party_id: string;
  /** Compatibility text — kept alongside `event` for at least one full
   *  release after Phase 3 stage 8. Never an encoded JSON payload. */
  message: string;
  event: GameLogEvent;
  node_id: string | null;
  character_name: string | null;
}

const MAX_BATCH = 20;
const FLUSH_MS = 250;

let buffer: PendingRow[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

async function flush(): Promise<void> {
  if (timer !== null) { clearTimeout(timer); timer = null; }
  if (buffer.length === 0) return;
  const rows = buffer;
  buffer = [];
  try {
    await supabase.from('party_combat_log').insert(rows as any);
  } catch {
    // ignore — cosmetic log
  }
}

/**
 * Enqueue a row for batched insert. The row id IS `event.id` — the id minted
 * by the authoritative emitter — so the same identity survives display,
 * persistence, broadcast, self-echo dedup and catch-up.
 */
export function enqueuePartyCombatLog(
  partyId: string,
  event: GameLogEvent,
  nodeId: string | null,
  characterName: string | null,
): string {
  const id = event.id;
  const message = event.legacy?.raw ?? event.message;
  buffer.push({ id, party_id: partyId, message, event, node_id: nodeId, character_name: characterName });
  if (buffer.length >= MAX_BATCH) {
    void flush();
  } else if (timer === null) {
    timer = setTimeout(() => { void flush(); }, FLUSH_MS);
  }
  return id;
}

if (typeof document !== 'undefined') {
  const onHide = () => { void flush(); };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') onHide();
  });
  window.addEventListener('pagehide', onHide);
}
