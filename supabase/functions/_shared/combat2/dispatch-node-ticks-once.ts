import type { NodeTickRunResult } from './process-node-tick-once.ts';

export const DISPATCH_LIMIT = 10;

export interface DueNodeCandidate {
  node_id: string;
  encounter_id: string;
  next_due_at: string;
}

export interface DispatchNodeResult {
  nodeId: string;
  classification: string;
  tick?: number;
  reason?: string;
}

export type DispatchRunResult =
  | { ok: false; classification: 'maintenance' | 'world_asleep' | 'discovery_failed'; candidateCount: 0; processedCount: 0; summary: Record<string, number>; results: []; moreMayRemain: false; reason?: string }
  | { ok: true; classification: 'dispatched'; candidateCount: number; processedCount: number; summary: Record<string, number>; results: DispatchNodeResult[]; moreMayRemain: boolean };

export interface DispatchDependencies {
  discoverDueNodes(limit: number): Promise<unknown>;
  processNode(nodeId: string): Promise<NodeTickRunResult>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function refusal(classification: 'maintenance' | 'world_asleep' | 'discovery_failed', reason?: string): DispatchRunResult {
  return { ok: false, classification, candidateCount: 0, processedCount: 0, summary: {}, results: [], moreMayRemain: false, ...(reason ? { reason } : {}) };
}

function safeWorkerResult(nodeId: string, result: NodeTickRunResult): DispatchNodeResult {
  const base: DispatchNodeResult = { nodeId, classification: result.kind };
  if (result.ok && (result.kind === 'committed' || result.kind === 'already_committed')) return { ...base, tick: result.tick };
  if (!result.ok && result.kind === 'stale_claim' && result.reason) return { ...base, reason: result.reason };
  if (!result.ok && result.kind === 'foreign_reference' && result.relation) return { ...base, reason: result.relation.slice(0, 80) };
  if (!result.ok && result.kind.endsWith('_rejected')) return { ...base, reason: 'authoritative input rejected' };
  if (!result.ok && (result.kind.endsWith('_transport_error') || result.kind.startsWith('malformed_') || result.kind === 'resolver_failed')) {
    return { ...base, reason: 'worker failed safely' };
  }
  return base;
}

/** Discover and process one fixed, bounded batch. Never retries or loops. */
export async function dispatchNodeTicksOnce(deps: DispatchDependencies): Promise<DispatchRunResult> {
  let raw: unknown;
  try {
    raw = await deps.discoverDueNodes(DISPATCH_LIMIT);
  } catch {
    return refusal('discovery_failed', 'due-node discovery failed');
  }

  const envelope = object(raw);
  if (!envelope || typeof envelope.ok !== 'boolean' || typeof envelope.kind !== 'string') {
    return refusal('discovery_failed', 'malformed due-node response');
  }
  if (envelope.ok === false && (envelope.kind === 'maintenance' || envelope.kind === 'world_asleep')) {
    return refusal(envelope.kind);
  }
  if (envelope.ok !== true || envelope.kind !== 'candidates' || !Array.isArray(envelope.candidates)) {
    return refusal('discovery_failed', 'unknown due-node response');
  }
  if (envelope.candidates.length > DISPATCH_LIMIT) {
    return refusal('discovery_failed', 'due-node response exceeded fixed limit');
  }

  const candidates: DueNodeCandidate[] = [];
  const seen = new Set<string>();
  for (const value of envelope.candidates) {
    const candidate = object(value);
    if (!candidate || typeof candidate.node_id !== 'string' || !UUID_RE.test(candidate.node_id) ||
        typeof candidate.encounter_id !== 'string' || !UUID_RE.test(candidate.encounter_id) ||
        typeof candidate.next_due_at !== 'string' || Number.isNaN(Date.parse(candidate.next_due_at)) ||
        seen.has(candidate.node_id)) {
      return refusal('discovery_failed', 'malformed due-node candidate');
    }
    seen.add(candidate.node_id);
    candidates.push(candidate as unknown as DueNodeCandidate);
  }

  const results: DispatchNodeResult[] = [];
  const summary: Record<string, number> = {};
  for (const candidate of candidates) {
    let item: DispatchNodeResult;
    try {
      item = safeWorkerResult(candidate.node_id, await deps.processNode(candidate.node_id));
    } catch {
      item = { nodeId: candidate.node_id, classification: 'worker_exception', reason: 'worker threw unexpectedly' };
    }
    results.push(item);
    summary[item.classification] = (summary[item.classification] ?? 0) + 1;
  }

  return {
    ok: true,
    classification: 'dispatched',
    candidateCount: candidates.length,
    processedCount: results.length,
    summary,
    results,
    moreMayRemain: candidates.length === DISPATCH_LIMIT,
  };
}
