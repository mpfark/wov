import { useState } from 'react';
import { Check, ChevronsUpDown, Package } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Button } from '@/components/ui/button';

interface LootTablePickerTable {
  id: string;
  name: string;
}

interface LootTablePickerProps {
  tables: LootTablePickerTable[];
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  allowNone?: boolean;
  className?: string;
}

export default function LootTablePicker({
  tables, value, onChange,
  placeholder = 'Select loot table…', allowNone = false, className,
}: LootTablePickerProps) {
  const [open, setOpen] = useState(false);

  const selectedTable = value ? tables.find(t => t.id === value) : null;
  const displayLabel = selectedTable ? selectedTable.name : (allowNone && !value ? 'None' : placeholder);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open}
          className={cn('h-8 justify-between text-xs font-normal w-full', className)}>
          <span className="truncate flex items-center gap-1">
            <Package className="w-3 h-3 shrink-0 text-muted-foreground" />
            {displayLabel}
          </span>
          <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px] p-0 z-50" align="start">
        <Command filter={(val, search) => {
          const t = tables.find(tb => tb.id === val);
          if (!t) return val === '__none__' && 'none'.includes(search.toLowerCase()) ? 1 : 0;
          return t.name.toLowerCase().includes(search.toLowerCase()) ? 1 : 0;
        }}>
          <CommandInput placeholder="Search loot tables…" className="h-9 text-xs" />
          <CommandList>
            <CommandEmpty className="py-4 text-xs">No loot tables found.</CommandEmpty>
            {allowNone && (
              <CommandItem
                value="__none__"
                onSelect={() => { onChange(null); setOpen(false); }}
                className="text-xs text-muted-foreground"
              >
                <Check className={cn('mr-2 h-3 w-3', !value ? 'opacity-100' : 'opacity-0')} />
                None — use per-item loot
              </CommandItem>
            )}
            <CommandGroup>
              {tables.map(t => (
                <CommandItem
                  key={t.id}
                  value={t.id}
                  onSelect={() => { onChange(t.id); setOpen(false); }}
                  className="text-xs"
                >
                  <Check className={cn('mr-2 h-3 w-3', value === t.id ? 'opacity-100' : 'opacity-0')} />
                  {t.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
