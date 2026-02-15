import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { Plus, Trash2 } from 'lucide-react';

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

export default function ItemPickerList({ value, onChange, label }: ItemPickerListProps) {
  const [items, setItems] = useState<ItemOption[]>([]);

  useEffect(() => {
    supabase.from('items').select('id, name, rarity, level').order('name').then(({ data }) => {
      if (data) setItems(data as ItemOption[]);
    });
  }, []);

  const addEntry = () => {
    if (items.length === 0) return;
    onChange([...value, { item_id: items[0].id, chance: 0.5 }]);
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

  const getItemName = (id: string) => items.find(i => i.id === id)?.name || 'Unknown';

  const rarityColor = (id: string) => {
    const r = items.find(i => i.id === id)?.rarity;
    if (r === 'unique') return 'text-primary';
    if (r === 'rare') return 'text-dwarvish';
    if (r === 'uncommon') return 'text-chart-2';
    return 'text-foreground';
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[10px] text-muted-foreground font-display">{label}</p>
        <Button size="sm" variant="outline" onClick={addEntry} className="text-xs h-6 px-2"
          disabled={items.length === 0}>
          <Plus className="w-3 h-3 mr-1" /> Add
        </Button>
      </div>

      {value.length === 0 && (
        <p className="text-xs text-muted-foreground italic">
          {items.length === 0 ? 'No items exist yet. Create items first.' : 'None configured.'}
        </p>
      )}

      {value.map((entry, i) => (
        <div key={i} className="flex items-center gap-2 p-1.5 rounded border border-border bg-background/40">
          <Select value={entry.item_id} onValueChange={v => updateEntry(i, 'item_id', v)}>
            <SelectTrigger className="flex-1 h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border z-50">
              {items.map(item => (
                <SelectItem key={item.id} value={item.id}>
                  <span className={rarityColor(item.id)}>{item.name}</span>
                  <span className="text-muted-foreground ml-1">Lv{item.level}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
