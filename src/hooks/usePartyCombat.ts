/**
 * usePartyCombat — unified server-authoritative combat via the combat-tick edge function.
 *
 * Solo: character runs their own 2s heartbeat calling the edge function directly.
 * Party leader: runs a 2s heartbeat, broadcasts results to party.
 * Party non-leader (same node as leader): listens for tick results via broadcast.
 * Non-leaders broadcast their buff and DoT stacks so the leader can include them in the tick.
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import { Character } from '@/hooks/useCharacter';
import { Creature } from '@/hooks/useCreatures';
import { supabase } from '@/integrations/supabase/client';
import { setWorkerInterval, clearWorkerInterval } from '@/lib/worker-timer';

interface Party {
  id: string;
  leader_id: string;
  tank_id: string | null;
}

interface CombatTickResponse {
  events: { type: string; message: string; character_id?: string }[];
  creature_states: { id: string; hp: number; alive: boolean }[];
  member_states: { character_id: string; hp: number; xp: number; gold: number; level: number; max_hp: number; bhp?: number }[];
  consumed_buffs?: { type: string; character_id: string; buff: string }[];
  cleared_dots?: { character_id: string; creature_id: string; dot_type: string }[];
}

export interface MemberBuffState {
  crit_buff?: { bonus: number };
  stealth_buff?: boolean;
  damage_buff?: boolean;
  root_debuff_target?: string;
  root_debuff_reduction?: number;
  ac_buff?: number;
  poison_buff?: boolean;
  evasion_buff?: { dodge_chance: number };
  ignite_buff?: boolean;
  absorb_buff?: { shield_hp: number };
  sunder_target?: string;
  sunder_reduction?: number;
  disengage_next_hit?: { bonus_mult: number };
  focus_strike?: { bonus_dmg: number };
}

export interface DotStackReport {
  bleed: Record<string, { damage_per_tick: number }>;
  poison: Record<string, { stacks: number; damage_per_tick: number }>;
  ignite: Record<string, { stacks: number; damage_per_tick: number }>;
}

export interface UsePartyCombatParams {
  character: Character;
  creatures: Creature[];
  party: Party | null;
  isLeader: boolean;
  isDead: boolean;
  addLocalLog: (msg: string) => void;
  updateCharacter: (updates: Partial<Character>) => Promise<void>;
  fetchGroundLoot: () => void;
  /** Gather current buff state for combat-tick payload */
  gatherBuffs?: () => MemberBuffState;
  /** Gather current DoT stacks for combat-tick payload */
  gatherDotStacks?: () => DotStackReport;
  /** Called when server consumes one-shot buffs (stealth, focus_strike, disengage) */
  onConsumedBuffs?: (consumed: { buff: string; character_id: string }[]) => void;
  /** Called when server clears DoT stacks (creature died from DoT) */
  onClearedDots?: (cleared: { character_id: string; creature_id: string; dot_type: string }[]) => void;
  /** Called on tick to execute a queued ability */
  onAbilityExecute?: (abilityIndex: number, targetId?: string) => Promise<void>;
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
  const prevNodeRef = useRef(params.character.current_node_id);
  const tickBusyRef = useRef(false);
  const justStoppedRef = useRef(false);
  const dotDrainNodeRef = useRef<string | null>(null);
  const pendingAggroRef = useRef(false);
  const aggroProcessedRef = useRef<Set<string>>(new Set());

  // Ability queue state
  const [pendingAbility, setPendingAbility] = useState<{ index: number; targetId?: string } | null>(null);
  const pendingAbilityRef = useRef<{ index: number; targetId?: string; readyAt: number } | null>(null);
  const idleCountRef = useRef(0);

  // Leader aggregates non-leader buff + DoT stacks received via broadcast
  const memberBuffsRef = useRef<Record<string, MemberBuffState>>({});
  const memberDotsRef = useRef<Record<string, DotStackReport>>({});
  const doTickRef = useRef<() => void>(() => {});

  // Derived: is this character the "driver" (runs the tick interval)?
  // Solo players and party leaders drive their own ticks.
  const isSolo = !params.party;
  const isDriver = isSolo || params.isLeader;

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
    justStoppedRef.current = true;
    dotDrainNodeRef.current = null;
    setInCombat(false);
    setActiveCombatCreatureId(null);
    setEngagedCreatureIds([]);
    engagedCreatureIdsRef.current = [];
    setCreatureHpOverrides({});
    creatureHpOverridesRef.current = {};
    memberBuffsRef.current = {};
    memberDotsRef.current = {};
    // Only clear interval if no pending ability — let it keep running for ability execution
    if (!pendingAbilityRef.current && intervalRef.current) {
      clearWorkerInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  // ── Queue ability for next tick ────────────────────────────────

  const queueAbility = useCallback((index: number, targetId?: string) => {
    pendingAbilityRef.current = { index, targetId };
    setPendingAbility({ index, targetId });
    idleCountRef.current = 0;
    // Ensure tick interval is running — ability executes on the NEXT heartbeat, not immediately
    if (!intervalRef.current) {
      intervalRef.current = setWorkerInterval(() => doTickRef.current(), 2000);
    }
  }, []);

  // ── Process tick result (shared by driver + non-leader) ────────

  const processTickResult = useCallback((data: CombatTickResponse) => {
    lastTickRef.current = Date.now();
    setLastTickTime(Date.now());

    // Update creature HP overrides
    for (const cs of data.creature_states) {
      setCreatureHpOverrides(prev => {
        const next = { ...prev, [cs.id]: cs.hp };
        creatureHpOverridesRef.current = next;
        return next;
      });
    }

    // Add tick separator before events
    if (data.events.length > 0) {
      ext.current.addLocalLog('---tick---');
    }

    // Display events via local log — convert own character name to "You"
    const myName = ext.current.character.name;
    for (const ev of data.events) {
      let msg = ev.message;
      if (ev.character_id === ext.current.character.id || msg.includes(myName)) {
        msg = msg.replace(new RegExp(`${myName}'s`, 'g'), 'Your');
        msg = msg.replace(new RegExp(`(^|(?:[\\p{Emoji_Presentation}\\p{Extended_Pictographic}\\uFE0F\\u200D]+\\s*(?:CRITICAL!\\s*)?))${myName} `, 'u'), '$1You ');
        msg = msg.replace(new RegExp(` ${myName} `, 'g'), ' you ');
        msg = msg.replace(new RegExp(` ${myName}\\.`, 'g'), ' you.');
        msg = msg.replace(new RegExp(` ${myName}!`, 'g'), ' you!');
      }
      ext.current.addLocalLog(msg);
    }

    // Update own character state from server-authoritative data
    const myState = data.member_states.find(m => m.character_id === ext.current.character.id);
    if (myState) {
      const updates: Partial<import('@/hooks/useCharacter').Character> = {
        hp: myState.hp,
        xp: myState.xp,
        gold: myState.gold,
        level: myState.level,
        max_hp: myState.max_hp,
      };
      if (myState.bhp !== undefined) updates.bhp = myState.bhp;
      ext.current.updateCharacter(updates);
    }

    // Notify client about consumed one-shot buffs
    if (data.consumed_buffs?.length && ext.current.onConsumedBuffs) {
      const myConsumed = data.consumed_buffs.filter(b => b.character_id === ext.current.character.id);
      if (myConsumed.length) ext.current.onConsumedBuffs(myConsumed);
    }

    // Notify client about cleared DoT stacks (creature died from DoT)
    if (data.cleared_dots?.length && ext.current.onClearedDots) {
      const myCleared = data.cleared_dots.filter(d => d.character_id === ext.current.character.id);
      if (myCleared.length) ext.current.onClearedDots(myCleared);
    }

    // Refresh ground loot if any drops occurred
    if (data.events.some(e => e.type === 'loot_drop')) {
      ext.current.fetchGroundLoot();
    }

    // Update combat state — only consider creatures we were actually fighting (engaged)
    const engagedAlive = data.creature_states.filter(cs => cs.alive && engagedCreatureIdsRef.current.includes(cs.id));
    if (engagedAlive.length === 0) {
      // Don't stop combat if we're in drain mode — stale tick results from before
      // node change shouldn't kill the drain interval
      if (!dotDrainNodeRef.current) {
        stopCombat();
      }
    } else {
      if (!inCombatRef.current) {
        inCombatRef.current = true;
        setInCombat(true);
      }
      setActiveCombatCreatureId(engagedAlive[0].id);
      setEngagedCreatureIds(prev => {
        const aliveIds = new Set(engagedAlive.map(cs => cs.id));
        const result = prev.filter(id => aliveIds.has(id));
        engagedCreatureIdsRef.current = result;
        return result;
      });
    }
  }, [stopCombat]);

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
      .on('broadcast', { event: 'member_dot_state' }, (payload) => {
        if (!ext.current.isLeader) return;
        const { character_id, dots } = payload.payload as { character_id: string; dots: DotStackReport };
        if (character_id && dots) memberDotsRef.current[character_id] = dots;
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

  // ── Non-leader: broadcast buff + DoT state periodically ─────────
  useEffect(() => {
    if (!params.party || params.isLeader) return;
    const interval = setInterval(() => {
      if (!channelRef.current) return;
      if (ext.current.gatherDotStacks) {
        const dots = ext.current.gatherDotStacks();
        const hasActiveDots = dots.bleed || Object.keys(dots.poison).length > 0 || Object.keys(dots.ignite).length > 0;
        if (hasActiveDots) {
          channelRef.current.send({ type: 'broadcast', event: 'member_dot_state', payload: { character_id: ext.current.character.id, dots } });
        }
      }
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
    if (tickBusyRef.current) return;
    tickBusyRef.current = true;
    try {
      const p = ext.current;

      // ── Execute pending ability (all players, not just drivers) ──
      const pending = pendingAbilityRef.current;
      if (pending) {
        pendingAbilityRef.current = null;
        setPendingAbility(null);
        if (p.onAbilityExecute && !p.isDead && p.character.hp > 0) {
          await p.onAbilityExecute(pending.index, pending.targetId);
        }
      }

      // ── Combat tick (drivers only) ──
      const solo = !p.party;
      const driver = solo || p.isLeader;

      // ── DoT drain mode: keep ticking DoTs on old node ──
      const drainNode = dotDrainNodeRef.current;
      if (drainNode && driver) {
        const myDots = ext.current.gatherDotStacks?.();
        const hasActiveDots = myDots && (
          Object.keys(myDots.bleed).length > 0 ||
          Object.keys(myDots.poison).length > 0 ||
          Object.keys(myDots.ignite).length > 0
        );

        if (!hasActiveDots) {
          // All DoTs expired, exit drain mode
          dotDrainNodeRef.current = null;
          if (intervalRef.current && !inCombatRef.current && !pendingAbilityRef.current) {
            clearWorkerInterval(intervalRef.current);
            intervalRef.current = null;
          }
        } else {
          const memberDots: Record<string, DotStackReport> = {};
          memberDots[p.character.id] = myDots;

          const body = {
            character_id: p.character.id,
            node_id: drainNode,
            member_buffs: {},
            member_dots: memberDots,
            engaged_creature_ids: [],
          };

          const { data, error } = await supabase.functions.invoke('combat-tick', { body });
          if (!error && data) {
            const result = data as CombatTickResponse;

            // Update creature HP overrides so re-engagement has accurate data
            for (const cs of result.creature_states) {
              setCreatureHpOverrides(prev => {
                const next = { ...prev, [cs.id]: cs.hp };
                creatureHpOverridesRef.current = next;
                return next;
              });
            }

            // Log events
            if (result.events?.length) {
              const myName = p.character.name;
              for (const ev of result.events) {
                let msg = ev.message;
                if (ev.character_id === p.character.id || msg.includes(myName)) {
                  msg = msg.replace(new RegExp(`${myName}'s`, 'g'), 'Your');
                  msg = msg.replace(new RegExp(`(^|(?:[\\p{Emoji_Presentation}\\p{Extended_Pictographic}\\uFE0F\\u200D]+\\s*(?:CRITICAL!\\s*)?))${myName} `, 'u'), '$1You ');
                }
                ext.current.addLocalLog(msg);
              }
            }

            // Update character state
            const myState = result.member_states?.find(m => m.character_id === p.character.id);
            if (myState) {
              const updates: Partial<import('@/hooks/useCharacter').Character> = {
                hp: myState.hp, xp: myState.xp, gold: myState.gold,
                level: myState.level, max_hp: myState.max_hp,
              };
              if (myState.bhp !== undefined) updates.bhp = myState.bhp;
              ext.current.updateCharacter(updates);
            }

            // Handle cleared DoTs
            if (result.cleared_dots?.length && ext.current.onClearedDots) {
              const myCleared = result.cleared_dots.filter(d => d.character_id === p.character.id);
              if (myCleared.length) ext.current.onClearedDots(myCleared);
            }

            // Fetch ground loot if drops occurred (at the old node — player won't see them, but they should exist)
            if (result.events?.some(e => e.type === 'loot_drop')) {
              ext.current.fetchGroundLoot();
            }

            // Check if all DoTs are now cleared after processing
            const remainingDots = ext.current.gatherDotStacks?.();
            const stillHasDots = remainingDots && (
              Object.keys(remainingDots.bleed).length > 0 ||
              Object.keys(remainingDots.poison).length > 0 ||
              Object.keys(remainingDots.ignite).length > 0
            );
            if (!stillHasDots) {
              dotDrainNodeRef.current = null;
              if (intervalRef.current && !inCombatRef.current && !pendingAbilityRef.current) {
                clearWorkerInterval(intervalRef.current);
                intervalRef.current = null;
              }
            }
          }
        }
        // Skip normal combat tick in drain mode
      } else if (driver && !p.isDead && p.character.hp > 0 && engagedCreatureIdsRef.current.length > 0) {
        // Gather buff state: own + collected from non-leaders
        const memberBuffs: Record<string, MemberBuffState> = solo ? {} : { ...memberBuffsRef.current };
        if (ext.current.gatherBuffs) {
          memberBuffs[p.character.id] = ext.current.gatherBuffs();
        }

        // Gather DoT stacks: own + collected from non-leaders
        const memberDots: Record<string, DotStackReport> = solo ? {} : { ...memberDotsRef.current };
        if (ext.current.gatherDotStacks) {
          memberDots[p.character.id] = ext.current.gatherDotStacks();
        }

        const body = solo
          ? {
              character_id: p.character.id,
              node_id: p.character.current_node_id,
              member_buffs: memberBuffs,
              member_dots: memberDots,
              engaged_creature_ids: engagedCreatureIdsRef.current,
            }
          : {
              party_id: p.party!.id,
              node_id: p.character.current_node_id,
              member_buffs: memberBuffs,
              member_dots: memberDots,
              engaged_creature_ids: engagedCreatureIdsRef.current,
            };

        const { data, error } = await supabase.functions.invoke('combat-tick', { body });

        if (error) {
          console.error('Combat tick error:', error);
        } else {
          const result = data as CombatTickResponse;
          if (!result) {
            stopCombat();
          } else if (result.creature_states && result.creature_states.filter(cs => cs.alive).length === 0 && !result.events?.length) {
            // Server confirms zero alive creatures AND no events — combat is truly over
            stopCombat();
          } else {
            // Broadcast to party (only in party mode)
            if (!solo) {
              channelRef.current?.send({
                type: 'broadcast',
                event: 'combat_tick_result',
                payload: result,
              });
            }
            processTickResult(result);
          }
        }
      } else if (driver && (p.isDead || p.character.hp <= 0) && inCombatRef.current) {
        stopCombat();
      }

      // ── Idle detection: stop interval if no combat, no pending ability, and no DoT drain ──
      if (!inCombatRef.current && !pendingAbilityRef.current && !dotDrainNodeRef.current) {
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
    }
  }, [processTickResult, stopCombat]);

  useEffect(() => { doTickRef.current = doTick; }, [doTick]);

  // ── Start combat ───────────────────────────────────────────────

  const startCombat = useCallback((creatureId: string) => {
    const p = ext.current;
    if (p.isDead || p.character.hp <= 0) return;

    // Non-leader in party: broadcast an engagement request to the leader
    if (p.party && !p.isLeader) {
      channelRef.current?.send({
        type: 'broadcast',
        event: 'engage_request',
        payload: { creature_id: creatureId, character_id: p.character.id },
      });
      return;
    }

    // Driver (solo or party leader): add creature to engaged list
    // Clear any active DoT drain mode — new combat takes priority
    dotDrainNodeRef.current = null;

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
      if (intervalRef.current) clearWorkerInterval(intervalRef.current);
      doTick(); // Immediate first tick
      intervalRef.current = setWorkerInterval(() => doTickRef.current(), 2000);
    }
  }, [doTick]);

  // ── Auto-aggro: re-engage aggressive creatures after combat stops ──

  useEffect(() => {
    if (inCombat) {
      justStoppedRef.current = false;
    }
  }, [inCombat]);

  useEffect(() => {
    const p = ext.current;
    if (inCombat || !justStoppedRef.current || p.isDead || pendingAggroRef.current) return;
    // Only drivers auto-re-engage (solo or party leader)
    if (p.party && !p.isLeader) return;
    if (params.creatures.length === 0) return; // Wait for creatures to load
    const nextAggro = params.creatures.find(c => c.is_alive && c.hp > 0 && c.is_aggressive);
    if (nextAggro) {
      justStoppedRef.current = false;
      const timeout = setTimeout(() => {
        ext.current.addLocalLog(`⚠️ ${nextAggro.name} attacks!`);
        startCombat(nextAggro.id);
      }, 500);
      return () => clearTimeout(timeout);
    } else {
      // Creatures loaded but none aggressive — clear justStopped
      justStoppedRef.current = false;
    }
  }, [params.creatures, inCombat, startCombat]);

  // Auto-aggro: during combat, add new aggressive creatures to engaged list
  useEffect(() => {
    const p = ext.current;
    if (!inCombat) return;
    if (p.party && !p.isLeader) return; // Only drivers manage engagement
    for (const c of params.creatures) {
      if (c.is_aggressive && c.is_alive && c.hp > 0 && !engagedCreatureIdsRef.current.includes(c.id)) {
        setEngagedCreatureIds(prev => {
          if (prev.includes(c.id)) return prev;
          const next = [...prev, c.id];
          engagedCreatureIdsRef.current = next;
          return next;
        });
        ext.current.addLocalLog(`⚠️ ${c.name} joins the fight!`);
      }
    }
  }, [params.creatures, inCombat]);

  // ── Pending aggro: trigger after node change when creatures load ──
  useEffect(() => {
    const p = ext.current;
    if (!pendingAggroRef.current || params.creatures.length === 0 || p.isDead || p.character.hp <= 0) return;
    if (p.party && !p.isLeader) return; // Only drivers
    pendingAggroRef.current = false;
    justStoppedRef.current = false; // Prevent duplicate "attacks!" from re-engage effect
    const aggressiveCreatures = params.creatures.filter(
      c => c.is_aggressive && c.is_alive && c.hp > 0 && !aggroProcessedRef.current.has(c.id)
    );
    if (aggressiveCreatures.length === 0) return;
    for (const c of aggressiveCreatures) aggroProcessedRef.current.add(c.id);
    const timeout = setTimeout(() => {
      if (ext.current.character.hp <= 0) return;
      const firstAggro = aggressiveCreatures[0];
      if (firstAggro) {
        ext.current.addLocalLog(`⚠️ ${firstAggro.name} is aggressive and attacks you!`);
        startCombat(firstAggro.id);
      }
    }, 500);
    return () => clearTimeout(timeout);
  }, [params.creatures, startCombat]);

  // ── Lifecycle effects ──────────────────────────────────────────

  // Stop when party disbands (party mode only — solo keeps fighting)
  // Note: transitioning from party to solo or vice versa resets combat
  useEffect(() => {
    // If we were in party mode and party dissolved, stop to reset state
    if (!params.party && channelRef.current) stopCombat();
  }, [params.party, stopCombat]);

  // Handle node changes — enter DoT drain mode if active DoTs, otherwise stop
  useEffect(() => {
    if (params.character.current_node_id !== prevNodeRef.current) {
      const oldNode = prevNodeRef.current;
      const newNode = params.character.current_node_id;
      prevNodeRef.current = newNode;

      // Reset aggro tracking for new node
      aggroProcessedRef.current = new Set();
      pendingAggroRef.current = true;

      // Check if we're returning to the node where DoTs are draining
      if (dotDrainNodeRef.current && dotDrainNodeRef.current === newNode) {
        // Returned to drain node — re-engage creatures that have our active DoTs
        dotDrainNodeRef.current = null;
        const dots = ext.current.gatherDotStacks?.();
        if (dots) {
          const dotCreatureIds = new Set([
            ...Object.keys(dots.bleed),
            ...Object.keys(dots.poison),
            ...Object.keys(dots.ignite),
          ]);
          if (dotCreatureIds.size > 0) {
            const creatureIds = Array.from(dotCreatureIds);
            setEngagedCreatureIds(creatureIds);
            engagedCreatureIdsRef.current = creatureIds;
            setActiveCombatCreatureId(creatureIds[0]);
            inCombatRef.current = true;
            setInCombat(true);
            idleCountRef.current = 0;
            // Ensure interval is running (might have stopped if drain ended just before return)
            if (!intervalRef.current) {
              intervalRef.current = setWorkerInterval(() => doTickRef.current(), 2000);
            }
          }
        }
        return;
      }

      // Check if there are active DoTs that should keep ticking on the old node
      const dots = ext.current.gatherDotStacks?.();
      const hasActiveDots = dots && (
        Object.keys(dots.bleed).length > 0 ||
        Object.keys(dots.poison).length > 0 ||
        Object.keys(dots.ignite).length > 0
      );

      if (hasActiveDots && oldNode) {
        // Enter DoT drain mode: stop combat UI but keep interval ticking
        dotDrainNodeRef.current = oldNode;
        inCombatRef.current = false;
        setInCombat(false);
        setActiveCombatCreatureId(null);
        setEngagedCreatureIds([]);
        engagedCreatureIdsRef.current = [];
        // Keep interval running for DoT drain ticks
        if (!intervalRef.current) {
          intervalRef.current = setWorkerInterval(() => doTickRef.current(), 2000);
        }
      } else {
        stopCombat();
      }
    }
  }, [params.character.current_node_id, stopCombat]);

  // Stop when player dies
  useEffect(() => {
    if (params.isDead) stopCombat();
  }, [params.isDead, stopCombat]);

  // Non-leader: timeout for stale combat (no tick in 6s → assume leader left)
  useEffect(() => {
    if (!inCombat || params.isLeader || !params.party) return;
    const check = setInterval(() => {
      if (Date.now() - lastTickRef.current > 6000) {
        stopCombat();
      }
    }, 2000);
    return () => clearInterval(check);
  }, [inCombat, params.isLeader, params.party, stopCombat]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearWorkerInterval(intervalRef.current);
    };
  }, []);

  const isDotDraining = dotDrainNodeRef.current !== null;

  return {
    inCombat,
    isDotDraining,
    activeCombatCreatureId,
    engagedCreatureIds,
    creatureHpOverrides,
    lastTickTime,
    updateCreatureHp,
    startCombat,
    stopCombat,
    pendingAbility,
    queueAbility,
  };
}
