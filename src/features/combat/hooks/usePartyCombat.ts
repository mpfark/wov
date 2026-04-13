/**
 * usePartyCombat — unified server-authoritative combat via the combat-tick edge function.
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
import { CLASS_COMBAT_PROFILES } from '../utils/combat-math';
import { Character } from '@/features/character';
import { Creature } from '@/features/creatures';
import { supabase } from '@/integrations/supabase/client';
import { setWorkerInterval, clearWorkerInterval } from '@/lib/worker-timer';
import { UNIVERSAL_ABILITIES, CLASS_ABILITIES } from '@/features/combat';
import { interpretCombatTickResult } from '../utils/interpretCombatTickResult';
import type { CombatTickResponse } from '../utils/interpretCombatTickResult';
import { getStoredDisplayMode } from '../utils/combat-text';
import { useCombatAggroEffects } from './useCombatAggroEffects';
import { useCombatLifecycle } from './useCombatLifecycle';

/** Ability types that are processed server-side in the combat-tick */
const SERVER_ABILITY_TYPES = new Set(['multi_attack', 'execute_attack', 'ignite_consume', 'burst_damage', 'dot_debuff']);

let nextTickId = 1;

interface Party {
  id: string;
  leader_id: string;
  tank_id: string | null;
}

export interface MemberBuffState {
  crit_buff?: { bonus: number };
  stealth_buff?: boolean;
  damage_buff?: boolean;
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
  focus_strike?: { bonus_dmg: number };
}

export interface UsePartyCombatParams {
  character: Character;
  creatures: Creature[];
  party: Party | null;
  isLeader: boolean;
  isDead: boolean;
  addLocalLog: (msg: string) => void;
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
  /** Buff setters for death cleanup (Envenom/Ignite) */
  setPoisonBuff?: React.Dispatch<React.SetStateAction<any>>;
  setIgniteBuff?: React.Dispatch<React.SetStateAction<any>>;
}

export function usePartyCombat(params: UsePartyCombatParams) {
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

  // Dev-only: combat start timing
  const combatStartTimeRef = useRef<number | null>(null);

  // Ability queue state
  const [pendingAbility, setPendingAbility] = useState<{ index: number; targetId?: string } | null>(null);
  const pendingAbilityRef = useRef<{ index: number; targetId?: string; readyAt: number } | null>(null);
  const idleCountRef = useRef(0);

  // Prediction state
  const [localPredictionOverrides, setLocalPredictionOverrides] = useState<Record<string, PredictionOverride>>({});
  const currentTickIdRef = useRef<number | null>(null);
  const [predictedLogEntry, setPredictedLogEntry] = useState<{ tickId: number; message: string } | null>(null);

  // Leader aggregates non-leader buff stacks received via broadcast
  const memberBuffsRef = useRef<Record<string, MemberBuffState>>({});
  const memberAbilitiesRef = useRef<any[]>([]);
  const doTickRef = useRef<() => void>(() => {});

  // ── Helpers ────────────────────────────────────────────────────

  const updateCreatureHp = useCallback((creatureId: string, hp: number) => {
    setCreatureHpOverrides(prev => {
      const next = { ...prev, [creatureId]: hp };
      creatureHpOverridesRef.current = next;
      return next;
    });
  }, []);

  const stopCombat = useCallback(() => {
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
    pendingAbilityRef.current = null;
    setPendingAbility(null);
    setLocalPredictionOverrides({});
    currentTickIdRef.current = null;
    setPredictedLogEntry(null);
    if (intervalRef.current) {
      clearWorkerInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  // ── Queue ability for next tick ────────────────────────────────

  const queueAbility = useCallback((index: number, targetId?: string) => {
    pendingAbilityRef.current = { index, targetId, readyAt: Date.now() + 2000 };
    setPendingAbility({ index, targetId });
    idleCountRef.current = 0;
    if (!intervalRef.current) {
      intervalRef.current = setWorkerInterval(() => doTickRef.current(), 2000);
    }
  }, []);

  // ── Aggro effects ──────────────────────────────────────────────

  const startCombatCore = useCallback((creatureId: string) => {
    const p = ext.current;
    if (p.isDead || p.character.hp <= 0) return;

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

      // Instant prediction: move creature HP bar before first server tick
      const creature = ext.current.creatures.find(c => c.id === creatureId);
      if (creature && creature.is_alive && creature.hp > 0) {
        const profile = CLASS_COMBAT_PROFILES[ext.current.character.class];
        if (profile) {
          const attackerStat = (ext.current.character[profile.stat as keyof typeof ext.current.character] as number) || 10;
          const prediction = predictConservativeDamage({
            classKey: ext.current.character.class,
            attackerStat,
            int: ext.current.character.int,
            str: ext.current.character.str,
            creatureAC: creature.ac,
          });
          if (prediction.shouldPredict) {
            const predictedHp = applyPredictedDamage(creature.hp, prediction.predictedDamage);
            setLocalPredictionOverrides({ [creatureId]: { hp: predictedHp, ts: Date.now() } });
          }
        }
      }

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
    addLocalLog: params.addLocalLog,
    setEngagedCreatureIds,
  });

  // ── Process tick result (thin wrapper around pure interpreter) ──

  const processTickResult = useCallback((data: CombatTickResponse) => {
    // Non-leader: enter combat state when receiving broadcast tick results
    if (!inCombatRef.current && ext.current.party && !ext.current.isLeader) {
      inCombatRef.current = true;
      setInCombat(true);
      idleCountRef.current = 0;
      // Populate engaged creatures from server data
      const serverCreatureIds = data.creature_states.map(cs => cs.id);
      if (serverCreatureIds.length > 0) {
        setEngagedCreatureIds(serverCreatureIds);
        engagedCreatureIdsRef.current = serverCreatureIds;
        setActiveCombatCreatureId(serverCreatureIds[0]);
      }
    }
    if (!inCombatRef.current) return;

    // Dev-only: aggro→first-tick latency
    if (import.meta.env.DEV && combatStartTimeRef.current) {
      console.debug('[polish] aggro→first-tick', (performance.now() - combatStartTimeRef.current).toFixed(0), 'ms');
      combatStartTimeRef.current = null;
    }

    // Clear prediction for creatures with authoritative data
    const serverCreatureIds = new Set(data.creature_states.map(cs => cs.id));
    setLocalPredictionOverrides(prev => clearPredictionForCreatures(prev, serverCreatureIds));

    // Resolve predicted log entry
    if (currentTickIdRef.current !== null) {
      currentTickIdRef.current = null;
      setPredictedLogEntry(null);
    }

    const now = Date.now();
    const gap = lastTickRef.current ? now - lastTickRef.current : 0;
    const result = interpretCombatTickResult(
      data,
      ext.current.character.id,
      ext.current.character.name,
      engagedCreatureIdsRef.current,
      getStoredDisplayMode(),
    );

    if (result.ticksProcessed && result.ticksProcessed > 1) {
      console.warn(`[combat] Processed ${result.ticksProcessed} ticks in one response (gap: ${gap}ms)`);
    }
    lastTickRef.current = now;
    setLastTickTime(now);

    // Track killed creatures
    for (const id of result.killedCreatureIds) recentlyKilledRef.current.add(id);

    // Apply creature HP overrides
    for (const [id, hp] of Object.entries(result.creatureHpUpdates)) {
      setCreatureHpOverrides(prev => {
        const next = { ...prev, [id]: hp };
        creatureHpOverridesRef.current = next;
        return next;
      });
    }

    // Log messages
    for (const msg of result.formattedLogMessages) ext.current.addLocalLog(msg);

    // Character state
    if (result.characterUpdates) {
      if (ext.current.updateCharacterLocal) {
        ext.current.updateCharacterLocal(result.characterUpdates);
      } else {
        ext.current.updateCharacter(result.characterUpdates);
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

    if (result.aliveEngagedIds.length === 0) {
      setTimeout(() => stopCombat(), 250);
    } else {
      if (!inCombatRef.current) {
        inCombatRef.current = true;
        setInCombat(true);
      }
      setActiveCombatCreatureId(result.aliveEngagedIds[0]);
      setEngagedCreatureIds(prev => {
        const aliveSet = new Set(result.aliveEngagedIds);
        const filtered = prev.filter(id => aliveSet.has(id));
        engagedCreatureIdsRef.current = filtered;
        return filtered;
      });
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
        if (data) processTickResult(data);
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
    return () => clearInterval(interval);
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

        const allAbilities = [...UNIVERSAL_ABILITIES, ...(CLASS_ABILITIES[p.character.class] || [])];
        const ability = allAbilities[pending.index];

        if (ability && SERVER_ABILITY_TYPES.has(ability.type)) {
          const targetId = pending.targetId || engagedCreatureIdsRef.current[0];
          const cpCost = ability.cpCost;

          const abilityPayload = {
            character_id: p.character.id,
            ability_type: ability.type,
            target_creature_id: targetId,
            consume_stacks: 0,
            cp_cost: cpCost,
          };

          if (p.party && !p.isLeader) {
            channelRef.current?.send({
              type: 'broadcast',
              event: 'member_pending_ability',
              payload: { ability: abilityPayload },
            });
          } else {
            pendingAbilitiesForServer.push(abilityPayload);
          }
        } else {
          if (p.onAbilityExecute && !p.isDead && p.character.hp > 0) {
            await p.onAbilityExecute(pending.index, pending.targetId);
          }
        }
      }

      // Combat tick (drivers only)
      const solo = !p.party;
      const driver = solo || p.isLeader;

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

        // Apply conservative prediction before server call
        const tickId = nextTickId++;
        currentTickIdRef.current = tickId;

        const activeCreature = engagedCreatureIdsRef.current[0];
        if (activeCreature && !p.isDead && p.character.hp > 0) {
          const { CLASS_COMBAT_PROFILES: profiles } = await import('../utils/combat-math');
          const profile = profiles[p.character.class];
          if (profile) {
            const statKey = profile.stat as keyof typeof p.character;
            const attackerStat = (p.character[statKey] as number) || 10;
            const creature = p.creatures.find(c => c.id === activeCreature);
            if (creature && creature.is_alive && creature.hp > 0) {
              const prediction = predictConservativeDamage({
                classKey: p.character.class,
                attackerStat,
                int: p.character.int,
                str: p.character.str,
                creatureAC: creature.ac,
                sunderReduction: 0,
              });
              if (prediction.shouldPredict) {
                const currentHp = creatureHpOverridesRef.current[activeCreature] ?? creature.hp;
                const predictedHp = applyPredictedDamage(currentHp, prediction.predictedDamage);
                setLocalPredictionOverrides(prev => ({
                  ...prev,
                  [activeCreature]: { hp: predictedHp, ts: Date.now() },
                }));
              }
            }
          }
        }

        // Request-scoped stale response guard
        const seq = ++tickSeqRef.current;
        const tickT0 = Date.now();
        const tickGap = lastTickRef.current ? tickT0 - lastTickRef.current : 0;
        console.log(`[combat] tick #${seq} start (gap: ${tickGap}ms, engaged: ${engagedCreatureIdsRef.current.length})`);

        const { data, error } = await supabase.functions.invoke('combat-tick', { body });

        const tickLatency = Date.now() - tickT0;

        if (seq !== tickSeqRef.current) {
          console.log(`[combat] stale tick response ignored`, { seq, current: tickSeqRef.current, latency: tickLatency });
        } else if (error) {
          console.error('Combat tick error:', error);
        } else {
          const result = data as CombatTickResponse;
          console.log(`[combat] tick #${seq} response (latency: ${tickLatency}ms, ticks_processed: ${result?.ticks_processed})`);
          if (!result) {
            stopCombat();
          } else {
            if (!solo) {
              channelRef.current?.send({ type: 'broadcast', event: 'combat_tick_result', payload: result });
            }
            processTickResult(result);
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
  });

  return {
    inCombat,
    activeCombatCreatureId,
    engagedCreatureIds,
    creatureHpOverrides,
    localPredictionOverrides,
    predictedLogEntry,
    lastTickTime,
    updateCreatureHp,
    startCombat: startCombatCore,
    stopCombat,
    fleeStopCombat,
    pendingAbility,
    queueAbility,
  };
}
