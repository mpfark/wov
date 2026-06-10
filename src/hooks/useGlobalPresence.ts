import { useState, useEffect, useMemo, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface OnlinePlayer {
  id: string;
  name: string;
  family_name?: string | null;
  race: string;
  class: string;
  level: number;
  gender: 'male' | 'female';
  /** True while the player holds the King/Queen title (Aldric killing blow). */
  is_king_slayer?: boolean;
}

interface PresenceCharacter {
  id: string;
  name: string;
  family_name?: string | null;
  race: string;
  class: string;
  level: number;
  gender: 'male' | 'female';
  is_king_slayer?: boolean;
}

export function useGlobalPresence(character?: PresenceCharacter | null) {
  const [onlinePlayers, setOnlinePlayers] = useState<OnlinePlayer[]>([]);

  const charData = useMemo(() => {
    if (!character) return null;
    return { id: character.id, name: character.name, family_name: character.family_name ?? null, race: character.race, class: character.class, level: character.level, gender: character.gender, is_king_slayer: !!character.is_king_slayer };
  }, [character?.id, character?.name, character?.family_name, character?.race, character?.class, character?.level, character?.gender, character?.is_king_slayer]);

  // Keep a ref to the latest charData for the heartbeat interval
  const charDataRef = useRef(charData);
  useEffect(() => { charDataRef.current = charData; }, [charData]);

  useEffect(() => {
    if (!charData) { setOnlinePlayers([]); return; }

    const channel = supabase.channel('global-presence', {
      config: { presence: { key: charData.id } },
    });

    const trackPresence = async () => {
      const data = charDataRef.current;
      if (!data) return;
      try {
        await channel.track({
          id: data.id,
          name: data.name,
          family_name: data.family_name,
          race: data.race,
          class: data.class,
          level: data.level,
          gender: data.gender,
          is_king_slayer: data.is_king_slayer,
        });
      } catch (e) {
        console.warn('[global-presence] track failed, will retry', e);
      }
    };

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        const players: OnlinePlayer[] = [];
        for (const [, presences] of Object.entries(state)) {
          const p = (presences as any[])[0];
          if (p?.id && p?.name) {
            players.push({ id: p.id, name: p.name, race: p.race, class: p.class, level: p.level, gender: p.gender || 'male', is_king_slayer: !!p.is_king_slayer });
          }
        }
        players.sort((a, b) => b.level - a.level || a.name.localeCompare(b.name));
        setOnlinePlayers(players);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await trackPresence();
        }
      });

    // Heartbeat: re-track every 30s to survive brief disconnects
    const heartbeat = setInterval(trackPresence, 30_000);

    return () => {
      clearInterval(heartbeat);
      supabase.removeChannel(channel);
    };
  }, [charData]);

  return { onlinePlayers };
}
