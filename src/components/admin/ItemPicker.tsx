import { useState, useMemo } from 'react';
import { Check, ChevronsUpDown, Package } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Button } from '@/components/ui/button';

interface ItemPickerItem {
  id: string;
  name: string;
  rarity: string;
  level?: number;
  slot?: string | null;
  value?: number;
}

interface ItemPickerProps {
  items: ItemPickerItem[];
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  allowNone?: boolean;
  excludeIds?: string[];
  filterSlot?: string | null;
  className?: string;
}

const RARITY_ORDER: Record<string, number> = { unique: 0, uncommon: 1, common: 2 };
const RARITY_COLORS: Record<string, string> = {
  unique: 'text-primary',
  uncommon: 'text-elvish',
  common: 'text-foreground',
};

export default function ItemPicker({
  items, value, onChange,
  placeholder = 'Select item…', allowNone = false, excludeIds = [], filterSlot, className,
}: ItemPickerProps) {
  const [open, setOpen] = useState(false);

  const filteredItems = useMemo(() => {
    let list = items.filter(i => !excludeIds.includes(i.id));
    if (filterSlot) list = list.filter(i => i.slot === filterSlot);
    return list;
  }, [items, excludeIds, filterSlot]);

  const grouped = useMemo(() => {
    const groups: Record<string, { label: string; items: ItemPickerItem[] }> = {};
    for (const item of filteredItems) {
      const r = item.rarity || 'common';
      if (!groups[r]) groups[r] = { label: r.charAt(0).toUpperCase() + r.slice(1), items: [] };
      groups[r].items.push(item);
    }
    return Object.entries(groups).sort((a, b) => (RARITY_ORDER[a[0]] ?? 9) - (RARITY_ORDER[b[0]] ?? 9));
  }, [filteredItems]);

  const selectedItem = value ? items.find(i => i.id === value) : null;
  const displayLabel = selectedItem ? selectedItem.name : (allowNone && !value ? 'None' : placeholder);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open}
          className={cn('h-8 justify-between text-xs font-normal w-full', className)}>
          <span className={cn('truncate flex items-center gap-1', selectedItem ? RARITY_COLORS[selectedItem.rarity] : '')}>
            <Package className="w-3 h-3 shrink-0 text-muted-foreground" />
            {displayLabel}
          </span>
          <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-0 z-50" align="start">
        <Command filter={(val, search) => {
          const item = filteredItems.find(i => i.id === val);
          if (!item) return val === '__none__' && 'none'.includes(search.toLowerCase()) ? 1 : 0;
          return item.name.toLowerCase().includes(search.toLowerCase()) ? 1 : 0;
        }}>
          <CommandInput placeholder="Search items…" className="h-9 text-xs" />
          <CommandList>
            <CommandEmpty className="py-4 text-xs">No items found.</CommandEmpty>
            {allowNone && (
              <CommandGroup>
                <CommandItem
                  value="__none__"
                  onSelect={() => { onChange(null); setOpen(false); }}
                  className="text-xs text-muted-foreground"
                >
                  <Check className={cn('mr-2 h-3 w-3', !value ? 'opacity-100' : 'opacity-0')} />
                  None
                </CommandItem>
              </CommandGroup>
            )}
            {grouped.map(([rarity, { label, items: groupItems }]) => (
              <CommandGroup key={rarity} heading={label}>
                {groupItems.map(item => (
                  <CommandItem
                    key={item.id}
                    value={item.id}
                    onSelect={() => { onChange(item.id); setOpen(false); }}
                    className="text-xs"
                  >
                    <Check className={cn('mr-2 h-3 w-3', value === item.id ? 'opacity-100' : 'opacity-0')} />
                    <span className={RARITY_COLORS[item.rarity] || ''}>{item.name}</span>
                    {item.level !== undefined && (
                      <span className="text-muted-foreground ml-1">Lv{item.level}</span>
                    )}
                    {item.slot && (
                      <span className="text-muted-foreground ml-1 text-[10px]">{item.slot.replace('_', ' ')}</span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
