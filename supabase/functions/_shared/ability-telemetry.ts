/**
 * ability-telemetry.ts — server binding for the shared ability-magnitude
 * resolver (checkpoint 2).
 *
 * Wraps `resolveAbilityMagnitude` with:
 *   • the server ability registry (`load-ability-calcs.ts`),
 *   • in-isolate aggregated counters (no hot-path writes),
 *   • an actionable-event queue that receives a row ONLY for a parity
 *     mismatch, an invalid/unavailable configuration, or a hard failure.
 *
 * Import `resolveMagnitude` instead of the raw `resolveServer*` helpers so all
 * ability math funnels through one place.
 */
import {
  getServerAbilityCalcs, isAbilityRegistryLoaded,
} from './load-ability-calcs.ts';
import {
  resolveAbilityMagnitude,
  accumulateAbilityCalcCounters,
  createAbilityCalcCounters,
  isActionableAbilityCalcEvent,
  magnitudeLabel,
  type AbilityCalcCounters,
  type AbilityMagnitudeResult,
  type MagnitudeKind,
} from './combat/ability-magnitude.ts';
import type { AbilityCalc, CalcInputs } from './formulas/ability-calc.ts';

/**
 * Global cutover flag. Legacy fallback is a pre-cutover mechanism only; once
 * this is true an invalid active configuration is an actionable failure, never
 * a silent legacy substitution. Flipped at checkpoint 5 for all classes at once.
 */
export const USE_CONFIG_ABILITY_CALCS_V2 =
  (Deno.env.get('USE_CONFIG_ABILITY_CALCS_V2') ?? 'false') === 'true';

/** Parity comparison mode — evaluates both paths. Off in production. */
const COMPARE_MODE = (Deno.env.get('ABILITY_CALC_COMPARE') ?? 'false') === 'true';
const DEV_LOG = (Deno.env.get('ABILITY_CALC_DEBUG') ?? 'false') === 'true';

let counters: AbilityCalcCounters = createAbilityCalcCounters();

export interface AbilityCalcAuditRow {
  character_id: string | null;
  node_id: string | null;
  event_type: string;
  message: string;
  payload: Record<string, unknown>;
}

let auditQueue: AbilityCalcAuditRow[] = [];
const AUDIT_QUEUE_CAP = 20;

export interface MagnitudeArgs {
  classKey: string;
  abilityKey: string;
  kind: MagnitudeKind;
  /** Named mechanic parameter key when `kind === 'mechanic'`. */
  param?: string;
  inputs: CalcInputs;
  /** The original inline formula — only invoked when config cannot answer. */
  legacy: () => number;
  characterId?: string | null;
  nodeId?: string | null;
}

function pickCalc(args: MagnitudeArgs): AbilityCalc | null {
  const entry = getServerAbilityCalcs(args.classKey, args.abilityKey);
  if (!entry) return null;
  switch (args.kind) {
    case 'amount': return entry.amountCalc;
    case 'duration': return entry.durationCalc;
    case 'mechanic': {
      // Canonical home is `abilities.mechanic_calcs` (checkpoint 4). The legacy
      // `effect_config.<param>_calc` spelling is still honoured for rows that
      // have not been migrated yet.
      if (args.param && entry.mechanicCalcs?.[args.param]) return entry.mechanicCalcs[args.param];
      const raw = (entry.effectConfig ?? {})[`${args.param}_calc`];
      if (!raw || typeof raw !== 'object') return null;
      const calc = raw as AbilityCalc;
      return Array.isArray(calc.terms) && typeof calc.base === 'number' ? calc : null;
    }
    default: return null;
  }
}

/**
 * Resolve an ability magnitude through configuration, falling back to the
 * caller's inline formula. Records telemetry; writes nothing.
 *
 * `resolveMagnitudeEx` returns the full result so a call site can tell whether
 * configuration answered. That matters for riders that are *inside* the
 * configured calc post-cutover (judgment's ×0.8, consecrate's ×0.65): they must
 * only be re-applied when the legacy closure produced the number.
 */
export function resolveMagnitudeEx(args: MagnitudeArgs): AbilityMagnitudeResult {
  const result: AbilityMagnitudeResult = resolveAbilityMagnitude({
    classKey: args.classKey,
    abilityKey: args.abilityKey,
    kind: args.kind,
    param: args.param,
    inputs: args.inputs,
    calc: args.kind === 'interval' ? null : pickCalc(args),
    legacy: args.legacy,
    useV2: USE_CONFIG_ABILITY_CALCS_V2,
    compare: COMPARE_MODE,
    registryUnavailable: !isAbilityRegistryLoaded(),
  });

  accumulateAbilityCalcCounters(counters, result);

  if (DEV_LOG) {
    console.log('[ability-calc]', magnitudeLabel(args), result.source, result.value,
      result.fallbackReason ?? '', result.mismatch ? `legacy=${result.legacyValue}` : '');
  }

  if (isActionableAbilityCalcEvent(result) && auditQueue.length < AUDIT_QUEUE_CAP) {
    auditQueue.push({
      character_id: args.characterId ?? null,
      node_id: args.nodeId ?? null,
      event_type: result.mismatch
        ? 'ability_calc_mismatch'
        : result.actionableFailure
          ? 'ability_calc_failure'
          : 'ability_calc_fallback',
      message: result.message ?? `${magnitudeLabel(args)}: ${result.fallbackReason}`,
      payload: {
        label: magnitudeLabel(args),
        source: result.source,
        value: result.value,
        legacy_value: result.legacyValue ?? null,
        fallback_reason: result.fallbackReason ?? null,
        v2: USE_CONFIG_ABILITY_CALCS_V2,
      },
    });
  }

  return result;
}

/** Value-only convenience wrapper around `resolveMagnitudeEx`. */
export function resolveMagnitude(args: MagnitudeArgs): number {
  return resolveMagnitudeEx(args).value;
}


/** Snapshot of the aggregated counters for this isolate. */
export function getAbilityCalcCounters(): AbilityCalcCounters {
  return { ...counters };
}

export function resetAbilityCalcCounters(): void {
  counters = createAbilityCalcCounters();
}

/** Take and clear the queued actionable rows (mismatch / fallback / failure). */
export function drainAbilityCalcAuditRows(): AbilityCalcAuditRow[] {
  const rows = auditQueue;
  auditQueue = [];
  return rows;
}
