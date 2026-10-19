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
  heartbeatId?: number | null;
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
  resourceSnapshots?: Combat2ResourceSnapshot[];
  droppedResourceSnapshots?: number;
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

function write(recording: Combat2DiagnosticRecording | null, notify = true): void {
  if (recording) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(recording));
  else sessionStorage.removeItem(STORAGE_KEY);
  if (notify) window.dispatchEvent(new Event('combat2-diagnostic-change'));
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
      heartbeatId:typeof event.heartbeat_id==='number'?event.heartbeat_id:null,
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


// Resource observations are separate from the existing 500-event buffer.
// No raw rows, names, credentials, effect JSON or arbitrary payloads are retained.
export const COMBAT2_DIAGNOSTIC_MAX_RESOURCE_SNAPSHOTS = 200;
export const COMBAT2_DIAGNOSTIC_MAX_RESOURCE_CREATURES = 16;
export interface DiagnosticResourceValues {
  hp?: number | null; maxHp?: number | null; cp?: number | null; maxCp?: number | null;
  mp?: number | null; maxMp?: number | null; reservedCp?: number | null;
  queuedCp?: number | null; displayedCp?: number | null; spendableCp?: number | null;
}
export interface DiagnosticCreatureResources { id: string; projectionId?: string | null; spawnSeq?: number | null; hp: number | null; maxHp: number | null }
export interface Combat2ResourceInput {
  characterId: string; nodeId?: string | null; encounterId?: string | null;
  tick?: number | null; cursor?: number | null; stateVersion?: number | null; requestId?: string | null;
  layer: 'client_received' | 'client_state' | 'ui_displayed'; source: string;
  sourceUpdatedAt?: string | null; readStartedAt?: number | null; status?: string | null;
  player?: DiagnosticResourceValues; creatures?: readonly DiagnosticCreatureResources[];
}
export interface Combat2ResourceSnapshot extends Combat2ResourceInput {
  event: 'resource_snapshot'; side: 'client'; wallTime: string; monotonicMs: number;
  omittedCreatures: number;
}
const finite = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;
const label = (value: unknown): string | null => typeof value === 'string' ? value.slice(0,128) : null;
export function diagnosticPlayerResources(row: Record<string, unknown>): DiagnosticResourceValues {
  return { hp: finite(row.hp), maxHp: finite(row.maxHp ?? row.max_hp),
    cp: finite(row.cp), maxCp: finite(row.maxCp ?? row.max_cp),
    mp: finite(row.mp), maxMp: finite(row.maxMp ?? row.max_mp) };
}
export function diagnosticCreatureResources(row: Record<string, unknown>): DiagnosticCreatureResources {
  return { id: label(row.creatureId ?? row.id) ?? '', projectionId: label(row.creatureId ? row.id : null),
    spawnSeq: finite(row.spawnSeq ?? row.spawn_seq), hp: finite(row.hp), maxHp: finite(row.maxHp ?? row.max_hp) };
}
/** Best effort and recording-scoped: observation must never affect gameplay. */
export function recordCombat2ResourceState(snapshot: Combat2ResourceInput | (() => Combat2ResourceInput)): void {
  try {
    const recording = currentCombat2Recording();
    if (!recording) return;
    const input = typeof snapshot === 'function' ? snapshot() : snapshot;
    if (input.characterId !== recording.characterId || !['client_received','client_state','ui_displayed'].includes(input.layer)) return;
    // Only numeric allowlisted values; preserve over-cap/negative observations, not formulas/clamps.
    const player = input.player ? Object.fromEntries(
      ['hp','maxHp','cp','maxCp','mp','maxMp','reservedCp','queuedCp','displayedCp','spendableCp']
        .filter(key => key in input.player!).map(key => [key,finite(input.player![key as keyof DiagnosticResourceValues])])) : undefined;
    const creatures = input.creatures?.slice(0,COMBAT2_DIAGNOSTIC_MAX_RESOURCE_CREATURES).map(c => ({
      id: label(c.id) ?? '', projectionId: label(c.projectionId), spawnSeq: finite(c.spawnSeq), hp: finite(c.hp), maxHp: finite(c.maxHp),
    }));
    const value: Combat2ResourceInput & { omittedCreatures: number } = {
      characterId: recording.characterId, nodeId: label(input.nodeId), encounterId: label(input.encounterId),
      tick: finite(input.tick), cursor: finite(input.cursor), stateVersion: finite(input.stateVersion), requestId: label(input.requestId),
      layer: input.layer, source: label(input.source) ?? 'unknown', status: label(input.status),
      sourceUpdatedAt: label(input.sourceUpdatedAt), readStartedAt: finite(input.readStartedAt),
      player, creatures, omittedCreatures: Math.max(0,(input.creatures?.length ?? 0)-COMBAT2_DIAGNOSTIC_MAX_RESOURCE_CREATURES),
    };
    const snapshots = recording.resourceSnapshots ?? [];
    const previous = [...snapshots].reverse().find(s => s.source === value.source && s.layer === value.layer);
    const comparable = (v: Combat2ResourceInput) => {
      const { sourceUpdatedAt: _updated, readStartedAt: _read, ...rest } = v; return JSON.stringify(rest);
    };
    if (previous) {
      const { wallTime: _wall, monotonicMs: _mono, event: _event, side: _side, ...old } = previous;
      if (comparable(old) === comparable(value)) return;
    }
    const next = [...snapshots,{ ...value, event: 'resource_snapshot' as const, side: 'client' as const,
      wallTime: new Date().toISOString(), monotonicMs: performance.now() }];
    const overflow = Math.max(0,next.length-COMBAT2_DIAGNOSTIC_MAX_RESOURCE_SNAPSHOTS);
    // Do not dispatch a React change for each resource sample (or recurse through observers).
    write({ ...recording, resourceSnapshots: next.slice(overflow),
      droppedResourceSnapshots: (recording.droppedResourceSnapshots ?? 0)+overflow },false);
  } catch { /* Storage/quota/diagnostic failures cannot interrupt a resource update. */ }
}

export function buildCombat2DiagnosticExport(recording: Combat2DiagnosticRecording, serverEvents: Combat2DiagnosticEvent[] = []) {
  const clientEvents = recording.events;
  const resourceSnapshots = recording.resourceSnapshots ?? [];
  const key = (e: Combat2DiagnosticEvent) => e.requestId ?? (e.tick != null && e.encounterId ? `${e.encounterId}:${e.tick}` : null);
  const clientKeys = new Set(clientEvents.map(key).filter(Boolean));
  const serverKeys = new Set(serverEvents.map(key).filter(Boolean));
  const duplicates = [...clientKeys, ...serverKeys].filter((value, index, all) => all.indexOf(value) !== index);
  const correlatedTimeline = [...clientEvents, ...serverEvents, ...resourceSnapshots].map(event => ({ ...event, correlationId: key(event) }))
    .sort((a, b) => a.wallTime.localeCompare(b.wallTime));
  const elapsed = [...clientEvents, ...serverEvents].map(e => e.elapsedMs).filter((v): v is number => typeof v === 'number');
  return {
    metadata: { version: 1, sessionId: recording.sessionId, startedAt: recording.startedAt,
      expiresAt: recording.expiresAt, note: 'Client and server clocks are independent; wall-clock ordering is descriptive only.', droppedClientEvents: recording.dropped, droppedResourceSnapshots: recording.droppedResourceSnapshots ?? 0,
      initialScope: { characterId: recording.characterId, nodeId: recording.nodeId, encounterId: recording.encounterId },
      resourceEvidence: 'All resource snapshots are browser observations, not independently verified server state. UI values are render values, not animation samples. Source/tick/version identities take precedence over wall-clock ordering.' },
    clientEvents, serverEvents, resourceSnapshots, correlatedTimeline,
    unmatchedClientEvents: clientEvents.filter(e => { const k=key(e); return k != null && !serverKeys.has(k); }),
    unmatchedServerEvents: serverEvents.filter(e => { const k=key(e); return k != null && !clientKeys.has(k); }),
    summaryStatistics: { clientEventCount: clientEvents.length, serverEventCount: serverEvents.length, resourceSnapshotCount: resourceSnapshots.length,
      duplicateCorrelationIds: [...new Set(duplicates)], longestObservedPhaseMs: elapsed.length ? Math.max(...elapsed) : null },
  };
}
