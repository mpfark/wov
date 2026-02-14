import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface PlayerPresence {
  id: string;
  name: string;
  race: string;
  class: string;
  level: number;
}

interface PresenceCharacter {
  id: string;
  name: string;
  race: string;
  class: string;
  level: number;
}

export function usePresence(nodeId: string | null, character?: PresenceCharacter | null) {
  const [playersHere, setPlayersHere] = useState<PlayerPresence[]>([]);

  // Memoize character data to avoid unnecessary re-subscriptions
  const charData = useMemo(() => {
    if (!character) return null;
    return { id: character.id, name: character.name, race: character.race, class: character.class, level: character.level };
  }, [character?.id, character?.name, character?.race, character?.class, character?.level]);

  useEffect(() => {
    if (!nodeId || !charData) { setPlayersHere([]); return; }

    const channel = supabase.channel(`presence-node-${nodeId}`, {
      config: { presence: { key: charData.id } },
    });

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        const players: PlayerPresence[] = [];
        for (const [key, presences] of Object.entries(state)) {
          if (key === charData.id) continue; // exclude self
          const p = (presences as any[])[0];
          if (p?.id && p?.name) {
            players.push({ id: p.id, name: p.name, race: p.race, class: p.class, level: p.level });
          }
        }
        setPlayersHere(players);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({
            id: charData.id,
            name: charData.name,
            race: charData.race,
            class: charData.class,
            level: charData.level,
          });
        }
      });

    return () => { supabase.removeChannel(channel); };
  }, [nodeId, charData]);

  return { playersHere };
}
