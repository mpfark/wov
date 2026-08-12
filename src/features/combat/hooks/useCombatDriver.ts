/**
 * useCombatDriver — unified server-authoritative combat via the combat-tick edge function.
 * (Drives both solo and party combat; formerly usePartyCombat.)
 *
 * HYBRID MODEL:
 * - Live combat sessions exist only while players are actively present in the node.
 * - When a player leaves a node, the session ends immediately (no offscreen rounds).
 * - Persistent effects (DoTs) survive independently in active_effects.
 * - Offscreen effect reconciliation happens via combat-catchup on node access.
 * - Client polls every 2s; server processes only active same-node combat.
 *
 * This file is the orchestration layer composing:
 *   - interpretCombatTickResult (pure response parsing)
 *   - useCombatAggroEffects (auto-aggro logic)
 *   - useCombatLifecycle (cleanup / lifecycle)
 *   - combat-predictor helpers (prediction state)
 */
import { useState, useCallback, useEffect, useRef } from 'react';

import { Character } from '@/features/character';
import { Creature } from '@/features/creatures';
import { supabase } from '@/integrations/supabase/client';
import { notifyMaterialsChanged } from '@/features/inventory/hooks/useMaterials';
import { setWorkerInterval, clearWorkerInterval } from '@/lib/worker-timer';
import { getAbilityKeyForSlot } from '@/features/combat/utils/ability-calcs';
import { CLASS_ABILITIES } from '@/features/combat';
import { interpretCombatTickResult } from '../utils/interpretCombatTickResult';
import type { CombatTickResponse } from '../utils/interpretCombatTickResult';

import { useCombatAggroEffects } from './useCombatAggroEffects';
import { buildAggroEvent, buildPositioningEvent } from '@/features/combat/events/threat-event-builder';
import { useCombatLifecycle } from './useCombatLifecycle';
import { legacyStringToEvent } from '@/features/combat/events/legacy-adapter';
import { createLogEvent, mapServerEventType } from '@/features/combat/events/log-event';
import {
  traceAbilityPress, traceTickStart, traceTickResponse, traceTickApplied, traceBroadcastTick,
  type TickCause,
} from '@/features/combat/trace/combat-trace';

/** Ability types that are processed server-side in the combat-tick */
const SERVER_ABILITY_TYPES = new Set([
  'multi_attack', 'stack_consume', 'execute_attack', 'ignite_consume', 'burst_damage', 'dot_debuff',
  // T0 openers — resolved server-side; can also initiate combat against a Tab target
  // `weapon_attack` is the consolidated reusable weapon strike; the three
  // per-class mechanics stay listed for archived assignments.
  'spell_attack', 'fireball', 'weapon_attack', 'power_strike', 'aimed_shot', 'backstab', 'smite', 'cutting_words',
]);

/**
 * Phase 6: how stale the tick stream must be before a non-leader party member
 * wakes the tick itself. Longer than the 2s leader heartbeat so a healthy
 * leader always stays the natural driver, short enough that a suspended or
 * offline leader cannot freeze the fight.
 */
const FOLLOWER_WAKE_STALE_MS = 6000;



interface Party {
  id: string;
  leader_id: string;
  tank_id: string | null;
}

export interface MemberBuffState {
  crit_buff?: { bonus: number };
  stealth_buff?: boolean | { mult?: number };
  /** Consolidated `offense_buff` (damage_mult): carries the granting ability key. */
  damage_buff?: boolean | { ability_key?: string };
  root_debuff_target?: string;
  root_debuff_reduction?: number;
  battle_cry_dr?: { reduction: number; crit_reduction: number };
  poison_buff?: boolean;
  evasion_buff?: { dodge_chance: number };
  ignite_buff?: boolean;
  absorb_buff?: { shield_hp: number };
  sunder_target?: string;
  sunder_reduction?: number;
  disengage_next_hit?: { bonus_mult: number };
  holy_shield?: { wis_mod: number; expires_at: number };
  
  aura_pulse?: { mag_mod: number; expires_at: number; ability_key?: string };
  divine_challenge?: { flat: number; expires_at: number };
}

export interface UseCombatDriverParams {
  character: Character;
  creatures: Creature[];
  party: Party | null;
  isLeader: boolean;
  isDead: boolean;
  /** Structured-event emitter — the only local log path. */
  addLocalLogEvent: (event: import('@/features/combat/events/log-event').GameLogEvent) => void;

  updateCharacter: (updates: Partial<Character>) => Promise<void>;
  updateCharacterLocal?: (updates: Partial<Character>) => void;
  fetchGroundLoot: () => void;
  gatherBuffs?: () => MemberBuffState;
  onConsumedBuffs?: (consumed: { buff: string; character_id: string }[]) => void;
  onClearedDots?: (cleared: { character_id: string; creature_id: string; dot_type: string }[]) => void;
  onPoisonProc?: (creatureId: string) => void;
  onIgniteProc?: (creatureId: string) => void;
  onAbilityExecute?: (abilityIndex: number, targetId?: string) => Promise<void>;
  onConsumedAbilityStacks?: (stacks: { character_id: string; creature_id: string; stack_type: string }[]) => void;
  /** Callback with server DoT state for UI sync */
  onActiveDots?: (dots: Record<string, any>) => void;
  /** Callback with merged creature-centric debuffs for shared party display */
  onCreatureDebuffs?: (debuffs: Record<string, any>) => void;
  /** Callback to sync absorb shield HP from server */
  onAbsorbSync?: (remaining: number) => void;
  /** Callback when a boss creature dies with an admin-authored death cry */
  onBossDeathCry?: (entry: { creatureName: string; text: string }) => void;
  /** Callback fired with creature IDs the server confirmed dead in this tick (for optimistic UI removal) */
  onCreaturesKilled?: (creatureIds: string[]) => void;
  /** Buff setters for death cleanup (Envenom/Ignite) */
  setPoisonBuff?: React.Dispatch<React.SetStateAction<any>>;
  setIgniteBuff?: React.Dispatch<React.SetStateAction<any>>;
  /** Force-clear reserved_buffs locally on death so stance buttons don't
   *  remain pressed past the server's authoritative wipe. */
  clearReservedBuffsLocal?: () => void;
  /**
   * Optional pre-apply hook: called with the new HP value the server is about
   * to commit for THIS player. Return true if the caller initiated a flee
   * (wimp panic escape); useCombatDriver still applies the HP update either way.
   */
  onIncomingPlayerHp?: (newHp: number) => boolean;

}

export function useCombatDriver(params: UseCombatDriverParams) {
  const ext = useRef(params);
  ext.current = params;

  const [inCombat, setInCombat] = useState(false);
  const [activeCombatCreatureId, setActiveCombatCreatureId] = useState<string | null>(null);
  const [engagedCreatureIds, setEngagedCreatureIds] = useState<string[]>([]);
  const engagedCreatureIdsRef = useRef<string[]>([]);
  const [creatureHpOverrides, setCreatureHpOverrides] = useState<Record<string, number>>({});
  const creatureHpOverridesRef = useRef<Record<string, number>>({});
  const [lastTickTime, setLastTickTime] = useState<number | null>(null);
  
  const intervalRef = useRef<number | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const lastTickRef = useRef<number>(0);
  const inCombatRef = useRef(false);
  const tickBusyRef = useRef(false);
  const tickPendingRef = useRef(false);
  const tickSeqRef = useRef(0);
  // Monotonic per-session sequence for durable combat action submissions.
  const durableSeqRef = useRef(0);
  /**
   * Why the next tick request is being fired — instrumentation only.
   * Consumed (and reset to 'cadence') by doTick.
   */
  const tickCauseRef = useRef<TickCause>('cadence');
  /**
   * Batch ids already applied locally. A driver can receive the same
   * authoritative batch twice (own response + party broadcast); replaying it
   * duplicates log lines and re-applies creature HP.
   */
  const appliedBatchIdsRef = useRef<Set<string>>(new Set());

  // Dev-only: combat start timing
  const combatStartTimeRef = useRef<number | null>(null);

  // Ability queue state
  const [pendingAbility, setPendingAbility] = useState<{ index: number; targetId?: string } | null>(null);
  const pendingAbilityRef = useRef<{ index: number; targetId?: string; readyAt: number; cpCost: number; label: string } | null>(null);
  const [pendingCpCost, setPendingCpCost] = useState<number>(0);
  // Last CP value the client optimistically committed for the in-flight ability.
  // When the server's tick response echoes this exact value, we suppress the
  // CP repaint so the bar doesn't briefly snap up and back down.
  const optimisticCpRef = useRef<number | null>(null);
  const idleCountRef = useRef(0);

   // Prediction removed — creature HP only updates from server responses

  // Leader aggregates non-leader buff stacks received via broadcast
  const memberBuffsRef = useRef<Record<string, MemberBuffState>>({});
  const memberAbilitiesRef = useRef<any[]>([]);
  const doTickRef = useRef<() => void>(() => {});
  // Tracks the target of the most recent dispatched opener ability so we can
  // engage only that creature (not other aggressive bystanders the server
  // happens to report state for) when transitioning idle → in-combat.
  const lastDispatchedOpenerTargetRef = useRef<string | null>(null);

  // ── Helpers ────────────────────────────────────────────────────

  const updateCreatureHp = useCallback((creatureId: string, hp: number) => {
    setCreatureHpOverrides(prev => {
      const next = { ...prev, [creatureId]: hp };
      creatureHpOverridesRef.current = next;
      return next;
    });
  }, []);

  const stopCombat = useCallback(() => {
    // Durable disengage (Phase 2): drop this character's engagement rows so
    // the server-side roster stops treating us as a combatant, and cancel any
    // still-pending durable intent.
    const leavingCharacterId = ext.current?.character?.id;
    if (leavingCharacterId) {
      void supabase
        .rpc('leave_encounter_engagements', {
          _character_id: leavingCharacterId,
          _creature_id: null,
        })
        .then(({ error }) => {
          if (error) console.warn('[combat] disengage failed', error.message);
        });
    }
    inCombatRef.current = false;
    tickBusyRef.current = false;
    tickSeqRef.current = 0;
    setInCombat(false);
    setActiveCombatCreatureId(null);
    setEngagedCreatureIds([]);
    engagedCreatureIdsRef.current = [];
    setCreatureHpOverrides({});
    creatureHpOverridesRef.current = {};
    memberBuffsRef.current = {};
    memberAbilitiesRef.current = [];
    // If a T0/queued ability was mid-cast, fizzle it (no CP charged — server never saw it).
    const fizzling = pendingAbilityRef.current;
    if (fizzling) {
      const p = ext.current;
      const fizzleEvent = buildPositioningEvent(
        'fizzle',
        `Your ${fizzling.label} fizzles as you move away.`,
        { kind: 'player', id: p.character.id, name: p.character.name },
      );
      p.addLocalLogEvent(fizzleEvent);
    }
    pendingAbilityRef.current = null;
    setPendingAbility(null);
    setPendingCpCost(0);
    optimisticCpRef.current = null;
    if (intervalRef.current) {
      clearWorkerInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  // ── Mobile / background-tab catchup ───────────────────────────
  // When the tab returns to the foreground:
  //  - drivers (solo / leader) immediately fire a tick so any kill that
  //    resolved while throttled is processed before the player moves;
  //  - non-leader party members refresh their character row to pick up
  //    XP/gold/Renown awarded by the leader's tick that they may have
  //    missed if the realtime broadcast was dropped while suspended.
  useEffect(() => {
    const onVisible = async () => {
      if (document.visibilityState !== 'visible') return;
      const p = ext.current;
      const solo = !p.party;
      const driver = solo || p.isLeader;
      if (driver) {
        if (inCombatRef.current) {
          try { doTickRef.current(); } catch { /* noop */ }
        }
        return;
      }
      // Non-leader: pull a fresh character snapshot in case the broadcast was missed.
      try {
        const { data } = await supabase
          .from('characters')
          .select('xp, gold, level, bhp, rp_total_earned, unspent_stat_points, max_cp, max_mp, max_hp, respec_points')
          .eq('id', p.character.id)
          .single();
        if (data && ext.current.updateCharacterLocal) {
          ext.current.updateCharacterLocal(data as Partial<Character>);
        }
      } catch (e) {
        console.warn('[combat] visibility refresh failed', e);
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);



  // ── Queue ability for the next tick submission ─────────────────
  // The action is eligible immediately: the previous build parked it for a
  // fixed 2s (`readyAt: now + 2000`) which, on top of the 2s cadence, meant a
  // pressed ability could wait up to 4s before it was even submitted. The tick
  // cadence itself stays the pacing authority — we simply re-phase it so the
  // dispatch happens now and the next cadence tick is a full interval later.

  const queueAbility = useCallback((index: number, targetId?: string) => {
    const p = ext.current;
    const allAbilities = CLASS_ABILITIES[p.character.class] || [];
    const ability = allAbilities[index];
    const cpCost = ability?.cpCost ?? 0;
    const label = ability?.label ?? 'ability';
    pendingAbilityRef.current = { index, targetId, readyAt: Date.now(), cpCost, label };
    setPendingAbility({ index, targetId });
    setPendingCpCost(cpCost);
    idleCountRef.current = 0;
    traceAbilityPress(label);
    tickCauseRef.current = 'ability';
    if (intervalRef.current) clearWorkerInterval(intervalRef.current);
    intervalRef.current = setWorkerInterval(() => doTickRef.current(), 2000);
    doTickRef.current();
  }, []);

  // ── Aggro effects ──────────────────────────────────────────────

  const startCombatCore = useCallback((creatureId: string) => {
    const p = ext.current;
    if (p.isDead || p.character.hp <= 0) return;

    // Durable engagement roster: every character records its own
    // character↔creature engagement, independent of party role. The shared
    // encounter resolver reads this roster instead of client-sent ids.
    void supabase
      .rpc('join_encounter_engagement', {
        _character_id: p.character.id,
        _creature_id: creatureId,
      })
      .then(({ error }) => {
        if (error) console.warn('[combat] engagement join failed', error.message);
      });

    if (p.party && !p.isLeader) {
      channelRef.current?.send({
        type: 'broadcast',
        event: 'engage_request',
        payload: { creature_id: creatureId, character_id: p.character.id },
      });
      return;
    }


    setEngagedCreatureIds(prev => {
      if (prev.includes(creatureId)) return prev;
      const next = [...prev, creatureId];
      engagedCreatureIdsRef.current = next;
      return next;
    });
    setActiveCombatCreatureId(creatureId);

    if (!inCombatRef.current) {
      inCombatRef.current = true;
      setInCombat(true);
      idleCountRef.current = 0;
      console.log(`[combat] startCombat creature=${creatureId} at ${Date.now()}`);
      if (import.meta.env.DEV) combatStartTimeRef.current = performance.now();


      if (intervalRef.current) clearWorkerInterval(intervalRef.current);
      doTickRef.current();
      intervalRef.current = setWorkerInterval(() => doTickRef.current(), 2000);
    }
  }, []);

  const {
    pendingAggroRef, aggroProcessedRef, recentlyKilledRef,
  } = useCombatAggroEffects({
    creatures: params.creatures,
    inCombat,
    isLeader: params.isLeader,
    party: params.party,
    isDead: params.isDead,
    character: params.character,
    engagedCreatureIdsRef,
    startCombat: startCombatCore,
    addLocalLogEvent: params.addLocalLogEvent,
    setEngagedCreatureIds,
  });

  // ── Process tick result (thin wrapper around pure interpreter) ──

  /**
   * `meta` is instrumentation-only context from the transport that delivered
   * this result (own HTTP response vs party broadcast). It never influences
   * how the result is applied.
   */
  const processTickResult = useCallback((
    data: CombatTickResponse,
    meta?: { seq?: number; receivedAt?: number },
  ) => {
    // Duplicate-batch guard: the same authoritative batch can reach us twice
    // (our own response plus the leader broadcast, or a recovery replay).
    // Applying it twice duplicates log lines and re-applies HP.
    const batchId = data.encounter_batch_id;
    if (batchId) {
      if (appliedBatchIdsRef.current.has(batchId)) {
        if (meta?.seq !== undefined && meta.receivedAt !== undefined) {
          traceTickResponse(meta.seq, { roundTripMs: 0, outcome: 'duplicate', batchId });
        }
        return;
      }
      appliedBatchIdsRef.current.add(batchId);
      if (appliedBatchIdsRef.current.size > 200) {
        appliedBatchIdsRef.current = new Set(
          [...appliedBatchIdsRef.current].slice(-100),
        );
      }
    }
    // Enter combat state when a tick arrives while we're idle and the server
    // reports live creatures. This covers two cases:
    //   1. Non-leader party member receiving a broadcast tick result.
    //   2. Solo player / leader who fired a T0 opener out of combat — the
    //      server engaged the creature in response to the queued ability,
    //      so we must adopt that engagement here or no heartbeat continues.
    if (!inCombatRef.current) {
      const aliveServerCreatures = data.creature_states.filter(cs => cs.alive).map(cs => cs.id);
      // For a solo/leader T0 opener, engage only the targeted creature so we
      // don't drag in other aggressive bystanders the server happens to
      // include in its tick state. Non-leader broadcast path keeps full set.
      const openerTarget = lastDispatchedOpenerTargetRef.current;
      lastDispatchedOpenerTargetRef.current = null;
      const isBroadcastEntry = !!ext.current.party && !ext.current.isLeader;
      let toEngage: string[] = aliveServerCreatures;
      if (!isBroadcastEntry && openerTarget && aliveServerCreatures.includes(openerTarget)) {
        toEngage = [openerTarget];
      }
      // One-shot opener kill: opener target is in creature_states but already
      // dead. We still need to run the result through interpretCombatTickResult
      // so the kill log, XP/gold/Renown/salvage, and loot drop are applied.
      // Treat the dead target as our engagement for this single tick so the
      // downstream pipeline matches it; aliveEngagedIds === 0 will then
      // immediately stopCombat.
      if (
        !isBroadcastEntry &&
        toEngage.length === 0 &&
        openerTarget &&
        data.creature_states.some(cs => cs.id === openerTarget)
      ) {
        toEngage = [openerTarget];
      }
      if (toEngage.length > 0) {
        inCombatRef.current = true;
        setInCombat(true);
        idleCountRef.current = 0;
        setEngagedCreatureIds(toEngage);
        engagedCreatureIdsRef.current = toEngage;
        setActiveCombatCreatureId(toEngage[0]);
        // Ensure the recurring tick heartbeat is running for the driver.
        const solo = !ext.current.party;
        const driver = solo || ext.current.isLeader;
        if (driver && !intervalRef.current) {
          intervalRef.current = setWorkerInterval(() => doTickRef.current(), 2000);
        }
      }
    }
    if (!inCombatRef.current) return;

    // Dev-only: aggro→first-tick latency
    if (import.meta.env.DEV && combatStartTimeRef.current) {
      console.debug('[polish] aggro→first-tick', (performance.now() - combatStartTimeRef.current).toFixed(0), 'ms');
      combatStartTimeRef.current = null;
    }

    const now = Date.now();
    const gap = lastTickRef.current ? now - lastTickRef.current : 0;
    const result = interpretCombatTickResult(
      data,
      ext.current.character.id,
      ext.current.character.name,
      engagedCreatureIdsRef.current,
    );

    const caughtUp = (result.ticksProcessed ?? 0) > 1;
    if (caughtUp) {
      console.warn(`[combat] Processed ${result.ticksProcessed} ticks in one response (gap: ${gap}ms)`);
    }
    lastTickRef.current = now;
    setLastTickTime(now);

    // Track killed creatures
    for (const id of result.killedCreatureIds) recentlyKilledRef.current.add(id);
    // Optimistic UI removal — don't wait for the realtime UPDATE round-trip.
    // Important when a kill coincides with a level-up: the heavy character
    // re-render can otherwise delay the dead-creature DOM removal noticeably.
    if (result.killedCreatureIds.length && ext.current.onCreaturesKilled) {
      ext.current.onCreaturesKilled(result.killedCreatureIds);
    }

    // Apply creature HP overrides — one state commit for the whole tick so a
    // multi-creature response doesn't schedule a render per creature.
    const hpEntries = Object.entries(result.creatureHpUpdates);
    if (hpEntries.length > 0) {
      setCreatureHpOverrides(prev => {
        const next = { ...prev };
        for (const [id, hp] of hpEntries) next[id] = hp;
        creatureHpOverridesRef.current = next;
        return next;
      });
    }

    // Log messages. When the server folded several rounds into one response the
    // clump is legitimate catch-up, not lag — mark it so the log reads honestly.
    // No artificial pacing is applied.
    if (caughtUp && result.formattedLogMessages.length > 0) {
      ext.current.addLocalLogEvent(createLogEvent({
        type: 'system',
        effectType: 'tick_separator',
        message: `Catching up — ${result.ticksProcessed} rounds resolved at once.`,
      }));
    }
    for (const line of result.formattedLogMessages) {
      ext.current.addLocalLogEvent(typeof line === 'string' ? legacyStringToEvent(line) : line);
    }

    if (meta?.seq !== undefined && meta.receivedAt !== undefined) {
      traceTickApplied(meta.seq, meta.receivedAt);
    }

    // Salvage / gem drops land in character_materials (no realtime on that
    // table), so nudge mounted useMaterials hooks when this tick awarded any.
    if (data.events?.some(ev =>
      (ev.type === 'gem_drop' || ev.type === 'salvage_reward') &&
      (!ev.character_id || ev.character_id === ext.current.character.id)
    )) {
      notifyMaterialsChanged(ext.current.character.id);
    }




    // Character state
    if (result.characterUpdates) {
      const updates = { ...result.characterUpdates };
      // Stale-death guard: if we already know the character is dead (respawn
      // countdown is running) and this tick still reports hp=0, drop the hp
      // field so it can't clobber the client's respawn write of hp=1 that
      // happens 3s later.
      if (
        typeof updates.hp === 'number' &&
        updates.hp <= 0 &&
        (ext.current.isDead || ext.current.character.hp <= 0)
      ) {
        delete updates.hp;
      }
      // CP reconciliation: if the server agrees with the value the client
      // already optimistically committed, drop the field so we don't repaint
      // the bar (avoids the "CP returned then deducted" flicker).
      if (typeof updates.cp === 'number' && optimisticCpRef.current !== null) {
        if (updates.cp === optimisticCpRef.current) {
          delete updates.cp;
          optimisticCpRef.current = null;
        } else {
          // Server disagrees — accept the authoritative value and clear the
          // optimistic flag so subsequent ticks behave normally.
          optimisticCpRef.current = null;
        }
      }
      // Wimp pre-apply hook: give the wimp system a chance to start a panic
      // flee SYNCHRONOUSLY before we commit the new HP. This catches single-
      // tick burst damage that drops the player past the threshold in one
      // server write, where the reactive `useEffect` in useWimp would
      // otherwise only fire after the HP update has already been applied
      // (and possibly killed the player).
      if (typeof updates.hp === 'number' && ext.current.onIncomingPlayerHp) {
        try { ext.current.onIncomingPlayerHp(updates.hp); }
        catch (e) { console.error('[combat] onIncomingPlayerHp threw:', e); }
      }
      if (Object.keys(updates).length > 0) {
        if (ext.current.updateCharacterLocal) {
          ext.current.updateCharacterLocal(updates);
        } else {
          ext.current.updateCharacter(updates);
        }
      }
    }

    // Callbacks
    if (result.myConsumedBuffs.length && ext.current.onConsumedBuffs) ext.current.onConsumedBuffs(result.myConsumedBuffs);
    if (result.myClearedDots.length && ext.current.onClearedDots) ext.current.onClearedDots(result.myClearedDots);
    if (result.myConsumedAbilityStacks.length && ext.current.onConsumedAbilityStacks) ext.current.onConsumedAbilityStacks(result.myConsumedAbilityStacks);

    for (const cid of result.poisonProcs) ext.current.onPoisonProc?.(cid);
    for (const cid of result.igniteProcs) ext.current.onIgniteProc?.(cid);

    // result.activeEffectsSnapshot intentionally unused — server is authoritative
    if (result.dotsByChar && ext.current.onActiveDots) ext.current.onActiveDots(result.dotsByChar);
    if (result.creatureDebuffs && ext.current.onCreatureDebuffs) ext.current.onCreatureDebuffs(result.creatureDebuffs);
    if (result.hasLootDrop) ext.current.fetchGroundLoot();

    // Sync absorb shield HP from server
    if (result.absorbRemaining !== null && ext.current.onAbsorbSync) {
      ext.current.onAbsorbSync(result.absorbRemaining);
    }

    // Boss death cries — broadcast to all players via the global channel
    if (result.bossDeathCries.length && ext.current.onBossDeathCry) {
      for (const entry of result.bossDeathCries) ext.current.onBossDeathCry(entry);
    }

    // Release engagements the server says are no longer alive at the node.
    // Covers off-screen deaths (DoT / Consecrate resolved by combat-catchup):
    // those creatures never appear in killedCreatureIds, so without this the
    // client stayed "in combat" against a corpse and ticked forever.
    if (result.staleEngagedIds && result.staleEngagedIds.length > 0) {
      const stale = new Set(result.staleEngagedIds);
      const kept = engagedCreatureIdsRef.current.filter(id => !stale.has(id));
      if (kept.length !== engagedCreatureIdsRef.current.length) {
        engagedCreatureIdsRef.current = kept;
        setEngagedCreatureIds(kept);
        setActiveCombatCreatureId(prev => (prev && stale.has(prev) ? (kept[0] ?? null) : prev));
      }
    }

    if (result.sessionEnded) {
      const stillEngaged =
        (result.aliveEngagedIds?.length ?? 0) > 0 ||
        engagedCreatureIdsRef.current.length > 0;
      if (!stillEngaged) {
        stopCombat();
        return;
      }
      // Ignore session_ended — next tick will create a fresh session
    }

    // Engagement lifecycle: the server only tells us authoritatively about
    // creatures that changed HP this tick (creature_states is filtered).
    // "Missing from creature_states" therefore means "unchanged", NOT "gone".
    // Authoritative "no longer engaged" signals are killedCreatureIds and the
    // stale-engagement release above.
    const killedThisTick = new Set(result.killedCreatureIds);
    const remainingEngaged = engagedCreatureIdsRef.current.filter(id => !killedThisTick.has(id));

    if (remainingEngaged.length === 0) {
      if (killedThisTick.size === 0) {
        // Nothing engaged. If the server released stale engagements (off-screen
        // death) or reported the session ended, leave combat instead of
        // ticking against a corpse.
        if (
          inCombatRef.current &&
          ((result.staleEngagedIds && result.staleEngagedIds.length > 0) || result.sessionEnded)
        ) {
          stopCombat();
        }
        return;
      }
      // A creature died and nothing is left engaged — try to roll into another
      // aggressive creature on the node. Keeps inCombat true so we don't fire
      // the re-engage aggro flavor line.
      setTimeout(() => {
        const p = ext.current;
        const killed = recentlyKilledRef.current;
        const nextAggro = p.creatures.find(
          c => c.is_aggressive && c.is_alive && c.hp > 0 && !killed.has(c.id)
        );
        if (nextAggro && !p.isDead && p.character.hp > 0 && (!p.party || p.isLeader)) {
          aggroProcessedRef.current.add(nextAggro.id);
          const joinEvent = buildAggroEvent(
            'join',
            { id: nextAggro.id, name: nextAggro.name },
            { kind: 'player', id: p.character.id, name: p.character.name },
          );
          p.addLocalLogEvent(joinEvent);
          setEngagedCreatureIds(prev => {
            if (prev.includes(nextAggro.id)) return prev;
            const next = [...prev, nextAggro.id];
            engagedCreatureIdsRef.current = next;
            return next;
          });
          setActiveCombatCreatureId(nextAggro.id);
          return;
        }
        stopCombat();
      }, 250);
      return;
    }

    if (!inCombatRef.current) {
      inCombatRef.current = true;
      setInCombat(true);
    }
    // Only shift active target if the current one died this tick.
    setActiveCombatCreatureId(prev => (prev && killedThisTick.has(prev) ? remainingEngaged[0] : (prev ?? remainingEngaged[0])));
    if (remainingEngaged.length !== engagedCreatureIdsRef.current.length) {
      engagedCreatureIdsRef.current = remainingEngaged;
      setEngagedCreatureIds(remainingEngaged);
    }
  }, [stopCombat, recentlyKilledRef]);

  // ── Broadcast channel (party only) ─────────────────────────────

  useEffect(() => {
    const partyId = params.party?.id;
    if (!partyId) { channelRef.current = null; return; }

    const channel = supabase.channel(`party-combat-${partyId}`);
    channelRef.current = channel;

    channel
      .on('broadcast', { event: 'combat_tick_result' }, (payload) => {
        if (ext.current.isLeader) return;
        const data = payload.payload as CombatTickResponse;
        if (!data) return;
        const gap = lastTickRef.current ? Date.now() - lastTickRef.current : 0;
        traceBroadcastTick(gap, data.ticks_processed, data.encounter_batch_id ?? null);
        processTickResult(data);
      })
      .on('broadcast', { event: 'engage_request' }, (payload) => {
        if (!ext.current.isLeader) return;
        const { creature_id } = payload.payload as { creature_id: string; character_id: string };
        if (!creature_id) return;
        setEngagedCreatureIds(prev => {
          if (prev.includes(creature_id)) return prev;
          const next = [...prev, creature_id];
          engagedCreatureIdsRef.current = next;
          return next;
        });
        setActiveCombatCreatureId(creature_id);
        if (!inCombatRef.current) {
          inCombatRef.current = true;
          setInCombat(true);
          if (intervalRef.current) clearWorkerInterval(intervalRef.current);
          doTickRef.current();
          intervalRef.current = setWorkerInterval(() => doTickRef.current(), 2000);
        }
      })
      .on('broadcast', { event: 'member_buff_state' }, (payload) => {
        if (!ext.current.isLeader) return;
        const { character_id, buffs } = payload.payload as { character_id: string; buffs: MemberBuffState };
        if (character_id && buffs) memberBuffsRef.current[character_id] = buffs;
      })
      .on('broadcast', { event: 'member_pending_ability' }, (payload) => {
        if (!ext.current.isLeader) return;
        const { ability } = payload.payload as { ability: any };
        if (ability) memberAbilitiesRef.current.push(ability);
      })
      .subscribe();

    return () => {
      channelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [params.party?.id, processTickResult]);

  // Non-leader: broadcast buff state periodically
  useEffect(() => {
    if (!params.party || params.isLeader) return;
    const interval = setInterval(() => {
      if (!channelRef.current) return;
      if (!inCombatRef.current) return;
      if (ext.current.gatherBuffs) {
        const buffs = ext.current.gatherBuffs();
        if (Object.keys(buffs).length > 0) {
          channelRef.current.send({ type: 'broadcast', event: 'member_buff_state', payload: { character_id: ext.current.character.id, buffs } });
        }
      }
    }, 1800);
    // Phase 6 fallback heartbeat: if the leader's ticks stop landing, wake the
    // tick from here. doTick itself decides whether the gap is large enough.
    const wake = setInterval(() => {
      if (!inCombatRef.current) return;
      const since = lastTickRef.current ? Date.now() - lastTickRef.current : Infinity;
      if (since > FOLLOWER_WAKE_STALE_MS) doTickRef.current();
    }, 2000);
    return () => { clearInterval(interval); clearInterval(wake); };
  }, [params.party, params.isLeader]);

  // ── Driver (solo or party leader): tick function ───────────────

  const doTick = useCallback(async () => {
    if (tickBusyRef.current) {
      tickPendingRef.current = true;
      return;
    }
    tickBusyRef.current = true;
    try {
      const p = ext.current;

      // Process pending ability
      const pending = pendingAbilityRef.current;
      let pendingAbilitiesForServer: any[] = [];

      if (pending && Date.now() >= pending.readyAt) {
        pendingAbilityRef.current = null;
        setPendingAbility(null);

        const allAbilities = CLASS_ABILITIES[p.character.class] || [];
        const ability = allAbilities[pending.index];

        if (ability && SERVER_ABILITY_TYPES.has(ability.type)) {
          const targetId = pending.targetId || engagedCreatureIdsRef.current[0];
          const cpCost = ability.cpCost;

          // Remember the opener target so processTickResult engages only this
          // creature (not other aggressive bystanders on the node).
          if (!inCombatRef.current && targetId) {
            lastDispatchedOpenerTargetRef.current = targetId;
          }

          const expectedCpAfter = Math.max(0, (p.character.cp ?? 0) - cpCost);

          // Finisher stack counts are resolved server-side from
          // `active_effects` (Phase 5 authority): the client no longer reports
          // a stack count on the wire at all.


          // Canonical wire identity: the configured `ability_key` for this bar
          // slot. `ability_type` stays only as the mechanic dispatch hint.
          const abilityKey = getAbilityKeyForSlot(p.character.class, pending.index);

          // Durable intent: mirror the dispatch into `combat_actions` so the
          // action survives a dropped tick request. The same id travels on the
          // wire payload, letting the resolving tick retire exactly this row.
          const actionId =
            typeof crypto !== 'undefined' && 'randomUUID' in crypto
              ? crypto.randomUUID()
              : `${p.character.id}-${Date.now()}`;
          durableSeqRef.current += 1;
          const clientSeq = durableSeqRef.current;
          void supabase
            .rpc('submit_combat_action', {
              _id: actionId,
              _character_id: p.character.id,
              _ability_key: abilityKey,
              _target_creature_id: targetId ?? null,
              _target_character_id: null,
              _client_seq: clientSeq,
            })
            .then(({ error }) => {
              if (error) console.warn('[combat] durable action submit failed', error.message);
            });

          const abilityPayload = {
            character_id: p.character.id,
            action_id: actionId,
            ability_key: abilityKey,
            ability_type: ability.type,
            target_creature_id: targetId,
            cp_cost: cpCost,

            client_expected_cp_after: expectedCpAfter,
          };


          if (p.party && !p.isLeader) {
            channelRef.current?.send({
              type: 'broadcast',
              event: 'member_pending_ability',
              payload: { ability: abilityPayload },
            });
            // Follower: convert reservation into a real local CP debit so the
            // bar doesn't snap back up before the leader's broadcast confirms.
            optimisticCpRef.current = expectedCpAfter;
            ext.current.updateCharacterLocal?.({ cp: expectedCpAfter });
            setPendingCpCost(0);
          } else {
            pendingAbilitiesForServer.push(abilityPayload);
            // Solo / leader: commit the debit locally NOW. The reservation
            // shading goes away, but the filled CP amount stays at the same
            // visual position (raw - reserved == new raw, reserved 0). When
            // the tick response comes back, processTickResult will see the
            // server agrees and skip the CP repaint.
            optimisticCpRef.current = expectedCpAfter;
            ext.current.updateCharacterLocal?.({ cp: expectedCpAfter });
            setPendingCpCost(0);
          }
        } else {
          if (p.onAbilityExecute && !p.isDead && p.character.hp > 0) {
            await p.onAbilityExecute(pending.index, pending.targetId);
          }
          // Non-server abilities debit CP synchronously via onAbilityExecute,
          // so the reservation can be cleared immediately.
          setPendingCpCost(0);
        }
      }

      // Combat tick (drivers only)
      // Phase 6: the leader is no longer the only participant allowed to wake
      // a tick. If no tick result has landed for a while (leader suspended,
      // offline or its request dropped), any member wakes the tick itself. The
      // server accepts any eligible participant and serializes concurrent
      // wakeups on the session cursor, so at most one of them resolves.
      const solo = !p.party;
      const sinceLastTick = lastTickRef.current ? Date.now() - lastTickRef.current : Infinity;
      const followerWake =
        !solo && !p.isLeader && inCombatRef.current && sinceLastTick > FOLLOWER_WAKE_STALE_MS;
      const driver = solo || p.isLeader || followerWake;

      if (driver && !solo) {
        pendingAbilitiesForServer = [...pendingAbilitiesForServer, ...memberAbilitiesRef.current];
        memberAbilitiesRef.current = [];
      }

      if (driver && !p.isDead && p.character.hp > 0 && (engagedCreatureIdsRef.current.length > 0 || pendingAbilitiesForServer.length > 0)) {
        const memberBuffs: Record<string, MemberBuffState> = solo ? {} : { ...memberBuffsRef.current };
        if (ext.current.gatherBuffs) {
          memberBuffs[p.character.id] = ext.current.gatherBuffs();
        }

        const body = solo
          ? {
              character_id: p.character.id,
              node_id: p.character.current_node_id,
              member_buffs: memberBuffs,
              engaged_creature_ids: engagedCreatureIdsRef.current,
              pending_abilities: pendingAbilitiesForServer,
            }
          : {
              party_id: p.party!.id,
              node_id: p.character.current_node_id,
              member_buffs: memberBuffs,
              engaged_creature_ids: engagedCreatureIdsRef.current,
              pending_abilities: pendingAbilitiesForServer,
            };

        // Request-scoped stale response guard
        const seq = ++tickSeqRef.current;
        const tickT0 = Date.now();
        const tickGap = lastTickRef.current ? tickT0 - lastTickRef.current : 0;
        const cause = tickCauseRef.current;
        tickCauseRef.current = 'cadence';
        traceTickStart(seq, cause, tickGap, pendingAbilitiesForServer.length > 0);


        // Retry transient edge runtime errors (503 cold-start / boot failures)
        let data: any = null;
        let error: any = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          const res = await supabase.functions.invoke('combat-tick', { body });
          data = res.data;
          error = res.error;
          if (!error) break;
          const msg = String(error?.message ?? '');
          const ctx: any = (error as any)?.context;
          const status = ctx?.status ?? ctx?.response?.status;
          const isTransient =
            status === 503 || status === 502 || status === 504 ||
            /temporarily unavailable|non-2xx/i.test(msg);
          if (!isTransient) break;
          console.warn(`[combat] tick transient error (attempt ${attempt + 1}/3), retrying...`, { status, msg });
          await new Promise(r => setTimeout(r, 200 * (attempt + 1)));
        }

        const tickLatency = Date.now() - tickT0;
        const receivedAt = Date.now();
        const traceResponse = (outcome: 'applied' | 'stale' | 'reserved' | 'error' | 'empty') => {
          const res = data as CombatTickResponse | null;
          traceTickResponse(seq, {
            roundTripMs: tickLatency,
            ticksProcessed: res?.ticks_processed,
            encounterTick: res?.encounter_tick ?? null,
            batchId: res?.encounter_batch_id ?? null,
            serverResolveMs: res?.trace?.server_resolve_ms,
            outcome,
          });
        };

        if (seq !== tickSeqRef.current) {
          traceResponse('stale');
          console.log(`[combat] stale tick response ignored`, { seq, current: tickSeqRef.current, latency: tickLatency });
          // Still emit kill notifications from stale responses (e.g. last tick before node change)
          const staleResult = data as CombatTickResponse | null;
          if (staleResult?.events?.length) {
            const killEvents = staleResult.events.filter(ev =>
              ev.type === 'creature_death' || ev.type === 'xp_reward' || ev.type === 'gold_reward' ||
              ev.type === 'salvage_reward' || ev.type === 'renown_award' || ev.type === 'loot_drop'
            );
            if (killEvents.length > 0) {
              console.log(`[combat] processing ${killEvents.length} kill-related events from stale tick`);
              for (const ev of killEvents) {
                ext.current.addLocalLogEvent(createLogEvent({ type: mapServerEventType(ev.type), message: ev.message }));
              }
              // Apply character state updates (XP, gold, etc.) from the kill
              const myState = staleResult.member_states?.find(m => m.character_id === ext.current.character.id);
              if (myState && ext.current.updateCharacterLocal) {
                const updates: Record<string, number> = {};
                if (myState.xp !== undefined) updates.xp = myState.xp;
                if (myState.gold !== undefined) updates.gold = myState.gold;
                // Salvage / gem drops live in character_materials.
                notifyMaterialsChanged(ext.current.character.id);
                if (myState.bhp !== undefined) updates.bhp = myState.bhp;
                if (myState.rp_total_earned !== undefined) updates.rp_total_earned = myState.rp_total_earned;
                if (myState.level !== undefined) updates.level = myState.level;
                if (Object.keys(updates).length > 0) ext.current.updateCharacterLocal(updates);
              }
              // Trigger ground loot refresh if there was a loot drop
              if (staleResult.events.some(ev => ev.type === 'loot_drop')) {
                ext.current.fetchGroundLoot();
              }
            }
          }
        } else if (error) {
          traceResponse('error');
          console.error('Combat tick error:', error);
          // Don't strand the reservation overlay if the tick failed.
          setPendingCpCost(0);
        } else {
          const result = data as CombatTickResponse;
          if (!result) {
            traceResponse('empty');
            stopCombat();
          } else if ((result as any).tick_reserved_elsewhere) {
            // Another participant reserved this tick — it resolved nothing.
            // The winner's result arrives via broadcast / realtime.
            traceResponse('reserved');
            setPendingCpCost(0);
          } else if ((result as any).roster_unavailable) {
            // The resolver refused to simulate because the engagement roster
            // could not be loaded. Nothing authoritative changed — hold state
            // and let the next tick pick the elapsed time up.
            traceResponse('reserved');
            setPendingCpCost(0);
          } else {
            traceResponse('applied');
            if (!solo && p.isLeader) {
              channelRef.current?.send({ type: 'broadcast', event: 'combat_tick_result', payload: result });
            }
            // Reservation was already converted to a real local CP debit
            // at dispatch time, so we just process the tick result. CP
            // reconciliation in processTickResult will skip the CP repaint
            // when the server agrees with our optimistic value.
            processTickResult(result, { seq, receivedAt });
          }
        }
      } else if (driver && (p.isDead || p.character.hp <= 0) && inCombatRef.current) {
        stopCombat();
      }

      // Idle detection
      if (!inCombatRef.current && !pendingAbilityRef.current) {
        idleCountRef.current++;
        if (idleCountRef.current >= 2 && intervalRef.current) {
          clearWorkerInterval(intervalRef.current);
          intervalRef.current = null;
        }
      } else {
        idleCountRef.current = 0;
      }
    } finally {
      tickBusyRef.current = false;
      if (tickPendingRef.current) {
        tickPendingRef.current = false;
        setTimeout(() => doTickRef.current(), 0);
      }
    }
  }, [processTickResult, stopCombat]);

  useEffect(() => { doTickRef.current = doTick; }, [doTick]);

  // ── Lifecycle effects ──────────────────────────────────────────

  const { fleeStopCombat } = useCombatLifecycle({
    currentNodeId: params.character.current_node_id,
    isDead: params.isDead,
    inCombat,
    isLeader: params.isLeader,
    party: params.party,
    stopCombat,
    intervalRef,
    lastTickRef,
    inCombatRef,
    tickBusyRef,
    tickPendingRef,
    creatureHpOverridesRef,
    setCreatureHpOverrides,
    channelRef,
    aggroProcessedRef,
    recentlyKilledRef,
    pendingAggroRef,
    setPoisonBuff: params.setPoisonBuff,
    setIgniteBuff: params.setIgniteBuff,
    clearReservedBuffsLocal: params.clearReservedBuffsLocal,

  });

  return {
    inCombat,
    activeCombatCreatureId,
    engagedCreatureIds,
    creatureHpOverrides,
    lastTickTime,
    updateCreatureHp,
    startCombat: startCombatCore,
    stopCombat,
    fleeStopCombat,
    pendingAbility,
    pendingCpCost,
    queueAbility,
  };
}
