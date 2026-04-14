import { useState, useEffect, useCallback } from 'react';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from '@/components/ui/command';
import { supabase } from '@/integrations/supabase/client';

interface AdminGlobalSearchProps {
  onNavigate: (tab: string) => void;
}

interface SearchResult {
  id: string;
  name: string;
  type: 'creature' | 'item' | 'node' | 'user';
  tab: string;
}

export default function AdminGlobalSearch({ onNavigate }: AdminGlobalSearchProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);

  // Cmd+K listener
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(true);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const search = useCallback(async (q: string) => {
    if (q.length < 2) { setResults([]); return; }

    const pattern = `%${q}%`;
    const [creatures, items, nodes, profiles] = await Promise.all([
      supabase.from('creatures').select('id, name').ilike('name', pattern).limit(5),
      supabase.from('items').select('id, name').ilike('name', pattern).limit(5),
      supabase.from('nodes').select('id, name').ilike('name', pattern).limit(5),
      supabase.from('profiles').select('id, display_name').ilike('display_name', pattern).limit(5),
    ]);

    const r: SearchResult[] = [
      ...(creatures.data || []).map(c => ({ id: c.id, name: c.name, type: 'creature' as const, tab: 'creatures' })),
      ...(items.data || []).map(i => ({ id: i.id, name: i.name, type: 'item' as const, tab: 'items' })),
      ...(nodes.data || []).map(n => ({ id: n.id, name: n.name || `#${n.id.slice(0, 6)}`, type: 'node' as const, tab: 'world' })),
      ...(profiles.data || []).map(p => ({ id: p.id, name: p.display_name || 'Unknown', type: 'user' as const, tab: 'users' })),
    ];
    setResults(r);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => search(query), 250);
    return () => clearTimeout(timer);
  }, [query, search]);

  const handleSelect = (result: SearchResult) => {
    onNavigate(result.tab);
    setOpen(false);
    setQuery('');
    setResults([]);
  };

  const TYPE_LABELS: Record<string, string> = {
    creature: '🐾 Creature',
    item: '⚔️ Item',
    node: '🗺️ Node',
    user: '👤 User',
  };

  const grouped = results.reduce<Record<string, SearchResult[]>>((acc, r) => {
    (acc[r.type] = acc[r.type] || []).push(r);
    return acc;
  }, {});

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="h-7 text-xs text-muted-foreground gap-2"
        onClick={() => setOpen(true)}
      >
        <Search className="h-3 w-3" />
        Search...
        <kbd className="hidden md:inline-flex h-5 items-center gap-1 rounded border border-border bg-muted px-1.5 font-mono text-[10px] text-muted-foreground">
          ⌘K
        </kbd>
      </Button>

      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput
          placeholder="Search creatures, items, nodes, users..."
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          {Object.entries(grouped).map(([type, items]) => (
            <CommandGroup key={type} heading={TYPE_LABELS[type] || type}>
              {items.map((item) => (
                <CommandItem
                  key={`${item.type}-${item.id}`}
                  onSelect={() => handleSelect(item)}
                >
                  {item.name}
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
      </CommandDialog>
    </>
  );
}
