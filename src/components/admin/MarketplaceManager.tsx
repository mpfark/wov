import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Trash2, Eye, Search, X } from 'lucide-react';

interface Listing {
  id: string;
  seller_character_id: string;
  item_id: string;
  item_snapshot: any;
  current_durability: number;
  price: number;
  tax_rate: number;
  tax_amount: number;
  status: string;
  buyer_character_id: string | null;
  created_at: string;
  expires_at: string;
  sold_at: string | null;
  seller_name?: string;
  buyer_name?: string;
}

const STATUS_COLORS: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  active: 'default',
  sold: 'secondary',
  cancelled: 'outline',
  expired: 'destructive',
};

export default function MarketplaceManager() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [inspecting, setInspecting] = useState<Listing | null>(null);

  const load = async () => {
    setLoading(true);
    let query = supabase
      .from('marketplace_listings' as any)
      .select('*')
      .order('created_at', { ascending: false });
    if (statusFilter !== 'all') query = query.eq('status', statusFilter);
    const { data, error } = await query;
    if (error) { toast.error(error.message); setLoading(false); return; }
    const rows = (data as unknown as Listing[]) || [];
    const ids = Array.from(new Set([
      ...rows.map(r => r.seller_character_id),
      ...rows.map(r => r.buyer_character_id).filter(Boolean) as string[],
    ]));
    let names = new Map<string, string>();
    if (ids.length > 0) {
      const { data: chars } = await supabase.from('characters').select('id, name').in('id', ids);
      if (chars) for (const c of chars as any[]) names.set(c.id, c.name);
    }
    setListings(rows.map(r => ({
      ...r,
      seller_name: names.get(r.seller_character_id) || '—',
      buyer_name: r.buyer_character_id ? (names.get(r.buyer_character_id) || '—') : undefined,
    })));
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [statusFilter]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return listings;
    return listings.filter(l =>
      l.item_snapshot?.name?.toLowerCase().includes(q) ||
      l.seller_name?.toLowerCase().includes(q) ||
      l.buyer_name?.toLowerCase().includes(q)
    );
  }, [listings, search]);

  const adminCancel = async (id: string) => {
    if (!confirm('Cancel this listing and return the item to the seller?')) return;
    const { error } = await supabase.rpc('admin_cancel_listing' as any, { p_listing_id: id });
    if (error) toast.error(error.message);
    else { toast.success('Listing cancelled'); load(); }
  };

  const hardDelete = async (id: string) => {
    if (!confirm('Hard-delete this listing row? This cannot be undone.')) return;
    const { error } = await supabase.from('marketplace_listings' as any).delete().eq('id', id);
    if (error) toast.error(error.message);
    else { toast.success('Listing deleted'); load(); }
  };

  return (
    <div className="h-full flex flex-col p-4 gap-3">
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="font-display text-sm text-primary">Marketplace</h2>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-32 h-7 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="sold">Sold</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
            <SelectItem value="expired">Expired</SelectItem>
          </SelectContent>
        </Select>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
          <Input
            placeholder="Search seller, buyer, or item…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-7 text-xs pl-7 w-64"
          />
        </div>
        <span className="text-xs text-muted-foreground">{filtered.length} listing(s)</span>
      </div>

      <ScrollArea className="flex-1">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs w-32">Created</TableHead>
              <TableHead className="text-xs w-28">Seller</TableHead>
              <TableHead className="text-xs">Item</TableHead>
              <TableHead className="text-xs w-20">Durability</TableHead>
              <TableHead className="text-xs w-24 text-right">Price</TableHead>
              <TableHead className="text-xs w-20 text-right">Tax</TableHead>
              <TableHead className="text-xs w-24">Status</TableHead>
              <TableHead className="text-xs w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={8} className="text-xs text-muted-foreground text-center">Loading…</TableCell></TableRow>
            ) : filtered.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="text-xs text-muted-foreground text-center">No listings</TableCell></TableRow>
            ) : filtered.map(l => {
              const dPct = l.item_snapshot?.max_durability
                ? Math.round((l.current_durability / l.item_snapshot.max_durability) * 100)
                : 100;
              return (
                <TableRow key={l.id}>
                  <TableCell className="text-[10px] text-muted-foreground">{new Date(l.created_at).toLocaleString()}</TableCell>
                  <TableCell className="text-xs font-display">{l.seller_name}</TableCell>
                  <TableCell className="text-xs">
                    <div className="font-display text-primary">{l.item_snapshot?.name}</div>
                    <div className="text-[10px] text-muted-foreground capitalize">
                      {l.item_snapshot?.rarity} · L{l.item_snapshot?.level}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs">{dPct}%</TableCell>
                  <TableCell className="text-xs text-right font-mono">{l.price.toLocaleString()}</TableCell>
                  <TableCell className="text-xs text-right font-mono text-destructive">−{l.tax_amount.toLocaleString()}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_COLORS[l.status] || 'default'} className="text-[9px] capitalize">{l.status}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setInspecting(l)} title="Inspect">
                        <Eye className="h-3 w-3" />
                      </Button>
                      {l.status === 'active' && (
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => adminCancel(l.id)} title="Cancel listing">
                          <X className="h-3 w-3 text-amber-500" />
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => hardDelete(l.id)} title="Hard delete">
                        <Trash2 className="h-3 w-3 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </ScrollArea>

      <Dialog open={!!inspecting} onOpenChange={(v) => !v && setInspecting(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-display text-primary">Listing details</DialogTitle>
          </DialogHeader>
          {inspecting && (
            <div className="space-y-2 text-xs">
              <div><span className="text-muted-foreground">Item: </span><span className="font-display text-primary">{inspecting.item_snapshot?.name}</span></div>
              <div><span className="text-muted-foreground">Seller: </span>{inspecting.seller_name}</div>
              {inspecting.buyer_name && <div><span className="text-muted-foreground">Buyer: </span>{inspecting.buyer_name}</div>}
              <div><span className="text-muted-foreground">Price / Tax / Payout: </span>
                <span className="font-mono">{inspecting.price.toLocaleString()} / −{inspecting.tax_amount.toLocaleString()} / {(inspecting.price - inspecting.tax_amount).toLocaleString()}</span>
              </div>
              <div><span className="text-muted-foreground">Durability: </span>{inspecting.current_durability} / {inspecting.item_snapshot?.max_durability ?? '?'}</div>
              <div><span className="text-muted-foreground">Status: </span><Badge variant={STATUS_COLORS[inspecting.status] || 'default'} className="text-[9px] capitalize">{inspecting.status}</Badge></div>
              <div><span className="text-muted-foreground">Created: </span>{new Date(inspecting.created_at).toLocaleString()}</div>
              <div><span className="text-muted-foreground">Expires: </span>{new Date(inspecting.expires_at).toLocaleString()}</div>
              {inspecting.sold_at && <div><span className="text-muted-foreground">Sold at: </span>{new Date(inspecting.sold_at).toLocaleString()}</div>}
              <div className="border-t border-border pt-2">
                <div className="text-muted-foreground mb-1">Stats:</div>
                <pre className="text-[10px] bg-muted/30 p-2 rounded overflow-x-auto">{JSON.stringify(inspecting.item_snapshot?.stats || {}, null, 2)}</pre>
              </div>
              {inspecting.item_snapshot?.procs?.length > 0 && (
                <div className="border-t border-border pt-2">
                  <div className="text-muted-foreground mb-1">Procs:</div>
                  <pre className="text-[10px] bg-muted/30 p-2 rounded overflow-x-auto">{JSON.stringify(inspecting.item_snapshot.procs, null, 2)}</pre>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
