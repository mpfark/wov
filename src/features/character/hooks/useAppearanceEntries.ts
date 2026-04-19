import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { AppearanceEntry } from '../utils/appearance-resolver';

let cache: AppearanceEntry[] | null = null;
const subscribers = new Set<(entries: AppearanceEntry[]) => void>();
let inflight: Promise<void> | null = null;

async function fetchEntries(): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    const { data, error } = await supabase
      .from('appearance_entries')
      .select('id, slot, material, tier, asset_url, layer_order, occludes, is_shared, display_name');
    if (error) {
      console.warn('[useAppearanceEntries] failed to fetch:', error.message);
      cache = [];
    } else {
      cache = (data ?? []) as AppearanceEntry[];
    }
    subscribers.forEach((cb) => cache && cb(cache));
    inflight = null;
  })();
  return inflight;
}

/**
 * Lightweight global cache for appearance entries.
 * Re-fetched on `refresh()` from admin authoring tools.
 */
export function useAppearanceEntries() {
  const [entries, setEntries] = useState<AppearanceEntry[]>(cache ?? []);

  useEffect(() => {
    const cb = (next: AppearanceEntry[]) => setEntries(next);
    subscribers.add(cb);
    if (!cache) {
      fetchEntries();
    } else {
      setEntries(cache);
    }
    return () => {
      subscribers.delete(cb);
    };
  }, []);

  return {
    entries,
    refresh: async () => {
      cache = null;
      await fetchEntries();
    },
  };
}
