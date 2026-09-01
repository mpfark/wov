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
): Combat2PresentationState {
  const retained = useRef<{ key: string | null; model: Combat2PresentationModel | null }>({ key: null, model: null });
  if (retained.current.key !== sessionKey) retained.current = { key: sessionKey, model: null };

  let localError: string | null = null;
  if (sessionKey && delivery.snapshot) {
    try {
      const candidate = buildCombat2Presentation(delivery);
      const [characterId, , encounterId] = sessionKey.split(':');
      if (candidate.character.id !== characterId || candidate.encounterId !== encounterId) {
        throw new Error('combat2_sync identity does not match the active session');
      }
      retained.current.model = candidate;
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
