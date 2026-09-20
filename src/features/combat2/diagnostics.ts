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

export function startCombat2Recording(characterId: string, nodeId: string | null, encounterId: string | null, now = Date.now(), sessionId = crypto.randomUUID()): Combat2DiagnosticRecording {
  const recording: Combat2DiagnosticRecording = { version: 1, sessionId,
    startedAt: new Date(now).toISOString(), expiresAt: new Date(now + COMBAT2_DIAGNOSTIC_DURATION_MS).toISOString(),
    characterId, nodeId, encounterId, events: [], dropped: 0 };
  write(recording); return recording;
}

interface DiagnosticRpcClient { rpc(name:string,args:Record<string,unknown>):PromiseLike<{data:unknown;error:{message?:string}|null}> }
function row(value:unknown):Record<string,unknown>|null{return value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;}
export async function startCombat2ServerRecording(client:DiagnosticRpcClient,characterId:string,nodeId:string|null,encounterId:string|null){
  if(!nodeId)throw new Error('Combat2 diagnostic recording requires a node');
  const {data,error}=await client.rpc('combat2_diagnostic_start',{_character_id:characterId,_node_id:nodeId,_encounter_id:encounterId});
  const value=row(data); if(error||value?.ok!==true||value.kind!=='started'||typeof value.session_id!=='string')throw new Error(error?.message??'Diagnostic start refused');
  return startCombat2Recording(characterId,nodeId,encounterId,Date.now(),value.session_id);
}
export async function stopCombat2ServerRecording(client:DiagnosticRpcClient,sessionId:string){
  const {data,error}=await client.rpc('combat2_diagnostic_stop',{_session_id:sessionId}); const value=row(data);
  if(error||value?.ok!==true||value.kind!=='stopped')throw new Error(error?.message??'Diagnostic stop refused'); return stopCombat2Recording();
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
