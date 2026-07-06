import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface SlumberLogRow {
  id: number;
  state: 'awake' | 'asleep';
  awake_characters: number;
  changed_at: string;
}

export interface WorldSlumberState {
  currentState: 'awake' | 'asleep' | null;
  awakeNow: number;
  lastChangeAt: string | null;
  recent: SlumberLogRow[];
  loading: boolean;
}

/**
 * Polls the world's awake/asleep state (5-min activity window) and
 * recent transitions from world_slumber_log. Admin/overlord only —
 * the log table's RLS blocks other users.
 */
export function useWorldSlumberState(enabled: boolean, intervalMs = 30_000): WorldSlumberState {
  const [state, setState] = useState<WorldSlumberState>({
    currentState: null,
    awakeNow: 0,
    lastChangeAt: null,
    recent: [],
    loading: true,
  });

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const load = async () => {
      const [awakeRes, logRes] = await Promise.all([
        supabase.rpc('world_is_awake' as any),
        supabase
          .from('world_slumber_log')
          .select('id, state, awake_characters, changed_at')
          .order('changed_at', { ascending: false })
          .limit(20),
      ]);

      if (cancelled) return;

      const recent = (logRes.data ?? []) as SlumberLogRow[];
      const isAwake = awakeRes.data === true;
      const currentState: 'awake' | 'asleep' = isAwake ? 'awake' : 'asleep';
      // awake_characters count from most recent log entry when awake, else 0
      const awakeNow = isAwake ? (recent.find((r) => r.state === 'awake')?.awake_characters ?? 0) : 0;
      const lastChangeAt = recent[0]?.changed_at ?? null;

      setState({ currentState, awakeNow, lastChangeAt, recent, loading: false });
    };

    load();
    const t = setInterval(load, intervalMs);
    return () => { cancelled = true; clearInterval(t); };
  }, [enabled, intervalMs]);

  return state;
}
