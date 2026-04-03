/**
 * Owns: stat point allocation, full respec, and batch allocation logic.
 */
import { useCallback } from 'react';
import { Character } from '@/features/character';
import { getStatModifier, getMaxCp, getMaxMp, calculateStats, CLASS_LEVEL_BONUSES, calculateHP } from '@/lib/game-data';

interface UseStatAllocationArgs {
  character: Character;
  updateCharacter: (updates: Partial<Character>) => Promise<void>;
  addLog: (msg: string) => void;
}

export function useStatAllocation({ character, updateCharacter, addLog }: UseStatAllocationArgs) {
  const handleAllocateStat = useCallback(async (stat: string) => {
    if (character.unspent_stat_points <= 0) return;
    const currentVal = (character as any)[stat] ?? 10;
    const updates: Partial<Character> = {
      [stat]: currentVal + 1,
      unspent_stat_points: character.unspent_stat_points - 1,
    };
    if (stat === 'con') {
      updates.max_hp = character.max_hp + (getStatModifier(currentVal + 1) - getStatModifier(currentVal));
      if (updates.max_hp !== character.max_hp) {
        updates.hp = character.hp + (updates.max_hp! - character.max_hp);
      }
    }
    if (stat === 'int' || stat === 'wis' || stat === 'cha') {
      const eInt = stat === 'int' ? currentVal + 1 : character.int;
      const eWis = stat === 'wis' ? currentVal + 1 : character.wis;
      const eCha = stat === 'cha' ? currentVal + 1 : character.cha;
      const newMaxCp = getMaxCp(character.level, eInt, eWis, eCha);
      if (newMaxCp !== character.max_cp) {
        updates.max_cp = newMaxCp;
        updates.cp = Math.min((character.cp ?? 0) + (newMaxCp - character.max_cp), newMaxCp);
      }
    }
    if (stat === 'dex') {
      const newMaxMp = getMaxMp(character.level, currentVal + 1);
      if (newMaxMp !== (character.max_mp ?? 100)) {
        updates.max_mp = newMaxMp;
        updates.mp = Math.min((character.mp ?? 100) + (newMaxMp - (character.max_mp ?? 100)), newMaxMp);
      }
    }
    await updateCharacter(updates);
    addLog(`📊 +1 ${stat.toUpperCase()}! (${character.unspent_stat_points - 1} points remaining)`);
  }, [character, updateCharacter, addLog]);

  const handleFullRespec = useCallback(async () => {
    if ((character.respec_points || 0) <= 0) return;
    const creationStats = calculateStats(character.race, character.class);
    const levelBonuses = CLASS_LEVEL_BONUSES[character.class] || {};
    let totalRefunded = 0;
    const updates: Partial<Character> = {
      respec_points: (character.respec_points || 0) - 1,
    };
    for (const stat of ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const) {
      const levelBonusTotal = Math.floor((character.level - 1) / 3) * (levelBonuses[stat] || 0);
      const nonManualBase = (creationStats[stat] || 8) + levelBonusTotal;
      const manualPoints = (character as any)[stat] - nonManualBase;
      if (manualPoints > 0) {
        (updates as any)[stat] = nonManualBase;
        totalRefunded += manualPoints;
      }
    }
    updates.unspent_stat_points = character.unspent_stat_points + totalRefunded;
    const newCon = (updates.con ?? character.con) as number;
    const newMaxHp = calculateHP(character.class, newCon) + (character.level - 1) * 5;
    updates.max_hp = newMaxHp;
    updates.hp = Math.min(character.hp, newMaxHp);
    const newInt = (updates.int ?? character.int) as number;
    const newWis = (updates.wis ?? character.wis) as number;
    const newCha = (updates.cha ?? character.cha) as number;
    updates.max_cp = getMaxCp(character.level, newInt, newWis, newCha);
    updates.cp = Math.min(character.cp ?? 0, updates.max_cp);
    const newDex = (updates.dex ?? character.dex) as number;
    updates.max_mp = getMaxMp(character.level, newDex);
    updates.mp = Math.min(character.mp ?? 100, updates.max_mp);
    await updateCharacter(updates);
    addLog(`🔄 Full respec! ${totalRefunded} stat point${totalRefunded !== 1 ? 's' : ''} refunded.`);
  }, [character, updateCharacter, addLog]);

  const handleBatchAllocateStats = useCallback(async (allocations: Record<string, number>) => {
    const totalPoints = Object.values(allocations).reduce((s, v) => s + v, 0);
    if (totalPoints <= 0 || totalPoints > character.unspent_stat_points) return;
    const updates: Partial<Character> = {
      unspent_stat_points: character.unspent_stat_points - totalPoints,
    };
    for (const [stat, amount] of Object.entries(allocations)) {
      const currentVal = (character as any)[stat] ?? 10;
      (updates as any)[stat] = currentVal + amount;
    }
    const newCon = (updates.con ?? character.con) as number;
    const oldConMod = getStatModifier(character.con);
    const newConMod = getStatModifier(newCon);
    if (newConMod !== oldConMod) {
      const hpDelta = newConMod - oldConMod;
      updates.max_hp = character.max_hp + hpDelta;
      updates.hp = character.hp + hpDelta;
    }
    const newInt = (updates.int ?? character.int) as number;
    const newWis = (updates.wis ?? character.wis) as number;
    const newCha = (updates.cha ?? character.cha) as number;
    const newMaxCp = getMaxCp(character.level, newInt, newWis, newCha);
    if (newMaxCp !== character.max_cp) {
      updates.max_cp = newMaxCp;
      updates.cp = Math.min((character.cp ?? 0) + (newMaxCp - character.max_cp), newMaxCp);
    }
    const newDex = (updates.dex ?? character.dex) as number;
    const newMaxMp = getMaxMp(character.level, newDex);
    if (newMaxMp !== (character.max_mp ?? 100)) {
      updates.max_mp = newMaxMp;
      updates.mp = Math.min((character.mp ?? 100) + (newMaxMp - (character.max_mp ?? 100)), newMaxMp);
    }
    await updateCharacter(updates);
    const statList = Object.entries(allocations).map(([s, v]) => `+${v} ${s.toUpperCase()}`).join(', ');
    addLog(`📊 Batch allocation: ${statList} (${character.unspent_stat_points - totalPoints} points remaining)`);
  }, [character, updateCharacter, addLog]);

  return { handleAllocateStat, handleFullRespec, handleBatchAllocateStats };
}
