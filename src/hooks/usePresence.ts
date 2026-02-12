import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface PlayerPresence {
  id: string;
  name: string;
  race: string;
  class: string;
  level: number;
}

// Only show players whose last_online is within the last 2 minutes
const ONLINE_THRESHOLD_MS = 2 * 60 * 1000;

export function usePresence(nodeId: string | null) {
  const [playersHere, setPlayersHere] = useState<PlayerPresence[]>([]);

  useEffect(() => {
    if (!nodeId) { setPlayersHere([]); return; }

    const fetchPlayers = async () => {
      const cutoff = new Date(Date.now() - ONLINE_THRESHOLD_MS).toISOString();
      const { data } = await supabase
        .from('characters')
        .select('id, name, race, class, level')
        .eq('current_node_id', nodeId)
        .gte('last_online', cutoff);
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
