/**
 * usePartyCombat — unified server-authoritative combat via the combat-tick edge function.
 *
 * Combat sessions are persisted server-side. The server is the sole authority on time.
 * DoTs are tracked server-side in the combat_sessions table.
 * Client polls every 2s; server catches up all elapsed ticks deterministically.
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import { Character } from '@/hooks/useCharacter';
import { Creature } from '@/hooks/useCreatures';
import { supabase } from '@/integrations/supabase/client';
import { setWorkerInterval, clearWorkerInterval } from '@/lib/worker-timer';
import { UNIVERSAL_ABILITIES, CLASS_ABILITIES } from '@/lib/class-abilities';

/** Ability types that are processed server-side in the combat-tick */
const SERVER_ABILITY_TYPES = new Set(['multi_attack', 'execute_attack', 'ignite_consume', 'burst_damage']);

interface Party {
  id: string;
  leader_id: string;
  tank_id: string | null;
}

interface CombatTickResponse {
  events: { type: string; message: string; character_id?: string; creature_id?: string }[];
  creature_states: { id: string; hp: number; alive: boolean }[];
  member_states: { character_id: string; hp: number; xp: number; gold: number; level: number; max_hp: number; bhp?: number; unspent_stat_points?: number; max_cp?: number; max_mp?: number; respec_points?: number; salvage?: number; cp?: number }[];
  consumed_buffs?: { type: string; character_id: string; buff: string }[];
  cleared_dots?: { character_id: string; creature_id: string; dot_type: string }[];
  consumed_ability_stacks?: { character_id: string; creature_id: string; stack_type: string }[];
  active_effects?: { source_id: string; target_id: string; effect_type: string; stacks: number; damage_per_tick: number; expires_at: number }[];
  /** @deprecated Use active_effects instead */
  active_dots?: Record<string, any>;
  session_ended?: boolean;
  ticks_processed?: number;
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

  const pendingAggroRef = useRef(false);
  const aggroProcessedRef = useRef<Set<string>>(new Set());
  const recentlyKilledRef = useRef<Set<string>>(new Set());

  // Ability queue state
  const [pendingAbility, setPendingAbility] = useState<{ index: number; targetId?: string } | null>(null);
  const pendingAbilityRef = useRef<{ index: number; targetId?: string; readyAt: number } | null>(null);
  const idleCountRef = useRef(0);

  // Leader aggregates non-leader buff stacks received via broadcast
  const memberBuffsRef = useRef<Record<string, MemberBuffState>>({});
  // Leader aggregates non-leader pending abilities received via broadcast
  const memberAbilitiesRef = useRef<any[]>([]);
  const doTickRef = useRef<() => void>(() => {});

  const isSolo = !params.party;
  void (isSolo || params.isLeader); // isDriver — reserved for future use

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
    setInCombat(false);
    setActiveCombatCreatureId(null);
    setEngagedCreatureIds([]);
    engagedCreatureIdsRef.current = [];
    setCreatureHpOverrides({});
    creatureHpOverridesRef.current = {};
    memberBuffsRef.current = {};
    memberAbilitiesRef.current = [];
    if (!pendingAbilityRef.current && intervalRef.current) {
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

  // ── Process tick result (shared by driver + non-leader) ────────

  const processTickResult = useCallback((data: CombatTickResponse) => {
    lastTickRef.current = Date.now();
    setLastTickTime(Date.now());

    for (const cs of data.creature_states) {
      if (!cs.alive) recentlyKilledRef.current.add(cs.id);
    }

    for (const cs of data.creature_states) {
      setCreatureHpOverrides(prev => {
        const next = { ...prev, [cs.id]: cs.hp };
        creatureHpOverridesRef.current = next;
        return next;
      });
    }

    if (data.events.length > 0) {
      ext.current.addLocalLog('---tick---');
    }

    const myName = ext.current.character.name;
    for (const ev of data.events) {
      if (ev.type === 'tick_separator') {
        ext.current.addLocalLog('---tick---');
        continue;
      }
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
      if (myState.unspent_stat_points !== undefined) updates.unspent_stat_points = myState.unspent_stat_points;
      if (myState.max_cp !== undefined) updates.max_cp = myState.max_cp;
      if (myState.max_mp !== undefined) updates.max_mp = myState.max_mp;
      if (myState.respec_points !== undefined) updates.respec_points = myState.respec_points;
      if (myState.salvage !== undefined) updates.salvage = myState.salvage;
      if (myState.cp !== undefined) updates.cp = myState.cp;
      if (ext.current.updateCharacterLocal) {
        ext.current.updateCharacterLocal(updates);
      } else {
        ext.current.updateCharacter(updates);
      }
    }

    if (data.consumed_buffs?.length && ext.current.onConsumedBuffs) {
      const myConsumed = data.consumed_buffs.filter(b => b.character_id === ext.current.character.id);
      if (myConsumed.length) ext.current.onConsumedBuffs(myConsumed);
    }

    if (data.cleared_dots?.length && ext.current.onClearedDots) {
      const myCleared = data.cleared_dots.filter(d => d.character_id === ext.current.character.id);
      if (myCleared.length) ext.current.onClearedDots(myCleared);
    }

    if (data.consumed_ability_stacks?.length && ext.current.onConsumedAbilityStacks) {
      const myStacks = data.consumed_ability_stacks.filter(s => s.character_id === ext.current.character.id);
      if (myStacks.length) ext.current.onConsumedAbilityStacks(myStacks);
    }

    // Sync DoT state from server for UI display
    const myId = ext.current.character.id;
    for (const ev of data.events) {
      if (ev.character_id === myId && ev.type === 'poison_proc' && ev.creature_id && ext.current.onPoisonProc) {
        ext.current.onPoisonProc(ev.creature_id);
      }
      if (ev.character_id === myId && ev.type === 'ignite_proc' && ev.creature_id && ext.current.onIgniteProc) {
        ext.current.onIgniteProc(ev.creature_id);
      }
    }

    // Sync active effects from server for UI — map flat array to legacy nested format
    if (data.active_effects && ext.current.onActiveDots) {
      const dotsByChar: Record<string, any> = {};
      for (const eff of data.active_effects) {
        if (!dotsByChar[eff.source_id]) dotsByChar[eff.source_id] = { bleed: {}, poison: {}, ignite: {} };
        dotsByChar[eff.source_id][eff.effect_type][eff.target_id] = {
          stacks: eff.stacks, damage_per_tick: eff.damage_per_tick, expires_at: eff.expires_at,
        };
      }
      ext.current.onActiveDots(dotsByChar);
    } else if (data.active_dots && ext.current.onActiveDots) {
      // Backward compat fallback
      ext.current.onActiveDots(data.active_dots);
    }

    if (data.events.some(e => e.type === 'loot_drop')) {
      ext.current.fetchGroundLoot();
    }

    // Check if session ended server-side
    if (data.session_ended) {
      stopCombat();
      return;
    }

    // Normal combat state update
    const engagedAlive = data.creature_states.filter(cs => cs.alive && engagedCreatureIdsRef.current.includes(cs.id));
    if (engagedAlive.length === 0) {
      stopCombat();
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

  // ── Non-leader: broadcast buff state periodically ──────────────
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
    if (tickBusyRef.current) return;
    tickBusyRef.current = true;
    try {
      const p = ext.current;

      // ── Process pending ability ──
      const pending = pendingAbilityRef.current;
      let pendingAbilitiesForServer: any[] = [];

      if (pending && Date.now() >= pending.readyAt) {
        pendingAbilityRef.current = null;
        setPendingAbility(null);

        const allAbilities = [...UNIVERSAL_ABILITIES, ...(CLASS_ABILITIES[p.character.class] || [])];
        const ability = allAbilities[pending.index];

        if (ability && SERVER_ABILITY_TYPES.has(ability.type)) {
          const targetId = pending.targetId || engagedCreatureIdsRef.current[0];

          // For execute/conflagrate, consume_stacks comes from server DoT state now
          // The server will use its own DoT tracking to determine stacks
          const cpCost = p.character.level >= 39 ? Math.ceil(ability.cpCost * 0.9) : ability.cpCost;

          const abilityPayload = {
            character_id: p.character.id,
            ability_type: ability.type,
            target_creature_id: targetId,
            consume_stacks: 0, // Server will read from its own DoT state
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

      // ── Combat tick (drivers only) ──
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

        const { data, error } = await supabase.functions.invoke('combat-tick', { body });

        if (error) {
          console.error('Combat tick error:', error);
        } else {
          const result = data as CombatTickResponse;
          if (!result) {
            stopCombat();
          } else if (result.session_ended) {
            if (!solo) {
              channelRef.current?.send({ type: 'broadcast', event: 'combat_tick_result', payload: result });
            }
            processTickResult(result);
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

      // ── Idle detection ──
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
    }
  }, [processTickResult, stopCombat]);

  useEffect(() => { doTickRef.current = doTick; }, [doTick]);

  // ── Start combat ───────────────────────────────────────────────

  const startCombat = useCallback((creatureId: string) => {
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
      if (intervalRef.current) clearWorkerInterval(intervalRef.current);
      doTick();
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
    if (p.party && !p.isLeader) return;
    if (params.creatures.length === 0) return;
    const nextAggro = params.creatures.find(c => c.is_alive && c.hp > 0 && c.is_aggressive && !recentlyKilledRef.current.has(c.id));
    if (nextAggro) {
      justStoppedRef.current = false;
      ext.current.addLocalLog(`⚠️ ${nextAggro.name} attacks!`);
      startCombat(nextAggro.id);
    } else {
      justStoppedRef.current = false;
    }
  }, [params.creatures, inCombat, startCombat]);

  useEffect(() => {
    const p = ext.current;
    if (!inCombat) return;
    if (p.party && !p.isLeader) return;
    for (const c of params.creatures) {
      if (c.is_aggressive && c.is_alive && c.hp > 0 && !engagedCreatureIdsRef.current.includes(c.id) && !recentlyKilledRef.current.has(c.id)) {
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

  useEffect(() => {
    const p = ext.current;
    if (!pendingAggroRef.current || params.creatures.length === 0 || p.isDead || p.character.hp <= 0) return;
    if (p.party && !p.isLeader) return;
    pendingAggroRef.current = false;
    justStoppedRef.current = false;
    const aggressiveCreatures = params.creatures.filter(
      c => c.is_aggressive && c.is_alive && c.hp > 0 && !aggroProcessedRef.current.has(c.id)
    );
    if (aggressiveCreatures.length === 0) return;
    for (const c of aggressiveCreatures) aggroProcessedRef.current.add(c.id);
    if (ext.current.character.hp <= 0) return;
    const firstAggro = aggressiveCreatures[0];
    if (firstAggro) {
      ext.current.addLocalLog(`⚠️ ${firstAggro.name} is aggressive and attacks you!`);
      startCombat(firstAggro.id);
    }
  }, [params.creatures, startCombat]);

  // ── Lifecycle effects ──────────────────────────────────────────

  useEffect(() => {
    if (!params.party && channelRef.current) stopCombat();
  }, [params.party, stopCombat]);

  // Handle node changes — server handles DoT continuation via session
  useEffect(() => {
    if (params.character.current_node_id !== prevNodeRef.current) {
      prevNodeRef.current = params.character.current_node_id;
      aggroProcessedRef.current = new Set();
      recentlyKilledRef.current = new Set();
      pendingAggroRef.current = true;
      // Stop client-side combat — server session persists DoTs automatically
      stopCombat();
    }
  }, [params.character.current_node_id, stopCombat]);

  useEffect(() => {
    if (params.isDead) stopCombat();
  }, [params.isDead, stopCombat]);

  useEffect(() => {
    if (!inCombat || params.isLeader || !params.party) return;
    const check = setInterval(() => {
      if (Date.now() - lastTickRef.current > 6000) {
        stopCombat();
      }
    }, 2000);
    return () => clearInterval(check);
  }, [inCombat, params.isLeader, params.party, stopCombat]);

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearWorkerInterval(intervalRef.current);
    };
  }, []);

  return {
    inCombat,
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
