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

export function decodeAuthoritativeWorldState(value: unknown): 'awake' | 'asleep' {
  return value === 'awake' ? 'awake' : 'asleep';
}

/** Reads the singleton state written by wake_world()/shutdown_world(). */
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
      const [stateRes, logRes] = await Promise.all([
        supabase.from('world_state').select('state, changed_at').eq('id', 1).maybeSingle(),
        supabase
          .from('world_slumber_log')
          .select('id, state, awake_characters, changed_at')
          .order('changed_at', { ascending: false })
          .limit(20),
      ]);

      if (cancelled) return;

      const recent = (logRes.data ?? []) as SlumberLogRow[];
      const currentState = decodeAuthoritativeWorldState(stateRes.data?.state);
      const awakeNow = currentState === 'awake' ? (recent.find((r) => r.state === 'awake')?.awake_characters ?? 0) : 0;
      const lastChangeAt = stateRes.data?.changed_at ?? recent[0]?.changed_at ?? null;

      setState({ currentState, awakeNow, lastChangeAt, recent, loading: false });
    };

    load();
    const t = setInterval(load, intervalMs);
    return () => { cancelled = true; clearInterval(t); };
  }, [enabled, intervalMs]);

  return state;
}
