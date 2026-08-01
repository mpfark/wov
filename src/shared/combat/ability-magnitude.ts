/**
 * ability-magnitude.ts — checkpoint 2 of the ability-calculation rework.
 *
 * CANONICAL OWNER for: the single decision of *where an ability magnitude
 * comes from*. Every ability magnitude (damage, heal, duration, interval, and
 * every named mechanic value) resolves through `resolveAbilityMagnitude`.
 *
 * The resolver itself does no math beyond delegating to the shared evaluator.
 * It owns exactly three things:
 *
 *   1. Configured calc wins when present and valid.
 *   2. Otherwise the caller's `legacy()` closure runs — the original inline
 *      formula, passed in explicitly so it is visible at the call site and
 *      deletable in one sweep at checkpoint 7.
 *   3. Telemetry: aggregated in-isolate counters, plus an actionable-event
 *      queue that only ever receives mismatches, invalid-config fallbacks and
 *      hard failures. A healthy tick queues nothing.
 *
 * Post-cutover (`useV2`), an *invalid* active calc is NOT silently replaced by
 * legacy math: it is reported as an actionable failure. Publish-time validation
 * (checkpoint 4) is what guarantees this never fires.
 *
 * Mirrored to `supabase/functions/_shared/combat/ability-magnitude.ts`.
 */

import { evaluateCalc, type AbilityCalc, type CalcInputs } from '../formulas/ability-calc.ts';

export type MagnitudeKind = 'amount' | 'duration' | 'interval' | 'mechanic';

/** Why the legacy closure was used instead of configuration. */
export type FallbackReason =
  /** No calc configured for this magnitude — mechanic-owned math (expected pre-cutover). */
  | 'unconfigured'
  /** A calc exists but does not validate / did not evaluate to a finite number. */
  | 'invalid'
  /** The registry itself was unavailable (load failure). */
  | 'registry_unavailable'
  /**
   * A v2 (post-rework) calc exists but the global cutover flag is still off.
   * Backfilled v2 records are authored ahead of the flip (checkpoint 4) and
   * must not change balance before the parity proof (checkpoint 5).
   */
  | 'pending_cutover';

export interface AbilityMagnitudeRequest {
  classKey: string;
  abilityKey: string;
  kind: MagnitudeKind;
  /** Named mechanic parameter key when `kind === 'mechanic'` (e.g. 'arrow_count'). */
  param?: string;
  inputs: CalcInputs;
  /** Active configured calc, or null/undefined when none is configured. */
  calc: AbilityCalc | null | undefined;
  /** The original inline formula. Only invoked when configuration cannot answer. */
  legacy: () => number;
  /** True once `USE_CONFIG_ABILITY_CALCS_V2` is authoritative. */
  useV2?: boolean;
  /**
   * Parity comparison: evaluate BOTH paths and report a mismatch. Off by
   * default — legacy closures may roll dice, and comparison must never make a
   * production tick roll twice. Checkpoint 5 enables it with a seeded roll
   * source.
   */
  compare?: boolean;
  /** Set when the registry could not be loaded at all. */
  registryUnavailable?: boolean;
}

export interface AbilityMagnitudeResult {
  value: number;
  source: 'config' | 'legacy';
  fallbackReason?: FallbackReason;
  /** Populated only in comparison mode. */
  legacyValue?: number;
  mismatch?: boolean;
  /** Post-cutover invalid active config — the caller must surface a failure. */
  actionableFailure?: boolean;
  message?: string;
}

export interface AbilityCalcCounters {
  resolved: number;
  config: number;
  legacy: number;
  fallbackUnconfigured: number;
  /** v2 record present but the cutover flag is still off. */
  fallbackPendingCutover: number;
  fallbackInvalid: number;
  fallbackRegistry: number;
  compared: number;
  matched: number;
  mismatched: number;
  actionableFailures: number;
}

export function createAbilityCalcCounters(): AbilityCalcCounters {
  return {
    resolved: 0, config: 0, legacy: 0,
    fallbackUnconfigured: 0, fallbackPendingCutover: 0,
    fallbackInvalid: 0, fallbackRegistry: 0,
    compared: 0, matched: 0, mismatched: 0, actionableFailures: 0,
  };
}

/** Label used by telemetry / audit rows. */
export function magnitudeLabel(req: Pick<AbilityMagnitudeRequest, 'classKey' | 'abilityKey' | 'kind' | 'param'>): string {
  const suffix = req.kind === 'mechanic' ? `mechanic:${req.param ?? '?'}` : req.kind;
  return `${req.classKey}:${req.abilityKey}:${suffix}`;
}

function evaluateSafely(calc: AbilityCalc, inputs: CalcInputs): number | null {
  try {
    const value = evaluateCalc(calc, inputs);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Resolve one ability magnitude. Pure: all telemetry is returned, never
 * written. Callers (`combat-tick`, the client resolver) fold the result into
 * their own counters and audit queue.
 */
export function resolveAbilityMagnitude(req: AbilityMagnitudeRequest): AbilityMagnitudeResult {
  const label = magnitudeLabel(req);

  if (req.registryUnavailable) {
    return {
      value: req.legacy(),
      source: 'legacy',
      fallbackReason: 'registry_unavailable',
      message: `${label}: ability registry unavailable, legacy formula used`,
    };
  }

  if (!req.calc) {
    return {
      value: req.legacy(),
      source: 'legacy',
      fallbackReason: 'unconfigured',
    };
  }

  // Pre-cutover gate: v2 records are authored during checkpoint 4 but only
  // become authoritative when the global flag flips at checkpoint 5.
  if (req.calc.version === 2 && !req.useV2) {
    return {
      value: req.legacy(),
      source: 'legacy',
      fallbackReason: 'pending_cutover',
    };
  }

  const configured = evaluateSafely(req.calc, req.inputs);

  if (configured === null) {
    if (req.useV2) {
      // Post-cutover: never substitute legacy silently.
      return {
        value: req.legacy(),
        source: 'legacy',
        fallbackReason: 'invalid',
        actionableFailure: true,
        message: `${label}: active configuration is invalid — publish validation should have rejected it`,
      };
    }
    return {
      value: req.legacy(),
      source: 'legacy',
      fallbackReason: 'invalid',
      message: `${label}: configured calc failed to evaluate, legacy formula used`,
    };
  }

  if (req.compare) {
    const legacyValue = req.legacy();
    const mismatch = legacyValue !== configured;
    return {
      value: configured,
      source: 'config',
      legacyValue,
      mismatch,
      ...(mismatch
        ? { message: `${label}: parity mismatch — config ${configured} vs legacy ${legacyValue}` }
        : {}),
    };
  }

  return { value: configured, source: 'config' };
}

/** Fold a result into aggregated counters. Mutates and returns `counters`. */
export function accumulateAbilityCalcCounters(
  counters: AbilityCalcCounters,
  result: AbilityMagnitudeResult,
): AbilityCalcCounters {
  counters.resolved += 1;
  if (result.source === 'config') counters.config += 1;
  else counters.legacy += 1;
  switch (result.fallbackReason) {
    case 'unconfigured': counters.fallbackUnconfigured += 1; break;
    case 'pending_cutover': counters.fallbackPendingCutover += 1; break;
    case 'invalid': counters.fallbackInvalid += 1; break;
    case 'registry_unavailable': counters.fallbackRegistry += 1; break;
    default: break;
  }
  if (result.legacyValue !== undefined) {
    counters.compared += 1;
    if (result.mismatch) counters.mismatched += 1;
    else counters.matched += 1;
  }
  if (result.actionableFailure) counters.actionableFailures += 1;
  return counters;
}

/**
 * Is this result worth a database row? Only mismatches, invalid/unavailable
 * configuration and hard failures are. A successful comparison is not.
 */
export function isActionableAbilityCalcEvent(result: AbilityMagnitudeResult): boolean {
  return Boolean(
    result.mismatch ||
    result.actionableFailure ||
    result.fallbackReason === 'invalid' ||
    result.fallbackReason === 'registry_unavailable',
  );
}
