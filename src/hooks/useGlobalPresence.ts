import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface OnlinePlayer {
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

export function useGlobalPresence(character?: PresenceCharacter | null) {
  const [onlinePlayers, setOnlinePlayers] = useState<OnlinePlayer[]>([]);

  const charData = useMemo(() => {
    if (!character) return null;
    return { id: character.id, name: character.name, race: character.race, class: character.class, level: character.level };
  }, [character?.id, character?.name, character?.race, character?.class, character?.level]);

  useEffect(() => {
    if (!charData) { setOnlinePlayers([]); return; }

    const channel = supabase.channel('global-presence', {
      config: { presence: { key: charData.id } },
    });

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        const players: OnlinePlayer[] = [];
        for (const [, presences] of Object.entries(state)) {
          const p = (presences as any[])[0];
          if (p?.id && p?.name) {
            players.push({ id: p.id, name: p.name, race: p.race, class: p.class, level: p.level });
          }
        }
        players.sort((a, b) => b.level - a.level || a.name.localeCompare(b.name));
        setOnlinePlayers(players);
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
  }, [charData]);

  return { onlinePlayers };
}
