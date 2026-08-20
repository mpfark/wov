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
import { toast } from 'sonner';

import {
  maintenanceMessage,
  COMBAT_MAINTENANCE_MESSAGE,
} from '@/shared/combat/maintenance';
import { interpretTickAck, isTerminalTransportStatus } from '../utils/tick-ack';


import { Character } from '@/features/character';
import { Creature } from '@/features/creatures';
import { supabase } from '@/integrations/supabase/client';
import { notifyMaterialsChanged } from '@/features/inventory/hooks/useMaterials';
import { setWorkerTimeout, clearWorkerTimeout } from '@/lib/worker-timer';
import { nextTickDelayMs, readServerCadence, measuredNetworkMs, type ServerCadence } from '../utils/tick-pacer';
import { buildTickRequestBody } from '@/shared/combat/tick-request';

import { getAbilityKeyForSlot } from '@/features/combat/utils/ability-calcs';
import { CLASS_ABILITIES } from '@/features/combat';
import { interpretCombatTickResult } from '../utils/interpretCombatTickResult';
import type { CombatTickResponse } from '../utils/interpretCombatTickResult';

import { useCombatAggroEffects } from './useCombatAggroEffects';
import { useEncounterBatches } from './useEncounterBatches';
import {
  PendingActionTracker,
  describeRejection,
  type ActionOutcome,
} from '../utils/pending-actions';
import { dispatchDurableAction } from '../utils/dispatch-durable-action';
import type { ResyncSnapshot } from '../utils/resync';
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

/**
 * Hard floor between two `combat-tick` requests from one driver.
 *
 * The server can never produce two simulation ticks closer than the rate, so a
 * request inside this window is by construction either a refusal or a duplicate
 * claim attempt. It exists to stop event-driven call sites (ability press,
 * engage broadcast, visibility change) from stacking on top of the paced wake.
 */
const MIN_REQUEST_SPACING_MS = 400;




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
  /** Committed telegraph transitions (boss casts / Stored Power) for this tick. */
  onBossCasts?: (result: CombatTickResponse) => void;
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
  // C0: latched once the server reports combat is closed for maintenance.
  const [combatMaintenance, setCombatMaintenance] = useState(false);
  const maintenanceRef = useRef(false);
  const maintenanceNoticedRef = useRef(false);


  
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
   * C4 durable acknowledgement: submitted → pending → consumed/rejected by a
   * committed tick. Only committed batches retire an entry, so a lost HTTP
   * response can never lose an action, and duplicate delivery can never
   * acknowledge one twice.
   */
  const actionsRef = useRef(new PendingActionTracker());
  const [pendingActionCount, setPendingActionCount] = useState(0);
  const [lastActionRejection, setLastActionRejection] = useState<
    { actionId: string; label: string; reason: string; tick: number } | null
  >(null);
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
  /**
   * C4: the shared encounter whose `encounter_tick_batches` stream we follow.
   * Learned from the tick response. The committed batch stream is the ONLY
   * delivery path that may render; the HTTP response and the party broadcast
   * are acknowledgements that merely bound recovery.
   */
  const [encounterId, setEncounterId] = useState<string | null>(null);
  const encounterIdRef = useRef<string | null>(null);
  /** Set once useEncounterBatches is mounted (below); no-op before that. */
  const noteCommittedRef = useRef<(tick: number | null | undefined, batchId: string | null | undefined) => void>(() => {});

  // Dev-only: combat start timing
  const combatStartTimeRef = useRef<number | null>(null);
  /** Highest committed tick this client has applied (action submission anchor). */
  const lastAppliedTickRef = useRef(0);

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
  const doTickRef = useRef<() => void>(() => {});
  // Tracks the target of the most recent dispatched opener ability so we can
  // engage only that creature (not other aggressive bystanders the server
  // happens to report state for) when transitioning idle → in-combat.
  const lastDispatchedOpenerTargetRef = useRef<string | null>(null);
  /**
   * A durably submitted out-of-combat opener. It outlives `pendingAbilityRef`
   * (which is consumed the moment `doTick` dispatches) so the pacer keeps
   * running while the client is still technically out of combat and the action
   * waits for its first eligible committed boundary. Non-terminal `not_due` /
   * `in_flight` refusals therefore no longer strand the opener — the same
   * durable action id is retained, never resubmitted.
   */
  const openerPendingRef = useRef<{ actionId: string; targetId: string; slotIndex: number } | null>(null);
  /**
   * Target of an opener whose action a committed batch just consumed. Combat is
   * adopted from this authoritative outcome, not from whether the attack
   * happened to change the target's HP.
   */
  const adoptOpenerTargetRef = useRef<string | null>(null);
  /**
   * Ability-bar slot that is visibly pending, plus how far along it is. Feedback
   * only: it never submits, ticks, or changes CP. Pre-dispatch queue state and
   * durable pending state are one continuous visual state.
   */
  const [pendingAbilityIndex, setPendingAbilityIndex] = useState<number | null>(null);
  const [pendingAbilityStage, setPendingAbilityStage] = useState<'preparing' | 'submitted' | null>(null);

  /**
   * The last cadence report the server gave us (boundary + its own clock) and
   * when it arrived on this client. This is the ONLY input to pacing: the
   * client no longer owns a period of its own.
   */
  const cadenceRef = useRef<{ cadence: ServerCadence | null; receivedAt: number }>({
    cadence: null,
    receivedAt: 0,
  });
  /**
   * Client clock of the last *acknowledgement* of any kind (committed, refused,
   * maintenance). Distinct from `lastTickRef`, which only marks a rendered
   * legacy payload and is therefore never stamped in C4 solo combat.
   */
  const ackAtRef = useRef<number>(0);
  /** Client clock when the last request was submitted. */
  const lastRequestAtRef = useRef<number>(0);


  // ── Helpers ────────────────────────────────────────────────────

  const updateCreatureHp = useCallback((creatureId: string, hp: number) => {
    setCreatureHpOverrides(prev => {
      const next = { ...prev, [creatureId]: hp };
      creatureHpOverridesRef.current = next;
      return next;
    });
  }, []);

  /**
   * Recompute the pending pulse from its two sources: the local pre-dispatch
   * queue and the durable tracker. Called after every lifecycle transition, so
   * there is exactly one place that decides whether a button pulses.
   */
  const syncPendingVisual = useCallback(() => {
    const queued = pendingAbilityRef.current;
    if (queued) {
      setPendingAbilityIndex(queued.index);
      setPendingAbilityStage('preparing');
      return;
    }
    const durable = actionsRef.current.newestPending();
    if (durable && durable.slotIndex !== undefined) {
      setPendingAbilityIndex(durable.slotIndex);
      setPendingAbilityStage('submitted');
      return;
    }
    setPendingAbilityIndex(null);
    setPendingAbilityStage(null);
  }, []);
  const syncPendingVisualRef = useRef(syncPendingVisual);
  useEffect(() => { syncPendingVisualRef.current = syncPendingVisual; }, [syncPendingVisual]);

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
    appliedBatchIdsRef.current = new Set();
    actionsRef.current.reset();
    setPendingActionCount(0);
    setLastActionRejection(null);
    lastAppliedTickRef.current = 0;
    // B5: leaving combat ends our interest in this encounter's batch stream.
    encounterIdRef.current = null;
    setEncounterId(null);
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
    openerPendingRef.current = null;
    adoptOpenerTargetRef.current = null;
    setPendingAbilityIndex(null);
    setPendingAbilityStage(null);
    setPendingCpCost(0);
    optimisticCpRef.current = null;
    cadenceRef.current = { cadence: null, receivedAt: 0 };
    if (intervalRef.current) {
      clearWorkerTimeout(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  /**
   * The single pacing authority.
   *
   * Exactly one pending timer exists at any moment, and it always aims at the
   * server's authoritative next-due boundary (falling back to the nominal rate
   * only before the first answer). Four call sites used to arm competing 2s
   * worker intervals; that self-owned period aliased against the identical
   * server period and inflated a 2s cadence to a 2.906s committed cadence with
   * a third of all requests refused `not_due`.
   */
  const scheduleNextTick = useCallback((immediate = false) => {
    if (intervalRef.current) {
      clearWorkerTimeout(intervalRef.current);
      intervalRef.current = null;
    }
    if (maintenanceRef.current) return;
    // A durably submitted opener is work the pacer must keep alive even though
    // the client is not in combat yet and the local queue entry is gone.
    if (!inCombatRef.current && !pendingAbilityRef.current && !openerPendingRef.current) return;
    const { cadence, receivedAt } = cadenceRef.current;
    const delay = immediate
      ? 0
      : nextTickDelayMs({ cadence, receivedAtMs: receivedAt, nowMs: Date.now() });
    intervalRef.current = setWorkerTimeout(() => {
      intervalRef.current = null;
      doTickRef.current();
    }, delay);
  }, []);

  /** Stable handle so callbacks defined later can re-arm the pacer. */
  const scheduleNextTickRef = useRef<(immediate?: boolean) => void>(() => {});
  useEffect(() => { scheduleNextTickRef.current = scheduleNextTick; }, [scheduleNextTick]);

  /**
   * The one way any non-timer event asks for a tick.
   *
   * Combat start, ability presses, engage broadcasts, follower wakes and tab
   * visibility all used to call `doTick` directly. Each of those bypassed the
   * pacer entirely, so an event arriving just after a request produced a
   * back-to-back HTTP call (measured request gaps down to 0.652s against a 2s
   * cadence). They now share one entry point with a hard minimum spacing, and a
   * request that arrives while one is in flight is coalesced by `doTick`.
   */
  const requestTickNow = useCallback((cause: TickCause) => {
    if (maintenanceRef.current) return;
    const now = Date.now();
    tickCauseRef.current = cause;
    if (now - lastRequestAtRef.current < MIN_REQUEST_SPACING_MS) {
      // Too soon to be a distinct simulation tick: let the pacer place it.
      scheduleNextTickRef.current();
      return;
    }
    if (intervalRef.current) {
      clearWorkerTimeout(intervalRef.current);
      intervalRef.current = null;
    }
    doTickRef.current();
  }, []);
  const requestTickNowRef = useRef(requestTickNow);
  useEffect(() => { requestTickNowRef.current = requestTickNow; }, [requestTickNow]);

  /** Adopt the server's cadence report from an acknowledgement. */
  const noteCadence = useCallback(
    (
      ack: {
        nextDueAtMs?: number | null;
        serverNowMs?: number | null;
        serverProcessMs?: number | null;
      } | null,
      receivedAt: number,
      rttMs?: number,
    ) => {

      // Every acknowledgement is pacing-relevant, committed ones included: the
      // follow-up gate used to read a timestamp that only legacy renderable
      // payloads ever stamped, so under C4 it was permanently `Infinity` and
      // fired zero-delay follow-ups forever.
      ackAtRef.current = receivedAt;
      const cadence = readServerCadence(ack, rttMs);
      if (cadence) cadenceRef.current = { cadence, receivedAt };
    },
    [],
  );


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
          try { requestTickNowRef.current('visibility'); } catch { /* noop */ }
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
    setPendingAbilityIndex(index);
    setPendingAbilityStage('preparing');
    setPendingCpCost(cpCost);
    idleCountRef.current = 0;
    traceAbilityPress(label);
    // Dispatch through the single request authority; doTick re-arms the pacer
    // against the server boundary when it finishes, so this never adds a second
    // competing beat.
    requestTickNowRef.current('ability');

  }, []);

  // ── Aggro effects ──────────────────────────────────────────────

  const startCombatCore = useCallback((creatureId: string) => {
    const p = ext.current;
    if (p.isDead || p.character.hp <= 0) return;
    // C0: combat is closed for maintenance — refuse to engage at all once the
    // server has told us so. No engagement row, no broadcast, no timer.
    if (maintenanceRef.current) {
      toast.info(COMBAT_MAINTENANCE_MESSAGE);
      return;
    }


    // Durable engagement roster: every character records its own
    // character↔creature engagement, independent of party role. The shared
    // encounter resolver reads this roster instead of client-sent ids.
    void supabase
      .rpc('join_encounter_engagement', {
        _character_id: p.character.id,
        _creature_id: creatureId,
      })
      .then(({ error }) => {
        if (!error) return;
        // A refused engagement must never leave an optimistic local combat
        // state (or a running worker) behind: the affordance has to come back.
        console.warn('[combat] engagement join failed', error.message);
        toast.error('You cannot engage right now.');
        stopCombat();
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


      requestTickNowRef.current('cadence');

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
   * `meta.source` says which transport delivered this result:
   *   - `'batch'`  — a committed `encounter_tick_batches` row. Only these render.
   *   - anything else — an acknowledgement (own HTTP response, party broadcast).
   *     It contributes the encounter identity and the committed tick number, and
   *     is then discarded, so no client can ever display state that is not in a
   *     committed batch.
   */
  /**
   * Present committed action outcomes. Concise and reusing existing patterns:
   * a rejection is one combat-log system line plus the existing toast channel;
   * consumed and superseded actions only clear pending state (the tick's own
   * events already narrate what happened).
   */
  const applyActionOutcomes = useCallback((outcomes: ActionOutcome[]) => {
    for (const o of outcomes) {
      if (o.kind === 'rejected') {
        const reason = describeRejection(o.reason ?? 'rejected');
        setLastActionRejection({ actionId: o.actionId, label: o.label, reason, tick: o.tick });
        ext.current.addLocalLogEvent(
          createLogEvent({ type: 'system', message: `${o.label} failed — ${reason}.` }),
        );
      }
      // 'consumed': the batch's own events narrate the hit.
      // 'superseded': a newer action replaced it and the server never executed
      // it — silent, but distinct from an executed action in the ledger.
    }
    // Authoritative opener resolution: only a committed outcome may clear the
    // durable opener. A consumed opener hands its target to combat adoption
    // (hit, miss or zero damage alike); a rejection starts no combat at all.
    const opener = openerPendingRef.current;
    if (opener) {
      const mine = outcomes.find(o => o.actionId === opener.actionId);
      if (mine) {
        openerPendingRef.current = null;
        if (mine.kind === 'consumed') adoptOpenerTargetRef.current = opener.targetId;
      }
    }
    if (outcomes.length > 0) {
      setPendingActionCount(actionsRef.current.pendingCount);
      syncPendingVisualRef.current();
    }
  }, []);

  const processTickResult = useCallback((
    data: CombatTickResponse,
    meta?: { seq?: number; receivedAt?: number; source?: 'batch' | 'ack' },
  ) => {
    // Adopt the encounter this result belongs to so the shared batch stream can
    // be subscribed to (and recovered) for it.
    const incomingEncounterId = data.encounter_id ?? null;
    if (incomingEncounterId && incomingEncounterId !== encounterIdRef.current) {
      encounterIdRef.current = incomingEncounterId;
      setEncounterId(incomingEncounterId);
    }
    const batchId = data.encounter_batch_id;

    // Acknowledgement path: bound recovery, render nothing.
    if (meta?.source !== 'batch' && (batchId || typeof data.encounter_tick === 'number')) {
      noteCommittedRef.current(data.encounter_tick ?? null, batchId ?? null);
      if (meta?.seq !== undefined && meta.receivedAt !== undefined) {
        traceTickResponse(meta.seq, { roundTripMs: 0, outcome: 'reserved', batchId: batchId ?? null });
      }
      return;
    }

    // Duplicate-batch guard: a batch can still reach us twice (realtime plus a
    // recovery replay). Applying it twice duplicates log lines and HP writes.
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

    // ── C4: durable action acknowledgement ──────────────────────────────
    // Reconciled in the SAME committed-batch application as the combat state, so
    // an executed ability and the state it produced can never disagree.
    if (typeof data.encounter_tick === 'number') {
      lastAppliedTickRef.current = Math.max(lastAppliedTickRef.current, data.encounter_tick);
    }
    if (batchId && (data.consumed_action_ids?.length || data.rejected_actions?.length)) {
      const outcomes = actionsRef.current.applyCommitted({
        batchId,
        tick: data.encounter_tick ?? lastAppliedTickRef.current,
        consumedActionIds: data.consumed_action_ids ?? [],
        rejectedActions: data.rejected_actions ?? [],
      });
      applyActionOutcomes(outcomes);
    }

    // ── C5: telegraph delivery ──────────────────────────────────────────
    // Boss-cast starts, resolves and fizzles ride the committed batch, so the
    // telegraph opens and clears with the damage it belongs to.
    if (data.boss_casts?.length || data.boss_stored_power?.length) {
      ext.current.onBossCasts?.(data);
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
          scheduleNextTickRef.current();
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

  /**
   * C4: authoritative resynchronisation after an unrecoverable batch gap.
   *
   * Replaces local combat state from the snapshot (character resources/rewards,
   * creature HP, engagement, combat-stop state), closes any pending action whose
   * acknowledging batch is gone, and tells the player exactly once that some log
   * history is unavailable. No combat events are invented or replayed — the
   * missing narration is simply marked as unavailable.
   */
  const applyResync = useCallback((snapshot: ResyncSnapshot, range: { fromTick: number; toTick: number }) => {
    const p = ext.current;

    if (snapshot.character && p.updateCharacterLocal) {
      const c = snapshot.character;
      p.updateCharacterLocal({
        hp: c.hp, max_hp: c.max_hp, cp: c.cp, max_cp: c.max_cp, mp: c.mp, max_mp: c.max_mp,
        xp: c.xp, gold: c.gold, level: c.level,
        ...(c.bhp !== undefined ? { bhp: c.bhp } : {}),
        ...(c.rp_total_earned !== undefined ? { rp_total_earned: c.rp_total_earned } : {}),
        ...(c.unspent_stat_points !== undefined ? { unspent_stat_points: c.unspent_stat_points } : {}),
        ...(c.respec_points !== undefined ? { respec_points: c.respec_points } : {}),
      } as Partial<Character>);
      optimisticCpRef.current = null;
    }
    // Materials/loot awarded by pruned batches are re-read from the server
    // rather than reconstructed from deltas.
    notifyMaterialsChanged(p.character.id);
    p.fetchGroundLoot();

    // Creature HP is replaced wholesale — never merged with stale overrides.
    const overrides: Record<string, number> = {};
    for (const cr of snapshot.creatures) overrides[cr.id] = cr.hp;
    creatureHpOverridesRef.current = overrides;
    setCreatureHpOverrides(overrides);

    // Engagement / combat-stop state comes from the snapshot's engagement rows.
    const aliveEngaged = snapshot.engagedCreatureIds.filter(id =>
      snapshot.creatures.some(cr => cr.id === id && cr.alive),
    );
    engagedCreatureIdsRef.current = aliveEngaged;
    setEngagedCreatureIds(aliveEngaged);

    // Pending actions whose acknowledging batches were pruned are closed as
    // superseded (never reported as executed).
    applyActionOutcomes(actionsRef.current.reanchor(snapshot.tick));

    p.addLocalLogEvent(createLogEvent({
      type: 'system',
      message: `Combat history for ticks ${range.fromTick}-${range.toTick} is no longer available; state resynchronised from the server.`,
    }));

    if (snapshot.ended || aliveEngaged.length === 0 || (snapshot.character?.hp ?? 0) <= 0) {
      stopCombat();
    } else if (!inCombatRef.current) {
      inCombatRef.current = true;
      setInCombat(true);
      setActiveCombatCreatureId(aliveEngaged[0]);
    }
  }, [applyActionOutcomes, stopCombat]);

  // ── C4: committed batch stream (the only delivery path that renders) ──
  // Every participant applies the same committed batches in tick order, exactly
  // once. Holes are fetched from `encounter_tick_batches` by the recovery
  // machine inside the hook.
  const { noteCommitted } = useEncounterBatches({
    encounterId,
    characterId: params.character.id,
    baselines: () => ({
      [ext.current.character.id]: {
        xp: ext.current.character.xp,
        gold: ext.current.character.gold,
        level: ext.current.character.level,
        maxHp: ext.current.character.max_hp,
        renown: ext.current.character.bhp ?? 0,
        renownTotalEarned: ext.current.character.rp_total_earned ?? 0,
      },
    }),
    onBatch: (result, meta) => {
      traceBroadcastTick(
        lastTickRef.current ? Date.now() - lastTickRef.current : 0,
        result.ticks_processed,
        result.encounter_batch_id ?? null,
      );
      console.log('[combat] applying committed batch', { tick: meta.tickNumber, source: meta.source });
      processTickResult(result, { source: 'batch' });
    },
    onResync: (snapshot, range) => applyResync(snapshot, range),
  });
  useEffect(() => { noteCommittedRef.current = noteCommitted; }, [noteCommitted]);


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
          requestTickNowRef.current('broadcast');
        }

      })
      .on('broadcast', { event: 'member_buff_state' }, (payload) => {
        if (!ext.current.isLeader) return;
        const { character_id, buffs } = payload.payload as { character_id: string; buffs: MemberBuffState };
        if (character_id && buffs) memberBuffsRef.current[character_id] = buffs;
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
    // tick from here. This is a follower-only watchdog, never a second beat for
    // the driver, and it measures staleness from the last acknowledgement (or
    // rendered tick) rather than from a timestamp only legacy payloads stamp.
    const wake = setInterval(() => {
      if (!inCombatRef.current) return;
      const last = Math.max(lastTickRef.current, ackAtRef.current);
      const since = last ? Date.now() - last : Infinity;
      if (since > FOLLOWER_WAKE_STALE_MS) requestTickNowRef.current('wakeup');
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
      /** Local cast markers — wake signal only; intent lives in `combat_actions`. */
      let localCastCount = 0;
      /**
       * Out-of-combat opener: a durably accepted action with no encounter yet
       * must be able to wake the very first tick from ANY eligible participant,
       * including a party follower. The server still serializes wakes.
       */
      let openerWake = false;

      if (pending && Date.now() >= pending.readyAt) {
        pendingAbilityRef.current = null;
        setPendingAbility(null);

        const allAbilities = CLASS_ABILITIES[p.character.class] || [];
        const ability = allAbilities[pending.index];

        if (ability && SERVER_ABILITY_TYPES.has(ability.type)) {
          const targetId = pending.targetId || engagedCreatureIdsRef.current[0];
          const cpCost = ability.cpCost;
          const isOpener = !inCombatRef.current && !!targetId;


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
          // Durable intent must be visible BEFORE any tick can snapshot it: an
          // out-of-combat opener has no engagement yet, so a fire-and-forget
          // submission raced the tick and the action was never resolved. The
          // helper registers the pending entry, awaits the RPC and retries with
          // the SAME action id (idempotent by id) — no sleeps, no new ids.
          const dispatch = await dispatchDurableAction(
            {
              actionId,
              characterId: p.character.id,
              abilityKey,
              targetCreatureId: targetId ?? null,
              clientSeq,
              label: pending.label,
              isOpener,
              submittedAtTick: lastAppliedTickRef.current,
            },
            {
              tracker: actionsRef.current,
              submit: async (a) => {
                const { error } = await supabase.rpc('submit_combat_action', {
                  _id: a.actionId,
                  _character_id: a.characterId,
                  _ability_key: a.abilityKey,
                  _target_creature_id: a.targetCreatureId,
                  _target_character_id: null,
                  _client_seq: a.clientSeq,
                });
                return { error: error ? { message: error.message } : null };
              },
            },
          );
          setPendingActionCount(actionsRef.current.pendingCount);

          if (!dispatch.ok) {
            // Never durably accepted: not a committed `rejected` outcome, so the
            // tracker entry is gone, the reservation is refunded, no opener
            // target is retained and no tick is woken.
            console.warn('[combat] durable action submit failed', dispatch.error);
            setPendingCpCost(0);
            lastDispatchedOpenerTargetRef.current = null;
            p.addLocalLogEvent(
              buildPositioningEvent(
                'fizzle',
                `Your ${pending.label} fizzles before it can take hold.`,
                { kind: 'player', id: p.character.id, name: p.character.name },
              ),
            );
            toast.error(`${pending.label} could not be cast.`);
          } else {

            // Remember the opener target so processTickResult engages only this
            // creature (not other aggressive bystanders on the node).
            if (isOpener) {
              lastDispatchedOpenerTargetRef.current = targetId!;
              openerWake = true;
            }

            if (p.party && !p.isLeader) {
              // Stage C: the durable `combat_actions` row above is the only
              // intent the resolver reads — nothing is relayed to the leader.
              // Follower: convert reservation into a real local CP debit so the
              // bar doesn't snap back up before the leader's broadcast confirms.
              optimisticCpRef.current = expectedCpAfter;
              ext.current.updateCharacterLocal?.({ cp: expectedCpAfter });
              setPendingCpCost(0);
              if (openerWake) localCastCount += 1;
            } else {
              localCastCount += 1;
              // Solo / leader: commit the debit locally NOW. The reservation
              // shading goes away, but the filled CP amount stays at the same
              // visual position (raw - reserved == new raw, reserved 0). When
              // the tick response comes back, processTickResult will see the
              // server agrees and skip the CP repaint.
              optimisticCpRef.current = expectedCpAfter;
              ext.current.updateCharacterLocal?.({ cp: expectedCpAfter });
              setPendingCpCost(0);
            }
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
      // A follower opening combat outside of any encounter wakes the first tick
      // itself; ordinary in-combat follower abilities keep waiting for the
      // leader's shared cadence.
      const driver = solo || p.isLeader || followerWake || openerWake;


      if (driver && !p.isDead && p.character.hp > 0 && (engagedCreatureIdsRef.current.length > 0 || localCastCount > 0)) {
        const memberBuffs: Record<string, MemberBuffState> = solo ? {} : { ...memberBuffsRef.current };
        if (ext.current.gatherBuffs) {
          memberBuffs[p.character.id] = ext.current.gatherBuffs();
        }

        // Stage C: `combat_actions` is the sole intent source; the request
        // carries no abilities. Locally collected casts still drive the wake
        // condition above (they were already submitted durably).
        // One builder for both branches: the party branch used to omit
        // `character_id`, which `combat-tick` rejects with 400 invalid_request
        // (it is the ownership subject), so no party tick could ever resolve.
        const body = buildTickRequestBody({
          characterId: p.character.id,
          partyId: solo ? null : p.party!.id,
          nodeId: p.character.current_node_id,
          memberBuffs,
          engagedCreatureIds: engagedCreatureIdsRef.current,
        });


        // Request-scoped stale response guard
        const seq = ++tickSeqRef.current;
        const tickT0 = Date.now();
        lastRequestAtRef.current = tickT0;
        const tickGap = lastTickRef.current ? tickT0 - lastTickRef.current : 0;
        const cause = tickCauseRef.current;
        tickCauseRef.current = 'cadence';
        traceTickStart(seq, cause, tickGap, localCastCount > 0);



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
        // Every answer, whatever its classification, is an acknowledgement for
        // pacing purposes.
        ackAtRef.current = receivedAt;

        const traceResponse = (
          outcome: 'applied' | 'stale' | 'reserved' | 'error' | 'empty',
          extra?: {
            refusalReason?: string;
            terminal?: boolean;
            nextDueAtMs?: number | null;
            serverNowMs?: number | null;
            serverProcessMs?: number | null;
          },
        ) => {
          const res = data as CombatTickResponse | null;
          // Pacing arithmetic recorded alongside the answer that produced it, so
          // a validation run can be classified (legit boundary wait vs refusal
          // loop vs network) without re-deriving anything from a request log.
          const cadence = readServerCadence(extra ?? null, tickLatency);
          const networkMs = cadence ? measuredNetworkMs(cadence) : undefined;
          const remainingMs =
            cadence && cadence.nowMs !== null ? cadence.nextDueAtMs - cadence.nowMs : undefined;
          const plannedDelayMs = cadence
            ? nextTickDelayMs({ cadence, receivedAtMs: receivedAt, nowMs: receivedAt })
            : undefined;
          traceTickResponse(seq, {
            roundTripMs: tickLatency,
            ticksProcessed: res?.ticks_processed,
            encounterTick: res?.encounter_tick ?? null,
            batchId: res?.encounter_batch_id ?? null,
            serverResolveMs: res?.trace?.server_resolve_ms,
            outcome,
            refusalReason: extra?.refusalReason,
            terminal: extra?.terminal,
            serverNowMs: extra?.serverNowMs ?? null,
            nextDueAtMs: extra?.nextDueAtMs ?? null,
            serverProcessMs: extra?.serverProcessMs ?? null,
            networkMs,
            remainingMs,
            plannedDelayMs,
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
          // A 400/401/403 repeats forever: stop rather than tick on cadence.
          const ectx: any = (error as any)?.context;
          const estatus = ectx?.status ?? ectx?.response?.status;
          if (isTerminalTransportStatus(estatus)) {
            toast.error('Combat is not available for this character right now.');
            stopCombat();
          }
        } else {
          const ack = interpretTickAck(data);
          const result = data as CombatTickResponse;
          if (!result) {
            traceResponse('empty');
            stopCombat();
          } else if (ack.kind === 'maintenance') {
            // C0: the resolver refused to simulate — combat is closed. Nothing
            // authoritative changed. Latch it, stop the timer and tell the
            // player once.
            traceResponse('reserved');
            maintenanceRef.current = true;
            setCombatMaintenance(true);
            setPendingCpCost(0);
            if (!maintenanceNoticedRef.current) {
              maintenanceNoticedRef.current = true;
              const msg = ack.message ?? maintenanceMessage(result);
              toast.info(msg);
              ext.current.addLocalLogEvent(
                createLogEvent({ type: 'system', message: msg })
              );
            }
            stopCombat();
          } else if (ack.kind === 'committed') {
            // C3/C4 acknowledgement: identity only. Adopt the encounter so the
            // committed-batch stream is subscribed (and recoverable) for it,
            // and tell the sequencer which tick must exist. Nothing renders.
            traceResponse('reserved', {
              refusalReason: 'committed',
              nextDueAtMs: ack.nextDueAtMs,
              serverNowMs: ack.serverNowMs,
              serverProcessMs: ack.serverProcessMs,
            });
            setPendingCpCost(0);
            if (ack.encounterId && ack.encounterId !== encounterIdRef.current) {
              encounterIdRef.current = ack.encounterId;
              setEncounterId(ack.encounterId);
            }
            noteCadence(ack, receivedAt, tickLatency);

            noteCommittedRef.current(ack.tick, ack.batchId);
          } else if (ack.kind === 'refused') {
            traceResponse('reserved', {
              refusalReason: `${ack.failureKind}:${ack.reason}`,
              terminal: ack.terminal,
              nextDueAtMs: ack.nextDueAtMs,
              serverNowMs: ack.serverNowMs,
              serverProcessMs: ack.serverProcessMs,
            });

            setPendingCpCost(0);
            if (ack.terminal) {
              // The encounter can never resolve another live tick for us (the
              // roster is empty / access is gone). Leaving combat here is what
              // stops the worker and prevents intake from minting idle
              // encounters on every later cadence tick.
              console.log('[combat] terminal tick refusal — leaving combat', ack);
              stopCombat();
            } else {
              // Cadence refusal: the server told us exactly when the next tick
              // becomes due. Adopting it is enough — the pacer re-arms against
              // that boundary in the finally block below.
              noteCadence(ack, receivedAt, tickLatency);
            }
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

      // Idle detection: the pacer simply stops re-arming once there is nothing
      // left to drive (see scheduleNextTick's guard).
      if (!inCombatRef.current && !pendingAbilityRef.current) {
        idleCountRef.current++;
      } else {
        idleCountRef.current = 0;
      }
    } finally {
      tickBusyRef.current = false;
      // Coalesce overlapping wake-ups.
      //
      // A wake that arrived while a request was in flight may only produce an
      // immediate follow-up when it carries work the server can act on right
      // now — a queued ability. The previous gate also allowed "enough time has
      // elapsed", measured from `lastTickRef`, which under C4 is never stamped
      // in solo combat: `sinceApplied` was permanently `Infinity`, so every
      // coalesced wake fired at zero delay. That is the measured 0.652s request
      // gap. Elapsed-time follow-ups are now the pacer's job, and the pacer
      // aims at the server's boundary.
      let immediate = false;
      if (tickPendingRef.current) {
        tickPendingRef.current = false;
        if (pendingAbilityRef.current) {
          tickCauseRef.current = 'ability';
          immediate = true;
        }
      } else if (pendingAbilityRef.current) {
        tickCauseRef.current = 'ability';
        immediate = true;
      }
      // An "immediate" follow-up still respects the hard request floor, so a
      // rapid double press cannot produce two back-to-back claims.
      if (immediate && Date.now() - lastRequestAtRef.current < MIN_REQUEST_SPACING_MS) {
        immediate = false;
      }
      // Single re-arm point: every tick, whatever its outcome, schedules the
      // next one against the server's boundary.
      scheduleNextTick(immediate);
    }

  }, [processTickResult, stopCombat, scheduleNextTick, noteCadence]);

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
    /** C0: true once the server reported combat is closed for maintenance. */
    combatMaintenance,
    updateCreatureHp,
    startCombat: startCombatCore,
    stopCombat,
    fleeStopCombat,
    pendingAbility,
    pendingCpCost,
    queueAbility,
    /** C4: actions submitted but not yet acknowledged by a committed tick. */
    pendingActionCount,
    /** C4: most recent authoritative rejection (concise presentation only). */
    lastActionRejection,
  };
}
