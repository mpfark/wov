export type Combat2DiagnosticSide = 'client' | 'server';

export interface Combat2DiagnosticEvent {
  side: Combat2DiagnosticSide;
  event: string;
  monotonicMs?: number;
  wallTime: string;
  requestId?: string | null;
  intentId?: string | null;
  tick?: number | null;
  encounterId?: string | null;
  nodeId?: string | null;
  cursor?: number | null;
  outcome?: string | null;
  elapsedMs?: number | null;
}

export interface Combat2DiagnosticRecording {
  version: 1;
  sessionId: string;
  startedAt: string;
  expiresAt: string;
  characterId: string;
  nodeId: string | null;
  encounterId: string | null;
  events: Combat2DiagnosticEvent[];
  dropped: number;
}

export const COMBAT2_DIAGNOSTIC_MAX_EVENTS = 500;
export const COMBAT2_DIAGNOSTIC_DURATION_MS = 5 * 60_000;
const STORAGE_KEY = 'combat2-diagnostic-recording-v1';

function safeRead(): Combat2DiagnosticRecording | null {
  try {
    const value = sessionStorage.getItem(STORAGE_KEY);
    if (!value) return null;
    const parsed = JSON.parse(value) as Combat2DiagnosticRecording;
    return parsed.version === 1 && Array.isArray(parsed.events) ? parsed : null;
  } catch { return null; }
}

function write(recording: Combat2DiagnosticRecording | null): void {
  if (recording) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(recording));
  else sessionStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new Event('combat2-diagnostic-change'));
}

export function currentCombat2Recording(now = Date.now()): Combat2DiagnosticRecording | null {
  const recording = safeRead();
  if (!recording) return null;
  if (Date.parse(recording.expiresAt) <= now) {
    write({ ...recording, expiresAt: new Date(now).toISOString() });
    return null;
  }
  return recording;
}

export function startCombat2Recording(characterId: string, nodeId: string | null, encounterId: string | null, now = Date.now()): Combat2DiagnosticRecording {
  const recording: Combat2DiagnosticRecording = { version: 1, sessionId: crypto.randomUUID(),
    startedAt: new Date(now).toISOString(), expiresAt: new Date(now + COMBAT2_DIAGNOSTIC_DURATION_MS).toISOString(),
    characterId, nodeId, encounterId, events: [], dropped: 0 };
  write(recording); return recording;
}

export function stopCombat2Recording(): Combat2DiagnosticRecording | null {
  const recording = safeRead();
  if (recording) write({ ...recording, expiresAt: new Date().toISOString() });
  return recording;
}

export function clearCombat2Recording(): void { write(null); }

export function recordCombat2ClientEvent(event: Omit<Combat2DiagnosticEvent, 'side'|'wallTime'|'monotonicMs'>): void {
  const recording = currentCombat2Recording();
  if (!recording) return;
  const next = [...recording.events, { ...event, side: 'client' as const, wallTime: new Date().toISOString(), monotonicMs: performance.now() }];
  const overflow = Math.max(0, next.length - COMBAT2_DIAGNOSTIC_MAX_EVENTS);
  write({ ...recording, events: overflow ? next.slice(overflow) : next, dropped: recording.dropped + overflow });
}

export function buildCombat2DiagnosticExport(recording: Combat2DiagnosticRecording, serverEvents: Combat2DiagnosticEvent[] = []) {
  const clientEvents = recording.events;
  const key = (e: Combat2DiagnosticEvent) => e.requestId ?? (e.tick != null && e.encounterId ? `${e.encounterId}:${e.tick}` : null);
  const clientKeys = new Set(clientEvents.map(key).filter(Boolean));
  const serverKeys = new Set(serverEvents.map(key).filter(Boolean));
  const duplicates = [...clientKeys, ...serverKeys].filter((value, index, all) => all.indexOf(value) !== index);
  const correlatedTimeline = [...clientEvents, ...serverEvents].map(event => ({ ...event, correlationId: key(event) }))
    .sort((a, b) => a.wallTime.localeCompare(b.wallTime));
  const elapsed = correlatedTimeline.map(e => e.elapsedMs).filter((v): v is number => typeof v === 'number');
  return {
    metadata: { version: 1, sessionId: recording.sessionId, startedAt: recording.startedAt,
      expiresAt: recording.expiresAt, note: 'Client and server clocks are independent; wall-clock ordering is descriptive only.', droppedClientEvents: recording.dropped },
    clientEvents, serverEvents, correlatedTimeline,
    unmatchedClientEvents: clientEvents.filter(e => { const k=key(e); return k != null && !serverKeys.has(k); }),
    unmatchedServerEvents: serverEvents.filter(e => { const k=key(e); return k != null && !clientKeys.has(k); }),
    summaryStatistics: { clientEventCount: clientEvents.length, serverEventCount: serverEvents.length,
      duplicateCorrelationIds: [...new Set(duplicates)], longestObservedPhaseMs: elapsed.length ? Math.max(...elapsed) : null },
  };
}
