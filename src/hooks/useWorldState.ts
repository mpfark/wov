import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export type WorldState = 'awake' | 'asleep' | 'unknown';

/**
 * Tracks the global world_state.state singleton. Realtime is disabled while the
 * world is asleep, so we poll every 60s in addition to an initial fetch.
 */
export function useWorldState() {
  const [state, setState] = useState<WorldState>('unknown');
  const [waking, setWaking] = useState(false);

  const fetchState = useCallback(async () => {
    const { data } = await (supabase as any)
      .from('world_state')
      .select('state')
      .eq('id', 1)
      .maybeSingle();
    if (data?.state === 'awake' || data?.state === 'asleep') setState(data.state);
  }, []);

  useEffect(() => {
    fetchState();
    const iv = setInterval(fetchState, 60_000);
    return () => clearInterval(iv);
  }, [fetchState]);

  const wake = useCallback(async () => {
    setWaking(true);
    try {
      const { error } = await (supabase as any).rpc('wake_world');
      if (error) throw error;
      setState('awake');
    } finally {
      setWaking(false);
    }
  }, []);

  return { state, waking, wake, refresh: fetchState };
}
