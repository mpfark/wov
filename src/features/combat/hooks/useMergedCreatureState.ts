/**
 * useMergedCreatureHpOverrides — merges creature HP overrides from
 * multiple sources with a strict priority:
 *
 *   combat-tick (authoritative) > local prediction > broadcast (other players) > fetched (base)
 *
 * Prediction entries include a timestamp and are filtered out after PREDICTION_TTL_MS.
 *
 * State classification: Derived state (computed from server + broadcast + prediction sources)
 */
import { useMemo } from 'react';

/** Prediction override entry with timestamp for staleness detection */
export interface PredictionOverride {
  hp: number;
  ts: number;
}

const PREDICTION_TTL_MS = 4000;

export function useMergedCreatureHpOverrides(
  combatHpOverrides: Record<string, number>,
  broadcastOverrides: Record<string, number>,
  localPredictionOverrides: Record<string, PredictionOverride> = {},
): Record<string, number> {
  return useMemo(() => {
    const now = Date.now();
    const merged: Record<string, number> = { ...broadcastOverrides };

    // Layer predictions on top of broadcasts (only if not stale)
    for (const [id, pred] of Object.entries(localPredictionOverrides)) {
      if (now - pred.ts < PREDICTION_TTL_MS) {
        merged[id] = pred.hp;
      }
    }

    // Combat-tick overrides are highest priority — overwrite everything
    for (const [id, hp] of Object.entries(combatHpOverrides)) {
      merged[id] = hp;
    }

    return merged;
  }, [combatHpOverrides, broadcastOverrides, localPredictionOverrides]);
}
