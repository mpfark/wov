/**
 * useGameLoop — owns regen intervals, death detection, and party regen.
 * Delegates buff/debuff state to useBuffState.
 *
 * Mirrors LPMud's heart_beat() pattern for periodic effects.
 */
import { useState, useEffect, useRef } from 'react';
import { Character } from '@/features/character';
import { getBaseRegen, CLASS_PRIMARY_STAT, getCpRegenRate, getMaxCp, getMaxMp, getMpRegenRate, getMilestoneHpRegen, getMilestoneCpRegen } from '@/lib/game-data';
import { supabase } from '@/integrations/supabase/client';
import { logActivity } from '@/hooks/useActivityLog';
import { useBuffState } from './useBuffState';

// ─── Buff / debuff types ──────────────────────────────────────────
export interface RegenBuff { multiplier: number; expiresAt: number }
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
  updateCharacter: (updates: Partial<Character>) => Promise<void>;
  equipped: EquippedItem[];
  equipmentBonuses: Record<string, number>;
  getNode: (id: string) => any;
  addLog: (msg: string) => void;
  startingNodeId?: string;
  creatures: { id: string; name: string; level: number; rarity: string; hp: number; max_hp: number; loot_table: any; loot_table_id: string | null; drop_chance: number; node_id?: string | null; [k: string]: any }[];
  party: any;
  partyMembers: any[];
}

// ─── Hook ─────────────────────────────────────────────────────────
export function useGameLoop(params: UseGameLoopParams) {
  const {
    character, updateCharacter, equipped, equipmentBonuses, getNode, addLog,
    startingNodeId, creatures, party, partyMembers,
  } = params;

  // ── Buff state (delegated to useBuffState) ─────────────────
  const buff = useBuffState({ characterDex: character.dex, characterInt: character.int, creatures });
  const { partyRegenBuff } = buff.buffState;
  const { setPartyRegenBuff } = buff.buffSetters;
  const { regenBuff, foodBuff } = buff.buffState;

  // ── Local state ────────────────────────────────────────────
  const [isDead, setIsDead] = useState(false);
  const [regenTick, setRegenTick] = useState(false);
  const [deathCountdown, setDeathCountdown] = useState(3);
  const isDeadRef = useRef(false);

  // ── Regen refs (avoid stale closures in intervals) ─────────
  const regenCharRef = useRef({ hp: character.hp, max_hp: character.max_hp, current_node_id: character.current_node_id, con: character.con, level: character.level });
  const regenBuffRef = useRef(regenBuff);
  const foodBuffRef = useRef(foodBuff);
  const getNodeRef = useRef(getNode);
  const updateCharRegenRef = useRef(updateCharacter);
  const equippedRef = useRef(equipped);
  const inCombatRegenRef = useRef(false);
  const equipmentBonusesRef = useRef(equipmentBonuses);

  useEffect(() => { regenCharRef.current = { hp: character.hp, max_hp: character.max_hp, current_node_id: character.current_node_id, con: character.con, level: character.level }; }, [character.hp, character.max_hp, character.current_node_id, character.con, character.level]);
  useEffect(() => { regenBuffRef.current = regenBuff; }, [regenBuff]);
  useEffect(() => { foodBuffRef.current = foodBuff; }, [foodBuff]);
  useEffect(() => { getNodeRef.current = getNode; }, [getNode]);
  useEffect(() => { updateCharRegenRef.current = updateCharacter; }, [updateCharacter]);
  useEffect(() => { equippedRef.current = equipped; }, [equipped]);
  useEffect(() => { equipmentBonusesRef.current = equipmentBonuses; }, [equipmentBonuses]);

  // ── Computed values ────────────────────────────────────────
  const itemHpRegen = equipped.reduce((sum, inv) => sum + ((inv.item.stats as any)?.hp_regen || 0), 0);
  const baseRegen = getBaseRegen(character.con + (equipmentBonuses.con || 0));

  // ── HP + CP Regen (every 6s, unified tick) ─────────────────
  const cpCharRef = useRef({ cp: character.cp ?? 100, class: character.class, level: character.level, int: character.int, wis: character.wis, cha: character.cha });
  const cpStatRef = useRef(character);
  useEffect(() => { cpCharRef.current = { cp: character.cp ?? 100, class: character.class, level: character.level, int: character.int, wis: character.wis, cha: character.cha }; }, [character.cp, character.class, character.level, character.int, character.wis, character.cha]);
  useEffect(() => { cpStatRef.current = character; }, [character]);

  useEffect(() => {
    const interval = setInterval(() => {
      const updates: Partial<Character> = {};

      // ── HP Regen ──
      const { hp, max_hp, current_node_id, con } = regenCharRef.current;
      const gearHpBonus = equipmentBonusesRef.current.hp || 0;
      const gearConMod = Math.floor((equipmentBonusesRef.current.con || 0) / 2);
      const effectiveMaxHp = max_hp + gearHpBonus + gearConMod;
      if (hp < effectiveMaxHp && hp > 0) {
        const b = regenBuffRef.current;
        const potionBonus = Date.now() < b.expiresAt ? 0.5 : 0;
        const node = current_node_id ? getNodeRef.current(current_node_id) : null;
        const innBonus = node?.is_inn ? 1 : 0;
        const conWithGear = con + (equippedRef.current.reduce((s, inv) => s + ((inv.item.stats as any)?.con || 0), 0));
        const conRegen = getBaseRegen(conWithGear);
        const eqItemRegen = equippedRef.current.reduce((s, inv) => s + ((inv.item.stats as any)?.hp_regen || 0), 0);
        const food = foodBuffRef.current;
        const foodRegen = Date.now() < food.expiresAt ? food.flatRegen : 0;
        const milestoneHpFlat = getMilestoneHpRegen(regenCharRef.current.level);
        const totalMult = 1 + potionBonus + innBonus;
        const combatMult = inCombatRegenRef.current ? 0.1 : 1;
        // Scaled by 0.4 to compensate for 6s tick (was 15s, 2.5x more ticks)
        const regenAmount = Math.max(Math.floor((conRegen + eqItemRegen + foodRegen + milestoneHpFlat) * totalMult * combatMult * 0.4), 1);
        const newHp = Math.min(hp + regenAmount, effectiveMaxHp);
        if (newHp !== hp) {
          updates.hp = newHp;
          setRegenTick(true);
          setTimeout(() => setRegenTick(false), 1200);
        }
      }

      // ── CP Regen ──
      const { cp, class: charClass, level, int, wis, cha } = cpCharRef.current;
      const eqB = equipmentBonusesRef.current;
      const gearAwareMaxCp = getMaxCp(level, int + (eqB.int || 0), wis + (eqB.wis || 0), cha + (eqB.cha || 0));
      if (cp < gearAwareMaxCp) {
        const primaryStat = CLASS_PRIMARY_STAT[charClass] || 'con';
        const primaryVal = ((cpStatRef.current as any)[primaryStat] ?? 10) + (eqB[primaryStat] || 0);
        const bRegen = getCpRegenRate(primaryVal);
        const milestoneCpFlat = getMilestoneCpRegen(cpCharRef.current.level);
        const nodeId = regenCharRef.current.current_node_id;
        const node = nodeId ? getNodeRef.current(nodeId) : null;
        const innBonus = node?.is_inn ? 1 : 0;
        const b = regenBuffRef.current;
        const inspireBonus = Date.now() < b.expiresAt ? 0.5 : 0;
        const food = foodBuffRef.current;
        const foodCpRegen = Date.now() < food.expiresAt ? food.flatRegen * 0.5 : 0;
        const totalMult = 1 + inspireBonus + innBonus;
        const combatMult = inCombatRegenRef.current ? 0.1 : 1;
        const regenAmount = (bRegen + foodCpRegen + milestoneCpFlat) * totalMult * combatMult;
        const newCp = Math.min(Math.floor(cp + regenAmount), gearAwareMaxCp);
        if (newCp > cp) {
          updates.cp = newCp;
        }
      }

      if (Object.keys(updates).length > 0) {
        updateCharRegenRef.current(updates);
      }
    }, 6000);
    return () => clearInterval(interval);
  }, []);

  // ── MP Regen (every 2s) ────────────────────────────────────
  const mpCharRef = useRef({ mp: character.mp ?? 100, max_mp: character.max_mp ?? 100, current_node_id: character.current_node_id, dex: character.dex, level: character.level });
  useEffect(() => { mpCharRef.current = { mp: character.mp ?? 100, max_mp: character.max_mp ?? 100, current_node_id: character.current_node_id, dex: character.dex, level: character.level }; }, [character.mp, character.max_mp, character.current_node_id, character.dex, character.level]);

  useEffect(() => {
    const interval = setInterval(() => {
      const { mp, current_node_id, dex, level } = mpCharRef.current;
      const dexWithGear = dex + (equippedRef.current.reduce((s, inv) => s + ((inv.item.stats as any)?.dex || 0), 0));
      const effectiveMaxMp = getMaxMp(level, dexWithGear);
      if (mp >= effectiveMaxMp) return;
      const node = current_node_id ? getNodeRef.current(current_node_id) : null;
      const innBonus = node?.is_inn ? 1 : 0;
      const regenAmount = getMpRegenRate(dexWithGear) * (1 + innBonus);
      const newMp = Math.min(mp + regenAmount, effectiveMaxMp);
      if (newMp > mp) {
        updateCharRegenRef.current({ mp: newMp });
      }
    }, 2000);
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
      const gearHpBonus = equipmentBonusesRef.current.hp || 0;
      const gearConMod = Math.floor((equipmentBonusesRef.current.con || 0) / 2);
      const effectiveMaxHp = charState.max_hp + gearHpBonus + gearConMod;
      const selfNewHp = Math.min(effectiveMaxHp, charState.hp + partyRegenBuff.healPerTick);
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
