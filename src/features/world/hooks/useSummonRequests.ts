import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface SummonRequest {
  id: string;
  summoner_id: string;
  target_id: string;
  summoner_node_id: string;
  cp_cost: number;
  status: string;
  created_at: string;
  expires_at: string;
  summoner_name?: string;
}

export function useSummonRequests(characterId: string | null) {
  const [pendingSummons, setPendingSummons] = useState<SummonRequest[]>([]);

  const fetchPending = useCallback(async () => {
    if (!characterId) return;
    const { data } = await supabase
      .from('summon_requests')
      .select('*')
      .eq('target_id', characterId)
      .eq('status', 'pending')
      .gt('expires_at', new Date().toISOString());

    if (data && data.length > 0) {
      // Fetch summoner names
      const enriched: SummonRequest[] = [];
      for (const req of data) {
        const { data: name } = await supabase.rpc('get_character_name', { _character_id: req.summoner_id });
        enriched.push({ ...req, summoner_name: (name as string) || 'Unknown' });
      }
      setPendingSummons(enriched);
    } else {
      setPendingSummons([]);
    }
  }, [characterId]);

  useEffect(() => {
    fetchPending();
    if (!characterId) return;

    const channel = supabase
      .channel(`summon-requests-${characterId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'summon_requests',
        filter: `target_id=eq.${characterId}`,
      }, () => fetchPending())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [characterId, fetchPending]);

  // Auto-remove expired requests
  useEffect(() => {
    if (pendingSummons.length === 0) return;
    const timer = setInterval(() => {
      const now = new Date();
      setPendingSummons(prev => prev.filter(r => new Date(r.expires_at) > now));
    }, 5000);
    return () => clearInterval(timer);
  }, [pendingSummons.length]);

  const acceptSummon = useCallback(async (requestId: string) => {
    const { error } = await supabase.rpc('accept_summon', { _request_id: requestId });
    if (error) return error.message;
    setPendingSummons(prev => prev.filter(r => r.id !== requestId));
    return null;
  }, []);

  const declineSummon = useCallback(async (requestId: string) => {
    const { error } = await supabase.rpc('decline_summon', { _request_id: requestId });
    if (error) return error.message;
    setPendingSummons(prev => prev.filter(r => r.id !== requestId));
    return null;
  }, []);

  return { pendingSummons, acceptSummon, declineSummon };
}
