/**
 * Owns: stat point allocation, full respec, and batch allocation logic.
 *
 * IMPORTANT — max stat persistence:
 *   We do NOT write max_hp / max_cp / max_mp from this hook. Those columns
 *   are protected by the `restrict_party_leader_updates` DB trigger which
 *   silently discards client writes. The single source of truth for persisted
 *   gear-adjusted maxima is the `sync_character_resources` RPC, which we call
 *   after the stat write so the realtime subscription in `useCharacter` picks
 *   up the new values.
 */
import { useCallback } from 'react';
import { Character } from '@/features/character';
import { calculateStats, CLASS_LEVEL_BONUSES } from '@/lib/game-data';
import { supabase } from '@/integrations/supabase/client';

interface UseStatAllocationArgs {
  character: Character;
  updateCharacter: (updates: Partial<Character>) => Promise<void>;
  addLog: (msg: string) => void;
}

async function syncResources(characterId: string) {
  try {
    await supabase.rpc('sync_character_resources' as any, { p_character_id: characterId });
  } catch (e) {
    console.error('Failed to sync character resources after stat change:', e);
  }
}

export function useStatAllocation({ character, updateCharacter, addLog }: UseStatAllocationArgs) {
  const handleAllocateStat = useCallback(async (stat: string) => {
    if (character.unspent_stat_points <= 0) return;
    const currentVal = (character as any)[stat] ?? 10;
    const updates: Partial<Character> = {
      [stat]: currentVal + 1,
      unspent_stat_points: character.unspent_stat_points - 1,
    };
    await updateCharacter(updates);
    await syncResources(character.id);
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
    await updateCharacter(updates);
    await syncResources(character.id);
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
    await updateCharacter(updates);
    await syncResources(character.id);
    const statList = Object.entries(allocations).map(([s, v]) => `+${v} ${s.toUpperCase()}`).join(', ');
    addLog(`📊 Batch allocation: ${statList} (${character.unspent_stat_points - totalPoints} points remaining)`);
  }, [character, updateCharacter, addLog]);

  return { handleAllocateStat, handleFullRespec, handleBatchAllocateStats };
}
