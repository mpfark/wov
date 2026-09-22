import type { Combat2PresentationModel } from './presentation';

export interface Combat2ActionReadinessInput {
  inputLocked: boolean;
  encounterId: string | null;
  presentationStatus: string;
  model: Pick<Combat2PresentationModel, 'encounterStatus' | 'fighterExitState' | 'fighterPresent'> | null;
  dead: boolean;
  pendingFlee: boolean;
  fighter: Record<string, unknown> | null;
  characterId: string | null;
}

/** A healthy refresh may use the last accepted model; unsafe delivery states remain fail-closed. */
export function deriveCombat2ActionReadiness(input: Combat2ActionReadinessInput): boolean {
  const deliveryReady = input.presentationStatus === 'live'
    || (input.presentationStatus === 'syncing' && input.model !== null);
  return !!(!input.inputLocked && input.encounterId && deliveryReady
    && !!input.model && !input.dead && !input.pendingFlee && input.model.encounterStatus === 'active'
    && input.model.fighterPresent
    && input.fighter?.present === true && input.fighter.characterId === input.characterId
    && typeof input.fighter.entrySeq === 'number' && Number.isSafeInteger(input.fighter.entrySeq)
    && typeof input.fighter.id === 'string' && input.fighter.id && input.model.fighterExitState === null);
}

export function combat2DeliveryPreservesPending(status: string): boolean {
  return status === 'live' || status === 'syncing';
}

export function combat2AbilityControlDisabled(input: {
  actionsReady: boolean;
  levelLocked: boolean;
  insufficientCp: boolean;
  dead: boolean;
  invalidTarget: boolean;
}): boolean {
  return !input.actionsReady || input.levelLocked || input.insufficientCp || input.dead || input.invalidTarget;
}
