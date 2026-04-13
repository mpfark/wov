/**
 * useMergedCreatureHpOverrides — merges creature HP overrides from
 * multiple sources with a strict priority:
 *
 *   combat-tick (authoritative) > broadcast (other players) > fetched (base)
 *
 * State classification: Derived state (computed from server + broadcast sources)
 */
import { useMemo } from 'react';

export function useMergedCreatureHpOverrides(
  combatHpOverrides: Record<string, number>,
  broadcastOverrides: Record<string, number>,
): Record<string, number> {
  return useMemo(() => {
    const merged: Record<string, number> = { ...broadcastOverrides };

    // Combat-tick overrides are highest priority — overwrite everything
    for (const [id, hp] of Object.entries(combatHpOverrides)) {
      merged[id] = hp;
    }

    return merged;
  }, [combatHpOverrides, broadcastOverrides]);
}
