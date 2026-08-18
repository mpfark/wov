/**
 * combat-trace.ts — development-only combat timing instrumentation.
 *
 * Owns: a bounded ring buffer of per-tick timing samples plus the rolling
 * percentile summary the dev timing panel renders. Nothing here changes combat
 * behaviour: every entry point is a no-op when tracing is disabled.
 *
 * The point of this module is to answer one question precisely: when combat
 * "pauses then bursts", is that
 *   - legitimate catch-up (server resolved several ticks in one response),
 *   - delayed delivery (request round-trip spike), or
 *   - delayed presentation (result applied late / painted late)?
 *
 * Pure module state (no React), so it can be read from hooks and the panel.
 */

const MAX_SAMPLES = 120;

export type TickCause = 'cadence' | 'ability' | 'wakeup' | 'visibility' | 'broadcast' | 'followup';

export interface CombatTraceSample {
  /** Monotonic client tick sequence (or 0 for broadcast-only samples). */
  seq: number;
  cause: TickCause;
  /** Client clock when the request was submitted. */
  startedAt: number;
  /** Gap since the previous applied tick (ms). */
  gapMs: number;
  /** Ability label if this tick carried a queued ability dispatch. */
  abilityLabel?: string;
  /** ms from the player pressing the ability to the request submission. */
  buttonToSubmitMs?: number;
  /** Request round-trip (submit → response received). */
  roundTripMs?: number;
  /** Server-side resolve duration, when the server reports it. */
  serverResolveMs?: number;
  /** ms from response received to the result being applied to React state. */
  applyMs?: number;
  /** ms from apply to the next browser paint. */
  paintMs?: number;
  /** Server ticks folded into this one response (>1 == legitimate catch-up). */
  ticksProcessed?: number;
  /** Shared-encounter identity, when published. */
  encounterTick?: number | null;
  batchId?: string | null;
  /**
   * Classification fields (added so a validation run is classifiable from the
   * trace alone rather than by re-deriving intent from a request log):
   * why the request was made, what the server answered, and how the next wake
   * was computed.
   */
  refusalReason?: string;
  terminal?: boolean;
  /** Server clock sampled in the commit transaction. */
  serverNowMs?: number | null;
  /** Next scheduled boundary the server reported. */
  nextDueAtMs?: number | null;
  /** Server-measured span from claim answer to the clock sample. */
  serverProcessMs?: number | null;
  /** Round trip minus server processing = measured network time. */
  networkMs?: number;
  /** Remaining time to the boundary at the server's sample. */
  remainingMs?: number;
  /** Delay the pacer chose for the next request after this answer. */
  plannedDelayMs?: number;
  /** Set when the response was ignored (stale seq, reserved elsewhere, dropped). */
  outcome?: 'applied' | 'stale' | 'reserved' | 'error' | 'duplicate' | 'empty';

}

type Listener = () => void;

const samples: CombatTraceSample[] = [];
const listeners = new Set<Listener>();
const bySeq = new Map<number, CombatTraceSample>();

/** Timestamp of the last ability button press awaiting submission. */
let pendingAbilityPressAt: number | null = null;
let pendingAbilityLabel: string | null = null;

let enabled =
  typeof window !== 'undefined' &&
  (import.meta.env.DEV || window.localStorage?.getItem('wov.combatTrace') === '1');

export function isCombatTraceEnabled(): boolean {
  return enabled;
}

export function setCombatTraceEnabled(next: boolean) {
  enabled = next;
  try {
    window.localStorage?.setItem('wov.combatTrace', next ? '1' : '0');
  } catch { /* private mode */ }
  emit();
}

function emit() {
  for (const l of listeners) l();
}

export function subscribeCombatTrace(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getCombatTraceSamples(): CombatTraceSample[] {
  return samples;
}

export function clearCombatTrace() {
  samples.length = 0;
  bySeq.clear();
  pendingAbilityPressAt = null;
  pendingAbilityLabel = null;
  emit();
}

/** Player pressed an ability button — starts the button-to-submission clock. */
export function traceAbilityPress(label: string) {
  if (!enabled) return;
  pendingAbilityPressAt = Date.now();
  pendingAbilityLabel = label;
}

/** A tick request is being submitted. */
export function traceTickStart(seq: number, cause: TickCause, gapMs: number, carriedAbility: boolean) {
  if (!enabled) return;
  const sample: CombatTraceSample = {
    seq,
    cause,
    startedAt: Date.now(),
    gapMs,
  };
  if (carriedAbility && pendingAbilityPressAt !== null) {
    sample.buttonToSubmitMs = Date.now() - pendingAbilityPressAt;
    sample.abilityLabel = pendingAbilityLabel ?? undefined;
    pendingAbilityPressAt = null;
    pendingAbilityLabel = null;
  }
  samples.push(sample);
  bySeq.set(seq, sample);
  while (samples.length > MAX_SAMPLES) {
    const dropped = samples.shift();
    if (dropped) bySeq.delete(dropped.seq);
  }
  emit();
}

export interface TickResponseTrace {
  roundTripMs: number;
  ticksProcessed?: number;
  encounterTick?: number | null;
  batchId?: string | null;
  outcome: NonNullable<CombatTraceSample['outcome']>;
  /** Server-reported resolve duration in ms, when present in the payload. */
  serverResolveMs?: number;
  /** Classification of a refusal, so `not_due` bursts are self-evident. */
  refusalReason?: string;
  terminal?: boolean;
  serverNowMs?: number | null;
  nextDueAtMs?: number | null;
  serverProcessMs?: number | null;
  networkMs?: number;
  remainingMs?: number;
  plannedDelayMs?: number;
}

export function traceTickResponse(seq: number, info: TickResponseTrace) {
  if (!enabled) return;
  const sample = bySeq.get(seq);
  if (!sample) return;
  sample.roundTripMs = info.roundTripMs;
  sample.ticksProcessed = info.ticksProcessed;
  sample.encounterTick = info.encounterTick ?? null;
  sample.batchId = info.batchId ?? null;
  sample.outcome = info.outcome;
  sample.serverResolveMs = info.serverResolveMs;
  sample.refusalReason = info.refusalReason;
  sample.terminal = info.terminal;
  sample.serverNowMs = info.serverNowMs ?? null;
  sample.nextDueAtMs = info.nextDueAtMs ?? null;
  sample.serverProcessMs = info.serverProcessMs ?? null;
  sample.networkMs = info.networkMs;
  sample.remainingMs = info.remainingMs;
  sample.plannedDelayMs = info.plannedDelayMs;
  emit();
}


/**
 * The result was applied to React state. Also schedules a paint measurement so
 * a "burst" caused by late rendering is distinguishable from late delivery.
 */
export function traceTickApplied(seq: number, receivedAt: number) {
  if (!enabled) return;
  const sample = bySeq.get(seq);
  if (!sample) return;
  const appliedAt = Date.now();
  sample.applyMs = appliedAt - receivedAt;
  emit();
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => {
      sample.paintMs = Date.now() - appliedAt;
      emit();
    });
  }
}

/** Records a broadcast-delivered tick (party follower path). */
export function traceBroadcastTick(gapMs: number, ticksProcessed?: number, batchId?: string | null) {
  if (!enabled) return;
  samples.push({
    seq: 0,
    cause: 'broadcast',
    startedAt: Date.now(),
    gapMs,
    ticksProcessed,
    batchId: batchId ?? null,
    outcome: 'applied',
  });
  while (samples.length > MAX_SAMPLES) samples.shift();
  emit();
}

// ── Summary ────────────────────────────────────────────────────

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

export interface TraceMetric {
  p50: number | null;
  p95: number | null;
  count: number;
}

export interface CombatTraceSummary {
  buttonToSubmit: TraceMetric;
  cadenceGap: TraceMetric;
  roundTrip: TraceMetric;
  serverResolve: TraceMetric;
  apply: TraceMetric;
  paint: TraceMetric;
  /** Responses that folded more than one server tick (legitimate catch-up). */
  catchupCount: number;
  /** Responses discarded as stale / reserved / duplicate. */
  discardedCount: number;
  totalSamples: number;
}

function metric(values: (number | undefined)[]): TraceMetric {
  const nums = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  return { p50: percentile(nums, 50), p95: percentile(nums, 95), count: nums.length };
}

export function getCombatTraceSummary(): CombatTraceSummary {
  return {
    buttonToSubmit: metric(samples.map(s => s.buttonToSubmitMs)),
    cadenceGap: metric(samples.map(s => s.gapMs)),
    roundTrip: metric(samples.map(s => s.roundTripMs)),
    serverResolve: metric(samples.map(s => s.serverResolveMs)),
    apply: metric(samples.map(s => s.applyMs)),
    paint: metric(samples.map(s => s.paintMs)),
    catchupCount: samples.filter(s => (s.ticksProcessed ?? 0) > 1).length,
    discardedCount: samples.filter(s => s.outcome && s.outcome !== 'applied').length,
    totalSamples: samples.length,
  };
}
