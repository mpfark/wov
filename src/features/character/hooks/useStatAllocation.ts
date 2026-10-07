import { useCallback, useMemo } from 'react';
import type { Character } from '@/features/character';
import { progressionClient } from '../progression-command';
import { progressionRefusal } from '../progression-messages';
import type { ProgressionStat } from '../../../../supabase/functions/_shared/progression-command';
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
  const executeTraining = useCallback(async (action: { operation: 'respec' } | { operation: 'renown'; stat: ProgressionStat }) => {
    try {
      const result = await client.execute(action);
      if (result.kind === 'refused') { addLogEvent(buildErrorEvent(progressionRefusal(result.reason))); await onResourcesSynced?.(); return false; }
      const receipt = result.kind === 'replayed' ? result.original : result.receipt;
      const message = action.operation === 'respec' ? `Respec confirmed: ${receipt?.totalRefund ?? 'proven'} points refunded.`
        : `Renown training ${receipt?.outcome ?? 'confirmed'}: ${receipt?.cost ?? 'the recorded cost'} RP spent.`;
      addLogEvent(buildProgressionEvent(message, { effectType: 'stat_point' }));
      try { await onResourcesSynced?.(); } catch { addLogEvent(buildErrorEvent('Training committed. Refresh character data before another command.')); }
      return true;
    } catch (error) { addLogEvent(buildErrorEvent(error instanceof Error ? error.message : 'Training outcome is uncertain. Retry the same command.')); return false; }
  }, [client, addLogEvent, onResourcesSynced]);
  const handleFullRespec = useCallback(() => executeTraining({ operation: 'respec' }), [executeTraining]);
  const handleRenown = useCallback((stat: ProgressionStat) => executeTraining({ operation: 'renown', stat }), [executeTraining]);
  return { handleBatchAllocateStats, handleFullRespec, handleRenown };
}
