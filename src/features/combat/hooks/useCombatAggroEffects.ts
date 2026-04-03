/**
 * useCombatAggroEffects — auto-aggro and re-engagement logic.
 *
 * This file owns:
 * - Re-engaging aggressive creatures after combat stops
 * - Mid-fight aggressive creature joins
 * - Initial aggro on node entry
 * - Tracking which creatures have already been processed for aggro
 */
import { useEffect, useRef } from 'react';
import type { Character } from '@/features/character';
import type { Creature } from '@/features/creatures';

export interface UseCombatAggroEffectsParams {
  creatures: Creature[];
  inCombat: boolean;
  isLeader: boolean;
  party: { id: string } | null;
  isDead: boolean;
  character: Character;
  engagedCreatureIdsRef: React.MutableRefObject<string[]>;
  startCombat: (creatureId: string) => void;
  addLocalLog: (msg: string) => void;
  setEngagedCreatureIds: React.Dispatch<React.SetStateAction<string[]>>;
}

export function useCombatAggroEffects(params: UseCombatAggroEffectsParams) {
  const {
    creatures, inCombat, isLeader, party, isDead, character,
    engagedCreatureIdsRef, startCombat, addLocalLog, setEngagedCreatureIds,
  } = params;

  const pendingAggroRef = useRef(false);
  const aggroProcessedRef = useRef<Set<string>>(new Set());
  const recentlyKilledRef = useRef<Set<string>>(new Set());
  const justStoppedRef = useRef(false);

  // Track combat stop
  useEffect(() => {
    if (inCombat) {
      justStoppedRef.current = false;
    }
  }, [inCombat]);

  // Re-engage aggressive creatures after combat stops
  useEffect(() => {
    if (inCombat || !justStoppedRef.current || isDead) return;
    if (party && !isLeader) return;
    if (creatures.length === 0) return;
    const nextAggro = creatures.find(c => c.is_alive && c.hp > 0 && c.is_aggressive && !recentlyKilledRef.current.has(c.id));
    if (nextAggro) {
      justStoppedRef.current = false;
      addLocalLog(`⚠️ ${nextAggro.name} attacks!`);
      startCombat(nextAggro.id);
    } else {
      justStoppedRef.current = false;
    }
  }, [creatures, inCombat, startCombat, isDead, party, isLeader, addLocalLog]);

  // Mid-fight: aggressive creatures join
  useEffect(() => {
    if (!inCombat) return;
    if (party && !isLeader) return;
    for (const c of creatures) {
      if (c.is_aggressive && c.is_alive && c.hp > 0 && !engagedCreatureIdsRef.current.includes(c.id) && !recentlyKilledRef.current.has(c.id)) {
        setEngagedCreatureIds(prev => {
          if (prev.includes(c.id)) return prev;
          const next = [...prev, c.id];
          engagedCreatureIdsRef.current = next;
          return next;
        });
        addLocalLog(`⚠️ ${c.name} joins the fight!`);
      }
    }
  }, [creatures, inCombat, party, isLeader, engagedCreatureIdsRef, setEngagedCreatureIds, addLocalLog]);

  // Initial aggro on node entry
  useEffect(() => {
    if (!pendingAggroRef.current || creatures.length === 0 || isDead || character.hp <= 0) return;
    if (party && !isLeader) return;
    pendingAggroRef.current = false;
    justStoppedRef.current = false;
    const aggressiveCreatures = creatures.filter(
      c => c.is_aggressive && c.is_alive && c.hp > 0 && !aggroProcessedRef.current.has(c.id)
    );
    if (aggressiveCreatures.length === 0) return;
    for (const c of aggressiveCreatures) aggroProcessedRef.current.add(c.id);
    if (character.hp <= 0) return;
    const firstAggro = aggressiveCreatures[0];
    if (firstAggro) {
      addLocalLog(`⚠️ ${firstAggro.name} is aggressive and attacks you!`);
      startCombat(firstAggro.id);
    }
  }, [creatures, startCombat, isDead, character.hp, party, isLeader, addLocalLog]);

  return {
    pendingAggroRef,
    aggroProcessedRef,
    recentlyKilledRef,
    justStoppedRef,
  };
}
