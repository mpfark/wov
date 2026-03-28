import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface CachedItem {
  id: string;
  name: string;
  description: string;
  item_type: string;
  rarity: string;
  slot: string | null;
  stats: Record<string, number>;
  value: number;
  max_durability: number;
  hands: number | null;
  level: number;
  weapon_tag?: string | null;
}

// Module-level singleton cache shared across all hook instances
let itemCache = new Map<string, CachedItem>();
let cachePromise: Promise<void> | null = null;
let cacheLoaded = false;

async function loadCache() {
  if (cacheLoaded) return;
  if (cachePromise) return cachePromise;
  cachePromise = (async () => {
    const { data } = await supabase
      .from('items')
      .select('id, name, description, item_type, rarity, slot, stats, value, max_durability, hands, level');
    if (data) {
      const newCache = new Map<string, CachedItem>();
      for (const item of data) {
        newCache.set(item.id, item as CachedItem);
      }
      itemCache = newCache;
      cacheLoaded = true;
    }
    cachePromise = null;
  })();
  return cachePromise;
}

/** Get a cached item by ID. Returns undefined if not loaded yet. */
export function getCachedItem(id: string): CachedItem | undefined {
  return itemCache.get(id);
}

/** Get a cached item, loading the cache first if needed. */
export async function getCachedItemAsync(id: string): Promise<CachedItem | undefined> {
  if (!cacheLoaded) await loadCache();
  return itemCache.get(id);
}

/** Ensure an item is in cache (e.g. after admin creates one). */
export function addToItemCache(item: CachedItem) {
  itemCache.set(item.id, item);
}

/** Force reload the cache (e.g. after admin item edits). */
export async function invalidateItemCache() {
  cacheLoaded = false;
  cachePromise = null;
  await loadCache();
}

/**
 * React hook that ensures the item cache is loaded.
 * Returns { ready, getItem, allItems }.
 */
export function useItemCache() {
  const [ready, setReady] = useState(cacheLoaded);

  useEffect(() => {
    if (cacheLoaded) { setReady(true); return; }
    loadCache().then(() => setReady(true));
  }, []);

  const getItem = useCallback((id: string) => itemCache.get(id), []);

  const allItems = useCallback(() => Array.from(itemCache.values()), []);

  return { ready, getItem, allItems, invalidate: invalidateItemCache };
}
