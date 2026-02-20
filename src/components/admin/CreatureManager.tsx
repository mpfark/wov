import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2, Save, X, Skull } from 'lucide-react';
import { generateCreatureStats, calculateHumanoidGold, getCreatureDamageDie, getStatModifier } from '@/lib/game-data';
import { Slider } from '@/components/ui/slider';
import ItemPickerList from './ItemPickerList';

interface Creature {
  id: string;
  name: string;
  description: string;
  node_id: string | null;
  rarity: string;
  level: number;
  hp: number;
  max_hp: number;
  ac: number;
  stats: Record<string, number>;
  is_aggressive: boolean;
  loot_table: any[];
  respawn_seconds: number;
  is_alive: boolean;
  loot_table_id: string | null;
  drop_chance: number;
}

interface LootTableOption {
  id: string;
  name: string;
}

interface NodeOption {
  id: string;
  name: string;
  region_name?: string;
}

const RARITIES = ['regular', 'rare', 'boss'] as const;

const RARITY_COLORS: Record<string, string> = {
  regular: 'text-foreground',
  rare: 'text-dwarvish',
  boss: 'text-primary text-glow',
};

const defaultForm = () => ({
  name: '', description: '', node_id: '' as string | null,
  level: 1, rarity: 'regular',
  is_aggressive: false, is_humanoid: false, respawn_seconds: 300,
  loot_table: [] as { item_id: string; chance: number }[],
  gold_min: 0, gold_max: 0, gold_chance: 0.5,
  loot_table_id: null as string | null,
  drop_chance: 0.5,
});

export default function CreatureManager() {
  const [creatures, setCreatures] = useState<Creature[]>([]);
  const [nodes, setNodes] = useState<NodeOption[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [form, setForm] = useState(defaultForm());
  const [filter, setFilter] = useState('');
  const [regionFilter, setRegionFilter] = useState('all');
  const [showUnassigned, setShowUnassigned] = useState(false);
  const [showNoLoot, setShowNoLoot] = useState(false);
  const [loading, setLoading] = useState(false);
  const [lootTables, setLootTables] = useState<LootTableOption[]>([]);
  const [lootTableEntries, setLootTableEntries] = useState<{ item_id: string; weight: number; item_name: string }[]>([]);

  const loadData = async () => {
    const [c, n, r, lt] = await Promise.all([
      supabase.from('creatures').select('*').order('name'),
      supabase.from('nodes').select('id, name, region_id').order('name'),
      supabase.from('regions').select('id, name'),
      supabase.from('loot_tables').select('id, name').order('name'),
    ]);
    if (lt.data) setLootTables(lt.data as LootTableOption[]);
    if (c.data) setCreatures(c.data as unknown as Creature[]);
    if (n.data && r.data) {
      const regionMap = Object.fromEntries(r.data.map(reg => [reg.id, reg.name]));
      setNodes(n.data.map(node => ({
        id: node.id,
        name: node.name,
        region_name: regionMap[node.region_id] || 'Unknown',
      })));
    }
  };

  useEffect(() => { loadData(); }, []);

  const getNodeName = (id: string | null) => {
    if (!id) return 'Unassigned';
    return nodes.find(n => n.id === id)?.name || 'Unknown';
  };

  const openNew = () => {
    setSelectedId(null);
    setIsNew(true);
    setForm(defaultForm());
  };

  const openEdit = (c: Creature) => {
    setSelectedId(c.id);
    setIsNew(false);
    const rawLoot = Array.isArray(c.loot_table) ? c.loot_table : [];
    const goldEntry = rawLoot.find((e: any) => e.type === 'gold');
    const itemLoot = rawLoot.filter((e: any) => e.type !== 'gold');
    setForm({
      name: c.name, description: c.description, node_id: c.node_id,
      level: c.level, rarity: c.rarity,
      is_aggressive: c.is_aggressive, is_humanoid: (c as any).is_humanoid ?? false,
      respawn_seconds: c.respawn_seconds,
      loot_table: itemLoot,
      gold_min: goldEntry?.min || 0,
      gold_max: goldEntry?.max || 0,
      gold_chance: goldEntry?.chance ?? 0.5,
      loot_table_id: c.loot_table_id || null,
      drop_chance: c.drop_chance ?? 0.5,
    });
    // Load entries for selected loot table
    if (c.loot_table_id) {
      loadLootTableEntries(c.loot_table_id);
    } else {
      setLootTableEntries([]);
    }
  };

  const closePanel = () => {
    setSelectedId(null);
    setIsNew(false);
    setLootTableEntries([]);
  };

  const loadLootTableEntries = async (tableId: string) => {
    const { data } = await supabase
      .from('loot_table_entries')
      .select('item_id, weight')
      .eq('loot_table_id', tableId);
    if (data) {
      // Fetch item names
      const itemIds = data.map(e => e.item_id);
      const { data: itemsData } = await supabase.from('items').select('id, name').in('id', itemIds);
      const nameMap = Object.fromEntries((itemsData || []).map(i => [i.id, i.name]));
      setLootTableEntries(data.map(e => ({ item_id: e.item_id, weight: e.weight, item_name: nameMap[e.item_id] || 'Unknown' })));
    }
  };

  const handleSave = async () => {
    if (!form.name.trim()) return toast.error('Name is required');
    setLoading(true);

    const loot_table: any[] = [...form.loot_table];
    if (form.gold_max > 0) {
      loot_table.push({ type: 'gold', min: form.gold_min, max: form.gold_max, chance: form.gold_chance });
    }

    const generated = generateCreatureStats(form.level, form.rarity);
    const payload = {
      name: form.name.trim(),
      description: form.description.trim(),
      node_id: form.node_id || null,
      level: form.level,
      rarity: form.rarity as any,
      hp: generated.hp,
      max_hp: generated.hp,
      ac: generated.ac,
      stats: generated.stats,
      is_aggressive: form.is_aggressive,
      is_humanoid: form.is_humanoid,
      respawn_seconds: Math.max(0, form.respawn_seconds),
      loot_table,
      loot_table_id: form.loot_table_id || null,
      drop_chance: form.drop_chance,
    };

    let savedId = selectedId;
    if (selectedId) {
      const { error } = await supabase.from('creatures').update(payload).eq('id', selectedId);
      if (error) { toast.error(error.message); setLoading(false); return; }
      toast.success('Creature updated');
    } else {
      const { data, error } = await supabase.from('creatures').insert(payload).select().single();
      if (error) { toast.error(error.message); setLoading(false); return; }
      toast.success('Creature created');
      if (data) { savedId = data.id; setSelectedId(data.id); setIsNew(false); }
    }
    setLoading(false);
    const { data: refreshed } = await supabase.from('creatures').select('*').order('name');
    if (refreshed) {
      setCreatures(refreshed as unknown as Creature[]);
      const updated = refreshed.find((c: any) => c.id === savedId);
      if (updated) openEdit(updated as unknown as Creature);
    }
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from('creatures').delete().eq('id', id);
    if (error) return toast.error(error.message);
    toast.success('Creature deleted');
    if (selectedId === id) closePanel();
    loadData();
  };

  const previewStats = generateCreatureStats(form.level, form.rarity);
  const panelOpen = isNew || selectedId !== null;

  const formatRespawn = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  };

  const regionNames = [...new Set(nodes.map(n => n.region_name).filter(Boolean))].sort();

  const getNodeRegion = (nodeId: string | null) => {
    if (!nodeId) return '';
    return nodes.find(n => n.id === nodeId)?.region_name || '';
  };

  const hasNoLoot = (c: Creature) => {
    if (c.loot_table_id) return false;
    const loot = Array.isArray(c.loot_table) ? c.loot_table : [];
    const itemLoot = loot.filter((e: any) => e.type !== 'gold');
    return itemLoot.length === 0;
  };

  const filtered = creatures.filter(c => {
    if (showUnassigned && c.node_id) return false;
    if (showNoLoot && !hasNoLoot(c)) return false;
    const matchesText = c.name.toLowerCase().includes(filter.toLowerCase()) ||
      c.rarity.includes(filter.toLowerCase()) ||
      getNodeName(c.node_id).toLowerCase().includes(filter.toLowerCase());
    const matchesRegion = regionFilter === 'all' || getNodeRegion(c.node_id) === regionFilter;
    return matchesText && matchesRegion;
  });

  const unassignedCount = creatures.filter(c => !c.node_id).length;
  const noLootCount = creatures.filter(hasNoLoot).length;

  return (
    <div className="h-full flex">
      {/* Left: Creature List */}
      <div className="flex flex-col w-1/2 border-r border-border transition-all">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
          <Skull className="w-4 h-4 text-primary" />
          <h2 className="font-display text-sm text-primary">Creatures</h2>
          <span className="text-xs text-muted-foreground">({creatures.length})</span>
          <div className="flex-1" />
          <Select value={regionFilter} onValueChange={setRegionFilter}>
            <SelectTrigger className="w-32 h-7 text-xs"><SelectValue placeholder="Region" /></SelectTrigger>
            <SelectContent className="bg-popover border-border z-50 max-h-60">
              <SelectItem value="all" className="text-xs">All Regions</SelectItem>
              {regionNames.map(r => (
                <SelectItem key={r} value={r!} className="text-xs">{r}</SelectItem>
              ))}
            </SelectContent>
          </Select>
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
          <button
            onClick={() => setShowNoLoot(v => !v)}
            className={`px-2 py-0.5 rounded text-[10px] font-display transition-colors ${
              showNoLoot
                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/50'
                : 'bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            }`}
          >
            No Loot ({noLootCount})
          </button>
          <Button size="sm" onClick={openNew} className="font-display text-xs h-7">
            <Plus className="w-3 h-3 mr-1" /> New
          </Button>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-3 space-y-1.5">
            {filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8 italic">
                {creatures.length === 0 ? 'No creatures yet.' : 'No match.'}
              </p>
            ) : filtered.map(creature => (
              <div
                key={creature.id}
                className={`flex items-center justify-between p-2 rounded border transition-colors cursor-pointer ${
                  selectedId === creature.id ? 'border-primary bg-primary/10' : 'border-border bg-card/50 hover:bg-card/80'
                }`}
                onClick={() => openEdit(creature)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`font-display text-sm ${RARITY_COLORS[creature.rarity]}`}>{creature.name}</span>
                    <span className="text-[10px] text-muted-foreground capitalize px-1 py-0.5 rounded bg-background/50 border border-border">{creature.rarity}</span>
                    <span className="text-[10px] text-muted-foreground">Lvl {creature.level}</span>
                    {!creature.is_alive && <span className="text-[10px]">💀</span>}
                    {creature.is_aggressive && <span className="text-[10px]">⚔️</span>}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5">
                    <span className="text-xs text-muted-foreground">📍 {getNodeName(creature.node_id)}</span>
                    <span className="text-[10px] text-muted-foreground">HP {creature.hp}/{creature.max_hp} | AC {creature.ac}</span>
                  </div>
                </div>
                <Button size="sm" variant="destructive" onClick={(e) => { e.stopPropagation(); handleDelete(creature.id); }} className="h-7 w-7 p-0 shrink-0 ml-2">
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
              {selectedId ? `Edit: ${form.name || 'Creature'}` : 'New Creature'}
            </h2>
            <Button variant="ghost" size="sm" onClick={closePanel} className="h-6 w-6 p-0">
              <X className="w-4 h-4" />
            </Button>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-3 space-y-3">
              <Input placeholder="Creature name" value={form.name} maxLength={100}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="h-8 text-xs" />
              <Textarea placeholder="Description" value={form.description} maxLength={500}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} className="text-xs" />

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-muted-foreground">Rarity</label>
                  <Select value={form.rarity} onValueChange={v => {
                    setForm(f => {
                      const updated = { ...f, rarity: v };
                      if (updated.is_humanoid) {
                        const gold = calculateHumanoidGold(updated.level, v);
                        updated.gold_min = gold.min; updated.gold_max = gold.max; updated.gold_chance = gold.chance;
                      }
                      return updated;
                    });
                  }}>
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
                  <Input type="number" min={1} max={40} value={form.level}
                    onChange={e => {
                      const level = Math.max(1, Math.min(40, +e.target.value));
                      setForm(f => {
                        const updated = { ...f, level };
                        if (updated.is_humanoid) {
                          const gold = calculateHumanoidGold(level, updated.rarity);
                          updated.gold_min = gold.min; updated.gold_max = gold.max; updated.gold_chance = gold.chance;
                        }
                        return updated;
                      });
                    }}
                    className="h-8 text-xs" />
                </div>
              </div>

              <div>
                <label className="text-[10px] text-muted-foreground">Spawn Location</label>
                <Select value={form.node_id || 'none'} onValueChange={v => setForm(f => ({ ...f, node_id: v === 'none' ? null : v }))}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select node" /></SelectTrigger>
                  <SelectContent className="bg-popover border-border z-50 max-h-60">
                    <SelectItem value="none" className="text-xs text-muted-foreground">Unassigned</SelectItem>
                    {nodes.map(n => (
                      <SelectItem key={n.id} value={n.id} className="text-xs">
                        {n.name} <span className="text-muted-foreground ml-1">({n.region_name})</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-muted-foreground">Respawn (seconds)</label>
                  <div className="flex items-center gap-1">
                    <Input type="number" min={0} value={form.respawn_seconds}
                      onChange={e => setForm(f => ({ ...f, respawn_seconds: Math.max(0, +e.target.value) }))}
                      className="h-8 text-xs" />
                    <span className="text-[10px] text-muted-foreground whitespace-nowrap">({formatRespawn(form.respawn_seconds)})</span>
                  </div>
                </div>
                <div className="flex flex-col items-start gap-1.5 pb-1">
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <input type="checkbox" checked={form.is_aggressive}
                      onChange={e => setForm(f => ({ ...f, is_aggressive: e.target.checked }))} />
                    Aggressive
                  </label>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <input type="checkbox" checked={form.is_humanoid}
                      onChange={e => {
                        const checked = e.target.checked;
                        setForm(f => {
                          if (checked) {
                            const gold = calculateHumanoidGold(f.level, f.rarity);
                            return { ...f, is_humanoid: true, gold_min: gold.min, gold_max: gold.max, gold_chance: gold.chance };
                          }
                          return { ...f, is_humanoid: false, gold_min: 0, gold_max: 0, gold_chance: 0.5 };
                        });
                      }} />
                    Humanoid (auto gold)
                  </label>
                </div>
              </div>

              <div className="p-2 bg-background/50 rounded border border-border">
                <p className="text-[10px] text-muted-foreground mb-1">Auto-generated stats (Lvl {form.level} {form.rarity})</p>
                <div className="grid grid-cols-4 gap-x-3 gap-y-0.5 text-xs">
                  <span>HP: <strong>{previewStats.hp}</strong></span>
                  <span>AC: <strong>{previewStats.ac}</strong></span>
                  <span>STR: <strong>{previewStats.stats.str}</strong></span>
                  <span>DEX: <strong>{previewStats.stats.dex}</strong></span>
                  <span>CON: <strong>{previewStats.stats.con}</strong></span>
                  <span>INT: <strong>{previewStats.stats.int}</strong></span>
                  <span>WIS: <strong>{previewStats.stats.wis}</strong></span>
                  <span>CHA: <strong>{previewStats.stats.cha}</strong></span>
                </div>
                <div className="mt-1.5 pt-1.5 border-t border-border/50 flex items-center gap-3 text-xs">
                  <span>⚔️ Damage: <strong className="text-primary">1d{getCreatureDamageDie(form.level, form.rarity)} + {getStatModifier(previewStats.stats.str)}</strong></span>
                  <span className="text-muted-foreground">({1 + getStatModifier(previewStats.stats.str)}–{getCreatureDamageDie(form.level, form.rarity) + getStatModifier(previewStats.stats.str)})</span>
                </div>
              </div>

              {/* Loot Table selector */}
              <div className="space-y-1.5">
                <p className="font-display text-xs text-primary">Loot Table</p>
                <Select value={form.loot_table_id || 'none'} onValueChange={v => {
                  const tableId = v === 'none' ? null : v;
                  setForm(f => ({ ...f, loot_table_id: tableId }));
                  if (tableId) loadLootTableEntries(tableId);
                  else setLootTableEntries([]);
                }}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select loot table" /></SelectTrigger>
                  <SelectContent className="bg-popover border-border z-50 max-h-60">
                    <SelectItem value="none" className="text-xs text-muted-foreground">None (legacy inline)</SelectItem>
                    {lootTables.map(lt => (
                      <SelectItem key={lt.id} value={lt.id} className="text-xs">{lt.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {form.loot_table_id && (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <label className="text-[10px] text-muted-foreground">Drop Chance</label>
                      <span className="text-xs font-mono text-primary">{Math.round(form.drop_chance * 100)}%</span>
                    </div>
                    <Slider
                      value={[form.drop_chance * 100]}
                      onValueChange={([v]) => setForm(f => ({ ...f, drop_chance: v / 100 }))}
                      min={1} max={100} step={1}
                    />
                    {lootTableEntries.length > 0 && (
                      <div className="p-2 bg-background/50 rounded border border-border mt-1">
                        <p className="text-[10px] text-muted-foreground mb-1">Items in table:</p>
                        {(() => {
                          const totalWeight = lootTableEntries.reduce((s, e) => s + e.weight, 0);
                          return lootTableEntries.map((e, i) => (
                            <div key={i} className="flex justify-between text-[10px]">
                              <span>{e.item_name}</span>
                              <span className="text-primary font-mono">{((e.weight / totalWeight) * form.drop_chance * 100).toFixed(1)}%</span>
                            </div>
                          ));
                        })()}
                      </div>
                    )}
                  </div>
                )}

                {!form.loot_table_id && (
                  <ItemPickerList label="Legacy Loot (per-item chance)" value={form.loot_table}
                    onChange={v => setForm(f => ({ ...f, loot_table: v }))} />
                )}
              </div>

              {/* Gold drop config */}
              <div className="space-y-1.5">
                <p className="font-display text-xs text-primary">Gold Drop</p>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-[10px] text-muted-foreground">Min</label>
                    <Input type="number" min={0} value={form.gold_min}
                      onChange={e => setForm(f => ({ ...f, gold_min: Math.max(0, +e.target.value) }))}
                      disabled={form.is_humanoid}
                      className="h-7 text-xs" />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground">Max</label>
                    <Input type="number" min={0} value={form.gold_max}
                      onChange={e => setForm(f => ({ ...f, gold_max: Math.max(0, +e.target.value) }))}
                      disabled={form.is_humanoid}
                      className="h-7 text-xs" />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground">Chance</label>
                    <Input type="number" min={0} max={1} step={0.05} value={form.gold_chance}
                      onChange={e => setForm(f => ({ ...f, gold_chance: Math.min(1, Math.max(0, +e.target.value)) }))}
                      disabled={form.is_humanoid}
                      className="h-7 text-xs" />
                  </div>
                </div>
                <p className="text-[9px] text-muted-foreground">
                  {form.is_humanoid ? 'Auto-calculated from level & rarity.' : 'Set max > 0 to enable. Chance 0–1.'}
                </p>
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
            Select a creature to edit
          </div>
        )}
      </div>
    </div>
  );
}
