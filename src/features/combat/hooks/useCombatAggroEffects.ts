/**
 * useCombatAggroEffects — auto-aggro and re-engagement logic.
 *
 * This file owns:
 * - Re-engaging aggressive creatures after combat stops
 * - Mid-fight aggressive creature joins
 * - Initial aggro on node entry
 * - Tracking which creatures have already been processed for aggro
 * - Immediate threat-feedback log lines (presentation only)
 */
import { useEffect, useRef } from 'react';
import type { Character } from '@/features/character';
import type { Creature } from '@/features/creatures';

// ── Immersive aggro phrases ────────────────────────────────────────
const THREAT_PHRASES_INITIAL = [
  (n: string) => `⚠️ ${n} lunges at you!`,
  (n: string) => `⚠️ ${n} turns on you!`,
  (n: string) => `⚠️ ${n} snarls and charges!`,
  (n: string) => `⚠️ ${n} locks eyes on you!`,
];

const THREAT_PHRASES_REENGAGE = [
  (n: string) => `⚠️ ${n} charges at you!`,
  (n: string) => `⚠️ ${n} rushes toward you!`,
  (n: string) => `⚠️ ${n} closes in on you!`,
];

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

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
  const wasInCombatRef = useRef(false);

  // Track combat stop — detect the true→false transition to enable re-engagement
  useEffect(() => {
    if (inCombat) {
      wasInCombatRef.current = true;
      justStoppedRef.current = false;
    } else if (wasInCombatRef.current) {
      wasInCombatRef.current = false;
      justStoppedRef.current = true;
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
      if (import.meta.env.DEV) {
        console.debug('[aggro] re-engage detected', { creatureId: nextAggro.id, ts: performance.now().toFixed(0) });
      }
      addLocalLog(pickRandom(THREAT_PHRASES_REENGAGE)(nextAggro.name));
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
      if (c.is_aggressive && c.is_alive && c.hp > 0 && !engagedCreatureIdsRef.current.includes(c.id) && !recentlyKilledRef.current.has(c.id) && !aggroProcessedRef.current.has(c.id)) {
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
      if (import.meta.env.DEV) {
        console.debug('[aggro] initial detected', { creatureId: firstAggro.id, ts: performance.now().toFixed(0) });
      }
      addLocalLog(pickRandom(THREAT_PHRASES_INITIAL)(firstAggro.name));
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
