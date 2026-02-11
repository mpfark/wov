import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface PlayerPresence {
  id: string;
  name: string;
  race: string;
  class: string;
  level: number;
}

export function usePresence(nodeId: string | null) {
  const [playersHere, setPlayersHere] = useState<PlayerPresence[]>([]);

  useEffect(() => {
    if (!nodeId) { setPlayersHere([]); return; }

    const fetchPlayers = async () => {
      const { data } = await supabase
        .from('characters')
        .select('id, name, race, class, level')
        .eq('current_node_id', nodeId);
      if (data) setPlayersHere(data as PlayerPresence[]);
    };

    fetchPlayers();

    const channel = supabase
      .channel(`node-presence-${nodeId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'characters',
      }, () => {
        fetchPlayers();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [nodeId]);

  return { playersHere };
}
