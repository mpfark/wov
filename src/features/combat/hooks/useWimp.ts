import { useEffect, useRef } from 'react';
import { Character } from '@/features/character';
import { GameNode } from '@/features/world';

interface UseWimpParams {
  character: Character | null;
  inCombat: boolean;
  currentNode: GameNode | undefined;
  onMove: (nodeId: string, direction?: string) => void;
  addLog: (msg: string) => void;
}

const DIR_NAMES: Record<string, string> = {
  N: 'North', S: 'South', E: 'East', W: 'West',
  NE: 'Northeast', NW: 'Northwest', SE: 'Southeast', SW: 'Southwest',
};

/**
 * Watches the player's HP during combat and auto-flees in the configured
 * direction when HP drops at or below `wimp_hp_threshold` (% of max HP).
 * Fires at most once per combat session.
 */
export function useWimp({ character, inCombat, currentNode, onMove, addLog }: UseWimpParams) {
  const firedRef = useRef(false);
  const warnedNoPathRef = useRef(false);

  // Reset the latch whenever combat ends.
  useEffect(() => {
    if (!inCombat) {
      firedRef.current = false;
      warnedNoPathRef.current = false;
    }
  }, [inCombat]);

  useEffect(() => {
    if (!inCombat || !character || firedRef.current) return;
    const threshold = character.wimp_hp_threshold ?? 0;
    const direction = character.wimp_direction;
    if (threshold <= 0 || !direction) return;
    if (character.hp <= 0) return;
    if (character.hp > threshold) return;

    const conn = (currentNode?.connections as any[] | undefined)?.find(
      (c: any) => c.direction === direction
    );
    if (!conn) {
      if (!warnedNoPathRef.current) {
        addLog(`⚠️ Wimp wanted to flee ${DIR_NAMES[direction] || direction} but no path exists.`);
        warnedNoPathRef.current = true;
      }
      return;
    }
    if (conn.locked) {
      if (!warnedNoPathRef.current) {
        addLog(`⚠️ Wimp wanted to flee ${DIR_NAMES[direction] || direction} but the path is locked.`);
        warnedNoPathRef.current = true;
      }
      return;
    }

    firedRef.current = true;
    addLog(`⚠️ Wimp triggered at ${character.hp} HP — fleeing ${DIR_NAMES[direction] || direction}!`);
    onMove(conn.node_id, direction);
  }, [inCombat, character, currentNode, onMove, addLog]);
}
