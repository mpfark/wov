/**
 * useConsumableActions — owns consumable item usage (potions, food).
 *
 * Intentionally tiny. Kept separate from combat and movement to maintain
 * clear domain boundaries.
 */
import { useCallback } from 'react';
import { Character } from '@/features/character';

import { getEffectiveMaxHp } from '@/lib/game-data';
import type { BuffSetters } from '@/features/combat/hooks/useBuffState';
import { buildBuffEvent, buildHealEvent, buildSystemEvent } from '@/features/combat/events/client-event-builder';
import type { GameLogEvent } from '@/features/combat/events/log-event';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Params interface
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface UseConsumableActionsParams {
  character: Character;
  updateCharacter: (updates: Partial<Character>) => Promise<void>;
  addLogEvent: (event: GameLogEvent) => void;
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
        if (result.restored > 0) p.addLogEvent(buildHealEvent(`You used ${result.itemName} and restored ${result.restored} HP.`, { amount: result.restored, amountKind: 'heal', effectType: 'potion' }));
        else p.addLogEvent(buildSystemEvent(`You used ${result.itemName}. You are already at full health.`, { effectType: 'potion' }));
        
      } else if (result.hpRegen > 0) {
        p.addLogEvent(buildBuffEvent(`You consumed ${result.itemName}. +${result.hpRegen} HP & CP regen for 5 minutes.`, { effectType: 'food' }));
        
        p.buffSetters.setFoodBuff({ flatRegen: result.hpRegen, expiresAt: Date.now() + 300000 });
      }
    }
  }, [p.useConsumable, p.character.id, p.character.hp, p.character.max_hp, p.equipmentBonuses, p.updateCharacter, p.addLogEvent, p.buffSetters]);

  return { handleUseConsumable };
}
