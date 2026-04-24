import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface MarketplaceListing {
  id: string;
  seller_character_id: string;
  item_id: string;
  item_snapshot: {
    name: string;
    rarity: string;
    slot: string | null;
    stats: Record<string, number>;
    value: number;
    hands: number | null;
    illustration_url: string;
    item_type: string;
    level: number;
    max_durability: number;
    procs?: any[];
    weapon_tag?: string | null;
  };
  current_durability: number;
  price: number;
  tax_rate: number;
  tax_amount: number;
  status: 'active' | 'sold' | 'cancelled' | 'expired';
  buyer_character_id: string | null;
  created_at: string;
  expires_at: string;
  sold_at: string | null;
  // Joined seller name (resolved client-side)
  seller_name?: string;
}

export function useMarketplace(characterId: string | null) {
  const [listings, setListings] = useState<MarketplaceListing[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchListings = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('marketplace_listings' as any)
      .select('*')
      .eq('status', 'active')
      .order('created_at', { ascending: false });
    if (!error && data) {
      const rows = data as unknown as MarketplaceListing[];
      // Resolve seller names in a single batched query
      const sellerIds = Array.from(new Set(rows.map(r => r.seller_character_id)));
      let nameMap = new Map<string, string>();
      if (sellerIds.length > 0) {
        const { data: chars } = await supabase
          .from('characters')
          .select('id, name')
          .in('id', sellerIds);
        if (chars) for (const c of chars as any[]) nameMap.set(c.id, c.name);
      }
      setListings(rows.map(r => ({ ...r, seller_name: nameMap.get(r.seller_character_id) || 'Unknown' })));
    }
    setLoading(false);
  }, []);

  // Initial load + realtime updates
  useEffect(() => {
    fetchListings();
    const ch = supabase
      .channel('marketplace-listings-sub')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'marketplace_listings' }, () => {
        fetchListings();
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [fetchListings]);

  // Periodically expire listings (every 5 min) and on focus
  useEffect(() => {
    const tick = () => {
      supabase.rpc('expire_marketplace_listings' as any).then(() => {});
    };
    tick();
    const id = window.setInterval(tick, 5 * 60 * 1000);
    return () => window.clearInterval(id);
  }, []);

  const list = useCallback(async (inventoryId: string, price: number) => {
    if (!characterId) return { ok: false, error: 'No character' };
    const { data, error } = await supabase.rpc('list_unique_item' as any, {
      p_character_id: characterId,
      p_inventory_id: inventoryId,
      p_price: price,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true, data: data as any };
  }, [characterId]);

  const buy = useCallback(async (listingId: string) => {
    if (!characterId) return { ok: false, error: 'No character' };
    const { data, error } = await supabase.rpc('buy_unique_listing' as any, {
      p_character_id: characterId,
      p_listing_id: listingId,
    });
    if (error) return { ok: false, error: error.message };
    // Optimistically remove the bought listing so the buyer's UI updates instantly,
    // even before the realtime event arrives.
    setListings(prev => prev.filter(l => l.id !== listingId));
    return { ok: true, data: data as any };
  }, [characterId]);

  const cancel = useCallback(async (listingId: string) => {
    if (!characterId) return { ok: false, error: 'No character' };
    const { error } = await supabase.rpc('cancel_unique_listing' as any, {
      p_character_id: characterId,
      p_listing_id: listingId,
    });
    if (error) return { ok: false, error: error.message };
    // Optimistically remove the cancelled listing for snappy local feedback.
    setListings(prev => prev.filter(l => l.id !== listingId));
    return { ok: true };
  }, [characterId]);

  return { listings, loading, fetchListings, list, buy, cancel };
}
