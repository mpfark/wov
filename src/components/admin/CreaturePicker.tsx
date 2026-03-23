import { useState, useMemo } from 'react';
import { Check, ChevronsUpDown, Skull } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Button } from '@/components/ui/button';

interface CreaturePickerCreature {
  id: string;
  name: string;
  level: number;
  rarity: string;
  node_id?: string | null;
  loot_table_id?: string | null;
}

interface CreaturePickerProps {
  creatures: CreaturePickerCreature[];
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  allowNone?: boolean;
  className?: string;
}

const RARITY_ORDER: Record<string, number> = { boss: 0, rare: 1, regular: 2 };
const RARITY_COLORS: Record<string, string> = {
  boss: 'text-primary',
  rare: 'text-dwarvish',
  regular: 'text-foreground',
};

export default function CreaturePicker({
  creatures, value, onChange,
  placeholder = 'Select creature…', allowNone = false, className,
}: CreaturePickerProps) {
  const [open, setOpen] = useState(false);

  const grouped = useMemo(() => {
    const groups: Record<string, { label: string; creatures: CreaturePickerCreature[] }> = {};
    for (const c of creatures) {
      const r = c.rarity || 'regular';
      if (!groups[r]) groups[r] = { label: r.charAt(0).toUpperCase() + r.slice(1), creatures: [] };
      groups[r].creatures.push(c);
    }
    return Object.entries(groups).sort((a, b) => (RARITY_ORDER[a[0]] ?? 9) - (RARITY_ORDER[b[0]] ?? 9));
  }, [creatures]);

  const selectedCreature = value ? creatures.find(c => c.id === value) : null;
  const displayLabel = selectedCreature ? selectedCreature.name : (allowNone && !value ? 'None' : placeholder);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open}
          className={cn('h-8 justify-between text-xs font-normal w-full', className)}>
          <span className={cn('truncate flex items-center gap-1', selectedCreature ? RARITY_COLORS[selectedCreature.rarity] : '')}>
            <Skull className="w-3 h-3 shrink-0 text-muted-foreground" />
            {displayLabel}
          </span>
          <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-0 z-50" align="start">
        <Command filter={(val, search) => {
          const c = creatures.find(cr => cr.id === val);
          if (!c) return val === '__none__' && 'none'.includes(search.toLowerCase()) ? 1 : 0;
          return c.name.toLowerCase().includes(search.toLowerCase()) ? 1 : 0;
        }}>
          <CommandInput placeholder="Search creatures…" className="h-9 text-xs" />
          <CommandList>
            <CommandEmpty className="py-4 text-xs">No creatures found.</CommandEmpty>
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
            {grouped.map(([rarity, { label, creatures: groupCreatures }]) => (
              <CommandGroup key={rarity} heading={label}>
                {groupCreatures.map(c => (
                  <CommandItem
                    key={c.id}
                    value={c.id}
                    onSelect={() => { onChange(c.id); setOpen(false); }}
                    className="text-xs"
                  >
                    <Check className={cn('mr-2 h-3 w-3', value === c.id ? 'opacity-100' : 'opacity-0')} />
                    <span className={RARITY_COLORS[c.rarity] || ''}>{c.name}</span>
                    <span className="text-muted-foreground ml-1">Lv{c.level}</span>
                    {c.node_id && <span className="text-[9px] text-muted-foreground/60 ml-1">(assigned)</span>}
                    {c.loot_table_id && <span className="text-[9px] ml-1">🔗</span>}
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
