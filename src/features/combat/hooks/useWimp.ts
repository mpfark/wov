import { useEffect, useRef, useCallback } from 'react';
import { Character } from '@/features/character';
import { GameNode } from '@/features/world';

interface UseWimpParams {
  character: Character | null;
  inCombat: boolean;
  currentNode: GameNode | undefined;
  onMove: (nodeId: string, direction?: string, options?: { wimpFlee?: boolean }) => void;
  addLog: (msg: string) => void;
}

const DIR_NAMES: Record<string, string> = {
  N: 'North', S: 'South', E: 'East', W: 'West',
  NE: 'Northeast', NW: 'Northwest', SE: 'Southeast', SW: 'Southwest',
};

export interface WimpApi {
  /**
   * Imperatively check whether an incoming HP value (from the next server tick)
   * would cross the wimp threshold and, if so, initiate a panic flee NOW
   * instead of waiting for React to re-render with the new HP.
   *
   * Returns `true` if a flee was initiated for this tick.
   */
  tryFleeForIncomingHp: (newHp: number) => boolean;
  /**
   * Notify the wimp system that the player moved themselves during combat.
   * Suppresses further wimp auto-flees until this combat ends — the player
   * has clearly taken control of their retreat and we don't want the wimp
   * to yank them in a different (potentially fatal) direction.
   */
  notifyPlayerMoved: () => void;
}

/**
 * Watches the player's HP during combat and auto-flees in the configured
 * direction when HP drops at or below `wimp_hp_threshold`. Fires at most
 * once per combat session. Wimp flees skip opportunity attacks (panic escape).
 */
export function useWimp({ character, inCombat, currentNode, onMove, addLog }: UseWimpParams): WimpApi {
  const firedRef = useRef(false);
  const warnedNoPathRef = useRef(false);

  // Reset the latch whenever combat ends.
  useEffect(() => {
    if (!inCombat) {
      firedRef.current = false;
      warnedNoPathRef.current = false;
    }
  }, [inCombat]);

  // Shared decision body — returns true if a flee was triggered.
  const attemptFlee = useCallback((observedHp: number): boolean => {
    if (!inCombat || !character || firedRef.current) return false;
    const threshold = character.wimp_hp_threshold ?? 0;
    const direction = character.wimp_direction;
    if (threshold <= 0 || !direction) return false;
    if (observedHp <= 0) return false;
    if (observedHp > threshold) return false;

    const conn = (currentNode?.connections as any[] | undefined)?.find(
      (c: any) => c.direction === direction,
    );
    if (!conn) {
      if (!warnedNoPathRef.current) {
        addLog(`⚠️ Wimp wanted to flee ${DIR_NAMES[direction] || direction} but no path exists.`);
        warnedNoPathRef.current = true;
      }
      return false;
    }
    if (conn.locked) {
      if (!warnedNoPathRef.current) {
        addLog(`⚠️ Wimp wanted to flee ${DIR_NAMES[direction] || direction} but the path is locked.`);
        warnedNoPathRef.current = true;
      }
      return false;
    }

    firedRef.current = true;
    onMove(conn.node_id, direction, { wimpFlee: true });
    return true;
  }, [inCombat, character, currentNode, onMove, addLog]);

  // Reactive trigger: fires when server-applied HP updates land via realtime.
  useEffect(() => {
    if (!character) return;
    attemptFlee(character.hp);
  }, [character, attemptFlee]);

  // Imperative trigger: combat-tick caller invokes this with the incoming HP
  // BEFORE applying the update, so flee starts synchronously.
  const tryFleeForIncomingHp = useCallback((newHp: number) => {
    return attemptFlee(newHp);
  }, [attemptFlee]);

  return { tryFleeForIncomingHp };
}
