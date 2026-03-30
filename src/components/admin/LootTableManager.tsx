import { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Slider } from '@/components/ui/slider';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Plus, Trash2, Save, X, Package } from 'lucide-react';
import ItemPicker from './ItemPicker';

interface LootTable {
  id: string;
  name: string;
  created_at: string;
}

interface LootEntry {
  id: string;
  loot_table_id: string;
  item_id: string;
  weight: number;
}

interface ItemOption {
  id: string;
  name: string;
  rarity: string;
  level: number;
}

const _RARITY_COLORS: Record<string, string> = {
  common: 'text-foreground',
  uncommon: 'text-elvish',
  rare: 'text-dwarvish',
  unique: 'text-primary text-glow',
};

export default function LootTableManager() {
  const [tables, setTables] = useState<LootTable[]>([]);
  const [items, setItems] = useState<ItemOption[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [tableName, setTableName] = useState('');
  const [entries, setEntries] = useState<LootEntry[]>([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(false);
  // Track how many creatures use each table
  const [creatureCounts, setCreatureCounts] = useState<Map<string, number>>(new Map());

  const loadData = async () => {
    const [t, i, c] = await Promise.all([
      supabase.from('loot_tables').select('*').order('name'),
      supabase.from('items').select('id, name, rarity, level').order('name'),
      supabase.from('creatures').select('loot_table_id'),
    ]);
    if (t.data) setTables(t.data as LootTable[]);
    if (i.data) setItems(i.data as ItemOption[]);
    if (c.data) {
      const counts = new Map<string, number>();
      for (const cr of c.data) {
        if (cr.loot_table_id) counts.set(cr.loot_table_id, (counts.get(cr.loot_table_id) || 0) + 1);
      }
      setCreatureCounts(counts);
    }
  };

  useEffect(() => { loadData(); }, []);

  const openNew = () => {
    setSelectedId(null);
    setIsNew(true);
    setTableName('');
    setEntries([]);
  };

  const openEdit = async (table: LootTable) => {
    setSelectedId(table.id);
    setIsNew(false);
    setTableName(table.name);
    const { data } = await supabase.from('loot_table_entries').select('*').eq('loot_table_id', table.id);
    setEntries((data || []) as LootEntry[]);
  };

  const closePanel = () => {
    setSelectedId(null);
    setIsNew(false);
  };

  const handleSave = async () => {
    if (!tableName.trim()) return toast.error('Name is required');
    setLoading(true);

    let tableId = selectedId;
    if (selectedId) {
      const { error } = await supabase.from('loot_tables').update({ name: tableName.trim() }).eq('id', selectedId);
      if (error) { toast.error(error.message); setLoading(false); return; }
    } else {
      const { data, error } = await supabase.from('loot_tables').insert({ name: tableName.trim() }).select().single();
      if (error) { toast.error(error.message); setLoading(false); return; }
      tableId = data.id;
      setSelectedId(data.id);
      setIsNew(false);
    }

    // Sync entries: delete all, re-insert
    await supabase.from('loot_table_entries').delete().eq('loot_table_id', tableId!);
    if (entries.length > 0) {
      const rows = entries.map(e => ({ loot_table_id: tableId!, item_id: e.item_id, weight: e.weight }));
      const { error } = await supabase.from('loot_table_entries').insert(rows);
      if (error) { toast.error(error.message); setLoading(false); return; }
    }

    toast.success(selectedId ? 'Loot table updated' : 'Loot table created');
    setLoading(false);
    loadData();
    // Reload entries
    const { data: refreshed } = await supabase.from('loot_table_entries').select('*').eq('loot_table_id', tableId!);
    if (refreshed) setEntries(refreshed as LootEntry[]);
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from('loot_tables').delete().eq('id', id);
    if (error) return toast.error(error.message);
    toast.success('Loot table deleted');
    if (selectedId === id) closePanel();
    loadData();
  };

  const addEntry = () => {
    if (items.length === 0) return;
    setEntries(prev => [...prev, { id: crypto.randomUUID(), loot_table_id: selectedId || '', item_id: items[0].id, weight: 10 }]);
  };

  const updateEntry = (idx: number, field: 'item_id' | 'weight', value: string | number) => {
    setEntries(prev => prev.map((e, i) => i === idx ? { ...e, [field]: value } : e));
  };

  const removeEntry = (idx: number) => {
    setEntries(prev => prev.filter((_, i) => i !== idx));
  };

  const totalWeight = useMemo(() => entries.reduce((s, e) => s + e.weight, 0), [entries]);

  const _getItemName = (id: string) => items.find(i => i.id === id)?.name || 'Unknown';
  const _getItemRarity = (id: string) => items.find(i => i.id === id)?.rarity || 'common';

  const filtered = tables.filter(t => t.name.toLowerCase().includes(filter.toLowerCase()));
  const panelOpen = isNew || selectedId !== null;

  return (
    <div className="h-full flex">
      {/* Left: Table List */}
      <div className="flex flex-col w-1/2 border-r border-border">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
          <Package className="w-4 h-4 text-primary" />
          <h2 className="font-display text-sm text-primary">Loot Tables</h2>
          <span className="text-xs text-muted-foreground">({tables.length})</span>
          <div className="flex-1" />
          <Input placeholder="Search..." value={filter} onChange={e => setFilter(e.target.value)} className="w-36 h-7 text-xs" />
          <Button size="sm" onClick={openNew} className="font-display text-xs h-7">
            <Plus className="w-3 h-3 mr-1" /> New
          </Button>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-3 space-y-1.5">
            {filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8 italic">No loot tables yet.</p>
            ) : filtered.map(table => (
              <div
                key={table.id}
                className={`flex items-center justify-between p-2 rounded border transition-colors cursor-pointer ${
                  selectedId === table.id ? 'border-primary bg-primary/10' : 'border-border bg-card/50 hover:bg-card/80'
                }`}
                onClick={() => openEdit(table)}
              >
                <div className="flex-1 min-w-0">
                  <span className="font-display text-sm">{table.name}</span>
                  <span className="text-[10px] text-muted-foreground ml-2">
                    {creatureCounts.get(table.id) || 0} creatures
                  </span>
                </div>
                <Button size="sm" variant="destructive" onClick={(e) => { e.stopPropagation(); handleDelete(table.id); }} className="h-7 w-7 p-0 shrink-0 ml-2">
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            ))}
          </div>
        </ScrollArea>
      </div>

      {/* Right: Editor */}
      <div className="w-1/2 flex flex-col bg-card/50">
        {panelOpen ? (
          <>
            <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
              <h2 className="font-display text-sm text-primary text-glow truncate">
                {selectedId ? `Edit: ${tableName || 'Table'}` : 'New Loot Table'}
              </h2>
              <Button variant="ghost" size="sm" onClick={closePanel} className="h-6 w-6 p-0">
                <X className="w-4 h-4" />
              </Button>
            </div>
            <ScrollArea className="flex-1">
              <div className="p-3 space-y-3">
                <Input placeholder="Table name (e.g. Forest Beasts Lvl 1-5)" value={tableName}
                  onChange={e => setTableName(e.target.value)} className="h-8 text-xs" />

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="font-display text-xs text-primary">Items ({entries.length})</p>
                    <Button size="sm" variant="outline" onClick={addEntry} className="h-6 text-[10px]">
                      <Plus className="w-3 h-3 mr-1" /> Add Item
                    </Button>
                  </div>

                  {entries.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">No items. Add items to define what can drop.</p>
                  ) : entries.map((entry, idx) => {
                    const pct = totalWeight > 0 ? ((entry.weight / totalWeight) * 100).toFixed(1) : '0.0';
                    return (
                      <div key={entry.id} className="flex items-center gap-2 p-2 bg-background/50 rounded border border-border">
                        <div className="flex-1">
                          <ItemPicker
                            items={items}
                            value={entry.item_id}
                            onChange={v => { if (v) updateEntry(idx, 'item_id', v); }}
                            placeholder="Select item…"
                            className="h-7"
                          />
                        </div>
                        <div className="flex items-center gap-1 w-32 shrink-0">
                          <Slider
                            value={[entry.weight]}
                            onValueChange={([v]) => updateEntry(idx, 'weight', v)}
                            min={1} max={100} step={1}
                            className="flex-1"
                          />
                          <span className="text-[10px] text-muted-foreground w-6 text-right">{entry.weight}</span>
                        </div>
                        <span className="text-[10px] text-primary w-12 text-right font-mono">{pct}%</span>
                        <Button size="sm" variant="ghost" onClick={() => removeEntry(idx)} className="h-6 w-6 p-0 text-destructive">
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    );
                  })}

                  {entries.length > 0 && (
                    <div className="text-[10px] text-muted-foreground">
                      Total weight: {totalWeight}. One item is selected per kill using weighted random.
                    </div>
                  )}
                </div>

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
            Select a loot table to edit
          </div>
        )}
      </div>
    </div>
  );
}
