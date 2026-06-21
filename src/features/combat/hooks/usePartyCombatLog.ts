import { useCallback } from 'react';
import { enqueuePartyCombatLog } from './partyCombatLogBatcher';

export function usePartyCombatLog(partyId: string | null) {
  // No realtime subscription — combat log entries arrive via party broadcast channel.
  // This hook only provides the insert helper.
  //
  // Insert is batched (250 ms / 20 rows) via partyCombatLogBatcher. The id is
  // generated client-side so callers can use it immediately for ownLogIdsRef
  // dedup without waiting for the DB round-trip.

  const addPartyCombatLog = useCallback(async (
    message: string,
    nodeId?: string | null,
    characterName?: string | null,
  ): Promise<string | null> => {
    if (!partyId) return null;
    return enqueuePartyCombatLog(partyId, message, nodeId ?? null, characterName ?? null);
  }, [partyId]);

  return { addPartyCombatLog };
}
