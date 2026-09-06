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
  return [...lines.values()];
}

/** Memory-only presentation evidence; it never participates in delivery cursors or batches. */
export function useCombat2VisibleLog(
  characterId: string,
  reserved: boolean,
  model: Combat2PresentationModel | null,
  acknowledgements: readonly GameLogEvent[],
): Combat2VisibleLog {
  const retained = useRef<{ key: string; events: readonly GameLogEvent[] } | null>(null);
  const ownerCharacter = useRef(characterId);
  if (ownerCharacter.current !== characterId) {
    ownerCharacter.current = characterId;
    retained.current = null;
  }
  const validModel = model?.character.id === characterId ? model : null;
  const key = validModel ? `${characterId}:${validModel.encounterId}` : null;
  const active = !!validModel && validModel.encounterStatus === 'active';

  if (key && active) retained.current = { key, events: mergeLines(validModel.events, acknowledgements) };

  if (!reserved) retained.current = null;
  if (active && retained.current?.key === key) return { events: retained.current.events, historical: false };
  if (reserved && retained.current) return { events: retained.current.events, historical: true };
  return { events: [], historical: false };
}
