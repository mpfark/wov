import { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { Plus, Trash2, ArrowUpDown } from 'lucide-react';
import ItemPicker from './ItemPicker';

interface LootEntry {
  item_id: string;
  chance: number;
}

interface ItemPickerListProps {
  value: LootEntry[];
  onChange: (entries: LootEntry[]) => void;
  label: string;
}

interface ItemOption {
  id: string;
  name: string;
  rarity: string;
  level: number;
}

type SortMode = 'name' | 'level-asc' | 'level-desc';

export default function ItemPickerList({ value, onChange, label }: ItemPickerListProps) {
  const [items, setItems] = useState<ItemOption[]>([]);
  const [sortMode, setSortMode] = useState<SortMode>('name');
  const [minLevel, setMinLevel] = useState('');
  const [maxLevel, setMaxLevel] = useState('');

  useEffect(() => {
    supabase.from('items').select('id, name, rarity, level').order('name').then(({ data }) => {
      if (data) setItems(data as ItemOption[]);
    });
  }, []);

  const sortedItems = useMemo(() => {
    let filtered = items.filter(i => {
      if (minLevel && i.level < Number(minLevel)) return false;
      if (maxLevel && i.level > Number(maxLevel)) return false;
      return true;
    });
    if (sortMode === 'level-asc') filtered.sort((a, b) => a.level - b.level);
    else if (sortMode === 'level-desc') filtered.sort((a, b) => b.level - a.level);
    else filtered.sort((a, b) => a.name.localeCompare(b.name));
    return filtered;
  }, [items, sortMode, minLevel, maxLevel]);

  const cycleSortMode = () => {
    setSortMode(prev => prev === 'name' ? 'level-asc' : prev === 'level-asc' ? 'level-desc' : 'name');
  };

  const sortLabel = sortMode === 'name' ? 'A-Z' : sortMode === 'level-asc' ? 'Lv↑' : 'Lv↓';

  const addEntry = () => {
    if (sortedItems.length === 0) return;
    onChange([...value, { item_id: sortedItems[0].id, chance: 0.5 }]);
  };

  const updateEntry = (index: number, field: keyof LootEntry, val: string | number) => {
    const updated = [...value];
    if (field === 'chance') {
      updated[index] = { ...updated[index], chance: Math.min(1, Math.max(0, Number(val))) };
    } else {
      updated[index] = { ...updated[index], item_id: val as string };
    }
    onChange(updated);
  };

  const removeEntry = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
  };




  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[10px] text-muted-foreground font-display">{label}</p>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={cycleSortMode} className="text-[10px] h-5 px-1.5 gap-0.5" title="Toggle sort">
            <ArrowUpDown className="w-2.5 h-2.5" /> {sortLabel}
          </Button>
          <Input
            type="number" placeholder="Min" value={minLevel}
            onChange={e => setMinLevel(e.target.value)}
            className="w-12 h-5 text-[10px] text-center px-1"
          />
          <span className="text-[10px] text-muted-foreground">–</span>
          <Input
            type="number" placeholder="Max" value={maxLevel}
            onChange={e => setMaxLevel(e.target.value)}
            className="w-12 h-5 text-[10px] text-center px-1"
          />
          <Button size="sm" variant="outline" onClick={addEntry} className="text-xs h-6 px-2"
            disabled={sortedItems.length === 0}>
            <Plus className="w-3 h-3 mr-1" /> Add
          </Button>
        </div>
      </div>

      {value.length === 0 && (
        <p className="text-xs text-muted-foreground italic">
          {items.length === 0 ? 'No items exist yet. Create items first.' : 'None configured.'}
        </p>
      )}

      {value.map((entry, i) => (
        <div key={i} className="flex items-center gap-2 p-1.5 rounded border border-border bg-background/40">
          <div className="flex-1">
            <ItemPicker
              items={sortedItems}
              value={entry.item_id}
              onChange={v => { if (v) updateEntry(i, 'item_id', v); }}
              placeholder="Select item…"
              className="h-7"
            />
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Input
              type="number" min={0} max={1} step={0.05}
              value={entry.chance}
              onChange={e => updateEntry(i, 'chance', e.target.value)}
              className="w-16 h-7 text-xs text-center"
            />
            <span className="text-[10px] text-muted-foreground">%</span>
          </div>
          <Button size="sm" variant="ghost" onClick={() => removeEntry(i)} className="h-6 w-6 p-0 shrink-0">
            <Trash2 className="w-3 h-3 text-destructive" />
          </Button>
        </div>
      ))}
    </div>
  );
}