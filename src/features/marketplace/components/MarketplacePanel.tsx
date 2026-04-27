import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Coins, Tag, Search, Plus, AlertTriangle, HandCoins } from 'lucide-react';
import { ServicePanelShell, ServicePanelEmpty } from '@/components/ui/ServicePanelShell';
import { useMarketplace } from '../hooks/useMarketplace';
import type { InventoryItem } from '@/features/inventory/hooks/useInventory';
import { useGlobalBroadcastSender } from '@/hooks/useGlobalBroadcast';

interface Props {
  open: boolean;
  onClose: () => void;
  characterId: string;
  characterName: string;
  characterGold: number;
  inventory: InventoryItem[];
  onTransacted: () => void;
  addLog?: (msg: string) => void;
  /** True when the player is currently standing at a marketplace node. */
  atMarketplace?: boolean;
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

function formatTimeAgo(ts: string): string {
  const ms = Date.now() - new Date(ts).getTime();
  if (ms < 60 * 1000) return 'just now';
  const m = Math.floor(ms / (60 * 1000));
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function statSummary(stats: Record<string, number> | undefined): string {
  if (!stats) return '—';
  const parts = Object.entries(stats)
    .filter(([, v]) => v !== 0)
    .map(([k, v]) => `${v > 0 ? '+' : ''}${v} ${k.toUpperCase()}`);
  return parts.length > 0 ? parts.join(', ') : '—';
}

export default function MarketplacePanel({
  open, onClose, characterId, characterName, characterGold, inventory, onTransacted, addLog, atMarketplace = true,
}: Props) {
  const { listings, uncollectedSales, loading, list, buy, collect } = useMarketplace(characterId);
  const sendGlobal = useGlobalBroadcastSender();
  const [tab, setTab] = useState<'browse' | 'mine' | 'create'>('browse');
  const [search, setSearch] = useState('');
  const [pickedInv, setPickedInv] = useState<string>('');
  const [selectedListing, setSelectedListing] = useState<string | null>(null);
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

  const selected = filteredListings.find(l => l.id === selectedListing) ?? null;
  const pickedItem = eligibleInventory.find(i => i.id === pickedInv) ?? null;

  const totalUncollected = useMemo(
    () => uncollectedSales.reduce((sum, s) => sum + (s.payout_amount ?? 0), 0),
    [uncollectedSales],
  );

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
    try {
      sendGlobal({
        kind: 'market_listed',
        icon: '📜',
        text: `Market: ${characterName} lists ${result.data?.item_name} for ${price.toLocaleString()} gold.`,
        actor: characterName,
      });
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
    setSelectedListing(null);
    onTransacted();
  };

  const handleCollect = async () => {
    if (!atMarketplace) {
      toast.error('You must be at a marketplace to collect your earnings.');
      return;
    }
    if (uncollectedSales.length === 0) return;
    const result = await collect();
    if (!result.ok) { toast.error(result.error || 'Failed to collect'); return; }
    const total = result.data?.total_gold ?? 0;
    const count = result.data?.collected_count ?? 0;
    toast.success(`+${total.toLocaleString()} gold collected from ${count} sale${count === 1 ? '' : 's'}`);
    addLog?.(`💰 You collect ${total.toLocaleString()} gold from your marketplace sales.`);
    onTransacted();
  };

  // ── BROWSE slot content ──────────────────────────────────────

  const browseLeft = (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by item or seller…"
          className="h-8 text-xs pl-7"
        />
      </div>
      {loading ? (
        <ServicePanelEmpty>Loading…</ServicePanelEmpty>
      ) : filteredListings.length === 0 ? (
        <ServicePanelEmpty>No active listings.</ServicePanelEmpty>
      ) : (
        <div className="space-y-1">
          {filteredListings.map(l => {
            const isMine = l.seller_character_id === characterId;
            const colorClass = RARITY_COLORS[l.item_snapshot?.rarity] || 'text-foreground';
            const isSelected = l.id === selectedListing;
            return (
              <button
                key={l.id}
                type="button"
                onClick={() => setSelectedListing(isSelected ? null : l.id)}
                className={`w-full text-left p-2 rounded border transition-colors ${
                  isSelected ? 'border-primary bg-primary/10' : 'border-border bg-background/40 hover:bg-background/60'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={`font-display text-sm truncate ${colorClass}`}>{l.item_snapshot?.name}</span>
                  <span className="font-mono text-xs text-primary shrink-0">
                    <Coins className="inline h-3 w-3 mr-0.5" />{l.price.toLocaleString()}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>L{l.item_snapshot?.level} · {l.item_snapshot?.slot ?? l.item_snapshot?.item_type}</span>
                  <span>{l.seller_name}{isMine && ' (you)'}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );

  const browseRight = selected ? (
    <div className="space-y-2">
      <h4 className={`font-display text-base ${RARITY_COLORS[selected.item_snapshot?.rarity] || 'text-foreground'}`}>
        {selected.item_snapshot?.name}
      </h4>
      <p className="text-[10px] text-muted-foreground capitalize">
        Level {selected.item_snapshot?.level} · {selected.item_snapshot?.slot ?? selected.item_snapshot?.item_type}
      </p>
      <div className="text-xs text-muted-foreground space-y-1 border-t border-border pt-2">
        <div>Stats: <span className="text-foreground">{statSummary(selected.item_snapshot?.stats)}</span></div>
        <div>
          Durability:{' '}
          <span>{selected.item_snapshot?.max_durability
            ? Math.round((selected.current_durability / selected.item_snapshot.max_durability) * 100)
            : 100}%</span>
        </div>
        <div>Seller: <span className="text-foreground">{selected.seller_name}</span></div>
        <div>Time left: <span className="text-foreground">{formatTimeLeft(selected.expires_at)}</span></div>
        <div>Price: <span className="text-primary font-display">{selected.price.toLocaleString()}g</span></div>
      </div>
    </div>
  ) : (
    <ServicePanelEmpty>Select a listing to see details.</ServicePanelEmpty>
  );

  const browseFooter = (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-muted-foreground">
        Your gold: <Coins className="inline h-3 w-3 text-primary" /> {characterGold.toLocaleString()}
      </span>
      <Button
        size="sm"
        disabled={!selected || selected.seller_character_id === characterId || characterGold < (selected?.price ?? Infinity)}
        onClick={() => selected && handleBuy(selected.id, selected.item_snapshot?.name, selected.price)}
        className="font-display text-xs h-8"
      >
        <Coins className="w-3 h-3 mr-1" />
        {selected
          ? selected.seller_character_id === characterId
            ? 'Your listing'
            : `Buy (${selected.price.toLocaleString()}g)`
          : 'Buy'}
      </Button>
    </div>
  );

  // ── MINE slot content ────────────────────────────────────────

  const mineLeft = (
    <div className="space-y-2">
      <div className="flex items-start gap-2 rounded border border-destructive/40 bg-destructive/10 p-2 text-[10px] text-destructive">
        <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
        <span>Listings are final and cannot be cancelled. Unsold items after 12 hours return to the world.</span>
      </div>
      {myListings.length === 0 ? (
        <ServicePanelEmpty>You have no active listings.</ServicePanelEmpty>
      ) : (
        <div className="space-y-1">
          {myListings.map(l => {
            const colorClass = RARITY_COLORS[l.item_snapshot?.rarity] || 'text-foreground';
            const dPct = l.item_snapshot?.max_durability
              ? Math.round((l.current_durability / l.item_snapshot.max_durability) * 100)
              : 100;
            const payout = l.price - l.tax_amount;
            return (
              <div key={l.id} className="p-2 rounded border border-border bg-background/40">
                <div className="flex items-center justify-between gap-2">
                  <span className={`font-display text-sm truncate ${colorClass}`}>{l.item_snapshot?.name}</span>
                  <span className="font-mono text-xs">{l.price.toLocaleString()}g</span>
                </div>
                <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>{dPct}% dur · {formatTimeLeft(l.expires_at)} left</span>
                  <span className="text-elvish">payout {payout.toLocaleString()}g</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  const mineRight = uncollectedSales.length === 0 ? (
    <ServicePanelEmpty>No earnings awaiting collection.</ServicePanelEmpty>
  ) : (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <HandCoins className="h-4 w-4 text-primary" />
        <span className="font-display text-xs text-primary">Earnings awaiting collection</span>
        <Badge variant="outline" className="text-[9px]">
          {uncollectedSales.length} sale{uncollectedSales.length === 1 ? '' : 's'}
        </Badge>
      </div>
      {!atMarketplace && (
        <p className="text-[10px] text-muted-foreground italic">
          You must be standing at a marketplace to collect.
        </p>
      )}
      <div className="space-y-1">
        {uncollectedSales.map(s => {
          const colorClass = RARITY_COLORS[s.item_snapshot?.rarity] || 'text-foreground';
          const soldAgo = s.sold_at ? formatTimeAgo(s.sold_at) : '—';
          return (
            <div key={s.id} className="flex items-center justify-between p-1.5 rounded border border-border/40 bg-background/40">
              <div className="min-w-0">
                <span className={`font-display text-xs truncate ${colorClass}`}>{s.item_snapshot?.name}</span>
                <span className="text-[10px] text-muted-foreground ml-1">· sold {soldAgo}</span>
              </div>
              <span className="text-xs font-mono text-elvish">{(s.payout_amount ?? 0).toLocaleString()}g</span>
            </div>
          );
        })}
      </div>
    </div>
  );

  const mineFooter = (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-muted-foreground">
        {uncollectedSales.length > 0
          ? <>Pending: <span className="text-elvish font-display">{totalUncollected.toLocaleString()}g</span></>
          : 'No pending earnings.'}
      </span>
      <Button
        size="sm"
        disabled={!atMarketplace || totalUncollected <= 0}
        onClick={handleCollect}
        className="font-display text-xs h-8"
        title={atMarketplace ? '' : 'Travel to a marketplace to collect your earnings'}
      >
        <Coins className="h-3 w-3 mr-1" />
        Collect {totalUncollected.toLocaleString()}g
      </Button>
    </div>
  );

  // ── CREATE slot content ─────────────────────────────────────

  const createLeft = eligibleInventory.length === 0 ? (
    <ServicePanelEmpty>No eligible items. Only unequipped, non-soulbound unique items can be listed.</ServicePanelEmpty>
  ) : (
    <div className="space-y-1">
      {eligibleInventory.map(inv => {
        const dPct = inv.item.max_durability
          ? Math.round((inv.current_durability / inv.item.max_durability) * 100)
          : 100;
        const isPicked = pickedInv === inv.id;
        return (
          <button
            key={inv.id}
            onClick={() => setPickedInv(inv.id)}
            className={`w-full text-left p-2 rounded border transition-colors ${
              isPicked ? 'border-primary bg-primary/10' : 'border-border bg-background/40 hover:bg-background/60'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-display text-sm text-primary">{inv.item.name}</span>
              <span className="text-[10px] text-muted-foreground">{dPct}% dur</span>
            </div>
            <div className="text-[10px] text-muted-foreground">{statSummary(inv.item.stats)}</div>
          </button>
        );
      })}
    </div>
  );

  const createRight = (
    <div className="space-y-3">
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
        <div className="text-[10px] text-muted-foreground bg-muted/20 rounded p-2 space-y-0.5">
          <div>Price: <span className="font-mono text-foreground">{price.toLocaleString()}</span></div>
          <div>Tax (10%): <span className="font-mono text-destructive">−{taxAmount.toLocaleString()}</span></div>
          <div>You receive: <span className="font-mono text-elvish">{sellerPayout.toLocaleString()}</span></div>
        </div>
      </div>
      <p className="text-[10px] text-muted-foreground italic">
        Listings expire after 12 hours.
      </p>
    </div>
  );

  const createFooter = (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-muted-foreground">
        {pickedItem
          ? <>Listing <span className="text-primary font-display">{pickedItem.item.name}</span> for <span className="text-elvish">{sellerPayout.toLocaleString()}g</span> net</>
          : 'Pick an item and set a price.'}
      </span>
      <Button
        onClick={handleCreate}
        disabled={!pickedInv || price <= 0 || submitting}
        size="sm"
        className="font-display text-xs h-8"
      >
        <Plus className="h-3 w-3 mr-1" /> List Item
      </Button>
    </div>
  );

  // ── Render ────────────────────────────────────────────────────

  const headerActions = (
    <span className="text-[10px] text-muted-foreground inline-flex items-center gap-1">
      <Coins className="h-3 w-3 text-primary" /> {characterGold.toLocaleString()}
    </span>
  );

  const subtitle = (
    <span className="inline-flex items-center gap-2">
      <Tag className="h-3 w-3" />
      <Badge variant="outline" className="text-[10px]">Unique items only</Badge>
    </span>
  );

  const tabs = (
    <Tabs value={tab} onValueChange={v => setTab(v as 'browse' | 'mine' | 'create')} className="w-full">
      <TabsList className="h-8 w-full grid grid-cols-3">
        <TabsTrigger value="browse" className="text-xs font-display">
          Browse ({listings.length})
        </TabsTrigger>
        <TabsTrigger value="mine" className="text-xs font-display relative">
          My Listings ({myListings.length})
          {uncollectedSales.length > 0 && (
            <Badge variant="default" className="ml-1.5 h-4 px-1 text-[9px] bg-primary text-primary-foreground">
              {uncollectedSales.length}
            </Badge>
          )}
        </TabsTrigger>
        <TabsTrigger value="create" className="text-xs font-display">List Item</TabsTrigger>
      </TabsList>
      <TabsContent value="browse" className="hidden" />
      <TabsContent value="mine" className="hidden" />
      <TabsContent value="create" className="hidden" />
    </Tabs>
  );

  const left = tab === 'browse' ? browseLeft : tab === 'mine' ? mineLeft : createLeft;
  const right = tab === 'browse' ? browseRight : tab === 'mine' ? mineRight : createRight;
  const footer = tab === 'browse' ? browseFooter : tab === 'mine' ? mineFooter : createFooter;
  const leftTitle = tab === 'browse'
    ? `Listings (${filteredListings.length})`
    : tab === 'mine'
      ? `Your Listings (${myListings.length})`
      : 'Eligible Items';
  const rightTitle = tab === 'browse'
    ? 'Listing Details'
    : tab === 'mine'
      ? 'Earnings'
      : 'Pricing';

  return (
    <ServicePanelShell
      open={open}
      onClose={onClose}
      icon="🏷️"
      title="Marketplace"
      subtitle={subtitle}
      headerActions={headerActions}
      tabs={tabs}
      leftTitle={leftTitle}
      rightTitle={rightTitle}
      left={left}
      right={right}
      footer={footer}
    />
  );
}
