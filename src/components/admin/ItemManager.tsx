import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Plus, Trash2, Save, X, Package, MapPin, Skull, ShoppingBag, Search, ArrowUpDown } from 'lucide-react';
import { getItemStatBudget, calculateItemStatCost, getItemStatCap, suggestItemGoldValue, CONSUMABLE_ALLOWED_STATS } from '@/lib/game-data';

interface Item {
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
  origin_type: string | null;
  origin_id: string | null;
}

const RARITIES = ['common', 'uncommon', 'unique'];
const SLOTS = ['head', 'amulet', 'shoulders', 'chest', 'gloves', 'belt', 'pants', 'ring', 'trinket', 'main_hand', 'off_hand', 'boots'];
const ITEM_TYPES = ['equipment', 'consumable', 'material', 'quest'];
const STAT_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha', 'ac', 'hp', 'hp_regen'];

const STAT_KEY_LABELS: Record<string, string> = {
  str: 'STR', dex: 'DEX', con: 'CON', int: 'INT', wis: 'WIS', cha: 'CHA',
  ac: 'AC', hp: 'HP', hp_regen: 'REGEN',
};

const RARITY_COLORS: Record<string, string> = {
  common: 'text-foreground',
  uncommon: 'text-elvish',
  rare: 'text-dwarvish',
  unique: 'text-primary text-glow',
};

const defaultForm = (): Omit<Item, 'id'> => ({
  name: '', description: '', item_type: 'equipment', rarity: 'common',
  slot: null, stats: {}, value: 0, max_durability: 100, hands: null, level: 1,
  origin_type: null, origin_id: null,
});

function BudgetIndicator({ level, rarity, stats, hands, itemType }: { level: number; rarity: string; stats: Record<string, number>; hands?: number; itemType?: string }) {
  const budget = getItemStatBudget(level, rarity, hands, itemType);
  const used = calculateItemStatCost(stats);
  const pct = budget > 0 ? Math.min((used / budget) * 100, 100) : 0;
  const over = used > budget;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className="text-[10px] text-muted-foreground">Stat Budget</label>
        <span className={`text-xs font-display ${over ? 'text-destructive' : 'text-chart-2'}`}>
          {used} / {budget} pts
        </span>
      </div>
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-secondary">
        <div
          className={`h-full transition-all ${over ? 'bg-destructive' : 'bg-chart-2'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {over && <p className="text-[10px] text-destructive">Over budget by {(used - budget).toFixed(1)} pts</p>}
    </div>
  );
}

export default function ItemManager() {
  const [items, setItems] = useState<Item[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [form, setForm] = useState(defaultForm());
  const [filter, setFilter] = useState('');
  const [typeTab, setTypeTab] = useState<string>('all');
  const [slotTab, setSlotTab] = useState<string>('all');
  const [rarityTab, setRarityTab] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'name' | 'level' | 'value' | 'rarity'>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [loading, setLoading] = useState(false);
  const [showUnassigned, setShowUnassigned] = useState(false);
  const [usedItemIds, setUsedItemIds] = useState<Set<string>>(new Set());
  const [allCreatures, setAllCreatures] = useState<{ id: string; name: string }[]>([]);
  const [allNodes, setAllNodes] = useState<{ id: string; name: string }[]>([]);
  const [itemUsage, setItemUsage] = useState<{
    creatures: { id: string; name: string; chance: number }[];
    searchNodes: { id: string; name: string; chance: number }[];
    vendors: { id: string; name: string; node_name: string; price: number }[];
    lootTables: { id: string; name: string; weight: number }[];
    holder?: { character_name: string; character_id: string } | null;
  } | null>(null);

  const loadItems = async () => {
    const { data } = await supabase.from('items').select('*').order('name');
    if (data) setItems(data as Item[]);
  };

  const loadItemUsage = async (itemId: string, itemRarity?: string) => {
    const [creaturesRes, nodesRes, vendorRes, lootEntryRes, lootTablesRes] = await Promise.all([
      supabase.from('creatures').select('id, name, loot_table'),
      supabase.from('nodes').select('id, name, searchable_items'),
      supabase.from('vendor_inventory').select('id, item_id, node_id, price').eq('item_id', itemId),
      supabase.from('loot_table_entries').select('loot_table_id, weight').eq('item_id', itemId),
      supabase.from('loot_tables').select('id, name'),
    ]);

    const creatures: { id: string; name: string; chance: number }[] = [];
    for (const c of (creaturesRes.data || [])) {
      const loot = (c.loot_table as any[]) || [];
      const entry = loot.find((l: any) => l.item_id === itemId);
      if (entry) creatures.push({ id: c.id, name: c.name, chance: entry.chance });
    }

    const searchNodes: { id: string; name: string; chance: number }[] = [];
    for (const n of (nodesRes.data || [])) {
      const items = (n.searchable_items as any[]) || [];
      const entry = items.find((l: any) => l.item_id === itemId);
      if (entry) searchNodes.push({ id: n.id, name: n.name, chance: entry.chance });
    }

    const nodeMap = new Map((nodesRes.data || []).map(n => [n.id, n.name]));
    const vendors = (vendorRes.data || []).map(v => ({
      id: v.id,
      name: '', 
      node_name: nodeMap.get(v.node_id) || 'Unknown',
      price: v.price,
    }));

    const ltMap = new Map((lootTablesRes.data || []).map(t => [t.id, t.name]));
    const lootTables = (lootEntryRes.data || []).map(e => ({
      id: e.loot_table_id,
      name: ltMap.get(e.loot_table_id) || 'Unknown',
      weight: e.weight,
    }));

    // Check if unique item is currently held by a player
    let holder: { character_name: string; character_id: string } | null = null;
    if (itemRarity === 'unique') {
      const { data: held } = await supabase
        .from('character_inventory')
        .select('character_id, character:characters(name)')
        .eq('item_id', itemId)
        .limit(1);
      if (held && held.length > 0) {
        const h = held[0] as any;
        holder = { character_id: h.character_id, character_name: h.character?.name || 'Unknown' };
      }
    }

    setItemUsage({ creatures, searchNodes, vendors, lootTables, holder });
  };

  const loadUsedItemIds = async () => {
    const [creaturesRes, nodesRes, vendorRes, startingGearRes, lootTableEntriesRes] = await Promise.all([
      supabase.from('creatures').select('loot_table'),
      supabase.from('nodes').select('searchable_items'),
      supabase.from('vendor_inventory').select('item_id'),
      supabase.from('class_starting_gear').select('item_id'),
      supabase.from('loot_table_entries').select('item_id'),
    ]);
    const ids = new Set<string>();
    for (const c of (creaturesRes.data || [])) {
      for (const e of ((c.loot_table as any[]) || [])) {
        if (e.item_id) ids.add(e.item_id);
      }
    }
    for (const n of (nodesRes.data || [])) {
      for (const e of ((n.searchable_items as any[]) || [])) {
        if (e.item_id) ids.add(e.item_id);
      }
    }
    for (const v of (vendorRes.data || [])) ids.add(v.item_id);
    for (const g of (startingGearRes.data || [])) ids.add(g.item_id);
    for (const lt of (lootTableEntriesRes.data || [])) ids.add(lt.item_id);
    setUsedItemIds(ids);
  };

  useEffect(() => {
    loadItems();
    loadUsedItemIds();
    supabase.from('creatures').select('id, name').order('name').then(({ data }) => { if (data) setAllCreatures(data); });
    supabase.from('nodes').select('id, name').order('name').then(({ data }) => { if (data) setAllNodes(data); });
  }, []);

  const openNew = () => {
    setSelectedId(null);
    setIsNew(true);
    setForm(defaultForm());
  };

  const openEdit = (item: Item) => {
    setSelectedId(item.id);
    setIsNew(false);
    setForm({
      name: item.name, description: item.description, item_type: item.item_type,
      rarity: item.rarity, slot: item.slot, stats: { ...item.stats },
      value: item.value, max_durability: item.max_durability, hands: item.hands,
      level: item.level ?? 1,
      origin_type: item.origin_type, origin_id: item.origin_id,
    });
    loadItemUsage(item.id, item.rarity);
  };

  const closePanel = () => {
    setSelectedId(null);
    setIsNew(false);
    setItemUsage(null);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return toast.error('Name is required');
    if (form.name.length > 100) return toast.error('Name must be under 100 characters');

    const budget = getItemStatBudget(form.level, form.rarity, form.hands ?? 1, form.item_type);
    const cost = calculateItemStatCost(form.stats);
    if (cost > budget) return toast.error(`Stat cost (${cost}) exceeds budget (${budget})`);

    setLoading(true);

    const payload: any = {
      name: form.name.trim(),
      description: form.description.trim(),
      item_type: form.item_type,
      rarity: form.rarity as any,
      slot: form.item_type === 'equipment' ? form.slot as any : null,
      stats: form.stats,
      value: Math.max(0, form.value),
      max_durability: Math.max(1, form.max_durability),
      hands: (form.item_type === 'equipment' && (form.slot === 'main_hand' || form.slot === 'off_hand')) || form.item_type === 'shield' ? form.hands : null,
      level: Math.max(1, Math.min(100, form.level)),
      origin_type: form.rarity === 'unique' ? form.origin_type : null,
      origin_id: form.rarity === 'unique' ? form.origin_id : null,
    };

    let savedId = selectedId;
    if (selectedId) {
      const { error } = await supabase.from('items').update(payload).eq('id', selectedId);
      if (error) { toast.error(error.message); setLoading(false); return; }
      toast.success('Item updated');
    } else {
      const { data, error } = await supabase.from('items').insert(payload).select().single();
      if (error) { toast.error(error.message); setLoading(false); return; }
      toast.success('Item created');
      if (data) { savedId = data.id; setSelectedId(data.id); setIsNew(false); }
    }
    setLoading(false);
    const { data: refreshed } = await supabase.from('items').select('*').order('name');
    if (refreshed) {
      setItems(refreshed as Item[]);
      const updated = refreshed.find((i: any) => i.id === savedId);
      if (updated) {
        openEdit(updated as Item);
      }
    }
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from('items').delete().eq('id', id);
    if (error) return toast.error(error.message);
    toast.success('Item deleted');
    if (selectedId === id) closePanel();
    loadItems();
  };

  const setStat = (key: string, val: number) => {
    const cap = getItemStatCap(key, form.level, form.item_type);
    const clamped = Math.max(0, Math.min(val, cap));
    setForm(f => {
      const stats = { ...f.stats };
      if (clamped === 0) { delete stats[key]; } else { stats[key] = clamped; }
      return { ...f, stats };
    });
  };

  const panelOpen = isNew || selectedId !== null;

  const unassignedCount = items.filter(i => !usedItemIds.has(i.id)).length;

  const RARITY_ORDER: Record<string, number> = { common: 0, uncommon: 1, rare: 2, unique: 3 };

  const filtered = items.filter(i => {
    if (showUnassigned && usedItemIds.has(i.id)) return false;
    if (typeTab !== 'all' && i.item_type !== typeTab) return false;
    if ((typeTab === 'equipment' || typeTab === 'shield') && slotTab !== 'all') {
      if (i.slot !== slotTab) return false;
    }
    if (rarityTab !== 'all' && i.rarity !== rarityTab) return false;
    if (!filter) return true;
    return i.name.toLowerCase().includes(filter.toLowerCase()) ||
      i.rarity.includes(filter.toLowerCase());
  }).sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1;
    if (sortBy === 'name') return dir * a.name.localeCompare(b.name);
    if (sortBy === 'level') return dir * ((a.level ?? 1) - (b.level ?? 1));
    if (sortBy === 'value') return dir * (a.value - b.value);
    if (sortBy === 'rarity') return dir * ((RARITY_ORDER[a.rarity] ?? 0) - (RARITY_ORDER[b.rarity] ?? 0));
    return 0;
  });

  return (
    <div className="h-full flex">
      {/* Left: Item List */}
      <div className="flex flex-col w-1/2 border-r border-border transition-all">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
          <Package className="w-4 h-4 text-primary" />
          <h2 className="font-display text-sm text-primary">Items</h2>
          <span className="text-xs text-muted-foreground">({filtered.length})</span>
          <div className="flex-1" />
          <Input placeholder="Search..." value={filter} onChange={e => setFilter(e.target.value)} className="w-36 h-7 text-xs" />
          <button
            onClick={() => setShowUnassigned(v => !v)}
            className={`px-2 py-0.5 rounded text-[10px] font-display transition-colors ${
              showUnassigned
                ? 'bg-destructive/20 text-destructive border border-destructive/50'
                : 'bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            }`}
          >
            Unassigned ({unassignedCount})
          </button>
          <Button size="sm" onClick={openNew} className="font-display text-xs h-7">
            <Plus className="w-3 h-3 mr-1" /> New
          </Button>
        </div>
        <div className="flex items-center gap-1 px-4 py-1.5 border-b border-border bg-card/30 shrink-0 flex-wrap">
          {['all', ...ITEM_TYPES].map(t => (
            <button
              key={t}
              onClick={() => { setTypeTab(t); setSlotTab('all'); setRarityTab('all'); }}
              className={`px-2 py-0.5 rounded text-[10px] font-display capitalize transition-colors ${
                typeTab === t
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              }`}
            >
              {t} {t !== 'all' ? `(${items.filter(i => i.item_type === t).length})` : `(${items.length})`}
            </button>
          ))}
        </div>
        {(typeTab === 'equipment' || typeTab === 'shield') && (
          <div className="flex items-center gap-1 px-4 py-1 border-b border-border bg-card/20 shrink-0 flex-wrap">
            {['all', ...(typeTab === 'shield' ? ['off_hand'] : SLOTS)].map(s => {
              const count = items.filter(i => i.item_type === typeTab && (s === 'all' || i.slot === s)).length;
              return (
                <button
                  key={s}
                  onClick={() => setSlotTab(s)}
                  className={`px-1.5 py-0.5 rounded text-[9px] font-display capitalize transition-colors ${
                    slotTab === s
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
                >
                  {s === 'all' ? 'All' : s.replace('_', ' ')} ({count})
                </button>
              );
            })}
          </div>
        )}
        {/* Rarity filter + Sort controls */}
        <div className="flex items-center gap-1 px-4 py-1 border-b border-border bg-card/20 shrink-0 flex-wrap">
          {['all', ...RARITIES].map(r => {
            const count = items.filter(i => {
              if (typeTab !== 'all' && i.item_type !== typeTab) return false;
              return r === 'all' || i.rarity === r;
            }).length;
            return (
              <button
                key={r}
                onClick={() => setRarityTab(r)}
                className={`px-1.5 py-0.5 rounded text-[9px] font-display capitalize transition-colors ${
                  rarityTab === r
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                } ${r !== 'all' ? RARITY_COLORS[r] : ''}`}
              >
                {r === 'all' ? 'All Rarities' : r} ({count})
              </button>
            );
          })}
          <div className="flex-1" />
          <div className="flex items-center gap-1">
            <ArrowUpDown className="w-3 h-3 text-muted-foreground" />
            {(['name', 'level', 'value', 'rarity'] as const).map(s => (
              <button
                key={s}
                onClick={() => {
                  if (sortBy === s) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
                  else { setSortBy(s); setSortDir('asc'); }
                }}
                className={`px-1.5 py-0.5 rounded text-[9px] font-display capitalize transition-colors ${
                  sortBy === s
                    ? 'bg-primary/20 text-primary border border-primary/30'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                {s}{sortBy === s ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
              </button>
            ))}
          </div>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-3 space-y-1.5">
            {filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8 italic">
                {items.length === 0 ? 'No items yet.' : 'No match.'}
              </p>
            ) : filtered.map(item => (
              <div
                key={item.id}
                className={`flex items-center justify-between p-2 rounded border transition-colors cursor-pointer ${
                  selectedId === item.id ? 'border-primary bg-primary/10' : 'border-border bg-card/50 hover:bg-card/80'
                }`}
                onClick={() => openEdit(item)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`font-display text-sm ${RARITY_COLORS[item.rarity]}`}>{item.name}</span>
                    <span className="text-[10px] text-muted-foreground capitalize px-1 py-0.5 rounded bg-background/50 border border-border">{item.rarity}</span>
                    <span className="text-[10px] text-muted-foreground px-1 py-0.5 rounded bg-background/50 border border-border">Lv{item.level ?? 1}</span>
                    {item.slot && (
                      <span className="text-[10px] text-muted-foreground capitalize px-1 py-0.5 rounded bg-background/50 border border-border">{item.slot.replace('_', ' ')}</span>
                    )}
                    <span className="text-[10px] text-muted-foreground">{item.item_type}</span>
                  </div>
                  <div className="flex items-center gap-3 mt-0.5">
                    <span className="text-[10px] text-primary shrink-0">{item.value}g</span>
                    <span className="text-[10px] text-muted-foreground shrink-0">Dur: {item.max_durability}</span>
                    {item.hands && <span className="text-[10px] text-muted-foreground shrink-0">{item.hands}H</span>}
                    {Object.entries(item.stats || {}).map(([k, v]) => (
                      <span key={k} className={`text-[10px] shrink-0 ${k === 'hp_regen' ? 'text-elvish' : 'text-chart-2'}`}>
                        {k === 'hp_regen' ? `+${v} Regen` : `+${v} ${k.toUpperCase()}`}
                      </span>
                    ))}
                  </div>
                </div>
                <Button size="sm" variant="destructive" onClick={(e) => { e.stopPropagation(); handleDelete(item.id); }} className="h-7 w-7 p-0 shrink-0 ml-2">
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            ))}
          </div>
        </ScrollArea>
      </div>

      {/* Right: Properties Panel */}
      <div className="w-1/2 flex flex-col bg-card/50">
        {panelOpen ? (
          <>
          <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
            <h2 className="font-display text-sm text-primary text-glow truncate">
              {selectedId ? `Edit: ${form.name || 'Item'}` : 'New Item'}
            </h2>
            <Button variant="ghost" size="sm" onClick={closePanel} className="h-6 w-6 p-0">
              <X className="w-4 h-4" />
            </Button>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-3 space-y-3">
              <Input placeholder="Item name" value={form.name} maxLength={100}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="h-8 text-xs" />
              <Textarea placeholder="Description" value={form.description} maxLength={500}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} className="text-xs" />

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-[10px] text-muted-foreground">Type</label>
                  <Select value={form.item_type} onValueChange={v => setForm(f => ({ ...f, item_type: v, slot: v === 'shield' ? 'off_hand' : f.slot, hands: v === 'shield' ? 1 : f.hands }))}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent className="bg-popover border-border z-50">
                      {ITEM_TYPES.map(t => (
                        <SelectItem key={t} value={t} className="capitalize text-xs">{t}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground">Rarity</label>
                  <Select value={form.rarity} onValueChange={v => setForm(f => ({ ...f, rarity: v }))}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent className="bg-popover border-border z-50">
                      {RARITIES.map(r => (
                        <SelectItem key={r} value={r} className="capitalize text-xs">
                          <span className={RARITY_COLORS[r]}>{r}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground">Level</label>
                  <Input type="number" min={1} max={100} value={form.level}
                    onChange={e => setForm(f => ({ ...f, level: Math.max(1, Math.min(100, +e.target.value)) }))} className="h-8 text-xs" />
                </div>
              </div>

              <BudgetIndicator level={form.level} rarity={form.rarity} stats={form.stats} hands={form.hands ?? 1} itemType={form.item_type} />

              {(form.item_type === 'equipment' || form.item_type === 'shield') && (
                <div>
                  <label className="text-[10px] text-muted-foreground">Equipment Slot</label>
                  <Select value={form.slot || ''} onValueChange={v => setForm(f => ({ ...f, slot: v || null }))}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select slot" /></SelectTrigger>
                    <SelectContent className="bg-popover border-border z-50">
                      {(form.item_type === 'shield' ? ['off_hand'] : SLOTS).map(s => (
                        <SelectItem key={s} value={s} className="capitalize text-xs">{s.replace('_', ' ')}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Potion slots for belt items */}
              {(form.item_type === 'equipment' || form.item_type === 'shield') && form.slot === 'belt' && (
                <div>
                  <label className="text-[10px] text-muted-foreground">Potion Slots</label>
                  <Input type="number" min={0} max={10} value={form.stats.potion_slots || 0}
                    onChange={e => setStat('potion_slots', Math.max(0, Math.min(10, +e.target.value)))}
                    className="h-8 text-xs w-24" />
                  <p className="text-[9px] text-muted-foreground mt-0.5">How many potions can be loaded into this belt for combat use.</p>
                </div>
              )}

              {form.item_type === 'equipment' && (form.slot === 'main_hand' || form.slot === 'off_hand') && (
                <div>
                  <label className="text-[10px] text-muted-foreground">Hands Required</label>
                  <Select value={String(form.hands || 1)} onValueChange={v => setForm(f => ({ ...f, hands: +v }))}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent className="bg-popover border-border z-50">
                      <SelectItem value="1" className="text-xs">One-Handed</SelectItem>
                      <SelectItem value="2" className="text-xs">Two-Handed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-muted-foreground">Gold Value</label>
                  <div className="flex items-center gap-1">
                    <Input type="number" min={0} value={form.value}
                      onChange={e => setForm(f => ({ ...f, value: Math.max(0, +e.target.value) }))} className="h-8 text-xs flex-1" />
                    <Button type="button" variant="outline" size="sm" className="h-8 text-[10px] px-2 shrink-0"
                      onClick={() => setForm(f => ({ ...f, value: suggestItemGoldValue(f.level, f.rarity) }))}>
                      Auto
                    </Button>
                  </div>
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground">Max Durability</label>
                  <Input type="number" min={1} value={100} disabled className="h-8 text-xs opacity-50" />
                  <p className="text-[9px] text-muted-foreground mt-0.5">Fixed at 100</p>
                </div>
              </div>

              <div>
                <label className="text-[10px] text-muted-foreground">
                  Stat Bonuses {form.item_type === 'consumable' ? '(HP & Regen only, no caps)' : '(capped per stat)'}
                </label>
                <div className="grid grid-cols-4 gap-1.5 mt-1">
                  {STAT_KEYS.filter(key => form.item_type !== 'consumable' || CONSUMABLE_ALLOWED_STATS.includes(key)).map(key => (
                    <div key={key} className="flex items-center gap-1">
                      <span className={`text-[10px] uppercase w-8 ${key === 'hp_regen' ? 'text-elvish' : 'text-muted-foreground'}`}>{STAT_KEY_LABELS[key] || key}</span>
                      <Input type="number" min={0} max={getItemStatCap(key, form.level, form.item_type)}
                        value={form.stats[key] || 0}
                        onChange={e => setStat(key, Math.max(0, +e.target.value))}
                        className="h-7 text-xs text-center" />
                    </div>
                  ))}
                </div>
              </div>

              {/* Origin tracking for unique items */}
              {form.rarity === 'unique' && (
                <div className="space-y-2 border-t border-border pt-3">
                  <label className="text-[10px] text-muted-foreground font-display">Unique Item Origin (where it returns when broken/offline)</label>
                  
                  {/* Holder indicator */}
                  {selectedId && itemUsage && (
                    <div className={`flex items-center gap-2 px-2 py-1.5 rounded border text-xs font-display ${
                      itemUsage.holder 
                        ? 'border-primary/40 bg-primary/10 text-primary' 
                        : 'border-chart-2/40 bg-chart-2/10 text-chart-2'
                    }`}>
                      {itemUsage.holder ? (
                        <>
                          <span className="text-[10px] uppercase tracking-wider opacity-70">Held by</span>
                          <span className="font-semibold">{itemUsage.holder.character_name}</span>
                        </>
                      ) : (
                        <>
                          <span className="text-[10px] uppercase tracking-wider opacity-70">Status</span>
                          <span className="font-semibold">Available — not held by any player</span>
                        </>
                      )}
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-muted-foreground">Origin Type</label>
                      <Select value={form.origin_type || ''} onValueChange={v => setForm(f => ({ ...f, origin_type: v || null, origin_id: null }))}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="None" /></SelectTrigger>
                        <SelectContent className="bg-popover border-border z-50">
                          <SelectItem value="creature" className="text-xs">Creature</SelectItem>
                          <SelectItem value="node" className="text-xs">Node (search)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground">
                        {form.origin_type === 'creature' ? 'Source Creature' : form.origin_type === 'node' ? 'Source Node' : 'Source'}
                      </label>
                      <Select value={form.origin_id || ''} onValueChange={v => setForm(f => ({ ...f, origin_id: v || null }))} disabled={!form.origin_type}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select..." /></SelectTrigger>
                        <SelectContent className="bg-popover border-border z-50 max-h-60">
                          {(form.origin_type === 'creature' ? allCreatures : allNodes).map(e => (
                            <SelectItem key={e.id} value={e.id} className="text-xs">{e.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              )}

              {/* Used In section */}
              {selectedId && itemUsage && (itemUsage.creatures.length > 0 || itemUsage.searchNodes.length > 0 || itemUsage.vendors.length > 0 || itemUsage.lootTables.length > 0) && (
                <div className="space-y-2 border-t border-border pt-3">
                  <p className="font-display text-xs text-primary">📍 Used In</p>
                  {itemUsage.creatures.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-[10px] text-muted-foreground flex items-center gap-1"><Skull className="w-3 h-3" /> Creature Loot Tables</p>
                      {itemUsage.creatures.map(c => (
                        <div key={c.id} className="flex items-center justify-between px-2 py-1 rounded bg-background/40 border border-border text-xs">
                          <span className="text-foreground">{c.name}</span>
                          <span className="text-muted-foreground">{(c.chance * 100).toFixed(0)}% drop</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {itemUsage.searchNodes.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-[10px] text-muted-foreground flex items-center gap-1"><Search className="w-3 h-3" /> Node Searchable Items</p>
                      {itemUsage.searchNodes.map(n => (
                        <div key={n.id} className="flex items-center justify-between px-2 py-1 rounded bg-background/40 border border-border text-xs">
                          <span className="text-foreground">{n.name}</span>
                          <span className="text-muted-foreground">{(n.chance * 100).toFixed(0)}% find</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {itemUsage.vendors.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-[10px] text-muted-foreground flex items-center gap-1"><ShoppingBag className="w-3 h-3" /> Vendor Inventory</p>
                      {itemUsage.vendors.map(v => (
                        <div key={v.id} className="flex items-center justify-between px-2 py-1 rounded bg-background/40 border border-border text-xs">
                          <span className="text-foreground">{v.node_name}</span>
                          <span className="text-primary">{v.price}g</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {itemUsage.lootTables.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-[10px] text-muted-foreground flex items-center gap-1"><Package className="w-3 h-3" /> Loot Tables</p>
                      {itemUsage.lootTables.map(lt => (
                        <div key={lt.id} className="flex items-center justify-between px-2 py-1 rounded bg-background/40 border border-border text-xs">
                          <span className="text-foreground">{lt.name}</span>
                          <span className="text-muted-foreground">weight {lt.weight}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <Button onClick={handleSave} disabled={loading} className="font-display text-xs">
                  <Save className="w-3 h-3 mr-1" /> {selectedId ? 'Update' : 'Create'}
                </Button>
                <Button variant="outline" onClick={closePanel} className="font-display text-xs">
                  <X className="w-3 h-3 mr-1" /> Cancel
                </Button>
              </div>
            </div>
          </ScrollArea>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground/50 text-sm italic font-display">
            Select an item to edit
          </div>
        )}
      </div>
    </div>
  );
}
