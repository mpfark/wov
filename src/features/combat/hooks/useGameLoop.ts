/**
 * useGameLoop — owns regen intervals, death detection, and party regen.
 * Delegates buff/debuff state to useBuffState.
 *
 * Mirrors LPMud's heart_beat() pattern for periodic effects.
 */
import { useState, useEffect, useRef } from 'react';
import { Character } from '@/features/character';
import { getStatRegen, getCpRegen, getMpRegenRate, getMilestoneHpRegen, getMilestoneCpRegen, getEffectiveMaxHp, getEffectiveMaxCp, getEffectiveMaxMp } from '@/lib/game-data';
import { supabase } from '@/integrations/supabase/client';
import { logActivity } from '@/hooks/useActivityLog';
import type { GameEventBus } from '@/hooks/useGameEvents';
import { useBuffState } from './useBuffState';

// ─── Buff / debuff types ──────────────────────────────────────────
export interface RegenBuff { multiplier: number; expiresAt: number } // kept for type compat but unused
export interface FoodBuff { flatRegen: number; expiresAt: number }
export interface CritBuff { bonus: number; expiresAt: number }
export interface StealthBuff { expiresAt: number }
export interface DamageBuff { expiresAt: number }
export interface RootDebuff { damageReduction: number; expiresAt: number }
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
export interface AbsorbBuff { shieldHp: number; expiresAt: number }
export interface PartyRegenBuff { healPerTick: number; expiresAt: number; source?: 'healer' | 'bard' }
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
export interface FocusStrikeBuff { bonusDmg: number }

// ─── Local type aliases ───────────────────────────────────────────
interface EquippedItem {
  item: { stats: any; name: string; rarity: string; item_type: string; [k: string]: any };
  [k: string]: any;
}

// ─── Params ───────────────────────────────────────────────────────
export interface UseGameLoopParams {
  character: Character;
  updateCharacter: (updates: Partial<Character>, effectiveCaps?: { maxHp?: number; maxCp?: number; maxMp?: number }) => Promise<void>;
  equipped: EquippedItem[];
  equipmentBonuses: Record<string, number>;
  getNode: (id: string) => any;
  addLog: (msg: string) => void;
  startingNodeId?: string;
  creatures: { id: string; name: string; level: number; rarity: string; hp: number; max_hp: number; loot_table: any; loot_table_id: string | null; drop_chance: number; node_id?: string | null; [k: string]: any }[];
  party: any;
  partyMembers: any[];
  /** Optional event bus — when provided, fires 'player:death' on death */
  bus?: GameEventBus;
  /** When false, the regen interval is suppressed. Used to wait until the
   *  server-side `sync_character_resources` RPC has resolved on entry so we
   *  don't write against pre-sync `max_*` (which the row-level trigger would
   *  silently clamp). Defaults to true for backward compatibility. */
  enabled?: boolean;
}

// ─── Hook ─────────────────────────────────────────────────────────
export function useGameLoop(params: UseGameLoopParams) {
  const {
    character, updateCharacter, equipped, equipmentBonuses, getNode, addLog,
    startingNodeId, creatures, party, partyMembers, bus,
    enabled = true,
  } = params;

  // Keep a ref so the long-lived interval below can read the latest value
  // without being re-created.
  const enabledRef = useRef(enabled);
  useEffect(() => { enabledRef.current = enabled; }, [enabled]);

  // ── Buff state (delegated to useBuffState) ─────────────────
  const buff = useBuffState({ characterDex: character.dex, characterInt: character.int, creatures });
  const { partyRegenBuff, inspireBuff } = buff.buffState;
  const { setPartyRegenBuff } = buff.buffSetters;
  const { foodBuff } = buff.buffState;

  // ── Local state ────────────────────────────────────────────
  const [isDead, setIsDead] = useState(false);
  const [regenTick, setRegenTick] = useState(false);
  const [deathCountdown, setDeathCountdown] = useState(3);
  const isDeadRef = useRef(false);

  // ── Regen refs (avoid stale closures in intervals) ─────────
  const regenCharRef = useRef({ hp: character.hp, max_hp: character.max_hp, current_node_id: character.current_node_id, con: character.con, level: character.level, mp: character.mp ?? 100, max_mp: character.max_mp ?? 100, dex: character.dex, class: character.class });
  const foodBuffRef = useRef(foodBuff);
  const inspireBuffRef = useRef(inspireBuff);
  const getNodeRef = useRef(getNode);
  const updateCharRegenRef = useRef(updateCharacter);
  const equippedRef = useRef(equipped);
  const inCombatRegenRef = useRef(false);
  const equipmentBonusesRef = useRef(equipmentBonuses);

  useEffect(() => { regenCharRef.current = { hp: character.hp, max_hp: character.max_hp, current_node_id: character.current_node_id, con: character.con, level: character.level, mp: character.mp ?? 100, max_mp: character.max_mp ?? 100, dex: character.dex, class: character.class }; }, [character.hp, character.max_hp, character.current_node_id, character.con, character.level, character.mp, character.max_mp, character.dex, character.class]);
  useEffect(() => { foodBuffRef.current = foodBuff; }, [foodBuff]);
  useEffect(() => { inspireBuffRef.current = inspireBuff; }, [inspireBuff]);
  useEffect(() => { getNodeRef.current = getNode; }, [getNode]);
  useEffect(() => { updateCharRegenRef.current = updateCharacter; }, [updateCharacter]);
  useEffect(() => { equippedRef.current = equipped; }, [equipped]);
  useEffect(() => { equipmentBonusesRef.current = equipmentBonuses; }, [equipmentBonuses]);

  // ── Computed values ────────────────────────────────────────
  const itemHpRegen = equipped.reduce((sum, inv) => sum + ((inv.item.stats as any)?.hp_regen || 0), 0);
  const baseRegen = getStatRegen(character.con + (equipmentBonuses.con || 0));

  // ── Unified HP + CP + MP Regen (every 4s) ───────────────────
  const cpCharRef = useRef({ cp: character.cp ?? 100, level: character.level, int: character.int, wis: character.wis, cha: character.cha });
  useEffect(() => { cpCharRef.current = { cp: character.cp ?? 100, level: character.level, int: character.int, wis: character.wis, cha: character.cha }; }, [character.cp, character.level, character.int, character.wis, character.cha]);

  useEffect(() => {
    const interval = setInterval(() => {
      // Wait until the on-entry `sync_character_resources` RPC has resolved.
      // Writing before that means we may write against stale `max_*` and have
      // the row trigger silently clamp `hp`/`cp`/`mp` down.
      if (!enabledRef.current) return;

      const updates: Partial<Character> = {};

      // ── HP Regen ──
      // During combat, the `combat-tick` edge function is the SOLE writer for
      // the character's HP. Doing client-side regen writes here races with the
      // server: a stale-ref or interleaved write can re-inflate the row's HP
      // and the next tick will deal damage off the inflated value, producing
      // the visible "bars jumping up and down" symptom.
      const { hp, current_node_id, con, mp, dex, level: charLevel, class: charClass } = regenCharRef.current;
      const node = current_node_id ? getNodeRef.current(current_node_id) : null;
      const innFlat = node?.is_inn ? 10 : 0;
      const eqB = equipmentBonusesRef.current;

      const effectiveMaxHp = getEffectiveMaxHp(charClass, con, charLevel, eqB);

      // Inspire (Bard) — flat additive HP & CP regen for the duration.
      // Like all other client regen sources, it is suppressed during combat.
      const insp = inspireBuffRef.current;
      const inspireActive = !!(insp && Date.now() < insp.expiresAt);
      const inspireHp = inspireActive ? insp!.hpPerTick : 0;
      const inspireCp = inspireActive ? insp!.cpPerTick : 0;

      if (!inCombatRegenRef.current && hp < effectiveMaxHp && hp > 0) {
        const conRegen = getStatRegen(con + (eqB.con || 0));
        const eqItemRegen = eqB.hp_regen || 0;
        const food = foodBuffRef.current;
        const foodRegen = Date.now() < food.expiresAt ? food.flatRegen : 0;
        const milestoneHpFlat = getMilestoneHpRegen(regenCharRef.current.level);
        const regenAmount = Math.max(Math.floor(conRegen + eqItemRegen + foodRegen + milestoneHpFlat + innFlat + inspireHp), 1);
        const newHp = Math.min(hp + regenAmount, effectiveMaxHp);
        if (newHp !== hp) {
          updates.hp = newHp;
          setRegenTick(true);
          setTimeout(() => setRegenTick(false), 1200);
        }
      }

      // ── CP Regen (skipped during combat to avoid stale-ref race with ability costs) ──
      if (!inCombatRegenRef.current) {
        const { cp, level: cpLevel, int, wis } = cpCharRef.current;
        const effectiveMaxCp = getEffectiveMaxCp(cpLevel, wis, eqB);
        if (cp < effectiveMaxCp) {
          const intWithGear = int + (eqB.int || 0);
          const intRegen = getCpRegen(intWithGear);
          const milestoneCpFlat = getMilestoneCpRegen(cpCharRef.current.level);
          const food = foodBuffRef.current;
          const foodCpRegen = Date.now() < food.expiresAt ? food.flatRegen * 0.5 : 0;
          const regenAmount = Math.max(Math.floor((intRegen + foodCpRegen + milestoneCpFlat + innFlat + inspireCp)), 1);
          const newCp = Math.min(cp + regenAmount, effectiveMaxCp);
          if (newCp > cp) {
            updates.cp = newCp;
          }
        }
      }

      // ── MP Regen (skipped during combat — same race-avoidance reason) ──
      const effectiveMaxMp = getEffectiveMaxMp(regenCharRef.current.level, dex, eqB);
      if (!inCombatRegenRef.current && mp < effectiveMaxMp) {
        const dexWithGear = dex + (eqB.dex || 0);
        // ×2 to compensate for 4s tick (was 2s)
        const regenAmount = getMpRegenRate(dexWithGear) * 2 + innFlat;
        const newMp = Math.min(mp + regenAmount, effectiveMaxMp);
        if (newMp > mp) {
          updates.mp = newMp;
        }
      }

      if (Object.keys(updates).length > 0) {
        updateCharRegenRef.current(updates, {
          maxHp: effectiveMaxHp,
          maxCp: getEffectiveMaxCp(cpCharRef.current.level, cpCharRef.current.wis, eqB),
          maxMp: effectiveMaxMp,
        });
      }
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  // ── Death detection & respawn ──────────────────────────────
  const deathGoldRef = useRef(character.gold);
  const deathNodeRef = useRef(startingNodeId);
  const updateCharRef = useRef(updateCharacter);
  const addLogRef = useRef(addLog);
  useEffect(() => { deathGoldRef.current = character.gold; }, [character.gold]);
  useEffect(() => { deathNodeRef.current = startingNodeId; }, [startingNodeId]);
  useEffect(() => { updateCharRef.current = updateCharacter; }, [updateCharacter]);
  useEffect(() => { addLogRef.current = addLog; }, [addLog]);

  useEffect(() => {
    if (character.hp > 0 || isDeadRef.current) return;
    isDeadRef.current = true;
    setIsDead(true);
    setDeathCountdown(3);
    // Emit global death event so GamePage can broadcast a death cry
    try { bus?.emit('player:death', { goldLost: Math.floor(deathGoldRef.current * 0.1) }); } catch {/* no-op */}
    const countdownInterval = setInterval(() => {
      setDeathCountdown(prev => Math.max(prev - 1, 0));
    }, 1000);
    const goldLost = Math.floor(deathGoldRef.current * 0.1);
    const respawnTimeout = setTimeout(async () => {
      await updateCharRef.current({
        hp: 1,
        gold: deathGoldRef.current - goldLost,
        current_node_id: deathNodeRef.current,
      });
      addLogRef.current(`💀 You have fallen! You lost ${goldLost} gold and awaken at the starting area with 1 HP.`);
      logActivity(character.user_id, character.id, 'combat_death', `Died and lost ${goldLost} gold`, { gold_lost: goldLost });
      isDeadRef.current = false;
      setIsDead(false);
      clearInterval(countdownInterval);
    }, 3000);
    return () => { clearTimeout(respawnTimeout); clearInterval(countdownInterval); isDeadRef.current = false; };
  }, [character.hp]);

  // ── Crescendo / Purifying Light party regen ────────────────
  useEffect(() => {
    if (!partyRegenBuff || Date.now() >= partyRegenBuff.expiresAt) return;
    const isHealer = partyRegenBuff.source === 'healer';
    const abilityLabel = isHealer ? 'Purifying Light' : 'Crescendo';
    const abilityEmoji = isHealer ? '✨💚' : '🎶✨';
    const interval = setInterval(async () => {
      if (Date.now() >= partyRegenBuff.expiresAt) {
        setPartyRegenBuff(null); clearInterval(interval); return;
      }
      const charState = regenCharRef.current;
      const eqBonuses = equipmentBonusesRef.current;
      const partyEffectiveMaxHp = getEffectiveMaxHp(charState.class, charState.con, charState.level, eqBonuses);
      const selfNewHp = Math.min(partyEffectiveMaxHp, charState.hp + partyRegenBuff.healPerTick);
      if (selfNewHp > charState.hp) {
        await updateCharacter({ hp: selfNewHp });
      }
      if (party) {
        const membersHere = partyMembers.filter(m => m.character_id !== character.id && m.character?.current_node_id === charState.current_node_id);
        for (const m of membersHere) {
          await supabase.rpc('heal_party_member', {
            _healer_id: character.id,
            _target_id: m.character_id,
            _heal_amount: partyRegenBuff.healPerTick,
          });
        }
        if (membersHere.length > 0) {
          addLog(`${abilityEmoji} ${abilityLabel} heals ${membersHere.length + 1} allies for ${partyRegenBuff.healPerTick} HP!`);
        } else {
          addLog(`${abilityEmoji} ${abilityLabel} heals you for ${partyRegenBuff.healPerTick} HP!`);
        }
      } else {
        addLog(`${abilityEmoji} ${abilityLabel} heals you for ${partyRegenBuff.healPerTick} HP!`);
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [partyRegenBuff, party, partyMembers, character, addLog, updateCharacter]);

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
