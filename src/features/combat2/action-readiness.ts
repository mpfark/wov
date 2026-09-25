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

export type ActionDisabledReason =
  | 'no_authoritative_snapshot'
  | 'delivery_unavailable'
  | 'movement_pending'
  | 'incapacitated'
  | 'requires_active_combat'
  | 'invalid_target'
  | 'action_in_flight'
  | 'insufficient_spendable_cp'
  | 'level_locked';

export type ActionReadiness =
  | { ready: true }
  | { ready: false; reason: ActionDisabledReason; message: string };

const ready = (): ActionReadiness => ({ ready: true });
const blocked = (reason: ActionDisabledReason, message: string): ActionReadiness => ({ ready: false, reason, message });

/** A healthy refresh may use the last accepted model; unsafe delivery states remain fail-closed. */
export function deriveCombat2ActionReadiness(input: Combat2ActionReadinessInput): ActionReadiness {
  const deliveryReady = input.presentationStatus === 'live'
    || (input.presentationStatus === 'syncing' && input.model !== null);
  // Precedence is deliberate: irreversible local safety gates first, then
  // delivery certainty, then authoritative ownership identity.
  if (input.dead) return blocked('incapacitated', 'You cannot act while incapacitated');
  if (input.pendingFlee) return blocked('movement_pending', 'Movement is pending');
  if (!deliveryReady && !['live', 'syncing'].includes(input.presentationStatus)) {
    return blocked('delivery_unavailable', 'Waiting for authoritative state');
  }
  if (!input.model) return blocked('no_authoritative_snapshot', 'Waiting for authoritative state');
  const ownsActiveCombat = !input.inputLocked && !!input.encounterId
    && input.model.encounterStatus === 'active' && input.model.fighterPresent
    && input.fighter?.present === true && input.fighter.characterId === input.characterId
    && typeof input.fighter.entrySeq === 'number' && Number.isSafeInteger(input.fighter.entrySeq)
    && typeof input.fighter.id === 'string' && !!input.fighter.id && input.model.fighterExitState === null;
  return ownsActiveCombat ? ready() : blocked('requires_active_combat', 'Requires active combat');
}

export function combat2DeliveryPreservesPending(status: string): boolean {
  return status === 'live' || status === 'syncing';
}

export function deriveCombat2AbilityReadiness(input: {
  session: ActionReadiness;
  levelLocked: boolean;
  levelRequired: number;
  inFlight: boolean;
  targetValid: boolean;
  stanceActive: boolean;
  requiredCp: number;
  availableCp: number;
}): ActionReadiness {
  if (!input.session.ready) return input.session;
  if (input.levelLocked) return blocked('level_locked', `Unlocks at level ${input.levelRequired}`);
  if (input.inFlight) return blocked('action_in_flight', 'Action already queued');
  if (!input.targetValid) return blocked('invalid_target', 'Select a valid target');
  if (!input.stanceActive && input.availableCp < input.requiredCp) {
    return blocked('insufficient_spendable_cp', `Requires ${input.requiredCp} CP — ${input.availableCp} available`);
  }
  return ready();
}
