/**
 * usePartyCombat — server-authoritative party combat via the combat-tick edge function.
 *
 * Leader: runs a 3s heartbeat calling the edge function, broadcasts results to party.
 * Non-leader: listens for tick results via broadcast, updates local state.
 * Provides the same external interface as useCombat for seamless integration.
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import { Character } from '@/hooks/useCharacter';
import { Creature } from '@/hooks/useCreatures';
import { supabase } from '@/integrations/supabase/client';

interface Party {
  id: string;
  leader_id: string;
  tank_id: string | null;
}

interface CombatTickResponse {
  events: { type: string; message: string; character_id?: string }[];
  creature_states: { id: string; hp: number; alive: boolean }[];
  member_states: { character_id: string; hp: number; xp: number; gold: number; level: number; max_hp: number }[];
  consumed_buffs?: { type: string; character_id: string; buff: string }[];
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
  fetchGroundLoot: () => void;
  /** Gather current buff state for combat-tick payload */
  gatherBuffs?: () => MemberBuffState;
  /** Called when server consumes one-shot buffs (stealth, focus_strike, disengage) */
  onConsumedBuffs?: (consumed: { buff: string; character_id: string }[]) => void;
}

export function usePartyCombat(params: UsePartyCombatParams) {
  const ext = useRef(params);
  ext.current = params;

  const [inCombat, setInCombat] = useState(false);
  const [activeCombatCreatureId, setActiveCombatCreatureId] = useState<string | null>(null);
  const [engagedCreatureIds, setEngagedCreatureIds] = useState<string[]>([]);
  const [creatureHpOverrides, setCreatureHpOverrides] = useState<Record<string, number>>({});
  const creatureHpOverridesRef = useRef<Record<string, number>>({});

  const intervalRef = useRef<number | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const lastTickRef = useRef<number>(0);
  const inCombatRef = useRef(false);
  const prevNodeRef = useRef(params.character.current_node_id);
  const tickBusyRef = useRef(false);

  // ── Helpers ────────────────────────────────────────────────────

  const updateCreatureHp = useCallback((creatureId: string, hp: number) => {
    setCreatureHpOverrides(prev => {
      const next = { ...prev, [creatureId]: hp };
      creatureHpOverridesRef.current = next;
      return next;
    });
  }, []);

  const stopCombat = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    inCombatRef.current = false;
    tickBusyRef.current = false;
    setInCombat(false);
    setActiveCombatCreatureId(null);
    setEngagedCreatureIds([]);
    setCreatureHpOverrides({});
    creatureHpOverridesRef.current = {};
  }, []);

  // ── Process tick result (shared by leader + non-leader) ────────

  const processTickResult = useCallback((data: CombatTickResponse) => {
    lastTickRef.current = Date.now();

    // Update creature HP overrides
    for (const cs of data.creature_states) {
      setCreatureHpOverrides(prev => {
        const next = { ...prev, [cs.id]: cs.hp };
        creatureHpOverridesRef.current = next;
        return next;
      });
    }

    // Display events via local log (avoids double-broadcast through party_combat_log)
    for (const ev of data.events) {
      ext.current.addLocalLog(ev.message);
    }

    // Update own character state from server-authoritative data
    const myState = data.member_states.find(m => m.character_id === ext.current.character.id);
    if (myState) {
      ext.current.updateCharacter({
        hp: myState.hp,
        xp: myState.xp,
        gold: myState.gold,
        level: myState.level,
        max_hp: myState.max_hp,
      });
    }

    // Refresh ground loot if any drops occurred
    if (data.events.some(e => e.type === 'loot_drop')) {
      ext.current.fetchGroundLoot();
    }

    // Update combat state
    const aliveCreatures = data.creature_states.filter(cs => cs.alive);
    if (aliveCreatures.length === 0) {
      stopCombat();
    } else {
      if (!inCombatRef.current) {
        inCombatRef.current = true;
        setInCombat(true);
      }
      setActiveCombatCreatureId(aliveCreatures[0].id);
      setEngagedCreatureIds(aliveCreatures.map(cs => cs.id));
    }
  }, [stopCombat]);

  // ── Broadcast channel ──────────────────────────────────────────

  useEffect(() => {
    const partyId = params.party?.id;
    if (!partyId) { channelRef.current = null; return; }

    const channel = supabase.channel(`party-combat-${partyId}`);
    channelRef.current = channel;

    channel
      .on('broadcast', { event: 'combat_tick_result' }, (payload) => {
        // Non-leaders process tick results from broadcast
        if (ext.current.isLeader) return;
        const data = payload.payload as CombatTickResponse;
        if (data) processTickResult(data);
      })
      .subscribe();

    return () => {
      channelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [params.party?.id, processTickResult]);

  // ── Leader: tick function ──────────────────────────────────────

  const doTick = useCallback(async () => {
    if (tickBusyRef.current) return;
    tickBusyRef.current = true;
    try {
      const p = ext.current;
      if (!p.party || !p.isLeader || p.isDead || p.character.hp <= 0) {
        stopCombat();
        return;
      }

      // Gather buff state from leader's client
      const memberBuffs: Record<string, MemberBuffState> = {};
      if (ext.current.gatherBuffs) {
        memberBuffs[p.character.id] = ext.current.gatherBuffs();
      }

      const { data, error } = await supabase.functions.invoke('combat-tick', {
        body: { party_id: p.party.id, node_id: p.character.current_node_id, member_buffs: memberBuffs },
      });

      if (error) {
        console.error('Combat tick error:', error);
        return;
      }

      const result = data as CombatTickResponse;
      if (!result || (!result.events?.length && !result.creature_states?.length)) {
        stopCombat();
        return;
      }

      // Broadcast to party
      channelRef.current?.send({
        type: 'broadcast',
        event: 'combat_tick_result',
        payload: result,
      });

      // Process locally
      processTickResult(result);
    } finally {
      tickBusyRef.current = false;
    }
  }, [processTickResult, stopCombat]);

  // ── Start combat (leader only) ─────────────────────────────────

  const startCombat = useCallback((creatureId: string) => {
    const p = ext.current;
    if (!p.party || !p.isLeader || p.isDead || p.character.hp <= 0) return;
    if (inCombatRef.current) return;

    inCombatRef.current = true;
    setInCombat(true);
    setActiveCombatCreatureId(creatureId);
    setEngagedCreatureIds([creatureId]);

    // Start 3s heartbeat
    if (intervalRef.current) clearInterval(intervalRef.current);
    doTick(); // Immediate first tick
    intervalRef.current = window.setInterval(doTick, 3000);
  }, [doTick]);

  // ── Lifecycle effects ──────────────────────────────────────────

  // Stop when party disbands
  useEffect(() => {
    if (!params.party) stopCombat();
  }, [params.party, stopCombat]);

  // Stop when node changes
  useEffect(() => {
    if (params.character.current_node_id !== prevNodeRef.current) {
      prevNodeRef.current = params.character.current_node_id;
      stopCombat();
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
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  return {
    inCombat,
    activeCombatCreatureId,
    engagedCreatureIds,
    creatureHpOverrides,
    updateCreatureHp,
    startCombat,
    stopCombat,
  };
}
