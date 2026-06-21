/**
 * partyCombatLogBatcher — client-side buffer for party_combat_log inserts.
 *
 * The single-row insert was the #10 DB hotspot (~12k calls). The row is
 * read back only for cosmetic combat-log scroll, so latency to disk is
 * not gameplay-critical. The realtime broadcast that drives other
 * clients' panels is fired *immediately* in GamePage — this module only
 * defers the durable insert.
 *
 * The id is generated client-side via crypto.randomUUID() so the broadcast
 * pipeline that dedupes against ownLogIdsRef gets a stable id without
 * waiting for the DB round-trip.
 */
import { supabase } from '@/integrations/supabase/client';

interface PendingRow {
  id: string;
  party_id: string;
  message: string;
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

/** Enqueue a row for batched insert. Returns the pre-generated id immediately. */
export function enqueuePartyCombatLog(
  partyId: string,
  message: string,
  nodeId: string | null,
  characterName: string | null,
): string {
  const id = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  buffer.push({ id, party_id: partyId, message, node_id: nodeId, character_name: characterName });
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
