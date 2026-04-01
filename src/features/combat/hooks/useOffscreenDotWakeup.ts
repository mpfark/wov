/**
 * useOffscreenDotWakeup — Client-assisted wake-up scheduler for offscreen DoT kills.
 *
 * DESIGN RULE:
 * - Client PREDICTS when reconciliation should be requested
 * - Server DETERMINES the actual reconciled result
 * - Client never sends damage, HP, death state, or tick counts
 *
 * When the player leaves a node with active DoT effects, this hook:
 * 1. Queries the DB for active_effects + creature HP at the departed node
 * 2. Simulates the per-effect tick timeline to predict lethal time
 * 3. Schedules a reconcileNode(nodeId) call at the predicted time (+buffer)
 * 4. If the creature survives, reschedules (up to MAX_RESCHEDULES)
 */

import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { GameEventBus } from '@/hooks/useGameEvents';

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
  creatureHp: Record<string, number>;
  effects: ActiveEffectSnapshot[];
}

interface TrackedNode {
  snapshot: OffscreenSnapshot;
  timerId: ReturnType<typeof setTimeout> | null;
  rescheduleCount: number;
  predictedDeathTime: number | null;
}

// ── Constants ────────────────────────────────────────────────────

const BUFFER_MS = 2000;
const MAX_TRACKED_NODES = 5;
const MAX_RESCHEDULES = 3;

// ── Prediction: per-effect tick simulation ───────────────────────

function predictLethalTime(
  creatureHp: number,
  effects: ActiveEffectSnapshot[],
): number | null {
  if (creatureHp <= 0 || effects.length === 0) return null;

  const ticks: { time: number; damage: number }[] = [];
  for (const eff of effects) {
    let t = eff.next_tick_at;
    while (t <= eff.expires_at) {
      ticks.push({ time: t, damage: eff.damage_per_tick });
      t += eff.tick_rate_ms;
    }
  }

  if (ticks.length === 0) return null;
  ticks.sort((a, b) => a.time - b.time);

  let hp = creatureHp;
  for (const tick of ticks) {
    hp -= tick.damage;
    if (hp <= 0) return tick.time;
  }

  return null;
}

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
  eventBus: GameEventBus;
}

export function useOffscreenDotWakeup({
  currentNodeId,
  eventBus,
}: UseOffscreenDotWakeupParams) {
  const trackedRef = useRef<Map<string, TrackedNode>>(new Map());
  const prevNodeRef = useRef<string | null>(currentNodeId);

  useEffect(() => {
    const prevNode = prevNodeRef.current;
    prevNodeRef.current = currentNodeId;

    // Detect node departure
    if (prevNode && prevNode !== currentNodeId) {
      const departedNodeId = prevNode;
      console.log(`[offscreen-dot] node departure detected: ${departedNodeId} → ${currentNodeId}`);

      // Query DB for fresh effects + creature state (async, fire-and-forget for the effect)
      (async () => {
        try {
          const [{ data: effects }, { data: creatures }] = await Promise.all([
            supabase
              .from('active_effects')
              .select('target_id, effect_type, damage_per_tick, stacks, next_tick_at, expires_at, tick_rate_ms')
              .eq('node_id', departedNodeId),
            supabase
              .from('creatures')
              .select('id, hp, max_hp')
              .eq('node_id', departedNodeId)
              .eq('is_alive', true),
          ]);

          console.log(`[offscreen-dot] DB query for node=${departedNodeId}: effects=${effects?.length ?? 0}, creatures=${creatures?.length ?? 0}`);

          if (!effects || effects.length === 0) {
            console.log(`[offscreen-dot] no active effects in DB for node=${departedNodeId}, not tracking`);
            return;
          }

          const creatureHp: Record<string, number> = {};
          for (const c of (creatures || [])) {
            creatureHp[c.id] = c.hp;
          }

          const snapshot: OffscreenSnapshot = {
            nodeId: departedNodeId,
            capturedAt: Date.now(),
            creatureHp,
            effects: effects.map(e => ({
              target_id: e.target_id,
              effect_type: e.effect_type,
              damage_per_tick: e.damage_per_tick,
              stacks: e.stacks,
              next_tick_at: e.next_tick_at,
              expires_at: e.expires_at,
              tick_rate_ms: e.tick_rate_ms,
            })),
          };

          scheduleWakeup(trackedRef.current, snapshot, 0, eventBus);
        } catch (err) {
          console.error(`[offscreen-dot] failed to query DB for node=${departedNodeId}:`, err);
        }
      })();
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

// ── Scheduling logic ────────────────────────────────────────────

function scheduleWakeup(
  tracked: Map<string, TrackedNode>,
  snapshot: OffscreenSnapshot,
  rescheduleCount: number,
  eventBus: GameEventBus,
) {
  const { predictedTime, lethalCreatureIds } = findEarliestLethalTime(snapshot);

  if (!predictedTime || lethalCreatureIds.length === 0) {
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
    }
  }

  // Clear existing timer for this node
  const existing = tracked.get(snapshot.nodeId);
  if (existing?.timerId) clearTimeout(existing.timerId);

  console.log(`[offscreen-dot] tracking node=${snapshot.nodeId}, predicted_death_in=${delay}ms, creatures=${lethalCreatureIds.join(',')}, reschedule=${rescheduleCount}`);

  const timerId = setTimeout(async () => {
    console.log(`[offscreen-dot] wake-up triggered for node=${snapshot.nodeId}`);

    try {
      const { data, error } = await supabase.functions.invoke('combat-catchup', {
        body: { node_id: snapshot.nodeId, force: true, reason: 'predicted_lethal_effect' },
      });

      if (error) {
        console.error('[offscreen-dot] reconcile error:', error);
        tracked.delete(snapshot.nodeId);
        return;
      }

      const reconciledCreatures = (data?.creatures || []) as { id: string; hp: number }[];

      // Emit kill reward events via event bus
      if (data?.kill_rewards && Array.isArray(data.kill_rewards)) {
        for (const reward of data.kill_rewards) {
          eventBus.emit('combat:kill', {
            creatureName: reward.creature_name,
            creatureLevel: reward.creature_level,
            creatureRarity: reward.creature_rarity,
            xp: reward.xp_each,
            gold: reward.gold_each,
          });
          eventBus.emit('log', {
            message: `☠️ ${reward.creature_name} has been slain by DoT! +${reward.xp_each} XP${reward.gold_each > 0 ? `, +${reward.gold_each} gold` : ''}.`,
          });
        }
      }

      const entry = tracked.get(snapshot.nodeId);
      if (!entry) return;

      if (rescheduleCount >= MAX_RESCHEDULES) {
        tracked.delete(snapshot.nodeId);
        console.log(`[offscreen-dot] max reschedules reached for node=${snapshot.nodeId}, clearing`);
        return;
      }

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

      scheduleWakeup(tracked, updatedSnapshot, rescheduleCount + 1, onKillRewards);
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
