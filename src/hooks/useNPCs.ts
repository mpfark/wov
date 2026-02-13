import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface NPC {
  id: string;
  name: string;
  description: string;
  dialogue: string;
  node_id: string | null;
  created_at: string;
}

export function useNPCs(nodeId: string | null) {
  const [npcs, setNPCs] = useState<NPC[]>([]);

  const fetchNPCs = useCallback(async () => {
    if (!nodeId) { setNPCs([]); return; }
    const { data } = await supabase
      .from('npcs')
      .select('*')
      .eq('node_id', nodeId);
    if (data) setNPCs(data as NPC[]);
  }, [nodeId]);

  useEffect(() => {
    fetchNPCs();
    if (!nodeId) return;

    const channel = supabase
      .channel(`npcs-${nodeId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'npcs', filter: `node_id=eq.${nodeId}` },
        () => { fetchNPCs(); }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [nodeId, fetchNPCs]);

  return { npcs };
}
