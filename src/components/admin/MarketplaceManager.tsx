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
import { Trash2, Eye, Search, X, AlertTriangle, RefreshCw, CheckCircle2, Clock } from 'lucide-react';

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
  /** Computed: 'escrowed' | 'in_inventory' | 'released' | 'unknown' */
  escrow_state?: string;
  /** Character name currently holding this unique (if any) */
  current_holder_name?: string | null;
}

const STATUS_COLORS: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  active: 'default',
  sold: 'secondary',
  cancelled: 'outline',
  expired: 'destructive',
};

const ESCROW_BADGE: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon: any }> = {
  escrowed: { label: 'Escrowed', variant: 'default', icon: Clock },
  in_inventory: { label: 'In inventory', variant: 'destructive', icon: AlertTriangle },
  released: { label: 'Released', variant: 'secondary', icon: CheckCircle2 },
  unknown: { label: '—', variant: 'outline', icon: AlertTriangle },
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

    // Resolve character names (sellers + buyers)
    const charIds = Array.from(new Set([
      ...rows.map(r => r.seller_character_id),
      ...rows.map(r => r.buyer_character_id).filter(Boolean) as string[],
    ]));
    const names = new Map<string, string>();
    if (charIds.length > 0) {
      const { data: chars } = await supabase.from('characters').select('id, name').in('id', charIds);
      if (chars) for (const c of chars as any[]) names.set(c.id, c.name);
    }

    // Resolve current holders for active-listing items (escrow audit)
    const activeItemIds = Array.from(new Set(rows.filter(r => r.status === 'active').map(r => r.item_id)));
    const holderByItem = new Map<string, { character_id: string; name: string }>();
    if (activeItemIds.length > 0) {
      const { data: invRows } = await supabase
        .from('character_inventory')
        .select('item_id, character_id')
        .in('item_id', activeItemIds);
      if (invRows && invRows.length > 0) {
        const holderCharIds = Array.from(new Set((invRows as any[]).map(r => r.character_id)));
        const { data: holderChars } = await supabase
          .from('characters')
          .select('id, name')
          .in('id', holderCharIds);
        const holderNameMap = new Map<string, string>();
        if (holderChars) for (const c of holderChars as any[]) holderNameMap.set(c.id, c.name);
        for (const r of invRows as any[]) {
          holderByItem.set(r.item_id, { character_id: r.character_id, name: holderNameMap.get(r.character_id) || '—' });
        }
      }
    }

    setListings(rows.map(r => {
      let escrow_state: string;
      let current_holder_name: string | null = null;
      if (r.status === 'active') {
        const holder = holderByItem.get(r.item_id);
        if (!holder) {
          escrow_state = 'escrowed';
        } else {
          escrow_state = 'in_inventory';
          current_holder_name = holder.name;
        }
      } else {
        // sold/cancelled/expired = item already released back into world
        escrow_state = 'released';
      }
      return {
        ...r,
        seller_name: names.get(r.seller_character_id) || '—',
        buyer_name: r.buyer_character_id ? (names.get(r.buyer_character_id) || '—') : undefined,
        escrow_state,
        current_holder_name,
      };
    }));
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

  const stuckCount = useMemo(
    () => listings.filter(l => l.status === 'active' && l.escrow_state === 'in_inventory').length,
    [listings]
  );

  const adminCancel = async (id: string) => {
    if (!confirm('Cancel this listing and return the item to the seller?')) return;
    const { error } = await supabase.rpc('admin_cancel_listing' as any, { p_listing_id: id });
    if (error) toast.error(error.message);
    else { toast.success('Listing cancelled'); load(); }
  };

  const resolveStuck = async (l: Listing) => {
    if (l.escrow_state !== 'in_inventory') return;
    if (!confirm(
      `This active listing's item is currently held by "${l.current_holder_name}". ` +
      `Mark the listing as cancelled WITHOUT returning the item (the holder keeps it). Continue?`
    )) return;
    const { error } = await supabase
      .from('marketplace_listings' as any)
      .update({ status: 'cancelled' })
      .eq('id', l.id);
    if (error) toast.error(error.message);
    else { toast.success('Stuck listing resolved'); load(); }
  };

  const hardDelete = async (id: string) => {
    if (!confirm('Hard-delete this listing row? This cannot be undone.')) return;
    const { error } = await supabase.from('marketplace_listings' as any).delete().eq('id', id);
    if (error) toast.error(error.message);
    else { toast.success('Listing deleted'); load(); }
  };

  const expireNow = async () => {
    const { data, error } = await supabase.rpc('expire_marketplace_listings' as any);
    if (error) toast.error(error.message);
    else { toast.success(`Expired ${data ?? 0} listing(s)`); load(); }
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
        {stuckCount > 0 && (
          <Badge variant="destructive" className="text-[9px] gap-1">
            <AlertTriangle className="h-3 w-3" /> {stuckCount} stuck
          </Badge>
        )}
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={load}>
            <RefreshCw className="h-3 w-3" /> Refresh
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={expireNow}>
            <Clock className="h-3 w-3" /> Run expiration
          </Button>
        </div>
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
              <TableHead className="text-xs w-28">Escrow</TableHead>
              <TableHead className="text-xs w-32" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={9} className="text-xs text-muted-foreground text-center">Loading…</TableCell></TableRow>
            ) : filtered.length === 0 ? (
              <TableRow><TableCell colSpan={9} className="text-xs text-muted-foreground text-center">No listings</TableCell></TableRow>
            ) : filtered.map(l => {
              const dPct = l.item_snapshot?.max_durability
                ? Math.round((l.current_durability / l.item_snapshot.max_durability) * 100)
                : 100;
              const escrow = ESCROW_BADGE[l.escrow_state || 'unknown'];
              const EscrowIcon = escrow.icon;
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
                  <TableCell>
                    <Badge variant={escrow.variant} className="text-[9px] gap-1" title={l.current_holder_name ? `Held by ${l.current_holder_name}` : undefined}>
                      <EscrowIcon className="h-3 w-3" />
                      {escrow.label}
                    </Badge>
                    {l.current_holder_name && (
                      <div className="text-[9px] text-muted-foreground mt-0.5">held by {l.current_holder_name}</div>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setInspecting(l)} title="Inspect">
                        <Eye className="h-3 w-3" />
                      </Button>
                      {l.status === 'active' && l.escrow_state === 'escrowed' && (
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => adminCancel(l.id)} title="Cancel & return item">
                          <X className="h-3 w-3 text-amber-500" />
                        </Button>
                      )}
                      {l.status === 'active' && l.escrow_state === 'in_inventory' && (
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => resolveStuck(l)} title="Resolve stuck listing (mark cancelled, item stays with holder)">
                          <AlertTriangle className="h-3 w-3 text-destructive" />
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => hardDelete(l.id)} title="Hard delete row">
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
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Status: </span>
                <Badge variant={STATUS_COLORS[inspecting.status] || 'default'} className="text-[9px] capitalize">{inspecting.status}</Badge>
                <Badge variant={ESCROW_BADGE[inspecting.escrow_state || 'unknown'].variant} className="text-[9px]">
                  {ESCROW_BADGE[inspecting.escrow_state || 'unknown'].label}
                </Badge>
              </div>

              {/* Status timeline */}
              <div className="border-t border-border pt-2">
                <div className="text-muted-foreground mb-1">Timeline</div>
                <ul className="space-y-1">
                  <li className="flex gap-2"><span className="text-muted-foreground w-16">Created</span><span>{new Date(inspecting.created_at).toLocaleString()}</span></li>
                  <li className="flex gap-2"><span className="text-muted-foreground w-16">Expires</span><span>{new Date(inspecting.expires_at).toLocaleString()}</span></li>
                  {inspecting.sold_at && (
                    <li className="flex gap-2"><span className="text-muted-foreground w-16">Sold</span><span>{new Date(inspecting.sold_at).toLocaleString()}{inspecting.buyer_name ? ` to ${inspecting.buyer_name}` : ''}</span></li>
                  )}
                  {inspecting.status === 'cancelled' && (
                    <li className="flex gap-2"><span className="text-muted-foreground w-16">Cancelled</span><span className="text-muted-foreground">status changed (no exact timestamp recorded)</span></li>
                  )}
                  {inspecting.status === 'expired' && (
                    <li className="flex gap-2"><span className="text-muted-foreground w-16">Expired</span><span>{new Date(inspecting.expires_at).toLocaleString()}</span></li>
                  )}
                  {inspecting.current_holder_name && (
                    <li className="flex gap-2"><span className="text-muted-foreground w-16">Held by</span><span className="font-display">{inspecting.current_holder_name}</span></li>
                  )}
                </ul>
              </div>

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

              <div className="border-t border-border pt-2 flex justify-end gap-2">
                {inspecting.status === 'active' && inspecting.escrow_state === 'escrowed' && (
                  <Button size="sm" variant="outline" onClick={() => { adminCancel(inspecting.id); setInspecting(null); }}>
                    Cancel & return
                  </Button>
                )}
                {inspecting.status === 'active' && inspecting.escrow_state === 'in_inventory' && (
                  <Button size="sm" variant="destructive" onClick={() => { resolveStuck(inspecting); setInspecting(null); }}>
                    Resolve stuck
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => { hardDelete(inspecting.id); setInspecting(null); }}>
                  Hard delete
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
