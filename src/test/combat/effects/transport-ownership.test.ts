/**
 * Transport result ownership for the internal effects-only dispatcher.
 *
 * Regression origin: a deployed dispatch was leased five times, pg_net returned
 * request ids, the Edge handler answered 401 before entry, and because only the
 * handler callback could complete a dispatch the row stayed at
 * `failures = 0 / last_outcome = null / lease held` while the due bleed never
 * advanced. These cases pin the corrected rules.
 */
import { describe, it, expect } from 'vitest';
import {
  applyVerdict,
  canDispatch,
  classifyTransport,
  ownsResponse,
  redactTransportText,
  type DispatchRow,
} from '@/shared/combat/effects-transport';

const NOW = 1_000_000;

const base: DispatchRow = {
  encounterId: 'enc-1',
  dispatchId: 'dsp-1',
  attempt: 3,
  requestId: 1164,
  requestGeneration: 3,
  requestedAtMs: NOW - 500,
  completedAt: null,
  leaseUntil: NOW + 10_000,
  backoffUntil: 0,
  failures: 0,
  lastOutcome: null,
};

describe('pg_net request identity', () => {
  it('stores the request id on the attempt that created it', () => {
    expect(ownsResponse(base, 1164, 3)).toBe(true);
  });

  it('refuses a response from an older dispatch generation', () => {
    expect(ownsResponse({ ...base, attempt: 4, requestGeneration: 4, requestId: 1200 }, 1164, 3))
      .toBe(false);
  });
});

describe('classification', () => {
  it('delivered and committed', () => {
    const v = classifyTransport({ status_code: 200, error_msg: null, content: '{"ok":true}' })!;
    expect(v).toMatchObject({ klass: 'delivered_committed', failure: false, retryable: false });
  });

  it('delivered but product-refused', () => {
    const v = classifyTransport({
      status_code: 200,
      error_msg: null,
      content: '{"ok":false,"kind":"no_work","reason":"nothing_due"}',
    })!;
    expect(v.klass).toBe('delivered_refused');
    expect(v.reason).toBe('no_work:nothing_due');
    expect(v.retryable).toBe(false);
  });

  it('detects gateway/JWT rejection before handler entry', () => {
    for (const status of [401, 403]) {
      const v = classifyTransport({
        status_code: status,
        error_msg: null,
        content: '{"ok":false,"kind":"unauthorized","reason":"missing or invalid credential"}',
      })!;
      expect(v.klass).toBe('gateway_rejected');
      expect(v.failure).toBe(true);
      expect(v.retryable).toBe(false);
    }
  });

  it('detects a wrong function path', () => {
    const v = classifyTransport({ status_code: 404, error_msg: null, content: 'not found' })!;
    expect(v).toMatchObject({ klass: 'not_found', failure: true, retryable: false });
  });

  it('treats 5xx as retryable', () => {
    const v = classifyTransport({ status_code: 503, error_msg: null, content: 'unavailable' })!;
    expect(v).toMatchObject({ klass: 'http_5xx', retryable: true, failure: true });
  });

  it('treats other 4xx as non-retryable', () => {
    const v = classifyTransport({
      status_code: 400,
      error_msg: null,
      content: '{"ok":false,"reason":"body is not valid JSON"}',
    })!;
    expect(v).toMatchObject({ klass: 'http_4xx', retryable: false });
  });

  it('treats a transport error as retryable', () => {
    const v = classifyTransport({ status_code: null, error_msg: 'dns error', content: null })!;
    expect(v).toMatchObject({ klass: 'transport_failure', retryable: true });
  });

  it('only calls a missing response a timeout after the window elapses', () => {
    expect(classifyTransport(null, { ageMs: 3_000 })).toBeNull();
    expect(classifyTransport(null, { ageMs: 20_000 })).toMatchObject({
      klass: 'timeout',
      retryable: true,
      failure: true,
    });
  });
});

describe('retry accounting', () => {
  it('a successful callback releases the lease immediately and clears failures', () => {
    const afterCallback: DispatchRow = { ...base, lastOutcome: 'ok', leaseUntil: 0, completedAt: NOW };
    const v = classifyTransport({ status_code: 200, error_msg: null, content: '{"ok":true}' })!;
    const next = applyVerdict(afterCallback, v, NOW);
    expect(next).toMatchObject({ leaseUntil: 0, backoffUntil: 0, failures: 0, lastOutcome: 'ok' });
  });

  it('an Edge commit whose callback then failed does not repeat the committed tick', () => {
    // Handler committed and recorded 'ok', but the HTTP response never parsed.
    const committed: DispatchRow = { ...base, lastOutcome: 'ok' };
    const v = classifyTransport({ status_code: 200, error_msg: null, content: 'gateway garbage' })!;
    const next = applyVerdict(committed, v, NOW);
    expect(next.failures).toBe(0);
    expect(next.backoffUntil).toBe(0);
    expect(next.lastOutcome).toBe('ok');
  });

  it('never leaves a failed attempt at failures = 0 with no outcome', () => {
    const v = classifyTransport({
      status_code: 401,
      error_msg: null,
      content: '{"ok":false,"reason":"missing or invalid credential"}',
    })!;
    const next = applyVerdict(base, v, NOW);
    expect(next.failures).toBe(1);
    expect(next.lastOutcome).toBe('gateway_rejected');
    expect(next.leaseUntil).toBe(0);
    expect(next.backoffUntil).toBeGreaterThan(NOW);
  });

  it('advances failure count and backoff over repeated retryable failures', () => {
    let row = { ...base };
    const v = classifyTransport({ status_code: 500, error_msg: null, content: 'boom' })!;
    const seen: number[] = [];
    for (let i = 0; i < 6; i++) {
      const next = applyVerdict(row, v, NOW);
      seen.push(next.backoffUntil - NOW);
      row = { ...row, failures: next.failures, lastOutcome: null };
    }
    expect(row.failures).toBe(6);
    expect(seen[0]).toBe(2000);
    expect(seen[1]).toBe(4000);
    expect(seen.at(-1)).toBe(30_000); // capped
  });
});

describe('in-flight suppression', () => {
  it('a pending request prevents a duplicate dispatch', () => {
    expect(canDispatch(base, NOW)).toBe(false);
  });

  it('allows dispatch once the pending request timed out', () => {
    expect(canDispatch({ ...base, requestedAtMs: NOW - 20_000, leaseUntil: 0 }, NOW)).toBe(true);
  });

  it('allows dispatch once the request completed and the lease released', () => {
    expect(canDispatch({ ...base, completedAt: NOW - 10, leaseUntil: 0 }, NOW)).toBe(true);
  });

  it('respects backoff', () => {
    expect(canDispatch({ ...base, completedAt: NOW, leaseUntil: 0, backoffUntil: NOW + 5000 }, NOW))
      .toBe(false);
  });

  it('dispatches when nothing has ever been sent', () => {
    expect(canDispatch(null, NOW)).toBe(true);
  });
});

describe('log redaction', () => {
  it('redacts bearer credentials and JWT-shaped tokens', () => {
    const out = redactTransportText(
      'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.sig failed',
    );
    expect(out).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(out).toContain('[redacted');
  });

  it('caps length so bodies cannot smuggle payloads into logs', () => {
    expect(redactTransportText('x'.repeat(5000)).length).toBe(300);
  });
});
