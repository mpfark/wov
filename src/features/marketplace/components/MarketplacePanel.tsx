import { useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Coins, Tag, Search, Plus, AlertTriangle } from 'lucide-react';
import { useMarketplace } from '../hooks/useMarketplace';
import type { InventoryItem } from '@/features/inventory/hooks/useInventory';
import { supabase } from '@/integrations/supabase/client';

interface Props {
  open: boolean;
  onClose: () => void;
  characterId: string;
  characterName: string;
  characterGold: number;
  inventory: InventoryItem[];
  onTransacted: () => void;
  addLog?: (msg: string) => void;
}

const RARITY_COLORS: Record<string, string> = {
  common: 'text-muted-foreground',
  uncommon: 'text-elvish',
  rare: 'text-blue-400',
  unique: 'text-primary',
  soulforged: 'text-magenta',
};

function formatTimeLeft(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'expired';
  const h = Math.floor(ms / (60 * 60 * 1000));
  const m = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function statSummary(stats: Record<string, number> | undefined): string {
  if (!stats) return '—';
  const parts = Object.entries(stats)
    .filter(([, v]) => v !== 0)
    .map(([k, v]) => `${v > 0 ? '+' : ''}${v} ${k.toUpperCase()}`);
  return parts.length > 0 ? parts.join(', ') : '—';
}

export default function MarketplacePanel({
  open, onClose, characterId, characterName, characterGold, inventory, onTransacted, addLog,
}: Props) {
  const { listings, loading, list, buy } = useMarketplace(characterId);
  const [tab, setTab] = useState<'browse' | 'mine' | 'create'>('browse');
  const [search, setSearch] = useState('');
  const [pickedInv, setPickedInv] = useState<string>('');
  const [price, setPrice] = useState<number>(1000);
  const [submitting, setSubmitting] = useState(false);

  const eligibleInventory = useMemo(
    () => inventory.filter(i =>
      i.item.rarity === 'unique' &&
      !i.equipped_slot &&
      !i.item.is_soulbound
    ),
    [inventory],
  );

  const filteredListings = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return listings;
    return listings.filter(l =>
      l.item_snapshot?.name?.toLowerCase().includes(q) ||
      l.seller_name?.toLowerCase().includes(q)
    );
  }, [listings, search]);

  const myListings = useMemo(
    () => listings.filter(l => l.seller_character_id === characterId),
    [listings, characterId],
  );

  const taxAmount = Math.floor(price * 0.10);
  const sellerPayout = Math.max(0, price - taxAmount);

  const handleCreate = async () => {
    if (!pickedInv) { toast.error('Select an item to list'); return; }
    if (price <= 0) { toast.error('Set a positive price'); return; }
    setSubmitting(true);
    const result = await list(pickedInv, price);
    setSubmitting(false);
    if (!result.ok) { toast.error(result.error || 'Failed to list item'); return; }
    toast.success('Item listed');
    onTransacted();
    addLog?.(`📜 You list ${result.data?.item_name} for ${price} gold.`);
    // Global broadcast
    try {
      const ch = supabase.channel('marketplace-global');
      await ch.subscribe();
      ch.send({
        type: 'broadcast',
        event: 'listed',
        payload: {
          seller: characterName,
          item_name: result.data?.item_name,
          price,
        },
      });
      setTimeout(() => { supabase.removeChannel(ch); }, 1000);
    } catch {/* non-critical */}
    setPickedInv('');
    setPrice(1000);
    setTab('browse');
  };

  const handleBuy = async (id: string, itemName: string, p: number) => {
    if (!confirm(`Buy ${itemName} for ${p} gold?`)) return;
    const result = await buy(id);
    if (!result.ok) { toast.error(result.error || 'Failed to buy'); return; }
    toast.success(`Bought ${itemName}`);
    addLog?.(`💰 You bought ${itemName} for ${p} gold.`);
    onTransacted();
  };


  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl bg-card border-border">
        <DialogHeader>
          <DialogTitle className="font-display text-primary flex items-center gap-2">
            <Tag className="h-4 w-4" /> Marketplace
            <Badge variant="outline" className="text-[10px]">Unique items only</Badge>
          </DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
          <TabsList className="h-8">
            <TabsTrigger value="browse" className="text-xs font-display">Browse ({listings.length})</TabsTrigger>
            <TabsTrigger value="mine" className="text-xs font-display">My Listings ({myListings.length})</TabsTrigger>
            <TabsTrigger value="create" className="text-xs font-display">List Item</TabsTrigger>
          </TabsList>

          {/* BROWSE */}
          <TabsContent value="browse" className="space-y-2 mt-3">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by item or seller…"
                  className="h-8 text-xs pl-7"
                />
              </div>
              <span className="text-[10px] text-muted-foreground">
                Your gold: <Coins className="inline h-3 w-3 text-primary" /> {characterGold}
              </span>
            </div>
            <ScrollArea className="h-[55vh] rounded border border-border">
              {loading ? (
                <p className="p-4 text-xs text-muted-foreground italic">Loading…</p>
              ) : filteredListings.length === 0 ? (
                <p className="p-4 text-xs text-muted-foreground italic">No active listings.</p>
              ) : (
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted/40 backdrop-blur z-10">
                    <tr className="text-[10px] text-muted-foreground">
                      <th className="text-left p-2">Item</th>
                      <th className="text-left p-2">Stats</th>
                      <th className="text-left p-2">Durability</th>
                      <th className="text-left p-2">Seller</th>
                      <th className="text-left p-2">Time Left</th>
                      <th className="text-right p-2">Price</th>
                      <th className="p-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {filteredListings.map(l => {
                      const isMine = l.seller_character_id === characterId;
                      const canAfford = characterGold >= l.price;
                      const colorClass = RARITY_COLORS[l.item_snapshot?.rarity] || 'text-foreground';
                      const dPct = l.item_snapshot?.max_durability
                        ? Math.round((l.current_durability / l.item_snapshot.max_durability) * 100)
                        : 100;
                      return (
                        <tr key={l.id} className="border-t border-border/50 hover:bg-muted/20">
                          <td className="p-2">
                            <div className={`font-display ${colorClass}`}>{l.item_snapshot?.name}</div>
                            <div className="text-[10px] text-muted-foreground capitalize">
                              L{l.item_snapshot?.level} · {l.item_snapshot?.slot ?? l.item_snapshot?.item_type}
                            </div>
                          </td>
                          <td className="p-2 text-muted-foreground">{statSummary(l.item_snapshot?.stats)}</td>
                          <td className="p-2">
                            <span className={dPct < 30 ? 'text-destructive' : dPct < 70 ? 'text-amber-500' : 'text-elvish'}>
                              {dPct}%
                            </span>
                          </td>
                          <td className="p-2 text-muted-foreground">{l.seller_name}</td>
                          <td className="p-2 text-[10px] text-muted-foreground">{formatTimeLeft(l.expires_at)}</td>
                          <td className="p-2 text-right font-mono">
                            <Coins className="inline h-3 w-3 text-primary mr-1" />
                            {l.price.toLocaleString()}
                          </td>
                          <td className="p-2 text-right">
                            {isMine ? (
                              <Badge variant="secondary" className="text-[9px]">yours</Badge>
                            ) : (
                              <Button
                                size="sm"
                                variant="default"
                                disabled={!canAfford}
                                className="h-6 text-[10px] font-display"
                                onClick={() => handleBuy(l.id, l.item_snapshot?.name, l.price)}
                              >
                                Buy
                              </Button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </ScrollArea>
          </TabsContent>

          {/* MY LISTINGS */}
          <TabsContent value="mine" className="space-y-2 mt-3">
            <div className="flex items-start gap-2 rounded border border-destructive/40 bg-destructive/10 p-2 text-[10px] text-destructive">
              <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
              <span>Listings are final and cannot be cancelled. Unsold items after 12 hours return to the world.</span>
            </div>
            <ScrollArea className="h-[52vh] rounded border border-border">
              {myListings.length === 0 ? (
                <p className="p-4 text-xs text-muted-foreground italic">You have no active listings.</p>
              ) : (
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted/40 backdrop-blur z-10">
                    <tr className="text-[10px] text-muted-foreground">
                      <th className="text-left p-2">Item</th>
                      <th className="text-left p-2">Durability</th>
                      <th className="text-left p-2">Time Left</th>
                      <th className="text-right p-2">Price</th>
                      <th className="text-right p-2">Payout</th>
                    </tr>
                  </thead>
                  <tbody>
                    {myListings.map(l => {
                      const colorClass = RARITY_COLORS[l.item_snapshot?.rarity] || 'text-foreground';
                      const dPct = l.item_snapshot?.max_durability
                        ? Math.round((l.current_durability / l.item_snapshot.max_durability) * 100)
                        : 100;
                      const payout = l.price - l.tax_amount;
                      return (
                        <tr key={l.id} className="border-t border-border/50 hover:bg-muted/20">
                          <td className="p-2">
                            <div className={`font-display ${colorClass}`}>{l.item_snapshot?.name}</div>
                          </td>
                          <td className="p-2">{dPct}%</td>
                          <td className="p-2 text-[10px] text-muted-foreground">{formatTimeLeft(l.expires_at)}</td>
                          <td className="p-2 text-right font-mono">{l.price.toLocaleString()}</td>
                          <td className="p-2 text-right font-mono text-elvish">{payout.toLocaleString()}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </ScrollArea>
          </TabsContent>

          {/* CREATE LISTING */}
          <TabsContent value="create" className="space-y-3 mt-3">
            <div className="space-y-1.5">
              <label className="text-[10px] text-muted-foreground font-display">Select unique item</label>
              {eligibleInventory.length === 0 ? (
                <p className="text-xs text-muted-foreground italic p-3 border border-border rounded">
                  No eligible items. Only unequipped, non-soulbound unique items can be listed.
                </p>
              ) : (
                <ScrollArea className="max-h-48 rounded border border-border">
                  <div className="p-1 space-y-0.5">
                    {eligibleInventory.map(inv => {
                      const dPct = inv.item.max_durability
                        ? Math.round((inv.current_durability / inv.item.max_durability) * 100)
                        : 100;
                      const isPicked = pickedInv === inv.id;
                      return (
                        <button
                          key={inv.id}
                          onClick={() => setPickedInv(inv.id)}
                          className={`w-full text-left p-2 rounded text-xs transition-colors ${
                            isPicked ? 'bg-primary/15 border border-primary/40' : 'hover:bg-muted/40 border border-transparent'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-display text-primary">{inv.item.name}</span>
                            <span className="text-[10px] text-muted-foreground">{dPct}% dur</span>
                          </div>
                          <div className="text-[10px] text-muted-foreground">{statSummary(inv.item.stats)}</div>
                        </button>
                      );
                    })}
                  </div>
                </ScrollArea>
              )}
            </div>

            <div className="flex items-start gap-2 rounded border border-destructive/40 bg-destructive/10 p-2 text-[10px] text-destructive">
              <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
              <span>
                <strong>Listings are final.</strong> Items cannot be recovered or cancelled. Unsold items after 12 hours return to the world drop pool.
              </span>
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] text-muted-foreground font-display">Asking price (gold)</label>
              <Input
                type="number"
                min={1}
                value={price}
                onChange={(e) => setPrice(Math.max(0, Number(e.target.value) || 0))}
                className="h-8 text-xs"
              />
              <div className="flex items-center gap-3 text-[10px] text-muted-foreground bg-muted/20 rounded p-2">
                <span>Price: <span className="font-mono text-foreground">{price.toLocaleString()}</span></span>
                <span>·</span>
                <span>Tax (10%): <span className="font-mono text-destructive">−{taxAmount.toLocaleString()}</span></span>
                <span>·</span>
                <span>You receive: <span className="font-mono text-elvish">{sellerPayout.toLocaleString()}</span></span>
              </div>
            </div>

            <Button
              onClick={handleCreate}
              disabled={!pickedInv || price <= 0 || submitting}
              className="font-display"
            >
              <Plus className="h-3 w-3 mr-1" /> List Item
            </Button>
            <p className="text-[10px] text-muted-foreground italic">
              Listings expire after 12 hours. Once listed, items cannot be recovered.
            </p>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
