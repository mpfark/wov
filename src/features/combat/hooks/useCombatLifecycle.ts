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
  enabled?: boolean;
  /**
   * Identity only (logging / caller convenience). This hook performs NO
   * departure write: ending participation is server-authoritative.
   */
  characterId: string;

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
  // Buff setters for death cleanup
  setPoisonBuff?: React.Dispatch<React.SetStateAction<any>>;
  setIgniteBuff?: React.Dispatch<React.SetStateAction<any>>;
  /** Wipe reserved_buffs locally on death (server is authoritative). */
  clearReservedBuffsLocal?: () => void;

}

export function useCombatLifecycle(params: UseCombatLifecycleParams) {
  const {
    
    currentNodeId, isDead, inCombat, isLeader, party,
    stopCombat, intervalRef, lastTickRef, inCombatRef, tickBusyRef, tickPendingRef,
    creatureHpOverridesRef, setCreatureHpOverrides, channelRef,
    aggroProcessedRef, recentlyKilledRef, pendingAggroRef,
    setPoisonBuff, setIgniteBuff, clearReservedBuffsLocal,

  } = params;

  const prevNodeRef = useRef(currentNodeId);

  // Party dissolution
  useEffect(() => {
    if (!party && channelRef.current) stopCombat();
  }, [party, stopCombat, channelRef]);

  // Node change — clear overrides, reset aggro, stop live combat.
  //
  // Departure itself is NOT a client concern. The authoritative act is the
  // server-side trigger on `characters.current_node_id`: node movement and the
  // end of participation happen in one transaction, whatever moved the
  // character (walk, flee, teleport, party follow, admin relocation), and
  // re-entry receives a fresh participation generation from intake. The client
  // deliberately calls no departure RPC, so no browser callback can be skipped,
  // delayed or lost — which is exactly how a Granite Slam once landed 47s late
  // on a character who had walked away and come back.
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



  // Death — clear commitment buffs (Envenom / Ignite) AND stance reservations.
  // The server (combat-tick) wipes characters.reserved_buffs on HP <= 0, but the
  // 3s pending-write mask in useCharacter can swallow the realtime echo if the
  // player just activated a stance. Mirror the wipe locally and clear the mask
  // so stance buttons reflect the dead state immediately.
  useEffect(() => {
    if (params.enabled !== false && isDead) {
      stopCombat();
      setPoisonBuff?.(null);
      setIgniteBuff?.(null);
      clearReservedBuffsLocal?.();
    }
  }, [isDead, stopCombat, setPoisonBuff, setIgniteBuff, clearReservedBuffsLocal]);


  // Non-leader timeout.
  // The follower wake-up in useCombatDriver fires at 6s of tick silence and
  // needs a round-trip to land, so tearing combat down at exactly 6s raced its
  // own recovery attempt and dropped the follower out of a live fight. Give the
  // recovery one full wake cycle plus a round-trip before giving up.
  useEffect(() => {
    if (params.enabled === false || !inCombat || isLeader || !party) return;
    const check = setInterval(() => {
      if (Date.now() - lastTickRef.current > 12000) {
        stopCombat();
      }
    }, 2000);
    return () => clearInterval(check);
  }, [inCombat, isLeader, party, stopCombat, lastTickRef, params.enabled]);

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
