import { useCallback, useMemo } from 'react';
import type { Character } from '@/features/character';
import { progressionClient } from '../progression-command';
import { buildErrorEvent, buildProgressionEvent } from '@/features/combat/events/client-event-builder';
import type { GameLogEvent } from '@/features/combat/events/log-event';
interface UseStatAllocationArgs {
  character: Character;
  addLogEvent: (event: GameLogEvent) => void;
  onResourcesSynced?: () => unknown;
}
export function useStatAllocation({ character, addLogEvent, onResourcesSynced }: UseStatAllocationArgs) {
  const client = useMemo(() => progressionClient(character.id), [character.id]);
  const handleBatchAllocateStats = useCallback(async (allocations: Record<string, number>): Promise<boolean> => {
    try {
      const result = await client.execute({ allocations });
      if (result.kind === 'refused') {
        await onResourcesSynced?.();
        addLogEvent(buildErrorEvent(`Allocation refused: ${result.reason ?? 'unavailable'}.`));
        return false;
      }
      addLogEvent(buildProgressionEvent('Stat allocation confirmed.', { effectType: 'stat_point' }));
      try { await onResourcesSynced?.(); }
      catch { addLogEvent(buildErrorEvent('Allocation committed. Refresh character data before making another allocation.')); }
      return true;
    } catch (error) {
      addLogEvent(buildErrorEvent(error instanceof Error ? error.message : 'Allocation unavailable.'));
      return false;
    }
  }, [client, addLogEvent, onResourcesSynced]);
  const handleFullRespec = useCallback(() => {
    addLogEvent(buildErrorEvent('Respec is unavailable until safe refunds are enabled.'));
  }, [addLogEvent]);
  return { handleBatchAllocateStats, handleFullRespec };
}
