import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { User } from '@supabase/supabase-js';

export interface Character {
  id: string;
  user_id: string;
  name: string;
  gender: 'male' | 'female';
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
  cp: number;
  max_cp: number;
  mp: number;
  max_mp: number;
  respec_points: number;
  bhp: number;
  bhp_trained: Record<string, number>;
}

export function useCharacter(user: User | null) {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(
    () => sessionStorage.getItem('selectedCharacterId')
  );

  // Sync selectedCharacterId to sessionStorage
  useEffect(() => {
    if (selectedCharacterId) {
      sessionStorage.setItem('selectedCharacterId', selectedCharacterId);
    } else {
      sessionStorage.removeItem('selectedCharacterId');
    }
  }, [selectedCharacterId]);

  const [loading, setLoading] = useState(true);
  const prevUserIdRef = useRef<string | null>(null);

  const fetchCharactersRef = useRef(async () => {});
  fetchCharactersRef.current = async () => {
    if (!user) return;
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

  const refetchCharacters = useCallback(() => {
    fetchCharactersRef.current();
  }, []);

  // Track fields with pending DB writes so realtime doesn't revert optimistic updates
  const pendingWritesRef = useRef<Map<string, Set<string>>>(new Map());

  const selectedCharacter = characters.find(c => c.id === selectedCharacterId) ?? null;

  useEffect(() => {
    if (!user) {
      prevUserIdRef.current = null;
      setCharacters([]);
      setSelectedCharacterId(null);
      setLoading(false);
      return;
    }

    // Only reset loading + refetch when the actual user changes, not on token refreshes
    const isNewUser = prevUserIdRef.current !== user.id;
    prevUserIdRef.current = user.id;
    if (isNewUser) {
      setLoading(true);
    }

    fetchCharactersRef.current();

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
          const incoming = payload.new as Character;
          const pendingFields = pendingWritesRef.current.get(incoming.id);
          setCharacters(prev => prev.map(c => {
            if (c.id !== incoming.id) return c;
            if (!pendingFields || pendingFields.size === 0) return incoming;
            // Merge: use local optimistic value for pending fields, server value for rest
            const merged = { ...incoming };
            for (const field of pendingFields) {
              (merged as any)[field] = (c as any)[field];
            }
            return merged;
          }));
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
    // Optimistically remove from UI immediately
    setCharacters(prev => prev.filter(c => c.id !== id));
    setSelectedCharacterId(prev => prev === id ? null : prev);
    // Clean up related data first
    await supabase.from('character_inventory').delete().eq('character_id', id);
    await supabase.from('party_members').delete().eq('character_id', id);
    const { error } = await supabase.from('characters').delete().eq('id', id);
    if (error) {
      // Revert on failure — refetch
      const { data } = await supabase.from('characters').select('*').eq('user_id', user!.id).order('created_at', { ascending: true });
      if (data) setCharacters(data as Character[]);
      throw error;
    }
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
    const char = data as Character;
    setCharacters(prev => [...prev, char]);
    // Don't select yet — let the caller finish setup (e.g. granting gear) first
    return data;
  };

  const selectCharacterAfterCreate = useCallback((id: string) => {
    setSelectedCharacterId(id);
  }, []);

  const updateCharacter = async (updates: Partial<Character>) => {
    if (!selectedCharacter) return;
    const charId = selectedCharacter.id;
    const fields = Object.keys(updates);

    // Mark fields as pending so realtime won't revert them
    const pending = pendingWritesRef.current.get(charId) || new Set<string>();
    fields.forEach(f => pending.add(f));
    pendingWritesRef.current.set(charId, pending);

    setCharacters(prev => prev.map(c => c.id === charId ? { ...c, ...updates } : c));

    try {
      const { error } = await supabase
        .from('characters')
        .update(updates as any)
        .eq('id', charId);
      if (error) throw error;
    } finally {
      // Clear pending fields after write completes
      const current = pendingWritesRef.current.get(charId);
      if (current) {
        fields.forEach(f => current.delete(f));
        if (current.size === 0) pendingWritesRef.current.delete(charId);
      }
    }
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
    selectCharacterAfterCreate,
  };
}
