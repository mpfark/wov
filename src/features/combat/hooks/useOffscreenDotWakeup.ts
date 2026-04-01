/**
 * useOffscreenDotWakeup — Client-assisted wake-up scheduler for offscreen DoT kills.
 *
 * DESIGN RULE:
 * - Client PREDICTS when reconciliation should be requested
 * - Server DETERMINES the actual reconciled result
 * - Client never sends damage, HP, death state, or tick counts
 *
 * When the player leaves a node with active DoT effects, this hook:
 * 1. Captures an explicit snapshot of creature HP + effects at departure
 * 2. Simulates the per-effect tick timeline to predict lethal time
 * 3. Schedules a reconcileNode(nodeId) call at the predicted time (+buffer)
 * 4. If the creature survives, reschedules (up to MAX_RESCHEDULES)
 */

import { useEffect, useRef } from 'react';
import { reconcileNode } from '@/features/creatures/hooks/useCreatures';
import { supabase } from '@/integrations/supabase/client';

// ── Types ────────────────────────────────────────────────────────

export interface ActiveEffectSnapshot {
  target_id: string;
  effect_type: string;
  damage_per_tick: number;
  stacks: number;
  next_tick_at: number;
  expires_at: number;
  tick_rate_ms: number;
}

interface OffscreenSnapshot {
  nodeId: string;
  capturedAt: number;
  creatureHp: Record<string, number>; // creature_id → last known HP
  effects: ActiveEffectSnapshot[];
}

interface TrackedNode {
  snapshot: OffscreenSnapshot;
  timerId: ReturnType<typeof setTimeout> | null;
  rescheduleCount: number;
  predictedDeathTime: number | null;
}

// ── Constants ────────────────────────────────────────────────────

const BUFFER_MS = 2000;        // Schedule wake-up 2s after predicted death
const MAX_TRACKED_NODES = 5;   // FIFO eviction
const MAX_RESCHEDULES = 3;     // Safety cap per node

// ── Prediction: per-effect tick simulation ───────────────────────

/**
 * Simulate the future tick timeline for a single creature.
 * Returns the timestamp at which HP is predicted to reach 0, or null.
 */
function predictLethalTime(
  creatureHp: number,
  effects: ActiveEffectSnapshot[],
): number | null {
  if (creatureHp <= 0 || effects.length === 0) return null;

  // Build timeline of all future ticks
  const ticks: { time: number; damage: number }[] = [];
  for (const eff of effects) {
    let t = eff.next_tick_at;
    while (t <= eff.expires_at) {
      ticks.push({ time: t, damage: eff.damage_per_tick });
      t += eff.tick_rate_ms;
    }
  }

  if (ticks.length === 0) return null;

  // Sort by time ascending
  ticks.sort((a, b) => a.time - b.time);

  let hp = creatureHp;
  for (const tick of ticks) {
    hp -= tick.damage;
    if (hp <= 0) return tick.time;
  }

  return null; // Effects expire before killing
}

/**
 * For a snapshot, find the earliest predicted death time across all creatures.
 */
function findEarliestLethalTime(snapshot: OffscreenSnapshot): {
  predictedTime: number | null;
  lethalCreatureIds: string[];
} {
  const lethalCreatureIds: string[] = [];
  let earliest: number | null = null;

  const creatureIds = new Set(snapshot.effects.map(e => e.target_id));
  for (const creatureId of creatureIds) {
    const hp = snapshot.creatureHp[creatureId];
    if (hp === undefined || hp <= 0) continue;

    const creatureEffects = snapshot.effects.filter(e => e.target_id === creatureId);
    const deathTime = predictLethalTime(hp, creatureEffects);
    if (deathTime !== null) {
      lethalCreatureIds.push(creatureId);
      if (earliest === null || deathTime < earliest) earliest = deathTime;
    }
  }

  return { predictedTime: earliest, lethalCreatureIds };
}

// ── Hook ─────────────────────────────────────────────────────────

export interface UseOffscreenDotWakeupParams {
  currentNodeId: string | null;
  lastActiveEffects: ActiveEffectSnapshot[] | null;
  creatures: { id: string; hp: number; max_hp: number }[];
  creatureHpOverrides: Record<string, number>;
}

export function useOffscreenDotWakeup({
  currentNodeId,
  lastActiveEffects,
  creatures,
  creatureHpOverrides,
}: UseOffscreenDotWakeupParams) {
  const trackedRef = useRef<Map<string, TrackedNode>>(new Map());
  const prevNodeRef = useRef<string | null>(currentNodeId);

  // Keep latest values in refs for snapshot capture
  const lastEffectsRef = useRef(lastActiveEffects);
  lastEffectsRef.current = lastActiveEffects;
  const creaturesRef = useRef(creatures);
  creaturesRef.current = creatures;
  const hpOverridesRef = useRef(creatureHpOverrides);
  hpOverridesRef.current = creatureHpOverrides;

  useEffect(() => {
    const prevNode = prevNodeRef.current;
    prevNodeRef.current = currentNodeId;

    // Detect node departure
    if (prevNode && prevNode !== currentNodeId) {
      // Player left prevNode — capture snapshot
      const effects = lastEffectsRef.current;
      if (effects && effects.length > 0) {
        // Build creature HP map from overrides + base
        const creatureHp: Record<string, number> = {};
        for (const c of creaturesRef.current) {
          creatureHp[c.id] = hpOverridesRef.current[c.id] ?? c.hp;
        }

        const snapshot: OffscreenSnapshot = {
          nodeId: prevNode,
          capturedAt: Date.now(),
          creatureHp,
          effects: [...effects],
        };

        scheduleWakeup(trackedRef.current, snapshot, 0);
      }
    }

    // If we entered a tracked node, clear its timer
    if (currentNodeId && trackedRef.current.has(currentNodeId)) {
      const entry = trackedRef.current.get(currentNodeId)!;
      if (entry.timerId) clearTimeout(entry.timerId);
      trackedRef.current.delete(currentNodeId);
      console.log(`[offscreen-dot] cleared tracking for node=${currentNodeId} (re-entered)`);
    }
  }, [currentNodeId]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      for (const entry of trackedRef.current.values()) {
        if (entry.timerId) clearTimeout(entry.timerId);
      }
      trackedRef.current.clear();
    };
  }, []);
}

// ── Scheduling logic (pure functions operating on tracked map) ───

function scheduleWakeup(
  tracked: Map<string, TrackedNode>,
  snapshot: OffscreenSnapshot,
  rescheduleCount: number,
) {
  const { predictedTime, lethalCreatureIds } = findEarliestLethalTime(snapshot);

  if (!predictedTime || lethalCreatureIds.length === 0) {
    // No lethal prediction — don't track
    const existing = tracked.get(snapshot.nodeId);
    if (existing?.timerId) clearTimeout(existing.timerId);
    tracked.delete(snapshot.nodeId);
    console.log(`[offscreen-dot] no lethal prediction for node=${snapshot.nodeId}, not tracking`);
    return;
  }

  const delay = Math.max(0, predictedTime - Date.now() + BUFFER_MS);

  // FIFO eviction if at capacity
  if (!tracked.has(snapshot.nodeId) && tracked.size >= MAX_TRACKED_NODES) {
    const oldestKey = tracked.keys().next().value;
    if (oldestKey) {
      const old = tracked.get(oldestKey);
      if (old?.timerId) clearTimeout(old.timerId);
      tracked.delete(oldestKey);
      console.log(`[offscreen-dot] evicted oldest tracked node=${oldestKey}`);
    }
  }

  // Clear existing timer for this node
  const existing = tracked.get(snapshot.nodeId);
  if (existing?.timerId) clearTimeout(existing.timerId);

  console.log(`[offscreen-dot] tracking node=${snapshot.nodeId}, predicted_death_in=${delay}ms, creatures=${lethalCreatureIds.join(',')}, reschedule=${rescheduleCount}`);

  const timerId = setTimeout(async () => {
    console.log(`[offscreen-dot] wake-up triggered for node=${snapshot.nodeId}`);

    try {
      const reconciledCreatures = await reconcileNode(snapshot.nodeId, { reason: 'predicted_lethal_effect' });

      // Check if we should reschedule
      const entry = tracked.get(snapshot.nodeId);
      if (!entry) return; // Node was cleared (player re-entered)

      if (rescheduleCount >= MAX_RESCHEDULES) {
        tracked.delete(snapshot.nodeId);
        console.log(`[offscreen-dot] max reschedules reached for node=${snapshot.nodeId}, clearing`);
        return;
      }

      // Check if any tracked creatures are still alive with effects
      const aliveCreatures = reconciledCreatures.filter(
        c => lethalCreatureIds.includes(c.id) && c.hp > 0
      );

      if (aliveCreatures.length === 0) {
        tracked.delete(snapshot.nodeId);
        console.log(`[offscreen-dot] creatures dead or gone for node=${snapshot.nodeId}, clearing`);
        return;
      }

      // Fetch remaining effects for this node to re-predict
      const { data: remainingEffects } = await supabase
        .from('active_effects')
        .select('target_id, effect_type, damage_per_tick, stacks, next_tick_at, expires_at, tick_rate_ms')
        .eq('node_id', snapshot.nodeId);

      if (!remainingEffects || remainingEffects.length === 0) {
        tracked.delete(snapshot.nodeId);
        console.log(`[offscreen-dot] no remaining effects for node=${snapshot.nodeId}, clearing`);
        return;
      }

      // Build updated snapshot and reschedule
      const updatedHp: Record<string, number> = {};
      for (const c of aliveCreatures) updatedHp[c.id] = c.hp;

      const updatedSnapshot: OffscreenSnapshot = {
        nodeId: snapshot.nodeId,
        capturedAt: Date.now(),
        creatureHp: updatedHp,
        effects: remainingEffects.map(e => ({
          target_id: e.target_id,
          effect_type: e.effect_type,
          damage_per_tick: e.damage_per_tick,
          stacks: e.stacks,
          next_tick_at: e.next_tick_at,
          expires_at: e.expires_at,
          tick_rate_ms: e.tick_rate_ms,
        })),
      };

      scheduleWakeup(tracked, updatedSnapshot, rescheduleCount + 1);
    } catch (err) {
      console.error(`[offscreen-dot] wake-up error for node=${snapshot.nodeId}:`, err);
      tracked.delete(snapshot.nodeId);
    }
  }, delay);

  tracked.set(snapshot.nodeId, {
    snapshot,
    timerId,
    rescheduleCount,
    predictedDeathTime: predictedTime,
  });
}
