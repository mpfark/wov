import { useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export function usePartyCombatLog(partyId: string | null) {
  // No realtime subscription — combat log entries arrive via party broadcast channel.
  // This hook only provides the insert helper.

  const addPartyCombatLog = useCallback(async (message: string, nodeId?: string | null, characterName?: string | null): Promise<string | null> => {
    if (!partyId) return null;
    const { data } = await supabase.from('party_combat_log').insert({ party_id: partyId, message, node_id: nodeId ?? null, character_name: characterName ?? null } as any).select('id').single();
    return data?.id ?? null;
  }, [partyId]);

  return { addPartyCombatLog };
}
