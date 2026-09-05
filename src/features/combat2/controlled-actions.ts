import { useMemo } from 'react';

export const MOVEMENT_UNAVAILABLE = 'Movement is disabled for this controlled Combat2 test.';

export const COMBAT_RESOURCE_FIELDS = new Set([
  'hp', 'cp', 'mp', 'max_hp', 'max_cp', 'max_mp', 'gold', 'xp', 'level', 'current_node_id',
  'reserved_buffs', 'bhp', 'rp_total_earned', 'unspent_stat_points', 'respec_points',
]);
export function isCombatMutation(updates: object) {
  return Object.keys(updates).some(key => COMBAT_RESOURCE_FIELDS.has(key));
}

export function guardControlledAction<A extends unknown[], R>(allowed: () => boolean, diagnose: (message: string) => void, action: (...args: A) => R) {
  return (...args: A): R => {
    if (!allowed()) { diagnose(MOVEMENT_UNAVAILABLE); return undefined as R; }
    return action(...args);
  };
}

export function useControlledAction<A extends unknown[], R>(allowed: () => boolean, diagnose: (message: string) => void, action: (...args: A) => R) {
  return useMemo(() => guardControlledAction(allowed, diagnose, action), [allowed, diagnose, action]);
}
