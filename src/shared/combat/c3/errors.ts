/**
 * c3/errors.ts — structured error classification for the C3 orchestration.
 *
 * Every failure the authoritative flow can produce is one of these kinds, so
 * the two Edge Function handlers never invent their own vocabulary and never
 * return simulated events on a failure path.
 */

export type C3ErrorKind =
  /** Combat is closed by the C0 maintenance gate. */
  | 'maintenance'
  /** No encounter could be resolved for the invoking participant. */
  | 'no_encounter'
  /** Another resolver (or the other mode) owns the tick. Retryable no-op. */
  | 'claim_refused'
  /** Snapshot load refused: stale claim / expired lease / version mismatch. */
  | 'snapshot_refused'
  /** Snapshot payload did not satisfy the C1 contract. Never retry blindly. */
  | 'decode_failed'
  /** The pure resolver threw. Nothing was written; claim is released. */
  | 'resolver_failed'
  /** The proposal failed the TypeScript validation mirror before commit. */
  | 'payload_invalid'
  /** commit_encounter_tick_v2 refused. Reason carried verbatim. */
  | 'commit_refused'
  /** Ownership was lost between snapshot and commit. Proposal discarded. */
  | 'lease_lost'
  /** Transport/unexpected failure. */
  | 'internal';

export interface C3Failure {
  readonly ok: false;
  readonly kind: C3ErrorKind;
  readonly reason: string;
  /** True when the caller may simply try again on the next cadence. */
  readonly retryable: boolean;
  readonly detail?: unknown;
}

export class C3Error extends Error {
  readonly kind: C3ErrorKind;
  readonly reason: string;
  readonly retryable: boolean;
  readonly detail?: unknown;

  constructor(kind: C3ErrorKind, reason: string, opts?: { retryable?: boolean; detail?: unknown }) {
    super(`${kind}:${reason}`);
    this.name = 'C3Error';
    this.kind = kind;
    this.reason = reason;
    this.retryable = opts?.retryable ?? RETRYABLE_BY_DEFAULT.has(kind);
    this.detail = opts?.detail;
  }

  toFailure(): C3Failure {
    return {
      ok: false,
      kind: this.kind,
      reason: this.reason,
      retryable: this.retryable,
      ...(this.detail === undefined ? {} : { detail: this.detail }),
    };
  }
}

const RETRYABLE_BY_DEFAULT = new Set<C3ErrorKind>([
  'claim_refused',
  'snapshot_refused',
  'commit_refused',
  'lease_lost',
]);

/** A decode failure is always a contract defect: explicit, never retried. */
export function decodeError(path: string, message: string): C3Error {
  return new C3Error('decode_failed', `${path}: ${message}`, { retryable: false });
}
