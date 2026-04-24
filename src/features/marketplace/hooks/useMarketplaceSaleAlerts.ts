import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface SaleAlert {
  listing_id: string;
  item_name: string;
  price: number;
  payout: number;
}

/**
 * Lightweight subscription that fires `onSale` whenever a listing belonging
 * to the given character transitions to status='sold'. Runs independently of
 * the marketplace panel so sellers get notified even when not standing at a
 * marketplace. Self-deduplicates so historical sales don't re-fire.
 */
export function useMarketplaceSaleAlerts(
  characterId: string | null,
  onSale: (sale: SaleAlert) => void,
) {
  const onSaleRef = useRef(onSale);
  useEffect(() => { onSaleRef.current = onSale; }, [onSale]);
  const seenRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!characterId) return;
    let cancelled = false;

    // Seed seen set with already-sold listings so we never fire historical alerts.
    (async () => {
      const { data } = await supabase
        .from('marketplace_listings' as any)
        .select('id')
        .eq('seller_character_id', characterId)
        .eq('status', 'sold');
      if (cancelled) return;
      if (data) for (const r of data as any[]) seenRef.current.add(r.id);
    })();

    const ch = supabase
      .channel(`marketplace-sale-alerts-${characterId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'marketplace_listings' }, (payload: any) => {
        const row = payload?.new;
        if (
          row &&
          row.status === 'sold' &&
          row.seller_character_id === characterId &&
          !seenRef.current.has(row.id)
        ) {
          seenRef.current.add(row.id);
          onSaleRef.current({
            listing_id: row.id,
            item_name: row.item_snapshot?.name ?? 'item',
            price: row.price,
            payout: row.payout_amount ?? Math.max(0, Math.floor(row.price * (1 - (row.tax_rate ?? 0.1)))),
          });
        }
      })
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
    };
  }, [characterId]);
}
