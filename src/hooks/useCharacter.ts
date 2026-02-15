import { useState, useEffect, useCallback } from 'react';
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
  unspent_stat_points: number;
}

export function useCharacter(user: User | null) {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const selectedCharacter = characters.find(c => c.id === selectedCharacterId) ?? null;

  useEffect(() => {
    if (!user) {
      setCharacters([]);
      setSelectedCharacterId(null);
      setLoading(false);
      return;
    }

    const fetchCharacters = async () => {
      const { data, error } = await supabase
        .from('characters')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true });

      if (!error && data) {
        setCharacters(data as Character[]);
      }
      setLoading(false);
    };

    fetchCharacters();

    const channel = supabase
      .channel('my-characters')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'characters',
        filter: `user_id=eq.${user.id}`,
      }, (payload) => {
        if (payload.eventType === 'DELETE') {
          const deletedId = (payload.old as any).id;
          setCharacters(prev => prev.filter(c => c.id !== deletedId));
          setSelectedCharacterId(prev => prev === deletedId ? null : prev);
        } else if (payload.eventType === 'INSERT') {
          setCharacters(prev => [...prev, payload.new as Character]);
        } else {
          setCharacters(prev => prev.map(c => c.id === (payload.new as any).id ? payload.new as Character : c));
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user]);

  const selectCharacter = useCallback((id: string) => {
    setSelectedCharacterId(id);
  }, []);

  const clearSelectedCharacter = useCallback(() => {
    setSelectedCharacterId(null);
  }, []);

  const deleteCharacter = useCallback(async (id: string) => {
    // Clean up related data first
    await supabase.from('character_inventory').delete().eq('character_id', id);
    await supabase.from('party_members').delete().eq('character_id', id);
    const { error } = await supabase.from('characters').delete().eq('id', id);
    if (error) {
      throw error;
    }
  }, []);

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
    const char = data as Character;
    setCharacters(prev => [...prev, char]);
    setSelectedCharacterId(char.id);
    return data;
  };

  const updateCharacter = async (updates: Partial<Character>) => {
    if (!selectedCharacter) return;
    setCharacters(prev => prev.map(c => c.id === selectedCharacter.id ? { ...c, ...updates } : c));
    const { error } = await supabase
      .from('characters')
      .update(updates as any)
      .eq('id', selectedCharacter.id);
    if (error) throw error;
  };

  return {
    characters,
    character: selectedCharacter,
    loading,
    selectCharacter,
    clearSelectedCharacter,
    deleteCharacter,
    createCharacter,
    updateCharacter,
  };
}
