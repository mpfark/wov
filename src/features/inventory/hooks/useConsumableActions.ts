/**
 * useConsumableActions — owns consumable item usage (potions, food).
 *
 * Intentionally tiny. Kept separate from combat and movement to maintain
 * clear domain boundaries.
 */
import { useCallback } from 'react';
import { Character } from '@/features/character';
import { logActivity } from '@/hooks/useActivityLog';
import { getEffectiveMaxHp } from '@/lib/game-data';
import type { BuffSetters } from '@/features/combat/hooks/useBuffState';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Params interface
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface UseConsumableActionsParams {
  character: Character;
  updateCharacter: (updates: Partial<Character>) => Promise<void>;
  addLog: (msg: string) => void;
  equipmentBonuses: Record<string, number>;
  useConsumable: (inventoryId: string, characterId: string, currentHp: number, maxHp: number, updateChar: (u: { hp: number }) => Promise<void>) => Promise<any>;
  buffSetters: Pick<BuffSetters, 'setFoodBuff'>;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Hook
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function useConsumableActions(params: UseConsumableActionsParams) {
  const p = params;

  const handleUseConsumable = useCallback(async (inventoryId: string) => {
    const consEffectiveMaxHp = getEffectiveMaxHp(p.character.class, p.character.con, p.character.level, p.equipmentBonuses);
    const result = await p.useConsumable(inventoryId, p.character.id, p.character.hp, consEffectiveMaxHp, p.updateCharacter);
    if (result) {
      if (result.isPotion) {
        if (result.restored > 0) p.addLog(`🧪 You used ${result.itemName} and restored ${result.restored} HP.`);
        else p.addLog(`🧪 You used ${result.itemName}. You are already at full health.`);
        logActivity(p.character.user_id, p.character.id, 'general', `Used ${result.itemName} (+${result.restored} HP)`);
      } else if (result.hpRegen > 0) {
        p.addLog(`🍞 You consumed ${result.itemName}. +${result.hpRegen} HP & CP regen for 5 minutes.`);
        logActivity(p.character.user_id, p.character.id, 'general', `Consumed ${result.itemName} (+${result.hpRegen} regen)`);
        p.buffSetters.setFoodBuff({ flatRegen: result.hpRegen, expiresAt: Date.now() + 300000 });
      }
    }
  }, [p.useConsumable, p.character.id, p.character.hp, p.character.max_hp, p.equipmentBonuses, p.updateCharacter, p.addLog, p.buffSetters]);

  return { handleUseConsumable };
}
