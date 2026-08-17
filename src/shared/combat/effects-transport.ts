/**
 * effects-transport.ts — TypeScript mirror of the internal effects-only
 * dispatcher's TRANSPORT result ownership.
 *
 * The deployed twins are:
 *   public.effects_catchup_reconcile()   — classification + retry accounting
 *   public.effects_due_dispatch()        — in-flight suppression
 *   public.effects_catchup_send()        — request-id persistence
 *
 * Why this exists: the dispatcher used to treat "pg_net returned a request id"
 * as delivery and depended entirely on the Edge handler calling
 * `record_effects_catchup_result`. When the handler rejected the dispatcher's
 * credential with 401 before ever entering, no callback was made, so the lease
 * stayed held with `failures = 0`, `last_outcome = null` — an invisible stall.
 * The HTTP response, not the callback, is now authoritative.
 */

export type TransportClass =
  | 'delivered_committed'
  | 'delivered_refused'
  | 'delivered_unparsed'
  | 'gateway_rejected'
  | 'not_found'
  | 'http_4xx'
  | 'http_5xx'
  | 'transport_failure'
  | 'timeout';

export interface HttpResponseRow {
  readonly status_code: number | null;
  readonly error_msg: string | null;
  /** Raw response body text, if any. */
  readonly content: string | null;
}

export interface TransportVerdict {
  readonly klass: TransportClass;
  readonly retryable: boolean;
  readonly failure: boolean;
  readonly reason: string | null;
}

/** Never let a credential survive into a log line. */
export function redactTransportText(text: string | null | undefined): string {
  return (text ?? '')
    .replace(/(bearer|apikey|authorization)[^,}"]*/gi, (m) => `${m.split(/\s|=|:/)[0]} [redacted]`)
    .replace(/ey[A-Za-z0-9_-]{10,}/g, '[redacted-token]')
    .slice(0, 300);
}

function parse(content: string | null): Record<string, unknown> | null {
  if (!content) return null;
  try {
    const v = JSON.parse(content);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Classify one completed pg_net response. `null` response means no row yet:
 * only an elapsed timeout window makes that authoritative.
 */
export function classifyTransport(
  response: HttpResponseRow | null,
  opts: { ageMs: number; timeoutMs?: number } = { ageMs: 0 },
): TransportVerdict | null {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  if (!response) {
    if (opts.ageMs < timeoutMs) return null; // still legitimately in flight
    return { klass: 'timeout', retryable: true, failure: true, reason: 'no_response_within_15s' };
  }

  const body = parse(response.content);
  if (response.error_msg) {
    return {
      klass: 'transport_failure',
      retryable: true,
      failure: true,
      reason: redactTransportText(response.error_msg),
    };
  }
  const status = response.status_code;
  if (status === null) {
    return { klass: 'transport_failure', retryable: true, failure: true, reason: 'no_status' };
  }
  if (status === 401 || status === 403) {
    return {
      klass: 'gateway_rejected',
      retryable: false,
      failure: true,
      reason: (body?.reason as string) ?? 'rejected_before_handler',
    };
  }
  if (status === 404) {
    return { klass: 'not_found', retryable: false, failure: true, reason: 'wrong_function_path' };
  }
  if (status >= 500) {
    return {
      klass: 'http_5xx',
      retryable: true,
      failure: true,
      reason: redactTransportText(response.content?.slice(0, 200) ?? ''),
    };
  }
  if (status >= 400) {
    return {
      klass: 'http_4xx',
      retryable: false,
      failure: true,
      reason: (body?.reason as string) ?? 'client_error',
    };
  }
  if (body?.ok === true) {
    return { klass: 'delivered_committed', retryable: false, failure: false, reason: null };
  }
  if (body && body.ok === false) {
    return {
      klass: 'delivered_refused',
      retryable: false,
      failure: true,
      reason: `${(body.kind as string) ?? 'refused'}:${(body.reason as string) ?? ''}`,
    };
  }
  return { klass: 'delivered_unparsed', retryable: false, failure: true, reason: 'unparsable_body' };
}

export interface DispatchRow {
  readonly encounterId: string;
  readonly dispatchId: string;
  readonly attempt: number;
  readonly requestId: number | null;
  readonly requestGeneration: number | null;
  readonly requestedAtMs: number | null;
  readonly completedAt: number | null;
  readonly leaseUntil: number;
  readonly backoffUntil: number;
  readonly failures: number;
  readonly lastOutcome: string | null;
}

/**
 * A response may only mutate the attempt that OWNS it. A late response from a
 * superseded generation must never clear a newer lease.
 */
export function ownsResponse(row: DispatchRow, requestId: number, generation: number): boolean {
  return row.requestId === requestId && row.requestGeneration === generation;
}

/**
 * In-flight suppression: a two-second scheduler must not stack a second HTTP
 * request on an encounter whose previous request has not resolved or timed out.
 */
export function canDispatch(row: DispatchRow | null, nowMs: number, timeoutMs = 15_000): boolean {
  if (!row) return true;
  const inFlight =
    row.requestId !== null &&
    row.completedAt === null &&
    row.requestedAtMs !== null &&
    nowMs - row.requestedAtMs < timeoutMs;
  if (inFlight) return false;
  return row.leaseUntil <= nowMs && row.backoffUntil <= nowMs;
}

/** Retry accounting after a verdict becomes authoritative. */
export function applyVerdict(
  row: DispatchRow,
  verdict: TransportVerdict,
  nowMs: number,
): Pick<DispatchRow, 'failures' | 'leaseUntil' | 'backoffUntil' | 'lastOutcome'> & {
  completed: true;
} {
  // A successful Edge callback already released the lease and recorded 'ok';
  // the transport verdict must not turn a committed tick into a failure.
  const callbackSucceeded = row.lastOutcome === 'ok';
  const failure = verdict.failure && !callbackSucceeded && verdict.klass !== 'delivered_committed';
  const failures = failure ? row.failures + 1 : callbackSucceeded ? row.failures : 0;
  return {
    completed: true,
    failures,
    leaseUntil: 0,
    backoffUntil: !failure
      ? 0
      : verdict.retryable
        ? nowMs + Math.min(30_000, 1000 * 2 ** Math.min(failures, 5))
        : nowMs + 60_000,
    lastOutcome: row.lastOutcome ?? (verdict.klass === 'delivered_committed' ? 'ok' : verdict.klass),
  };
}
