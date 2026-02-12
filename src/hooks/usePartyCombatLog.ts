import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface CombatLogEntry {
  id: string;
  party_id: string;
  message: string;
  created_at: string;
}

export function usePartyCombatLog(partyId: string | null) {
  const [entries, setEntries] = useState<CombatLogEntry[]>([]);

  // Fetch existing entries
  useEffect(() => {
    if (!partyId) { setEntries([]); return; }

    const fetchEntries = async () => {
      const { data } = await supabase
        .from('party_combat_log')
        .select('*')
        .eq('party_id', partyId)
        .order('created_at', { ascending: true })
        .limit(50);
      if (data) setEntries(data as CombatLogEntry[]);
    };

    fetchEntries();

    // Subscribe to realtime inserts
    const channel = supabase
      .channel(`party-combat-log-${partyId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'party_combat_log',
        filter: `party_id=eq.${partyId}`,
      }, (payload) => {
        setEntries(prev => [...prev.slice(-49), payload.new as CombatLogEntry]);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [partyId]);

  const addPartyCombatLog = useCallback(async (message: string): Promise<string | null> => {
    if (!partyId) return null;
    const { data } = await supabase.from('party_combat_log').insert({ party_id: partyId, message }).select('id').single();
    return data?.id ?? null;
  }, [partyId]);

  return { entries, addPartyCombatLog };
}
