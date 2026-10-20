import type { Combat2PresentationModel, Combat2PresentationState } from '@/features/combat2/presentation';

/** UI guard only; the inventory RPC and database fences retain authority. */
export function equipmentChangeReason(input: {
  legacyCombat: boolean; combat2Enabled: boolean; transitioning: boolean;
  sessionStatus: 'active' | 'exited' | 'idle'; deliveryStatus: Combat2PresentationState['status'];
  model: Combat2PresentationModel | null;
}): string | null {
  if (!input.combat2Enabled) return input.legacyCombat ? 'You cannot change equipment during combat.' : null;
  if (input.transitioning) return 'Finish movement before changing equipment.';
  if (input.sessionStatus !== 'active') return null;
  const model = input.model;
  if (!model || input.deliveryStatus !== 'live') return 'Wait for combat synchronization before changing equipment.';
  if (model.fighterExitState === 'pending') return 'Finish leaving combat before changing equipment.';
  if (model.fighterPresent && model.encounterStatus === 'active'
    && (model.autoattack?.active || model.creatures.some(c => c.isAlive && c.hp > 0 && c.engaged)))
    return 'You cannot change equipment during combat.';
  return null;
}
