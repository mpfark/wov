/**
 * ability-telemetry.ts — server binding for the shared ability-magnitude
 * resolver.
 *
 * Wraps `resolveAbilityMagnitude` with:
 *   • the server ability registry (`load-ability-calcs.ts`, primed from the
 *     compiled seed so configuration can always answer),
 *   • in-isolate aggregated counters (no hot-path writes),
 *   • an actionable-event queue that receives a row ONLY when configuration
 *     could not answer.
 *
 * Checkpoint 7: there is no legacy path and no cutover flag. Configuration is
 * the sole source of ability magnitudes.
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
  /** Constant safety floor used only when configuration fails. */
  fallbackValue?: number;
  characterId?: string | null;
  nodeId?: string | null;
}

function pickCalc(args: MagnitudeArgs): AbilityCalc | null {
  const entry = getServerAbilityCalcs(args.classKey, args.abilityKey);
  if (!entry) return null;
  switch (args.kind) {
    case 'amount': return entry.amountCalc;
    case 'duration': return entry.durationCalc;
    case 'interval': return entry.intervalMs == null ? null : {
      base: entry.intervalMs, terms: [], unit: 'ms', note: 'configured interval',
    };
    case 'mechanic': {
      // Canonical home is `abilities.mechanic_calcs`. The older
      // `effect_config.<param>_calc` spelling is still honoured for rows that
      // predate the migration.
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
 * Resolve an ability magnitude from configuration. Records telemetry; writes
 * nothing. `resolveMagnitudeEx` returns the full result so a call site can tell
 * whether configuration answered.
 */
export function resolveMagnitudeEx(args: MagnitudeArgs): AbilityMagnitudeResult {
  const result: AbilityMagnitudeResult = resolveAbilityMagnitude({
    classKey: args.classKey,
    abilityKey: args.abilityKey,
    kind: args.kind,
    param: args.param,
    inputs: args.inputs,
    calc: pickCalc(args),
    fallbackValue: args.fallbackValue,
    registryUnavailable: !isAbilityRegistryLoaded(),
  });

  accumulateAbilityCalcCounters(counters, result);

  if (DEV_LOG) {
    console.log('[ability-calc]', magnitudeLabel(args), result.source, result.value,
      result.failureReason ?? '');
  }

  if (isActionableAbilityCalcEvent(result) && auditQueue.length < AUDIT_QUEUE_CAP) {
    auditQueue.push({
      character_id: args.characterId ?? null,
      node_id: args.nodeId ?? null,
      event_type: 'ability_calc_failure',
      message: result.message ?? `${magnitudeLabel(args)}: ${result.failureReason}`,
      payload: {
        label: magnitudeLabel(args),
        source: result.source,
        value: result.value,
        failure_reason: result.failureReason ?? null,
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

/** Take and clear the queued actionable rows. */
export function drainAbilityCalcAuditRows(): AbilityCalcAuditRow[] {
  const rows = auditQueue;
  auditQueue = [];
  return rows;
}
