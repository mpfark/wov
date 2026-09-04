import { useRef } from 'react';
import type { Combat2DeliverySessionState } from './useCombat2DeliverySession';
import {
  buildCombat2Presentation,
  type Combat2PresentationModel,
  type Combat2PresentationState,
} from './presentation';

/** Retains the last valid model for one entry lifecycle; never mixes session keys. */
export function useCombat2Presentation(
  sessionKey: string | null,
  delivery: Combat2DeliverySessionState,
  classKey?: string,
): Combat2PresentationState {
  const retained = useRef<{ key: string | null; model: Combat2PresentationModel | null }>({ key: null, model: null });
  if (retained.current.key !== sessionKey) retained.current = { key: sessionKey, model: null };

  let localError: string | null = null;
  if (sessionKey && delivery.snapshot) {
    try {
      const candidate = buildCombat2Presentation(delivery, classKey);
      const [characterId, , encounterId] = sessionKey.split(':');
      if (candidate.character.id !== characterId || candidate.encounterId !== encounterId) {
        throw new Error('combat2_sync identity does not match the active session');
      }
      const previous = retained.current.model;
      // A terminal death is never undone by a delayed snapshot for this entry.
      if (!previous || (candidate.lastAppliedTick >= previous.lastAppliedTick
        && !((previous.character.hp <= 0 || previous.fighterExitState === 'dead')
          && candidate.character.hp > 0 && candidate.fighterExitState !== 'dead'))) {
        retained.current.model = candidate;
      }
    } catch (error) {
      localError = error instanceof Error ? error.message : 'Combat2 presentation failed';
    }
  }

  return {
    status: localError ? 'error' : delivery.status,
    model: retained.current.model,
    error: localError ?? delivery.error,
  };
}
