import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface XpBoost {
  multiplier: number;
  expires_at: string | null;
}

export function useXpBoost() {
  const [boost, setBoost] = useState<XpBoost>({ multiplier: 1, expires_at: null });

  useEffect(() => {
    // Fetch initial boost state
    const fetchBoost = async () => {
      const { data } = await supabase
        .from('xp_boost')
        .select('multiplier, expires_at')
        .limit(1)
        .single();
      if (data) setBoost(data);
    };
    fetchBoost();

    // Subscribe to realtime changes
    const channel = supabase
      .channel('xp-boost-changes')
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'xp_boost',
      }, (payload) => {
        const row = payload.new as any;
        setBoost({ multiplier: row.multiplier, expires_at: row.expires_at });
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  // Calculate effective multiplier (check if expired)
  const now = Date.now();
  const isActive = boost.multiplier > 1 && boost.expires_at && new Date(boost.expires_at).getTime() > now;
  const effectiveMultiplier = isActive ? boost.multiplier : 1;
  const expiresAt = isActive ? boost.expires_at : null;

  return { xpMultiplier: effectiveMultiplier, xpBoostExpiresAt: expiresAt, xpBoostRawMultiplier: boost.multiplier };
}
