/**
 * activityLogBatcher — client-side buffer for activity_log writes.
 *
 * Background: every move / teleport / kill / login fires a logActivity()
 * call. At ~25k calls in the slow-query report, that's the #3 DB hotspot
 * and pure overhead — these rows are cosmetic audit data, not gameplay.
 *
 * Strategy: hold entries up to 250 ms or 20 rows, then flush via a single
 * RPC (log_activity_batch) that inserts the whole array in one statement.
 * Flush eagerly on tab hide / pagehide so we don't lose entries.
 *
 * Gameplay impact: none. Logs are read by the admin chat widget only,
 * which tolerates ≤250 ms delay. On a crash mid-buffer we lose at most
 * one window of entries.
 */
import { supabase } from '@/integrations/supabase/client';

interface PendingEntry {
  character_id: string | null;
  event_type: string;
  message: string;
  metadata: Record<string, any>;
}

const MAX_BATCH = 20;
const FLUSH_MS = 250;

let buffer: PendingEntry[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

async function flush(): Promise<void> {
  if (timer !== null) { clearTimeout(timer); timer = null; }
  if (buffer.length === 0) return;
  const entries = buffer;
  buffer = [];
  // Best-effort. Errors swallowed to keep parity with the old fire-and-forget
  // logActivity() contract.
  try {
    await supabase.rpc('log_activity_batch', { _entries: entries as any });
  } catch {
    // ignore — logs are cosmetic
  }
}

export function enqueueActivityLog(entry: PendingEntry): void {
  buffer.push(entry);
  if (buffer.length >= MAX_BATCH) {
    void flush();
    return;
  }
  if (timer === null) {
    timer = setTimeout(() => { void flush(); }, FLUSH_MS);
  }
}

// Flush on tab hide / page unload so we don't drop the last window of logs.
if (typeof document !== 'undefined') {
  const onHide = () => { void flush(); };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') onHide();
  });
  window.addEventListener('pagehide', onHide);
}
