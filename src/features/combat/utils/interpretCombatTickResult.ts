/**
 * interpretCombatTickResult.ts — Pure interpretation of server combat-tick responses.
 *
 * This file owns: transforming a raw CombatTickResponse into structured update
 * instructions that the orchestration hook can apply to React state.
 *
 * Constraints:
 * - Completely pure: no refs, no setters, no side effects
 * - No React dependency
 * - Only returns structured data
 */

import type { Character } from '@/features/character';
import { formatCombatEvent, type CombatLogDisplayMode, type StructuredAttackEvent } from './combat-text';

export interface CombatTickResponse {
  events: { type: string; message: string; character_id?: string; creature_id?: string }[];
  creature_states: { id: string; hp: number; alive: boolean }[];
  member_states: {
    character_id: string; hp: number; xp: number; gold: number; level: number; max_hp: number;
    bhp?: number; unspent_stat_points?: number; max_cp?: number; max_mp?: number;
    respec_points?: number; salvage?: number; cp?: number;
  }[];
  consumed_buffs?: { type: string; character_id: string; buff: string }[];
  cleared_dots?: { character_id: string; creature_id: string; dot_type: string }[];
  consumed_ability_stacks?: { character_id: string; creature_id: string; stack_type: string }[];
  active_effects?: {
    source_id: string; target_id: string; effect_type: string;
    stacks: number; damage_per_tick: number; expires_at: number;
    next_tick_at?: number; tick_rate_ms?: number;
  }[];
  /** @deprecated Use active_effects instead */
  active_dots?: Record<string, any>;
  session_ended?: boolean;
  ticks_processed?: number;
  buff_sync?: Record<string, { absorb_remaining: number }>;
}

/** Aggregated creature-centric debuff view for shared party display */
export interface CreatureDebuffEntry {
  poison?: { stacks: number; damage_per_tick: number };
  ignite?: { stacks: number; damage_per_tick: number };
  bleed?: { stacks: number; damage_per_tick: number };
  sunder?: { stacks: number };
}

export interface TickInterpretation {
  /** Creature HP updates from server (authoritative) */
  creatureHpUpdates: Record<string, number>;
  /** IDs of creatures confirmed dead this tick */
  killedCreatureIds: string[];
  /** Formatted log messages to display */
  formattedLogMessages: string[];
  /** Partial character updates to apply, or null */
  characterUpdates: Partial<Character> | null;
  /** Consumed buff entries for this character */
  myConsumedBuffs: { type: string; character_id: string; buff: string }[];
  /** Cleared DoT entries for this character */
  myClearedDots: { character_id: string; creature_id: string; dot_type: string }[];
  /** Consumed ability stack entries for this character */
  myConsumedAbilityStacks: { character_id: string; creature_id: string; stack_type: string }[];
  /** Creature IDs that got a poison proc from this character */
  poisonProcs: string[];
  /** Creature IDs that got an ignite proc from this character */
  igniteProcs: string[];
  /** Normalized active effects snapshot for offscreen wake-up */
  activeEffectsSnapshot: {
    target_id: string; effect_type: string; damage_per_tick: number;
    stacks: number; next_tick_at: number; expires_at: number;
    tick_rate_ms: number; source_id: string;
  }[] | null;
  /** DoTs grouped by character for UI sync, or null */
  dotsByChar: Record<string, any> | null;
  /** Derived creature-centric debuff aggregation for shared party display (display-only) */
  creatureDebuffs: Record<string, CreatureDebuffEntry> | null;
  /** Whether a loot_drop event was present */
  hasLootDrop: boolean;
  /** Whether the server says combat ended */
  sessionEnded: boolean;
  /** IDs of alive creatures that are still engaged */
  aliveEngagedIds: string[];
  /** Whether there were multiple ticks processed (for logging) */
  ticksProcessed: number | undefined;
  /** Remaining absorb shield HP from server (null if no absorb active) */
  absorbRemaining: number | null;
}

/**
 * Pure interpretation of a CombatTickResponse.
 * Does NOT mutate any state — returns structured instructions.
 */
export function interpretCombatTickResult(
  data: CombatTickResponse,
  characterId: string,
  characterName: string,
  currentEngagedIds: string[],
  displayMode: CombatLogDisplayMode = 'both',
): TickInterpretation {
  // ── Creature HP updates ──
  const creatureHpUpdates: Record<string, number> = {};
  const killedCreatureIds: string[] = [];
  for (const cs of data.creature_states) {
    creatureHpUpdates[cs.id] = cs.hp;
    if (!cs.alive) killedCreatureIds.push(cs.id);
  }

  // ── Format log messages ──
  const formattedLogMessages: string[] = [];
  if (data.events.length > 0) {
    formattedLogMessages.push('---tick---');
  }
  for (const ev of data.events) {
    if (ev.type === 'tick_separator') {
      formattedLogMessages.push('---tick---');
      continue;
    }
    // Try MUD-style formatting for structured attack events
    const structured = ev as StructuredAttackEvent;
    const hasStructuredData = structured.attacker_name && structured.target_name;
    let msg: string;
    if (hasStructuredData) {
      msg = formatCombatEvent(structured, displayMode, characterId);
    } else {
      msg = ev.message;
    }
    // Name → You substitution for non-structured or 'numbers' mode
    if (ev.character_id === characterId || msg.includes(characterName)) {
      msg = msg.replace(new RegExp(`${characterName}'s`, 'g'), 'Your');
      msg = msg.replace(new RegExp(`(^|(?:[\\p{Emoji_Presentation}\\p{Extended_Pictographic}\\uFE0F\\u200D]+\\s*))${characterName} `, 'u'), '$1You ');
      msg = msg.replace(new RegExp(` ${characterName} `, 'g'), ' you ');
      msg = msg.replace(new RegExp(` ${characterName}\\.`, 'g'), ' you.');
      msg = msg.replace(new RegExp(` ${characterName}!`, 'g'), ' you!');
    }
    formattedLogMessages.push(msg);
  }

  // ── Character state updates ──
  const myState = data.member_states.find(m => m.character_id === characterId);
  let characterUpdates: Partial<Character> | null = null;
  if (myState) {
    characterUpdates = {
      hp: myState.hp,
      xp: myState.xp,
      gold: myState.gold,
      level: myState.level,
      max_hp: myState.max_hp,
    };
    if (myState.bhp !== undefined) characterUpdates.bhp = myState.bhp;
    if (myState.unspent_stat_points !== undefined) characterUpdates.unspent_stat_points = myState.unspent_stat_points;
    if (myState.max_cp !== undefined) characterUpdates.max_cp = myState.max_cp;
    if (myState.max_mp !== undefined) characterUpdates.max_mp = myState.max_mp;
    if (myState.respec_points !== undefined) characterUpdates.respec_points = myState.respec_points;
    if (myState.salvage !== undefined) characterUpdates.salvage = myState.salvage;
    if (myState.cp !== undefined) characterUpdates.cp = myState.cp;
  }

  // ── Filter consumed buffs/dots/stacks to this character ──
  const myConsumedBuffs = (data.consumed_buffs || []).filter(b => b.character_id === characterId);
  const myClearedDots = (data.cleared_dots || []).filter(d => d.character_id === characterId);
  const myConsumedAbilityStacks = (data.consumed_ability_stacks || []).filter(s => s.character_id === characterId);

  // ── Proc events ──
  const poisonProcs: string[] = [];
  const igniteProcs: string[] = [];
  for (const ev of data.events) {
    if (ev.character_id === characterId && ev.type === 'poison_proc' && ev.creature_id) {
      poisonProcs.push(ev.creature_id);
    }
    if (ev.character_id === characterId && ev.type === 'ignite_proc' && ev.creature_id) {
      igniteProcs.push(ev.creature_id);
    }
  }

  // ── Active effects snapshot for offscreen wake-up ──
  let activeEffectsSnapshot: TickInterpretation['activeEffectsSnapshot'] = null;
  if (data.active_effects) {
    activeEffectsSnapshot = data.active_effects.map(eff => ({
      target_id: eff.target_id,
      effect_type: eff.effect_type,
      damage_per_tick: eff.damage_per_tick,
      stacks: eff.stacks ?? 1,
      next_tick_at: eff.next_tick_at ?? 0,
      expires_at: eff.expires_at,
      tick_rate_ms: eff.tick_rate_ms ?? 2000,
      source_id: eff.source_id,
    }));
  }

  // ── DoTs by character for UI sync ──
  let dotsByChar: Record<string, any> | null = null;
  if (data.active_effects) {
    dotsByChar = {};
    for (const eff of data.active_effects) {
      if (!dotsByChar[eff.source_id]) dotsByChar[eff.source_id] = { bleed: {}, poison: {}, ignite: {} };
      dotsByChar[eff.source_id][eff.effect_type][eff.target_id] = {
        stacks: eff.stacks, damage_per_tick: eff.damage_per_tick, expires_at: eff.expires_at,
      };
    }
  } else if (data.active_dots) {
    dotsByChar = data.active_dots;
  }

  // ── Loot check ──
  const hasLootDrop = data.events.some(e => e.type === 'loot_drop');

  // ── Session ended ──
  const sessionEnded = !!data.session_ended;

  // ── Alive engaged creatures ──
  const aliveEngagedIds = data.creature_states
    .filter(cs => cs.alive && currentEngagedIds.includes(cs.id))
    .map(cs => cs.id);

  // ── Derived creature-centric debuff aggregation (display-only) ──
  let creatureDebuffs: Record<string, CreatureDebuffEntry> | null = null;
  if (data.active_effects) {
    creatureDebuffs = {};
    for (const eff of data.active_effects) {
      if (!creatureDebuffs[eff.target_id]) creatureDebuffs[eff.target_id] = {};
      const entry = creatureDebuffs[eff.target_id];
      const et = eff.effect_type as keyof CreatureDebuffEntry;
      if (et === 'sunder') {
        const prev = entry.sunder;
        entry.sunder = { stacks: (prev?.stacks ?? 0) + (eff.stacks ?? 1) };
      } else if (et === 'poison' || et === 'ignite' || et === 'bleed') {
        const prev = entry[et];
        entry[et] = {
          stacks: (prev?.stacks ?? 0) + (eff.stacks ?? 1),
          damage_per_tick: (prev?.damage_per_tick ?? 0) + (eff.damage_per_tick ?? 0),
        };
      }
    }
  }

  // ── Absorb shield sync ──
  const absorbRemaining = data.buff_sync?.[characterId]?.absorb_remaining ?? null;

  return {
    creatureHpUpdates,
    killedCreatureIds,
    formattedLogMessages,
    characterUpdates,
    myConsumedBuffs,
    myClearedDots,
    myConsumedAbilityStacks,
    poisonProcs,
    igniteProcs,
    activeEffectsSnapshot,
    dotsByChar,
    creatureDebuffs,
    hasLootDrop,
    sessionEnded,
    aliveEngagedIds,
    ticksProcessed: data.ticks_processed,
    absorbRemaining,
  };
}
