import { useRef } from 'react';
import type { Combat2PresentationModel } from './presentation';

/** Bridge combat release to a fresh character read; never fall back to a pre-release row. */
export function useCombat2ResourceHandoff(input: {
  enabled: boolean; characterId: string; nodeId: string | null;
  sessionStatus: 'active' | 'exited' | 'idle'; model: Combat2PresentationModel | null;
  readStartedAt?: number | null;
}): Combat2PresentationModel | null {
  const retained = useRef<{ scope: string; model: Combat2PresentationModel | null; releasedAt: number | null; activeSeen: boolean }>({ scope: '', model: null, releasedAt: null, activeSeen: false });
  const scope = JSON.stringify([input.characterId,input.nodeId]);
  if (!input.enabled || retained.current.scope !== scope) retained.current = { scope,model: null,releasedAt: null,activeSeen: false };
  if (!input.enabled) return null;
  if (input.sessionStatus === 'active') {
    retained.current.activeSeen = true;
    retained.current.model = input.model?.character.id === input.characterId ? input.model : null;
    retained.current.releasedAt = null;
    return retained.current.model;
  }
  if (!retained.current.model && retained.current.activeSeen && input.model?.character.id === input.characterId) retained.current.model = input.model;
  if (!retained.current.model) return null;
  // The latest snapshot may have delivered death/release in this very render.
  if (input.model?.character.id === input.characterId
      && input.model.encounterId === retained.current.model.encounterId
      && input.model.lastAppliedTick >= retained.current.model.lastAppliedTick) retained.current.model = input.model;
  retained.current.releasedAt ??= Date.now();
  if (input.readStartedAt != null && input.readStartedAt > retained.current.releasedAt) {
    retained.current.model = null;
    retained.current.activeSeen = false;
    return null;
  }
  return retained.current.model;
}
