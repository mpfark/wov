/**
 * useMergedCreatureHpOverrides — merges creature HP overrides from
 * multiple sources with a strict priority:
 *
 *   combat-tick (authoritative) > broadcast (other players) > fetched (base)
 *
 * This provides a single source of truth for creature HP display,
 * replacing ad-hoc merges scattered across GamePage and NodeView.
 *
 * State classification: Derived state (computed from server + broadcast sources)
 */
import { useMemo } from 'react';

export function useMergedCreatureHpOverrides(
  combatHpOverrides: Record<string, number>,
  broadcastOverrides: Record<string, number>,
): Record<string, number> {
  return useMemo(
    () => ({ ...broadcastOverrides, ...combatHpOverrides }),
    [combatHpOverrides, broadcastOverrides],
  );
}
