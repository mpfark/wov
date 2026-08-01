/**
 * ability-magnitude.ts — checkpoint 7 of the ability-calculation rework.
 *
 * CANONICAL OWNER for: the single decision of *where an ability magnitude
 * comes from*. Every ability magnitude (damage, heal, duration, interval, and
 * every named mechanic value) resolves through `resolveAbilityMagnitude`.
 *
 * Legacy inline formulas are **gone** (checkpoint 7). Configuration is the only
 * source of ability numbers:
 *
 *   1. The configured calc is evaluated by the shared evaluator.
 *   2. If it is missing or does not evaluate to a finite number, that is an
 *      **actionable failure** — publish-time validation exists precisely so
 *      this cannot happen — and the optional `fallbackValue` (a constant safety
 *      floor, never a formula) is returned.
 *   3. Telemetry: aggregated in-isolate counters plus an actionable-event queue
 *      that only ever receives failures. A healthy tick queues nothing.
 *
 * Mirrored to `supabase/functions/_shared/combat/ability-magnitude.ts`.
 */

import { evaluateCalc, type AbilityCalc, type CalcInputs } from '../formulas/ability-calc.ts';

export type MagnitudeKind = 'amount' | 'duration' | 'interval' | 'mechanic';

/** Why configuration could not answer. */
export type FailureReason =
  /** No calc configured for this magnitude. */
  | 'unconfigured'
  /** A calc exists but did not evaluate to a finite number. */
  | 'invalid'
  /** The registry itself was unavailable (load failure with no seed). */
  | 'registry_unavailable';

export interface AbilityMagnitudeRequest {
  classKey: string;
  abilityKey: string;
  kind: MagnitudeKind;
  /** Named mechanic parameter key when `kind === 'mechanic'` (e.g. 'arrow_count'). */
  param?: string;
  inputs: CalcInputs;
  /** Active configured calc, or null/undefined when none is configured. */
  calc: AbilityCalc | null | undefined;
  /**
   * Constant safety floor used only when configuration fails. Never a formula —
   * a failure is reported, not silently papered over.
   */
  fallbackValue?: number;
  /** Set when no configuration source could be reached at all. */
  registryUnavailable?: boolean;
}

export interface AbilityMagnitudeResult {
  value: number;
  source: 'config' | 'failed';
  failureReason?: FailureReason;
  /** True when the caller must surface a failure (config could not answer). */
  actionableFailure?: boolean;
  message?: string;
}

export interface AbilityCalcCounters {
  resolved: number;
  config: number;
  failedUnconfigured: number;
  failedInvalid: number;
  failedRegistry: number;
  actionableFailures: number;
}

export function createAbilityCalcCounters(): AbilityCalcCounters {
  return {
    resolved: 0, config: 0,
    failedUnconfigured: 0, failedInvalid: 0, failedRegistry: 0,
    actionableFailures: 0,
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

function fail(
  req: AbilityMagnitudeRequest,
  failureReason: FailureReason,
  detail: string,
): AbilityMagnitudeResult {
  return {
    value: req.fallbackValue ?? 0,
    source: 'failed',
    failureReason,
    actionableFailure: true,
    message: `${magnitudeLabel(req)}: ${detail}`,
  };
}

/**
 * Resolve one ability magnitude. Pure: all telemetry is returned, never
 * written. Callers (`combat-tick`, the client resolver) fold the result into
 * their own counters and audit queue.
 */
export function resolveAbilityMagnitude(req: AbilityMagnitudeRequest): AbilityMagnitudeResult {
  if (req.registryUnavailable) {
    return fail(req, 'registry_unavailable', 'ability configuration unavailable');
  }
  if (!req.calc) {
    return fail(req, 'unconfigured', 'no configured calc for this magnitude');
  }

  const configured = evaluateSafely(req.calc, req.inputs);
  if (configured === null) {
    return fail(
      req, 'invalid',
      'active configuration is invalid — publish validation should have rejected it',
    );
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
  switch (result.failureReason) {
    case 'unconfigured': counters.failedUnconfigured += 1; break;
    case 'invalid': counters.failedInvalid += 1; break;
    case 'registry_unavailable': counters.failedRegistry += 1; break;
    default: break;
  }
  if (result.actionableFailure) counters.actionableFailures += 1;
  return counters;
}

/**
 * Is this result worth a database row? Only hard failures are — a successful
 * configured resolution never writes.
 */
export function isActionableAbilityCalcEvent(result: AbilityMagnitudeResult): boolean {
  return Boolean(result.actionableFailure);
}
