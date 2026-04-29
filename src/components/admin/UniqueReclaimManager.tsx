import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from 'sonner';
import { RefreshCw, Crown } from 'lucide-react';

const OFFLINE_THRESHOLD_MIN = 90; // matches return_unique_items()

interface Holding {
  inv_id: string;
  character_id: string;
  character_name: string | null;
  last_online: string | null;
  equipped_slot: string | null;
  current_durability: number;
  item_id: string;
  item_name: string;
}

type ReclaimReason =
  | 'safe'
  | 'destroyed'
  | 'offline_unequipped'
  | 'offline_equipped';

function classifyReason(h: Holding): {
  reason: ReclaimReason;
  willReclaim: boolean;
  offlineMinutes: number | null;
} {
  const offlineMinutes = h.last_online
    ? Math.floor((Date.now() - new Date(h.last_online).getTime()) / 60_000)
    : null;
  const offlineEnough =
    offlineMinutes !== null && offlineMinutes >= OFFLINE_THRESHOLD_MIN;

  if (h.current_durability <= 0) {
    return { reason: 'destroyed', willReclaim: true, offlineMinutes };
  }
  if (offlineEnough && h.equipped_slot) {
    return { reason: 'offline_equipped', willReclaim: true, offlineMinutes };
  }
  if (offlineEnough && !h.equipped_slot) {
    return { reason: 'offline_unequipped', willReclaim: true, offlineMinutes };
  }
  return { reason: 'safe', willReclaim: false, offlineMinutes };
}

function formatOffline(mins: number | null): string {
  if (mins === null) return '—';
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h < 24) return `${h}h ${m}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

const REASON_LABEL: Record<ReclaimReason, string> = {
  safe: 'Safe',
  destroyed: 'Destroyed (dur ≤ 0)',
  offline_unequipped: `Offline ≥ ${OFFLINE_THRESHOLD_MIN}m, unequipped`,
  offline_equipped: `Offline ≥ ${OFFLINE_THRESHOLD_MIN}m, equipped`,
};

export default function UniqueReclaimManager() {
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [showOnlyReclaim, setShowOnlyReclaim] = useState(true);

  const load = async () => {
    setLoading(true);
    // 1. Get all unique items
    const { data: items, error: itemsErr } = await supabase
      .from('items')
      .select('id, name')
      .eq('rarity', 'unique');
    if (itemsErr) {
      toast.error('Failed to load unique items');
      setLoading(false);
      return;
    }
    const itemMap = new Map(items?.map((i) => [i.id, i.name]) ?? []);
    const itemIds = items?.map((i) => i.id) ?? [];
    if (itemIds.length === 0) {
      setHoldings([]);
      setLoading(false);
      return;
    }

    // 2. All inventory rows holding a unique item
    const { data: invs, error: invErr } = await supabase
      .from('character_inventory')
      .select('id, character_id, item_id, equipped_slot, current_durability')
      .in('item_id', itemIds);
    if (invErr) {
      toast.error('Failed to load inventory');
      setLoading(false);
      return;
    }

    // 3. Resolve characters
    const charIds = Array.from(new Set((invs ?? []).map((r) => r.character_id)));
    const { data: chars, error: charErr } = await supabase
      .from('characters')
      .select('id, name, last_online')
      .in('id', charIds);
    if (charErr) {
      toast.error('Failed to load characters');
      setLoading(false);
      return;
    }
    const charMap = new Map(chars?.map((c) => [c.id, c]) ?? []);

    const rows: Holding[] = (invs ?? []).map((r) => {
      const c = charMap.get(r.character_id);
      return {
        inv_id: r.id,
        character_id: r.character_id,
        character_name: c?.name ?? null,
        last_online: c?.last_online ?? null,
        equipped_slot: r.equipped_slot ?? null,
        current_durability: r.current_durability,
        item_id: r.item_id,
        item_name: itemMap.get(r.item_id) ?? '(unknown)',
      };
    });

    // Sort: reclaim-eligible first, then by offline time desc
    rows.sort((a, b) => {
      const ca = classifyReason(a);
      const cb = classifyReason(b);
      if (ca.willReclaim !== cb.willReclaim) return ca.willReclaim ? -1 : 1;
      return (cb.offlineMinutes ?? -1) - (ca.offlineMinutes ?? -1);
    });

    setHoldings(rows);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return holdings.filter((h) => {
      const c = classifyReason(h);
      if (showOnlyReclaim && !c.willReclaim) return false;
      if (!q) return true;
      return (
        h.item_name.toLowerCase().includes(q) ||
        (h.character_name ?? '').toLowerCase().includes(q)
      );
    });
  }, [holdings, filter, showOnlyReclaim]);

  const counts = useMemo(() => {
    let reclaim = 0;
    let destroyed = 0;
    let offlineEq = 0;
    let offlineUneq = 0;
    for (const h of holdings) {
      const c = classifyReason(h);
      if (c.willReclaim) reclaim++;
      if (c.reason === 'destroyed') destroyed++;
      if (c.reason === 'offline_equipped') offlineEq++;
      if (c.reason === 'offline_unequipped') offlineUneq++;
    }
    return {
      reclaim,
      destroyed,
      offlineEq,
      offlineUneq,
      total: holdings.length,
    };
  }, [holdings]);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-2xl flex items-center gap-2">
            <Crown className="h-5 w-5 text-primary" />
            Unique Item Reclaim
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Holders flagged for reclaim by{' '}
            <code className="text-xs">return_unique_items()</code>: durability ≤
            0, or owner offline ≥ {OFFLINE_THRESHOLD_MIN} minutes.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw
            className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`}
          />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card className="p-3">
          <div className="text-[10px] uppercase text-muted-foreground">
            Total held
          </div>
          <div className="text-2xl font-display">{counts.total}</div>
        </Card>
        <Card className="p-3 border-destructive/40">
          <div className="text-[10px] uppercase text-muted-foreground">
            Will reclaim
          </div>
          <div className="text-2xl font-display text-destructive">
            {counts.reclaim}
          </div>
        </Card>
        <Card className="p-3">
          <div className="text-[10px] uppercase text-muted-foreground">
            Destroyed
          </div>
          <div className="text-2xl font-display">{counts.destroyed}</div>
        </Card>
        <Card className="p-3">
          <div className="text-[10px] uppercase text-muted-foreground">
            Offline · equipped
          </div>
          <div className="text-2xl font-display">{counts.offlineEq}</div>
        </Card>
        <Card className="p-3">
          <div className="text-[10px] uppercase text-muted-foreground">
            Offline · unequipped
          </div>
          <div className="text-2xl font-display">{counts.offlineUneq}</div>
        </Card>
      </div>

      <div className="flex items-center gap-2">
        <Input
          placeholder="Filter by character or item name…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="max-w-sm"
        />
        <Button
          variant={showOnlyReclaim ? 'default' : 'outline'}
          size="sm"
          onClick={() => setShowOnlyReclaim((v) => !v)}
        >
          {showOnlyReclaim ? 'Showing reclaim-only' : 'Showing all'}
        </Button>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Status</TableHead>
              <TableHead>Character</TableHead>
              <TableHead>Item</TableHead>
              <TableHead>Equipped</TableHead>
              <TableHead className="text-right">Durability</TableHead>
              <TableHead className="text-right">Offline for</TableHead>
              <TableHead>Reason</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-6">
                  Loading…
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-6">
                  {showOnlyReclaim
                    ? 'No items currently eligible for reclaim.'
                    : 'No unique items held.'}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((h) => {
                const c = classifyReason(h);
                return (
                  <TableRow key={h.inv_id}>
                    <TableCell>
                      <Badge
                        variant={c.willReclaim ? 'destructive' : 'outline'}
                        className="text-[10px]"
                      >
                        {c.willReclaim ? 'Will reclaim' : 'Safe'}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-medium">
                      {h.character_name ?? (
                        <span className="text-muted-foreground">
                          #{h.character_id.slice(0, 6)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-primary">{h.item_name}</TableCell>
                    <TableCell>
                      {h.equipped_slot ? (
                        <Badge variant="secondary" className="text-[10px]">
                          {h.equipped_slot}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {h.current_durability}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatOffline(c.offlineMinutes)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {REASON_LABEL[c.reason]}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
