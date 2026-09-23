/**
 * useGameLoop — owns legacy death detection and presentation-only buff timers.
 * Authoritative passive HP/CP/MP settlement is server-owned.
 * Delegates buff/debuff state to useBuffState.
 *
 * Mirrors LPMud's heart_beat() pattern for periodic effects.
 */
import { useState, useEffect, useRef } from 'react';
import { Character } from '@/features/character';
import { getStatRegen, getEffectiveMaxHp } from '@/lib/game-data';

import type { GameEventBus } from '@/hooks/useGameEvents';
import { useBuffState } from './useBuffState';
import { buildDeathEvent } from '@/features/combat/events/client-event-builder';
import type { GameLogEvent } from '@/features/combat/events/log-event';
import { useExecutionFence } from '@/features/combat2/execution-fence';

// ─── Buff / debuff types ──────────────────────────────────────────
export interface RegenBuff { multiplier: number; expiresAt: number } // kept for type compat but unused
export interface FoodBuff { flatRegen: number; expiresAt: number }
export interface CritBuff { bonus: number; expiresAt: number }
export interface StealthBuff { expiresAt: number; mult?: number }
/** Consolidated `offense_buff` (damage_mult mode). `abilityKey` names the granting ability. */
export interface DamageBuff { expiresAt: number; abilityKey?: string }
export interface RootDebuff { damageReduction: number; expiresAt: number; creatureId?: string }
export interface BattleCryBuff { damageReduction: number; critReduction: number; expiresAt: number }
export interface DotDebuff {
  damagePerTick: number; intervalMs: number; expiresAt: number;
  startsAt?: number;
  creatureId: string; creatureName: string; creatureLevel: number; creatureRarity: string;
  creatureLootTable: any[]; lootTableId: string | null; dropChance: number;
  creatureNodeId: string | null;
  maxHp: number; lastKnownHp: number;
}
export interface PoisonBuff { expiresAt: number }
export interface PoisonStack {
  stacks: number; damagePerTick: number; expiresAt: number;
  creatureName: string; creatureLevel: number; creatureRarity: string;
  creatureLootTable: any[]; lootTableId: string | null; dropChance: number;
  creatureNodeId: string | null;
  maxHp: number; lastKnownHp: number;
}
export interface EvasionBuff { dodgeChance: number; expiresAt: number; source?: 'cloak' | 'disengage' }
export interface DisengageNextHit { bonusMult: number; expiresAt: number }
export interface IgniteBuff { expiresAt: number }
export interface IgniteStack {
  stacks: number; damagePerTick: number; expiresAt: number;
  creatureName: string; creatureLevel: number; creatureRarity: string;
  creatureLootTable: any[]; lootTableId: string | null; dropChance: number;
  creatureNodeId: string | null;
  maxHp: number; lastKnownHp: number;
}
export interface AbsorbBuff { shieldHp: number; shieldCap?: number; expiresAt: number }
/** Ticking party heal (Purifying Light / Crescendo share one `party_regen` base).
 *  `abilityKey` + `label` carry the class identity so no consumer branches on class. */
export interface PartyRegenBuff {
  healPerTick: number;
  expiresAt: number;
  source?: string;
  abilityKey?: string;
  label?: string;
  durationMs?: number;
  /** Authored tick line with {who} / {amount} placeholders. */
  tickText?: string;
}
/** Bard "Inspire" — flat additive HP/CP regen for caster + same-node party.
 *  Magnitude scales with caster CHA, duration scales with caster INT.
 *  Stored `durationMs` so the buff icon's progress bar fills correctly even
 *  though the duration is variable. */
export interface InspireBuff {
  hpPerTick: number;
  cpPerTick: number;
  expiresAt: number;
  durationMs: number;
  casterId: string;
}
export interface SunderDebuff { acReduction: number; expiresAt: number; creatureId: string; creatureName: string }

// ── Templar buffs ────────────────────────────────────────────
/** Holy Shield — reactive holy retaliation against attackers. */
export interface HolyShieldBuff { wisMod: number; expiresAt: number }
/** Consecrate — node-wide ground effect: heal allies, burn engaged creatures. */
/**
 * Node aura pulse (consolidated `aura_pulse`). `wisMod` is the resolved
 * magnitude attribute modifier (WIS for the Templar's Consecrate, whatever the
 * ability configures for another class); `abilityKey` carries identity so the
 * server resolves the right calc without a class branch.
 */
export interface ConsecrateBuff { wisMod: number; expiresAt: number; durationMs: number; abilityKey?: string }
/** Divine Challenge — flat damage reduction. */
/** Flat-mode mitigation buff. `text` is the authored mitigation line (optional). */
export interface DivineChallengeBuff { flat: number; expiresAt: number; text?: string }

// ─── Local type aliases ───────────────────────────────────────────
interface EquippedItem {
  item: { stats: any; name: string; rarity: string; item_type: string; [k: string]: any };
  [k: string]: any;
}

// ─── Params ───────────────────────────────────────────────────────
export interface UseGameLoopParams {
  combatEnabled?: boolean;
  character: Character;
  updateCharacter: (updates: Partial<Character>, effectiveCaps?: { maxHp?: number; maxCp?: number; maxMp?: number }) => Promise<void>;
  equipped: EquippedItem[];
  equipmentBonuses: Record<string, number>;
  getNode: (id: string) => any;
  addLogEvent: (event: GameLogEvent) => void;
  startingNodeId?: string;
  creatures: { id: string; name: string; level: number; rarity: string; hp: number; max_hp: number; loot_table: any; loot_table_id: string | null; drop_chance: number; node_id?: string | null; [k: string]: any }[];
  party: any;
  partyMembers: any[];
  /** Optional event bus — when provided, fires 'player:death' on death */
  bus?: GameEventBus;
  /** Legacy execution gate; passive resource settlement is server-owned. */
  enabled?: boolean;
  /** Retained for caller compatibility; passive resources are never written here. */
  updateCharacterLocal?: (updates: Partial<Character>, hold?: boolean) => void;
}

// ─── Hook ─────────────────────────────────────────────────────────
export function useGameLoop(params: UseGameLoopParams) {
  const combatEnabled = params.combatEnabled !== false;
  const execution = useExecutionFence(combatEnabled);
  const {
    character, updateCharacter, equipped, equipmentBonuses, addLogEvent,
    startingNodeId, creatures, bus,
  } = params;

  // ── Buff state (delegated to useBuffState) ─────────────────
  const buff = useBuffState({ characterDex: character.dex, characterInt: character.int, creatures });

  // ── Local state ────────────────────────────────────────────
  const [isDead, setIsDead] = useState(false);
  const [regenTick] = useState(false);
  const [deathCountdown, setDeathCountdown] = useState(3);
  const isDeadRef = useRef(false);

  const inCombatRegenRef = useRef(false);


  // ── Computed values ────────────────────────────────────────
  const itemHpRegen = equipped.reduce((sum, inv) => sum + ((inv.item.stats as any)?.hp_regen || 0), 0);
  const baseRegen = getStatRegen(character.con + (equipmentBonuses.con || 0));

  // HP/CP/MP regeneration is server-authoritative. The browser intentionally
  // owns no regeneration timer and writes no calculated resource amount.


  // ── Death detection & respawn ──────────────────────────────
  const deathGoldRef = useRef(character.gold);
  const deathNodeRef = useRef(startingNodeId);
  const updateCharRef = useRef(updateCharacter);
  const addLogEventRef = useRef(addLogEvent);
  useEffect(() => { deathGoldRef.current = character.gold; }, [character.gold]);
  useEffect(() => { deathNodeRef.current = startingNodeId; }, [startingNodeId]);
  useEffect(() => { updateCharRef.current = updateCharacter; }, [updateCharacter]);
  useEffect(() => { addLogEventRef.current = addLogEvent; }, [addLogEvent]);

  // Timers are held in refs so a mid-countdown hp change (optimistic write or
  // realtime echo re-firing this effect) does NOT tear them down. Previously
  // the effect's cleanup ran on every hp change, clearing both the countdown
  // interval and the respawn timeout — leaving the overlay frozen at 1 or 2.
  const deathIntervalRef = useRef<number | null>(null);
  const deathTimeoutRef = useRef<number | null>(null);
  useEffect(() => {
    if (combatEnabled) return;
    if (deathIntervalRef.current) clearInterval(deathIntervalRef.current);
    if (deathTimeoutRef.current) clearTimeout(deathTimeoutRef.current);
    deathIntervalRef.current = null;
    deathTimeoutRef.current = null;
    isDeadRef.current = false;
    setIsDead(false);
  }, [combatEnabled]);
  useEffect(() => {
    if (!execution.allowed()) return;
    const current = execution.capture();
    if (character.hp > 0 || isDeadRef.current) return;
    isDeadRef.current = true;
    setIsDead(true);
    setDeathCountdown(3);
    try { bus?.emit('player:death', { goldLost: Math.floor(deathGoldRef.current * 0.1) }); } catch {/* no-op */}
    if (deathIntervalRef.current) clearInterval(deathIntervalRef.current);
    if (deathTimeoutRef.current) clearTimeout(deathTimeoutRef.current);
    deathIntervalRef.current = window.setInterval(() => {
      if (!current()) return;
      setDeathCountdown(prev => {
        const next = Math.max(prev - 1, 0);
        if (next === 0 && deathIntervalRef.current) {
          clearInterval(deathIntervalRef.current);
          deathIntervalRef.current = null;
        }
        return next;
      });
    }, 1000);
    const goldLost = Math.floor(deathGoldRef.current * 0.1);
    deathTimeoutRef.current = window.setTimeout(async () => {
      if (!current()) return;
      try {
        await updateCharRef.current({
          hp: 1,
          gold: deathGoldRef.current - goldLost,
          current_node_id: deathNodeRef.current,
        });
        if (!current()) return;
        addLogEventRef.current(buildDeathEvent(`You have fallen! You lost ${goldLost} gold and awaken at the starting area with 1 HP.`, { amount: goldLost, amountKind: 'gold' }));
      } finally {
        if (!current()) return;
        if (deathIntervalRef.current) { clearInterval(deathIntervalRef.current); deathIntervalRef.current = null; }
        deathTimeoutRef.current = null;
        isDeadRef.current = false;
        setIsDead(false);
      }
    }, 3000);
    // No cleanup: mid-countdown re-runs must not cancel the timers. Unmount
    // cleanup is handled below in its own effect.
  }, [character.hp, combatEnabled, execution]);

  useEffect(() => () => {
    if (deathIntervalRef.current) clearInterval(deathIntervalRef.current);
    if (deathTimeoutRef.current) clearTimeout(deathTimeoutRef.current);
    isDeadRef.current = false;
  }, []);


  return {
    // Buff state (from useBuffState)
    buffState: buff.buffState,
    buffSetters: buff.buffSetters,
    // Buff handlers (from useBuffState)
    handleAddPoisonStack: buff.handleAddPoisonStack,
    handleAddIgniteStack: buff.handleAddIgniteStack,
    handleAbsorbDamage: buff.handleAbsorbDamage,
    notifyCreatureKilled: buff.notifyCreatureKilled,
    gatherBuffs: buff.gatherBuffs,
    handleConsumedBuffs: buff.handleConsumedBuffs,
    handleClearedDots: buff.handleClearedDots,
    syncFromServerEffects: buff.syncFromServerEffects,
    syncCreatureDebuffs: buff.syncCreatureDebuffs,
    // Local state
    isDead,
    regenTick,
    deathCountdown,
    // Computed
    itemHpRegen,
    baseRegen,
    // Refs
    inCombatRegenRef,
    deathGoldRef,
  };
}
