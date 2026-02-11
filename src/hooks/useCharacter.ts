import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { User } from '@supabase/supabase-js';

export interface Character {
  id: string;
  user_id: string;
  name: string;
  race: string;
  class: string;
  level: number;
  xp: number;
  hp: number;
  max_hp: number;
  gold: number;
  str: number;
  dex: number;
  con: number;
  int: number;
  wis: number;
  cha: number;
  ac: number;
  current_node_id: string | null;
}

export function useCharacter(user: User | null) {
  const [character, setCharacter] = useState<Character | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setCharacter(null);
      setLoading(false);
      return;
    }

    const fetchCharacter = async () => {
      const { data, error } = await supabase
        .from('characters')
        .select('*')
        .eq('user_id', user.id)
        .limit(1)
        .maybeSingle();

      if (!error && data) {
        setCharacter(data as Character);
      }
      setLoading(false);
    };

    fetchCharacter();

    // Subscribe to realtime changes on own character
    const channel = supabase
      .channel('my-character')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'characters',
        filter: `user_id=eq.${user.id}`,
      }, (payload) => {
        if (payload.eventType === 'DELETE') {
          setCharacter(null);
        } else {
          setCharacter(payload.new as Character);
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user]);

  const createCharacter = async (charData: {
    name: string; race: string; class: string;
    str: number; dex: number; con: number; int: number; wis: number; cha: number;
    hp: number; max_hp: number; ac: number; current_node_id: string;
  }) => {
    if (!user) return null;
    const { data, error } = await supabase
      .from('characters')
      .insert({
        name: charData.name,
        race: charData.race as any,
        class: charData.class as any,
        str: charData.str, dex: charData.dex, con: charData.con,
        int: charData.int, wis: charData.wis, cha: charData.cha,
        hp: charData.hp, max_hp: charData.max_hp, ac: charData.ac,
        current_node_id: charData.current_node_id,
        user_id: user.id,
      })
      .select()
      .single();
    if (error) throw error;
    setCharacter(data as Character);
    return data;
  };

  const updateCharacter = async (updates: Partial<Character>) => {
    if (!character) return;
    const { error } = await supabase
      .from('characters')
      .update(updates as any)
      .eq('id', character.id);
    if (error) throw error;
  };

  return { character, loading, createCharacter, updateCharacter };
}
