/** Server-only, single-claim/single-resolution/single-commit orchestration. */
import * as bossCatalog from './boss-catalog.ts';
import * as playerCatalog from './catalog.ts';
import { decodeClaim } from './decode.ts';
import type { ClaimDecodeResult } from './decode.ts';
import * as resolver from './resolver.ts';
import type { AuthoredAbilityRecord, CatalogRejection } from './catalog.ts';
import type { BossCastRejection } from './boss-catalog.ts';
import type { ProposedTick } from './types.ts';

export interface CommitTickArgs {
  _encounter_id: string;
  _claim_token: string;
  _candidate_tick: number;
  _expected_last_tick: number;
  _expected_state_version: number;
  _intent_ids: string[];
  _proposed: ProposedTick;
}

export interface NodeTickTransport {
  claimNode(nodeId: string): Promise<unknown>;
  commitTick(args: CommitTickArgs): Promise<unknown>;
}

export interface ProcessNodeTickDependencies {
  transport: NodeTickTransport;
  abilityRecords: readonly AuthoredAbilityRecord[];
  /** Test seam for the pure resolver; production callers omit it. */
  resolve?: typeof resolver.resolveNodeTick;
}

export type NodeTickRunResult =
  | { ok: true; kind: 'committed' | 'already_committed'; encounterId: string; tick: number }
  | { ok: true; kind: 'not_due'; nextDueAt: string | null }
  | { ok: true; kind: 'in_flight' | 'locked_or_absent' }
  | { ok: false; kind: 'claim_transport_error' | 'commit_transport_error'; diagnostic: string; stage: 'claim' | 'commit'; code?: string }
  | { ok: false; kind: 'malformed_claim' | 'malformed_commit'; diagnostic: string }
  | { ok: false; kind: 'snapshot_rejected'; errors: string[] }
  | { ok: false; kind: 'player_catalog_rejected'; rejected: readonly CatalogRejection[] }
  | { ok: false; kind: 'boss_catalog_rejected'; rejected: BossCastRejection[] }
  | { ok: false; kind: 'resolver_failed'; diagnostic: string }
  | { ok: false; kind: 'stale_claim'; encounterId: string; reason: 'no_encounter' | null }
  | { ok: false; kind: 'stale_snapshot'; encounterId: string }
  | { ok: false; kind: 'foreign_reference'; encounterId: string; relation: string | null };

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/** Explicit guard: discriminant narrowing on `ok` is unreliable under tsgo here. */
function isDecodeFailure(
  result: ClaimDecodeResult,
): result is Extract<ClaimDecodeResult, { ok: false }> {
  return result.ok === false;
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 300) : 'unknown error';
}

function safeTransportFailure(error: unknown, stage: 'claim' | 'commit') {
  const value = object(error);
  const code = typeof value?.code === 'string' && /^[A-Z0-9]{5}$/i.test(value.code) ? value.code : undefined;
  return { diagnostic: 'transport failed safely', stage, ...(code ? { code } : {}) };
}

/** Process at most one authoritative tick for one node. Never retries. */
export async function processNodeTickOnce(
  nodeId: string,
  dependencies: ProcessNodeTickDependencies,
): Promise<NodeTickRunResult> {
  let claimRaw: unknown;
  try {
    claimRaw = await dependencies.transport.claimNode(nodeId);
  } catch (error) {
    return { ok: false, kind: 'claim_transport_error', ...safeTransportFailure(error, 'claim') };
  }

  const claim = object(claimRaw);
  if (!claim || typeof claim.ok !== 'boolean' || typeof claim.kind !== 'string') {
    return { ok: false, kind: 'malformed_claim', diagnostic: 'claim envelope is not structured' };
  }
  if (claim.ok === false && claim.kind === 'not_due') {
    if (claim.next_due_at !== undefined && claim.next_due_at !== null && typeof claim.next_due_at !== 'string') {
      return { ok: false, kind: 'malformed_claim', diagnostic: 'not_due.next_due_at is invalid' };
    }
    return { ok: true, kind: 'not_due', nextDueAt: (claim.next_due_at as string | null | undefined) ?? null };
  }
  if (claim.ok === false && claim.kind === 'no_claim' && claim.reason === 'in_flight') {
    return { ok: true, kind: 'in_flight' };
  }
  if (claim.ok === false && claim.kind === 'no_claim' && claim.reason === 'locked_or_absent') {
    return { ok: true, kind: 'locked_or_absent' };
  }
  if (claim.ok !== true || claim.kind !== 'claimed') {
    return { ok: false, kind: 'malformed_claim', diagnostic: 'unknown claim outcome' };
  }

  const decoded = decodeClaim(claim);
  if (isDecodeFailure(decoded)) return { ok: false, kind: 'snapshot_rejected', errors: decoded.errors.slice(0, 20) };
  if (decoded.snapshot.boss_configurations === undefined) {
    return { ok: false, kind: 'snapshot_rejected', errors: ['snapshot.boss_configurations: required by worker'] };
  }
  const encounterId = claim.encounter_id;
  if (typeof encounterId !== 'string' || encounterId !== decoded.snapshot.encounter.id ||
      claim.candidate_tick !== decoded.snapshot.encounter.candidate_tick ||
      claim.last_committed_tick !== decoded.snapshot.encounter.tick ||
      claim.state_version !== decoded.snapshot.encounter.state_version) {
    return { ok: false, kind: 'malformed_claim', diagnostic: 'claim authority fields disagree with snapshot' };
  }

  const abilities = playerCatalog.buildAbilityCatalog(dependencies.abilityRecords);
  if (abilities.rejected.length > 0) {
    return { ok: false, kind: 'player_catalog_rejected', rejected: abilities.rejected };
  }
  const bosses = bossCatalog.adaptClaimedBossCatalog(decoded.snapshot);
  if (bosses.rejected.length > 0) {
    return { ok: false, kind: 'boss_catalog_rejected', rejected: bosses.rejected };
  }

  let proposal: ProposedTick;
  try {
    proposal = (dependencies.resolve ?? resolver.resolveNodeTick)(bosses.snapshot, { abilities: abilities.specs });
  } catch (error) {
    return { ok: false, kind: 'resolver_failed', diagnostic: safeError(error) };
  }

  let commitRaw: unknown;
  try {
    commitRaw = await dependencies.transport.commitTick({
      _encounter_id: encounterId,
      _claim_token: decoded.claimToken!,
      _candidate_tick: decoded.snapshot.encounter.candidate_tick,
      _expected_last_tick: decoded.snapshot.encounter.tick,
      _expected_state_version: decoded.snapshot.encounter.state_version,
      _intent_ids: proposal.intent_ids,
      _proposed: proposal,
    });
  } catch (error) {
    return { ok: false, kind: 'commit_transport_error', ...safeTransportFailure(error, 'commit') };
  }

  const commit = object(commitRaw);
  if (!commit || typeof commit.ok !== 'boolean' || typeof commit.kind !== 'string') {
    return { ok: false, kind: 'malformed_commit', diagnostic: 'commit envelope is not structured' };
  }
  if (commit.ok === true && (commit.kind === 'committed' || commit.kind === 'already_committed') &&
      typeof commit.tick === 'number') {
    return { ok: true, kind: commit.kind, encounterId, tick: commit.tick };
  }
  if (commit.ok === false && commit.kind === 'stale_claim') {
    const reason = commit.reason === 'no_encounter' ? 'no_encounter' : null;
    return { ok: false, kind: 'stale_claim', encounterId, reason };
  }
  if (commit.ok === false && commit.kind === 'stale_snapshot') {
    return { ok: false, kind: 'stale_snapshot', encounterId };
  }
  if (commit.ok === false && commit.kind === 'foreign_reference') {
    return {
      ok: false,
      kind: 'foreign_reference',
      encounterId,
      relation: typeof commit.relation === 'string' ? commit.relation : null,
    };
  }
  return { ok: false, kind: 'malformed_commit', diagnostic: 'unknown commit outcome' };
}
