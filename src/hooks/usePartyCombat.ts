/**
 * usePartyCombat — server-authoritative party combat via the combat-tick edge function.
 *
 * Leader: runs a 2s heartbeat calling the edge function, broadcasts results to party.
 * Non-leader: listens for tick results via broadcast, updates local state.
 * Non-leaders broadcast their buff and DoT stacks so the leader can include them in the tick.
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
  bleed?: { creature_id: string; damage_per_tick: number };
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

  const intervalRef = useRef<number | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const lastTickRef = useRef<number>(0);
  const inCombatRef = useRef(false);
  const prevNodeRef = useRef(params.character.current_node_id);
  const tickBusyRef = useRef(false);

  // Leader aggregates non-leader buff + DoT stacks received via broadcast
  const memberBuffsRef = useRef<Record<string, MemberBuffState>>({});
  const memberDotsRef = useRef<Record<string, DotStackReport>>({});

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
    memberBuffsRef.current = {};
    memberDotsRef.current = {};
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

    // Display events via local log — convert own character name to "You"
    const myName = ext.current.character.name;
    for (const ev of data.events) {
      let msg = ev.message;
      // Convert own character name references to "You" / "Your" for immersion
      if (ev.character_id === ext.current.character.id || msg.includes(myName)) {
        // Replace "CharName's" → "Your" (possessive, must come before name replacement)
        msg = msg.replace(new RegExp(`${myName}'s`, 'g'), 'Your');
        // Replace "CharName " at start or after emoji prefix → "You "
        msg = msg.replace(new RegExp(`(^|(?:[\\p{Emoji_Presentation}\\p{Extended_Pictographic}\\uFE0F\\u200D]+\\s*(?:CRITICAL!\\s*)?))${myName} `, 'u'), '$1You ');
        // Replace remaining " CharName " mid-sentence
        msg = msg.replace(new RegExp(` ${myName} `, 'g'), ' you ');
        msg = msg.replace(new RegExp(` ${myName}\\.`, 'g'), ' you.');
        msg = msg.replace(new RegExp(` ${myName}!`, 'g'), ' you!');
      }
      ext.current.addLocalLog(msg);
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
      .on('broadcast', { event: 'member_dot_state' }, (payload) => {
        // Leader collects non-leader DoT stacks
        if (!ext.current.isLeader) return;
        const { character_id, dots } = payload.payload as { character_id: string; dots: DotStackReport };
        if (character_id && dots) {
          memberDotsRef.current[character_id] = dots;
        }
      })
      .on('broadcast', { event: 'member_buff_state' }, (payload) => {
        // Leader collects non-leader buff states
        if (!ext.current.isLeader) return;
        const { character_id, buffs } = payload.payload as { character_id: string; buffs: MemberBuffState };
        if (character_id && buffs) {
          memberBuffsRef.current[character_id] = buffs;
        }
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

      // Broadcast DoT state
      if (ext.current.gatherDotStacks) {
        const dots = ext.current.gatherDotStacks();
        const hasActiveDots = dots.bleed || Object.keys(dots.poison).length > 0 || Object.keys(dots.ignite).length > 0;
        if (hasActiveDots) {
          channelRef.current.send({
            type: 'broadcast',
            event: 'member_dot_state',
            payload: { character_id: ext.current.character.id, dots },
          });
        }
      }

      // Broadcast buff state
      if (ext.current.gatherBuffs) {
        const buffs = ext.current.gatherBuffs();
        const hasActiveBuffs = Object.keys(buffs).length > 0;
        if (hasActiveBuffs) {
          channelRef.current.send({
            type: 'broadcast',
            event: 'member_buff_state',
            payload: { character_id: ext.current.character.id, buffs },
          });
        }
      }
    }, 1800); // Slightly faster than 2s tick to ensure leader has fresh data
    return () => clearInterval(interval);
  }, [params.party, params.isLeader]);

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

      // Gather buff state: leader's own + collected from non-leaders
      const memberBuffs: Record<string, MemberBuffState> = { ...memberBuffsRef.current };
      if (ext.current.gatherBuffs) {
        memberBuffs[p.character.id] = ext.current.gatherBuffs();
      }

      // Gather DoT stacks: leader's own + collected from non-leaders
      const memberDots: Record<string, DotStackReport> = { ...memberDotsRef.current };
      if (ext.current.gatherDotStacks) {
        memberDots[p.character.id] = ext.current.gatherDotStacks();
      }

      const { data, error } = await supabase.functions.invoke('combat-tick', {
        body: {
          party_id: p.party.id,
          node_id: p.character.current_node_id,
          member_buffs: memberBuffs,
          member_dots: memberDots,
        },
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

    // Start 2s heartbeat
    if (intervalRef.current) clearInterval(intervalRef.current);
    doTick(); // Immediate first tick
    intervalRef.current = window.setInterval(doTick, 2000);
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
