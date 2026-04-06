import { useState, useEffect, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface CreatureRow {
  id: string;
  name: string;
  level: number;
  rarity: string;
  is_humanoid: boolean;
  loot_mode: string;
  loot_table_id: string | null;
}

const MODE_LABELS: Record<string, string> = {
  legacy_table: '📋 Legacy',
  item_pool: '🎲 Item Pool',
  salvage_only: '🔩 Salvage',
};
const MODES = ['legacy_table', 'item_pool', 'salvage_only'] as const;

const RARITY_COLORS: Record<string, string> = {
  regular: 'text-foreground',
  rare: 'text-dwarvish',
  boss: 'text-primary text-glow',
};

export default function CreatureLootModesTab() {
  const [creatures, setCreatures] = useState<CreatureRow[]>([]);
  const [filter, setFilter] = useState('');
  const [modeFilter, setModeFilter] = useState<string>('all');
  const [humanoidFilter, setHumanoidFilter] = useState<'all' | 'yes' | 'no'>('all');
  const [pendingChanges, setPendingChanges] = useState<Map<string, string>>(new Map());

  const loadData = async () => {
    const { data } = await supabase
      .from('creatures')
      .select('id, name, level, rarity, is_humanoid, loot_mode, loot_table_id')
      .order('level')
      .order('name');
    if (data) setCreatures(data as CreatureRow[]);
  };

  useEffect(() => { loadData(); }, []);

  const filtered = useMemo(() => {
    return creatures.filter(c => {
      if (filter && !c.name.toLowerCase().includes(filter.toLowerCase())) return false;
      const effectiveMode = pendingChanges.get(c.id) || c.loot_mode;
      if (modeFilter !== 'all' && effectiveMode !== modeFilter) return false;
      if (humanoidFilter === 'yes' && !c.is_humanoid) return false;
      if (humanoidFilter === 'no' && c.is_humanoid) return false;
      return true;
    });
  }, [creatures, filter, modeFilter, humanoidFilter, pendingChanges]);

  const updateMode = (id: string, mode: string) => {
    setPendingChanges(prev => {
      const next = new Map(prev);
      next.set(id, mode);
      return next;
    });
  };

  const saveAll = async () => {
    const entries = [...pendingChanges.entries()];
    if (entries.length === 0) return toast.info('No changes');
    let errors = 0;
    for (const [id, mode] of entries) {
      const { error } = await supabase.from('creatures').update({ loot_mode: mode } as any).eq('id', id);
      if (error) errors++;
    }
    if (errors) toast.error(`${errors} creatures failed`);
    else toast.success(`${entries.length} creatures updated`);
    setPendingChanges(new Map());
    loadData();
  };

  const bulkSetMode = async (mode: string) => {
    const ids = filtered.map(c => c.id);
    if (ids.length === 0) return;
    const { error } = await supabase.from('creatures').update({ loot_mode: mode } as any).in('id', ids);
    if (error) return toast.error(error.message);
    toast.success(`${ids.length} creatures set to ${MODE_LABELS[mode]}`);
    setPendingChanges(new Map());
    loadData();
  };

  const modeCounts = useMemo(() => {
    const counts: Record<string, number> = { legacy_table: 0, item_pool: 0, salvage_only: 0 };
    for (const c of creatures) {
      const m = pendingChanges.get(c.id) || c.loot_mode;
      counts[m] = (counts[m] || 0) + 1;
    }
    return counts;
  }, [creatures, pendingChanges]);

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0 flex-wrap">
        <Input placeholder="Search..." value={filter} onChange={e => setFilter(e.target.value)} className="w-36 h-7 text-xs" />
        <select value={modeFilter} onChange={e => setModeFilter(e.target.value)} className="h-7 text-xs bg-background border border-border rounded px-1.5">
          <option value="all">All Modes</option>
          {MODES.map(m => <option key={m} value={m}>{MODE_LABELS[m]} ({modeCounts[m]})</option>)}
        </select>
        <select value={humanoidFilter} onChange={e => setHumanoidFilter(e.target.value as any)} className="h-7 text-xs bg-background border border-border rounded px-1.5">
          <option value="all">All Types</option>
          <option value="yes">Humanoid</option>
          <option value="no">Non-Humanoid</option>
        </select>
        <span className="text-[10px] text-muted-foreground">{filtered.length} creatures</span>
        <div className="flex-1" />
        {pendingChanges.size > 0 && (
          <Button size="sm" onClick={saveAll} className="h-7 text-xs font-display">Save {pendingChanges.size}</Button>
        )}
        <select onChange={e => { if (e.target.value) bulkSetMode(e.target.value); e.target.value = ''; }} className="h-7 text-xs bg-background border border-border rounded px-1.5">
          <option value="">Bulk set filtered...</option>
          {MODES.map(m => <option key={m} value={m}>{MODE_LABELS[m]}</option>)}
        </select>
      </div>
      <ScrollArea className="flex-1">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th className="text-left px-3 py-1.5 font-medium">Name</th>
              <th className="text-center px-2 py-1.5 font-medium w-12">Lvl</th>
              <th className="text-center px-2 py-1.5 font-medium w-16">Rarity</th>
              <th className="text-center px-2 py-1.5 font-medium w-20">Humanoid</th>
              <th className="text-center px-2 py-1.5 font-medium w-20">Legacy Table</th>
              <th className="text-center px-2 py-1.5 font-medium w-32">Loot Mode</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(c => {
              const effectiveMode = pendingChanges.get(c.id) || c.loot_mode;
              return (
                <tr key={c.id} className={`border-b border-border/50 hover:bg-card/50 ${pendingChanges.has(c.id) ? 'bg-primary/5' : ''}`}>
                  <td className={`px-3 py-1 ${RARITY_COLORS[c.rarity] || ''}`}>{c.name}</td>
                  <td className="text-center px-2 py-1">{c.level}</td>
                  <td className={`text-center px-2 py-1 ${RARITY_COLORS[c.rarity] || ''}`}>{c.rarity}</td>
                  <td className="text-center px-2 py-1">{c.is_humanoid ? '✅' : '—'}</td>
                  <td className="text-center px-2 py-1 text-muted-foreground">{c.loot_table_id ? '📋' : '—'}</td>
                  <td className="text-center px-2 py-1">
                    <select
                      value={effectiveMode}
                      onChange={e => updateMode(c.id, e.target.value)}
                      className="h-6 text-[10px] bg-background border border-border rounded px-1"
                    >
                      {MODES.map(m => <option key={m} value={m}>{MODE_LABELS[m]}</option>)}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </ScrollArea>
    </div>
  );
}
