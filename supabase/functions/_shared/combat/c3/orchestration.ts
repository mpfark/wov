/**
 * c3/orchestration.ts — the ONE authoritative combat execution pipeline.
 *
 * Both Edge Functions (`combat-tick`, `combat-catchup`) are thin shells over
 * `orchestrateCombatResolution`. Neither owns cadence, ownership, rules or
 * randomness; they only supply a request, a service-role client and a clock.
 *
 * Pipeline (identical for both modes, differing only in `supportedModes`):
 *
 *   1. C0 maintenance gate            — fail closed unless mode is `open`
 *   2. intake / encounter resolution  — one live encounter per node
 *   3. claim_encounter_tick           — sole source of ownership + mode
 *   4. encounter_snapshot_v2          — immutable state under the claim
 *   5. loadSnapshotAux + decode       — strict C1 contract, no defaulting
 *   6. resolveTickPure                — pure, seeded, no IO
 *   7. commit_encounter_tick_v2       — atomic apply, or nothing at all
 *   8. release on any failure          — the claim is never leaked
 *
 * Mutual exclusion: the database decides whether a tick is `live` or
 * `effects_only` from encounter presence. A handler passes only the modes it
 * is allowed to resolve, so catch-up can never take a live tick and live can
 * never take a catch-up tick. Catch-up therefore acquires no independent
 * authority — it competes for the same single claim.
 */

import { resolveTickPure } from '../pure/resolver.ts';
import type { ProposedTick } from '../pure/types.ts';
import { buildCommitRequest } from '../c2/payload.ts';
import type { SessionPresenceProposal } from '../c2/contract.ts';
import { decodeEncounterSnapshot } from './decode-snapshot.ts';
import { loadSnapshotAux, snapshotAbilityConfigVersion, type AbilityCatalog } from './loader.ts';
import { C3Error, type C3Failure } from './errors.ts';
import { parseCombatMode, COMBAT_MODE_KEY, COMBAT_MAINTENANCE_MESSAGE } from '../maintenance.ts';

/** Minimal supabase-js surface the pipeline uses. */
export interface OrchestrationDb {
  from: (table: string) => any;
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: any; error: any }>;
}

export interface OrchestrationRequest {
  /** Resolver role of the caller. Decides which claim modes are acceptable. */
  readonly role: 'live' | 'catchup';
  /** Invoking character. Required for `live` (intake); optional for catch-up. */
  readonly characterId?: string | null;
  /** Node to sweep. Required for catch-up when no character is supplied. */
  readonly nodeId?: string | null;
  /** Creatures the caller wants to engage. Filtered server-side by intake. */
  readonly creatureIds?: readonly string[];
  /**
   * Encounter this catch-up invocation owns. Internal effects-only workers are
   * scoped by `encounter_id + node_id` and carry no character at all.
   */
  readonly encounterId?: string | null;
  /**
   * Set only by the internal effects-only worker after the database confirmed,
   * under maintenance, that the ENTIRE scope (encounter, node, characters,
   * creatures) is explicitly granted. Never derived from a request body.
   */
  readonly scopeGranted?: boolean;
}

export interface OrchestrationDeps {
  readonly db: OrchestrationDb;
  /** Authoritative time, injected once and used everywhere downstream. */
  readonly nowMs: number;
  readonly catalog: AbilityCatalog;
  /**
   * Rebuild the ability catalog from live configuration. Called at most once,
   * only when the catalog's `configVersion` disagrees with the snapshot's; a
   * still-mismatched catalog fails the tick closed (`config_conflict`).
   */
  readonly refreshCatalog?: () => Promise<AbilityCatalog>;
  readonly newBatchId: () => string;
  readonly caller: string;
  readonly leaseMs?: number;
  /** Minimum spacing between ticks of one encounter. */
  readonly rateMs?: number;
  readonly log?: (message: string, detail?: unknown) => void;

}

export interface OrchestrationSuccess {
  readonly ok: true;
  readonly encounterId: string;
  readonly tick: number;
  readonly mode: ProposedTick['mode'];
  readonly batchId: string;
  readonly ticksProcessed: number;
  readonly rngDraws: number;
  readonly events: ProposedTick['events'];
  readonly configFailures: readonly string[];
}

export type OrchestrationResult = OrchestrationSuccess | C3Failure;

const DEFAULT_LEASE_MS = 8000;
const DEFAULT_RATE_MS = 2000;
/** A catch-up sweep may never simulate an unbounded backlog. */
const MAX_CATCHUP_TICKS = 30;

const MODES_BY_ROLE: Record<OrchestrationRequest['role'], string[]> = {
  live: ['live'],
  catchup: ['effects_only'],
};

/** Uniform failure shape; also the only place an unknown throw is normalised. */
function toFailure(e: unknown): C3Failure {
  if (e instanceof C3Error) return e.toFailure();
  return {
    ok: false,
    kind: 'internal',
    reason: e instanceof Error ? e.message : String(e),
    retryable: false,
  };
}

async function readCombatMode(db: OrchestrationDb): Promise<'open' | 'maintenance'> {
  try {
    const { data, error } = await db
      .from('combat_config')
      .select('value')
      .eq('key', COMBAT_MODE_KEY)
      .maybeSingle();
    if (error) return 'maintenance';
    return parseCombatMode((data as { value?: unknown } | null)?.value);
  } catch {
    return 'maintenance';
  }
}

/**
 * C5 phase 4 controlled soak (TEMPORARY).
 *
 * While combat is globally closed, an explicitly allowlisted character standing
 * on the single allowlisted test node may still resolve — through this exact
 * pipeline, with no alternate resolver and no relaxed rule. Authority lives in
 * `public.combat_soak_access_check`, which additionally requires the
 * `combat_soak` switch to be `on` and the allowlist row to be unexpired.
 *
 * Fails closed on any error. Remove together with the allowlist table after the
 * soak.
 */
async function soakAccessAllowed(
  db: OrchestrationDb,
  req: OrchestrationRequest,
): Promise<boolean> {
  try {
    const { data, error } = await db.rpc('combat_soak_access_check', {
      _character_id: req.characterId ?? null,
      _node_id: req.nodeId ?? null,
    });
    if (error) return false;
    return data === true;
  } catch {
    return false;
  }
}





/**
 * Resolve the single encounter this request belongs to.
 *
 * Live callers go through `encounter_intake`, which is also what enforces one
 * encounter per node and registers participation/engagements. Catch-up callers
 * only look up an existing encounter: a sweep must never create one.
 */
async function resolveEncounter(
  db: OrchestrationDb,
  req: OrchestrationRequest,
): Promise<string> {
  if (req.role === 'live') {
    if (!req.characterId) {
      throw new C3Error('no_encounter', 'live resolution requires a characterId');
    }
    const { data, error } = await db.rpc('encounter_intake', {
      _character_id: req.characterId,
      _creature_ids: [...(req.creatureIds ?? [])],
    });
    if (error) throw new C3Error('internal', `encounter_intake failed: ${error.message}`);
    if (!data?.ok) {
      throw new C3Error('no_encounter', String(data?.reason ?? 'intake_refused'), {
        retryable: false,
      });
    }
    return String(data.encounter_id);
  }

  // Internal effects-only workers are encounter-scoped: they name the encounter
  // the database handed them and never re-derive it from a character.
  if (req.encounterId) return req.encounterId;

  const nodeId = req.nodeId ?? (await nodeOfCharacter(db, req.characterId ?? null));
  if (!nodeId) throw new C3Error('no_encounter', 'catch-up requires a nodeId, encounterId or characterId');
  const { data, error } = await db.rpc('encounter_for_node', { _node_id: nodeId });
  if (error) throw new C3Error('internal', `encounter_for_node failed: ${error.message}`);
  if (!data) throw new C3Error('no_encounter', 'no encounter at node');
  return String(data);
}

async function nodeOfCharacter(db: OrchestrationDb, characterId: string | null): Promise<string | null> {
  if (!characterId) return null;
  const { data } = await db
    .from('characters')
    .select('current_node_id')
    .eq('id', characterId)
    .maybeSingle();
  return (data as { current_node_id?: string | null } | null)?.current_node_id ?? null;
}

interface Claim {
  readonly tick: number;
  readonly token: string;
  readonly resolverId: string;
  readonly dbMode: 'live' | 'effects_only';
}

async function claimTick(
  db: OrchestrationDb,
  encounterId: string,
  req: OrchestrationRequest,
  deps: OrchestrationDeps,
): Promise<Claim> {
  const { data, error } = await db.rpc('claim_encounter_tick', {
    _encounter_id: encounterId,
    _rate_ms: deps.rateMs ?? DEFAULT_RATE_MS,
    _lease_ms: deps.leaseMs ?? DEFAULT_LEASE_MS,
    _caller: deps.caller,
    _supported_modes: MODES_BY_ROLE[req.role],
  });
  if (error) throw new C3Error('internal', `claim_encounter_tick failed: ${error.message}`);
  if (!data?.claimed) {
    throw new C3Error('claim_refused', String(data?.reason ?? 'refused'), {
      detail: { mode: data?.mode ?? null },
    });
  }
  return {
    tick: Number(data.tick),
    token: String(data.claim_token),
    resolverId: String(data.resolver_id),
    dbMode: data.mode === 'live' ? 'live' : 'effects_only',
  };
}

async function release(
  db: OrchestrationDb,
  encounterId: string,
  claim: Claim,
  reason: string,
): Promise<void> {
  try {
    await db.rpc('release_encounter_tick', {
      _encounter_id: encounterId,
      _tick: claim.tick,
      _claim_token: claim.token,
      _reason: reason,
    });
  } catch {
    // The lease expires on its own; a failed release must never mask the
    // original error.
  }
}

/** How many ticks this claim is entitled to simulate. */
function ticksToSimulate(role: OrchestrationRequest['role'], root: any, nowMs: number): number {
  if (role === 'live') return 1;
  const rate = Math.max(250, Number(root?.tickRateMs ?? DEFAULT_RATE_MS));
  const last = Number(root?.cursor?.tickAtMs ?? 0);
  if (!last) return 1;
  const elapsed = Math.max(0, nowMs - last);
  return Math.max(1, Math.min(MAX_CATCHUP_TICKS, Math.floor(elapsed / rate)));
}

/** Presence bookkeeping only: never cadence, ownership or roster. */
function sessionProposal(
  proposed: ProposedTick,
  root: any,
): SessionPresenceProposal {
  const purged = new Set(proposed.engagementsPurgeCreatureIds);
  const engaged = new Set<string>();
  for (const e of Array.isArray(root?.engagements) ? root.engagements : []) {
    if (e?.creatureId && !purged.has(String(e.creatureId))) engaged.add(String(e.creatureId));
  }
  for (const e of proposed.engagementsJoin) engaged.add(e.creatureId);
  const engagedCreatureIds = [...engaged].sort();
  return {
    sessionId: null,
    ended: engagedCreatureIds.length === 0,
    engagedCreatureIds,
  };
}

/**
 * Resolve exactly one authoritative tick, end to end. Returns a typed failure
 * instead of throwing, and never returns simulated events on a failure path.
 */
export async function orchestrateCombatResolution(
  req: OrchestrationRequest,
  deps: OrchestrationDeps,
): Promise<OrchestrationResult> {
  const { db } = deps;

  // 1. Maintenance gate — before any encounter work. The only exception is the
  // temporary C5 soak allowlist, decided by the database.
  if ((await readCombatMode(db)) !== 'open' && req.scopeGranted !== true
      && !(await soakAccessAllowed(db, req))) {
    return {
      ok: false,
      kind: 'maintenance',
      reason: COMBAT_MAINTENANCE_MESSAGE,
      retryable: true,
    };
  }



  let encounterId: string;
  let claim: Claim;
  try {
    encounterId = await resolveEncounter(db, req);
    claim = await claimTick(db, encounterId, req, deps);
  } catch (e) {
    return toFailure(e);
  }

  try {
    // 4. Snapshot under the claim.
    const { data: root, error: snapErr } = await db.rpc('encounter_snapshot_v2', {
      _encounter_id: encounterId,
      _claim_token: claim.token,
      _tick: claim.tick,
    });
    if (snapErr) throw new C3Error('internal', `encounter_snapshot_v2 failed: ${snapErr.message}`);
    if (!root?.loaded) {
      throw new C3Error('snapshot_refused', String(root?.reason ?? 'not_loaded'));
    }

    // 5a. The isolate's ability catalog must match the configuration version
    // the snapshot pinned, otherwise magnitudes would come from unpinned config.
    const pinnedVersion = snapshotAbilityConfigVersion(root);
    let catalog = deps.catalog;
    if (catalog.configVersion !== pinnedVersion && deps.refreshCatalog) {
      catalog = await deps.refreshCatalog();
    }
    if (catalog.configVersion !== pinnedVersion) {
      throw new C3Error(
        'config_conflict',
        `ability catalog ${catalog.configVersion} != snapshot ${pinnedVersion}`,
      );
    }

    // 5b. Aux + strict decode. The resolver mode comes from the claim only.
    const mode = claim.dbMode === 'live' ? 'live' : 'catchup';
    const { aux, configFailures } = loadSnapshotAux({
      snapshotRoot: root,
      mode,
      nowMs: deps.nowMs,
      ticksToSimulate: ticksToSimulate(req.role, root, deps.nowMs),
      catalog,
    });
    const decoded = decodeEncounterSnapshot(root, aux);
    if (configFailures.length > 0) {
      deps.log?.('[c3] ability configuration failures', configFailures);
    }

    // 6. Pure simulation. No IO, no clock, no Math.random.
    let proposed: ProposedTick;
    try {
      // Policy C boundary is authoritative server state, not snapshot payload:
      // read it here and hand it to the pure resolver, which proposes expiry.
      let pauseBoundary: { suspendedAtMs: number; resumedAtMs: number } | null = null;
      try {
        const { data: pb } = await db.rpc('simulation_pause_boundary', {});
        if (pb && typeof pb.suspendedAtMs === 'number' && typeof pb.resumedAtMs === 'number') {
          pauseBoundary = { suspendedAtMs: pb.suspendedAtMs, resumedAtMs: pb.resumedAtMs };
        }
      } catch {
        pauseBoundary = null;
      }
      proposed = resolveTickPure({ ...decoded.snapshot, pauseBoundary });
    } catch (e) {
      throw new C3Error('resolver_failed', e instanceof Error ? e.message : String(e), {
        retryable: false,
      });
    }

    // 7. Atomic commit. Either every mutation lands or none does.
    const batchId = deps.newBatchId();
    const request = buildCommitRequest(
      decoded.envelope,
      proposed,
      sessionProposal(proposed, root),
      batchId,
    );
    const { data: commit, error: commitErr } = await db.rpc(
      'commit_encounter_tick_v2',
      request as unknown as Record<string, unknown>,
    );
    if (commitErr) {
      throw new C3Error('commit_refused', commitErr.message, { retryable: true });
    }
    if (!commit?.committed) {
      const reason = String(commit?.reason ?? 'refused');
      const kind = reason === 'stale_claim' || reason === 'lease_expired' ? 'lease_lost' : 'commit_refused';
      throw new C3Error(kind, reason);
    }

    return {
      ok: true,
      encounterId,
      tick: claim.tick,
      mode: proposed.mode,
      batchId,
      ticksProcessed: proposed.ticksProcessed,
      rngDraws: proposed.rngDraws,
      events: proposed.events,
      configFailures,
    };
  } catch (e) {
    const failure = toFailure(e);
    // The claim is released on every failure path, so a transient error never
    // parks an encounter in `resolving` until the lease expires.
    await release(db, encounterId, claim, failure.kind);
    return failure;
  }
}
