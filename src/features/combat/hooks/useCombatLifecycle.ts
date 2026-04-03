/**
 * useCombatLifecycle — combat session lifecycle cleanup.
 *
 * This file owns:
 * - Node-change cleanup (stop combat, reset aggro tracking)
 * - Death cleanup
 * - Non-leader timeout detection
 * - Unmount interval cleanup
 * - Synchronous flee cleanup (fleeStopCombat)
 */
import { useEffect, useRef, useCallback } from 'react';
import { clearWorkerInterval } from '@/lib/worker-timer';

export interface UseCombatLifecycleParams {
  currentNodeId: string | null;
  isDead: boolean;
  inCombat: boolean;
  isLeader: boolean;
  party: { id: string } | null;
  stopCombat: () => void;
  intervalRef: React.MutableRefObject<number | null>;
  lastTickRef: React.MutableRefObject<number>;
  inCombatRef: React.MutableRefObject<boolean>;
  tickBusyRef: React.MutableRefObject<boolean>;
  tickPendingRef: React.MutableRefObject<boolean>;
  creatureHpOverridesRef: React.MutableRefObject<Record<string, number>>;
  setCreatureHpOverrides: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  channelRef: React.MutableRefObject<any>;
  // Aggro refs to reset on node change
  aggroProcessedRef: React.MutableRefObject<Set<string>>;
  recentlyKilledRef: React.MutableRefObject<Set<string>>;
  pendingAggroRef: React.MutableRefObject<boolean>;
}

export function useCombatLifecycle(params: UseCombatLifecycleParams) {
  const {
    currentNodeId, isDead, inCombat, isLeader, party,
    stopCombat, intervalRef, lastTickRef, inCombatRef, tickBusyRef, tickPendingRef,
    creatureHpOverridesRef, setCreatureHpOverrides, channelRef,
    aggroProcessedRef, recentlyKilledRef, pendingAggroRef,
  } = params;

  const prevNodeRef = useRef(currentNodeId);

  // Party dissolution
  useEffect(() => {
    if (!party && channelRef.current) stopCombat();
  }, [party, stopCombat, channelRef]);

  // Node change — clear overrides, reset aggro, stop combat
  useEffect(() => {
    if (currentNodeId !== prevNodeRef.current) {
      prevNodeRef.current = currentNodeId;
      aggroProcessedRef.current = new Set();
      recentlyKilledRef.current = new Set();
      pendingAggroRef.current = true;
      creatureHpOverridesRef.current = {};
      setCreatureHpOverrides({});
      console.log('[combat] Node change — cleared creature HP overrides, ending live combat');
      stopCombat();
    }
  }, [currentNodeId, stopCombat, aggroProcessedRef, recentlyKilledRef, pendingAggroRef, creatureHpOverridesRef, setCreatureHpOverrides]);

  // Death
  useEffect(() => {
    if (isDead) stopCombat();
  }, [isDead, stopCombat]);

  // Non-leader timeout
  useEffect(() => {
    if (!inCombat || isLeader || !party) return;
    const check = setInterval(() => {
      if (Date.now() - lastTickRef.current > 6000) {
        stopCombat();
      }
    }, 2000);
    return () => clearInterval(check);
  }, [inCombat, isLeader, party, stopCombat, lastTickRef]);

  // Unmount cleanup
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearWorkerInterval(intervalRef.current);
    };
  }, [intervalRef]);

  // Synchronous flee: kill tick interval immediately before node change
  const fleeStopCombat = useCallback(() => {
    if (intervalRef.current) {
      clearWorkerInterval(intervalRef.current);
      intervalRef.current = null;
    }
    inCombatRef.current = false;
    tickBusyRef.current = false;
    tickPendingRef.current = false;
  }, [intervalRef, inCombatRef, tickBusyRef, tickPendingRef]);

  return { fleeStopCombat, prevNodeRef };
}
