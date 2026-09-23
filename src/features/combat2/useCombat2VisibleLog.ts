import { useRef } from 'react';
import type { GameLogEvent } from '@/features/combat/events/log-event';
import type { Combat2PresentationModel } from './presentation';

export interface Combat2VisibleLog {
  events: readonly GameLogEvent[];
  historical: boolean;
}

function mergeLines(authoritative: readonly GameLogEvent[], local: readonly GameLogEvent[]): GameLogEvent[] {
  const lines = new Map<string, GameLogEvent>();
  for (const line of [...authoritative, ...local].sort((a, b) => a.ts - b.ts)) lines.set(line.id, line);
  return [...lines.values()].slice(-100);
}

/** Memory-only presentation evidence; it never participates in delivery cursors or batches. */
export function useCombat2VisibleLog(
  characterId: string,
  reserved: boolean,
  model: Combat2PresentationModel | null,
  acknowledgements: readonly GameLogEvent[],
): Combat2VisibleLog {
  const retained = useRef<{ key: string | null; events: readonly GameLogEvent[]; historical: boolean } | null>(null);
  const ownerCharacter = useRef(characterId);
  if (ownerCharacter.current !== characterId) {
    ownerCharacter.current = characterId;
    retained.current = null;
  }
  const validModel = model?.character.id === characterId ? model : null;
  const key = validModel ? `${characterId}:${validModel.encounterId}` : null;
  const active = !!validModel && validModel.encounterStatus === 'active';

  if (key && validModel) {
    const sameEncounter = retained.current?.key === key;
    const prior = retained.current?.events ?? [];
    const incoming = active ? mergeLines(validModel.events, acknowledgements) : validModel.events;
    retained.current = {
      key,
      events: mergeLines(prior, incoming),
      historical: ['stopped'].includes(validModel.encounterStatus)
        ? true
        : sameEncounter ? retained.current?.historical ?? false : false,
    };
  }

  if (!reserved && retained.current) retained.current.historical = false;
  if (active && retained.current?.key === key) return { events: retained.current.events, historical: false };
  if (validModel && ['ended', 'completed'].includes(validModel.encounterStatus) && retained.current?.key === key) {
    return { events: retained.current.events, historical: false };
  }
  if (retained.current) return { events: retained.current.events, historical: retained.current.historical };
  return { events: [], historical: false };
}
