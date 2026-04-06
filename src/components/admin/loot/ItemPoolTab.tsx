import { useState, useEffect, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface PoolItem {
  id: string;
  name: string;
  level: number;
  rarity: string;
  item_type: string;
  slot: string | null;
  world_drop: boolean;
  drop_weight: number;
  weapon_tag: string | null;
}

const RARITY_COLORS: Record<string, string> = {
  common: 'text-foreground',
  uncommon: 'text-emerald-400',
  unique: 'text-primary text-glow',
};

export default function ItemPoolTab() {
  const [items, setItems] = useState<PoolItem[]>([]);
  const [filter, setFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'equipment' | 'consumable'>('all');
  const [rarityFilter, setRarityFilter] = useState<string>('all');
  const [worldDropFilter, setWorldDropFilter] = useState<'all' | 'yes' | 'no'>('all');
  const [pendingChanges, setPendingChanges] = useState<Map<string, Partial<PoolItem>>>(new Map());

  const loadItems = async () => {
    const { data } = await supabase
      .from('items')
      .select('id, name, level, rarity, item_type, slot, world_drop, drop_weight, weapon_tag')
      .in('item_type', ['equipment', 'consumable'])
      .order('level')
      .order('name');
    if (data) setItems(data as PoolItem[]);
  };

  useEffect(() => { loadItems(); }, []);

  const filtered = useMemo(() => {
    return items.filter(i => {
      if (filter && !i.name.toLowerCase().includes(filter.toLowerCase())) return false;
      if (typeFilter !== 'all' && i.item_type !== typeFilter) return false;
      if (rarityFilter !== 'all' && i.rarity !== rarityFilter) return false;
      if (worldDropFilter === 'yes' && !getEffective(i, 'world_drop')) return false;
      if (worldDropFilter === 'no' && getEffective(i, 'world_drop')) return false;
      return true;
    });
  }, [items, filter, typeFilter, rarityFilter, worldDropFilter, pendingChanges]);

  function getEffective<K extends keyof PoolItem>(item: PoolItem, field: K): PoolItem[K] {
    const pending = pendingChanges.get(item.id);
    if (pending && field in pending) return pending[field] as PoolItem[K];
    return item[field];
  }

  const updateItem = (id: string, field: string, value: any) => {
    setPendingChanges(prev => {
      const next = new Map(prev);
      const existing = next.get(id) || {};
      next.set(id, { ...existing, [field]: value });
      return next;
    });
  };

  const saveAll = async () => {
    const entries = [...pendingChanges.entries()];
    if (entries.length === 0) return toast.info('No changes to save');

    let errors = 0;
    for (const [id, changes] of entries) {
      const { error } = await supabase.from('items').update(changes as any).eq('id', id);
      if (error) errors++;
    }
    if (errors) toast.error(`${errors} items failed to save`);
    else toast.success(`${entries.length} items updated`);
    setPendingChanges(new Map());
    loadItems();
  };

  const bulkToggleWorldDrop = async (value: boolean) => {
    const ids = filtered.map(i => i.id);
    if (ids.length === 0) return;
    const { error } = await supabase.from('items').update({ world_drop: value } as any).in('id', ids);
    if (error) return toast.error(error.message);
    toast.success(`${ids.length} items set to world_drop = ${value}`);
    setPendingChanges(new Map());
    loadItems();
  };

  const worldDropCount = useMemo(() => items.filter(i => getEffective(i, 'world_drop')).length, [items, pendingChanges]);

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0 flex-wrap">
        <Input placeholder="Search items..." value={filter} onChange={e => setFilter(e.target.value)} className="w-40 h-7 text-xs" />
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value as any)} className="h-7 text-xs bg-background border border-border rounded px-1.5">
          <option value="all">All Types</option>
          <option value="equipment">Equipment</option>
          <option value="consumable">Consumable</option>
        </select>
        <select value={rarityFilter} onChange={e => setRarityFilter(e.target.value)} className="h-7 text-xs bg-background border border-border rounded px-1.5">
          <option value="all">All Rarity</option>
          <option value="common">Common</option>
          <option value="uncommon">Uncommon</option>
          <option value="unique">Unique</option>
        </select>
        <select value={worldDropFilter} onChange={e => setWorldDropFilter(e.target.value as any)} className="h-7 text-xs bg-background border border-border rounded px-1.5">
          <option value="all">World Drop: All</option>
          <option value="yes">World Drop: Yes</option>
          <option value="no">World Drop: No</option>
        </select>
        <span className="text-[10px] text-muted-foreground">{filtered.length} items · {worldDropCount} world drops</span>
        <div className="flex-1" />
        {pendingChanges.size > 0 && (
          <Button size="sm" onClick={saveAll} className="h-7 text-xs font-display">
            Save {pendingChanges.size} changes
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={() => bulkToggleWorldDrop(true)} className="h-7 text-[10px]">
          Enable All Filtered
        </Button>
        <Button size="sm" variant="outline" onClick={() => bulkToggleWorldDrop(false)} className="h-7 text-[10px]">
          Disable All Filtered
        </Button>
      </div>
      <ScrollArea className="flex-1">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th className="text-left px-3 py-1.5 font-medium">Name</th>
              <th className="text-center px-2 py-1.5 font-medium w-12">Lvl</th>
              <th className="text-center px-2 py-1.5 font-medium w-20">Rarity</th>
              <th className="text-center px-2 py-1.5 font-medium w-20">Type</th>
              <th className="text-center px-2 py-1.5 font-medium w-20">Slot/Tag</th>
              <th className="text-center px-2 py-1.5 font-medium w-20">World Drop</th>
              <th className="text-center px-2 py-1.5 font-medium w-32">Weight</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(item => (
              <tr key={item.id} className={`border-b border-border/50 hover:bg-card/50 ${pendingChanges.has(item.id) ? 'bg-primary/5' : ''}`}>
                <td className={`px-3 py-1 ${RARITY_COLORS[item.rarity] || ''}`}>{item.name}</td>
                <td className="text-center px-2 py-1">{item.level}</td>
                <td className={`text-center px-2 py-1 ${RARITY_COLORS[item.rarity] || ''}`}>{item.rarity}</td>
                <td className="text-center px-2 py-1 text-muted-foreground">{item.item_type}</td>
                <td className="text-center px-2 py-1 text-muted-foreground">{item.weapon_tag || item.slot || '—'}</td>
                <td className="text-center px-2 py-1">
                  <Switch
                    checked={getEffective(item, 'world_drop')}
                    onCheckedChange={v => updateItem(item.id, 'world_drop', v)}
                    className="mx-auto"
                  />
                </td>
                <td className="px-2 py-1">
                  <div className="flex items-center gap-1">
                    <Slider
                      value={[getEffective(item, 'drop_weight')]}
                      onValueChange={([v]) => updateItem(item.id, 'drop_weight', v)}
                      min={1} max={100} step={1}
                      className="flex-1"
                    />
                    <span className="text-[10px] text-muted-foreground w-6 text-right">{getEffective(item, 'drop_weight')}</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollArea>
    </div>
  );
}
