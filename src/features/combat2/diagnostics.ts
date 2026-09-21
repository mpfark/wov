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

/**
 * Pure read of the active recording. It must never write, because React renders
 * call it: a write dispatches `combat2-diagnostic-change`, which synchronously
 * re-renders the overlay and previously produced an unbounded render loop
 * (React error #301) for any stopped or expired session.
 */
export function currentCombat2Recording(now = Date.now()): Combat2DiagnosticRecording | null {
  const recording = safeRead();
  if (!recording) return null;
  return isCombat2RecordingFinished(recording, now) ? null : recording;
}

export function isCombat2RecordingFinished(recording: Combat2DiagnosticRecording, now = Date.now()): boolean {
  return Date.parse(recording.expiresAt) <= now;
}

/**
 * Stopped and expired recordings stay readable so their client buffer survives
 * reload and can still be exported. Only an explicit Clear discards them.
 */
export function recoverableCombat2Recording(): Combat2DiagnosticRecording | null {
  return safeRead();
}

export function startCombat2Recording(characterId: string, nodeId: string | null, encounterId: string | null, now = Date.now(), sessionId: string = crypto.randomUUID()): Combat2DiagnosticRecording {
  const recording: Combat2DiagnosticRecording = { version: 1, sessionId,
    startedAt: new Date(now).toISOString(), expiresAt: new Date(now + COMBAT2_DIAGNOSTIC_DURATION_MS).toISOString(),
    characterId, nodeId, encounterId, events: [], dropped: 0 };
  write(recording); return recording;
}

interface DiagnosticRpcClient { rpc(name:string,args:Record<string,unknown>):PromiseLike<{data:unknown;error:{message?:string}|null}> }
function row(value:unknown):Record<string,unknown>|null{return value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;}
export async function startCombat2ServerRecording(client:DiagnosticRpcClient,characterId:string,nodeId:string|null,encounterId:string|null){
  if(!nodeId)throw new Error('Combat2 diagnostic recording requires a node');
  // A finished recording still holds an unexported client buffer; never silently overwrite it.
  const retained=recoverableCombat2Recording();
  if(retained&&isCombat2RecordingFinished(retained))throw new Error('A stopped recording is still unexported; export or clear it first');
  const {data,error}=await client.rpc('combat2_diagnostic_start',{_character_id:characterId,_node_id:nodeId,_encounter_id:encounterId});
  const value=row(data); if(error||value?.ok!==true||value.kind!=='started'||typeof value.session_id!=='string')throw new Error(error?.message??'Diagnostic start refused');
  return startCombat2Recording(characterId,nodeId,encounterId,Date.now(),value.session_id);
}
export async function stopCombat2ServerRecording(client:DiagnosticRpcClient,sessionId:string){
  const {data,error}=await client.rpc('combat2_diagnostic_stop',{_session_id:sessionId}); const value=row(data);
  if(error||value?.ok!==true||value.kind!=='stopped')throw new Error(error?.message??'Diagnostic stop refused');
  return stopCombat2Recording(sessionId);
}
export async function exportCombat2ServerRecording(client:DiagnosticRpcClient,recording:Combat2DiagnosticRecording){
  const {data,error}=await client.rpc('combat2_diagnostic_export',{_session_id:recording.sessionId}); const value=row(data);
  if(error||value?.ok!==true||value.kind!=='exported'||!Array.isArray(value.events))throw new Error(error?.message??'Diagnostic export refused');
  const serverEvents:Combat2DiagnosticEvent[]=value.events.map((raw,index)=>{const event=row(raw);if(!event||typeof event.event_type!=='string'||typeof event.occurred_at!=='string')throw new Error(`Malformed server diagnostic event ${index}`);
    return {side:'server',event:event.event_type,wallTime:event.occurred_at,requestId:typeof event.request_id==='string'?event.request_id:null,
      intentId:typeof event.intent_id==='string'?event.intent_id:null,encounterId:typeof event.encounter_id==='string'?event.encounter_id:null,
      nodeId:typeof event.node_id==='string'?event.node_id:null,tick:typeof event.tick==='number'?event.tick:null,
      outcome:typeof event.outcome==='string'?event.outcome:null,elapsedMs:typeof event.elapsed_ms==='number'?event.elapsed_ms:null};});
  return buildCombat2DiagnosticExport(recording,serverEvents);
}

/**
 * Stopping is idempotent and fenced: a late response for an older session can
 * never finish a newer recording.
 */
export function stopCombat2Recording(sessionId?: string): Combat2DiagnosticRecording | null {
  const recording = safeRead();
  if (!recording) return null;
  if (sessionId !== undefined && recording.sessionId !== sessionId) return null;
  if (isCombat2RecordingFinished(recording)) return recording;
  const stopped = { ...recording, expiresAt: new Date().toISOString() };
  write(stopped);
  return stopped;
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
