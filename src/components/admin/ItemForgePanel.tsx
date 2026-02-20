import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2, Wand2, Check, Package, Sword, ShieldCheck, Zap, Filter } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

interface Creature {
  id: string;
  name: string;
  level: number;
  rarity: 'regular' | 'rare' | 'boss';
  is_humanoid: boolean;
  is_aggressive: boolean;
  node_id: string | null;
  loot_table_id: string | null;
  loot_table: any[];
  node_name?: string;
  region_id?: string;
  region_name?: string;
}

interface Region {
  id: string;
  name: string;
  min_level: number;
  max_level: number;
}

interface ForgedItem {
  creature_id: string;
  creature_name: string;
  creature_rarity: string;
  creature_level: number;
  name: string;
  description: string;
  item_type: string;
  rarity: string;
  slot: string | null;
  level: number;
  hands: number | null;
  stats: Record<string, number>;
  value: number;
  max_durability: number;
  drop_chance: number;
}

const RARITY_COLORS: Record<string, string> = {
  regular: 'text-muted-foreground',
  rare: 'text-blue-400',
  boss: 'text-red-400',
};

const ITEM_RARITY_COLORS: Record<string, string> = {
  common: 'text-muted-foreground',
  uncommon: 'text-green-400',
  rare: 'text-blue-400',
};

interface ItemForgePanelProps {
  onDataChanged?: () => void;
}

export default function ItemForgePanel({ onDataChanged }: ItemForgePanelProps = {}) {
  const [regions, setRegions] = useState<Region[]>([]);
  const [creatures, setCreatures] = useState<Creature[]>([]);
  const [selectedRegionId, setSelectedRegionId] = useState<string>('all');
  const [selectedNodeId, setSelectedNodeId] = useState<string>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [noLootOnly, setNoLootOnly] = useState(false);
  const [humanoidOnly, setHumanoidOnly] = useState(true);
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [generated, setGenerated] = useState<ForgedItem[]>([]);

  const loadData = useCallback(async () => {
    const [regRes, crRes, nodeRes] = await Promise.all([
      supabase.from('regions').select('id, name, min_level, max_level').order('min_level'),
      supabase.from('creatures').select('id, name, level, rarity, is_humanoid, is_aggressive, node_id, loot_table_id, loot_table').order('name'),
      supabase.from('nodes').select('id, name, region_id'),
    ]);

    const nodeMap = new Map((nodeRes.data || []).map((n: any) => [n.id, n]));
    const regMap = new Map((regRes.data || []).map((r: any) => [r.id, r]));

    const enriched: Creature[] = (crRes.data || []).map((c: any) => {
      const node = c.node_id ? nodeMap.get(c.node_id) : null;
      const region = node ? regMap.get(node.region_id) : null;
      return {
        ...c,
        node_name: node?.name,
        region_id: region?.id,
        region_name: region?.name,
        loot_table: c.loot_table || [],
      };
    });

    setRegions(regRes.data || []);
    setCreatures(enriched);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Derived lists
  const regionNodes = Array.from(
    new Map(
      creatures
        .filter(c => selectedRegionId === 'all' || c.region_id === selectedRegionId)
        .filter(c => c.node_id)
        .map(c => [c.node_id!, { id: c.node_id!, name: c.node_name || 'Unknown' }])
    ).values()
  ).sort((a, b) => a.name.localeCompare(b.name));

  const hasNoLoot = (c: Creature) => !c.loot_table_id && (!c.loot_table || c.loot_table.length === 0);

  const filteredCreatures = creatures.filter(c => {
    if (selectedRegionId !== 'all' && c.region_id !== selectedRegionId) return false;
    if (selectedNodeId !== 'all' && c.node_id !== selectedNodeId) return false;
    if (noLootOnly && !hasNoLoot(c)) return false;
    if (humanoidOnly && !c.is_humanoid) return false;
    return true;
  });

  const toggleId = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelectedIds(new Set(filteredCreatures.map(c => c.id)));
  const deselectAll = () => setSelectedIds(new Set());

  const generate = async () => {
    if (selectedIds.size === 0) {
      toast.error('Select at least one creature');
      return;
    }
    setLoading(true);
    setGenerated([]);
    try {
      const { data, error } = await supabase.functions.invoke('ai-item-forge', {
        body: { prompt: prompt.trim() || undefined, creature_ids: Array.from(selectedIds) },
      });
      if (error) throw error;
      if (data?.error) {
        if (data.error.includes('Rate limit') || data.status === 429) {
          toast.error('Rate limit hit — wait a moment and try again.');
        } else if (data.error.includes('credits') || data.status === 402) {
          toast.error('AI credits exhausted. Add funds in Settings → Workspace → Usage.');
        } else {
          throw new Error(data.error);
        }
        return;
      }
      const items: ForgedItem[] = data.items || [];
      if (items.length === 0) {
        toast.warning('No items were generated. Try selecting more humanoid creatures or adjusting the prompt.');
        return;
      }
      setGenerated(items);
      toast.success(`${items.length} items generated — review and apply below.`);
    } catch (e: any) {
      toast.error(e.message || 'Generation failed');
    } finally {
      setLoading(false);
    }
  };

  const applyAll = async () => {
    if (generated.length === 0) return;
    setApplying(true);

    try {
      // Group items by creature_id
      const byCreature = new Map<string, ForgedItem[]>();
      for (const item of generated) {
        if (!byCreature.has(item.creature_id)) byCreature.set(item.creature_id, []);
        byCreature.get(item.creature_id)!.push(item);
      }

      let totalItems = 0;
      let totalCreatures = 0;

      for (const [creatureId, items] of byCreature) {
        // Insert all items for this creature first
        const realItemIds: Array<{ item_id: string; drop_chance: number }> = [];

        for (const item of items) {
          const { data: itemData, error: itemErr } = await supabase
            .from('items')
            .insert({
              name: item.name,
              description: item.description,
              item_type: item.item_type,
              rarity: item.rarity as any,
              slot: item.slot as any || null,
              level: item.level,
              hands: item.hands || null,
              stats: item.stats || {},
              value: item.value,
              max_durability: Math.max(item.max_durability || 50, 1),
            })
            .select('id')
            .single();
          if (itemErr) throw itemErr;
          realItemIds.push({ item_id: itemData.id, drop_chance: item.drop_chance });
          totalItems++;
        }

        // Create a shared loot table for this creature
        const creatureName = items[0]?.creature_name || 'Creature';
        const { data: ltData, error: ltErr } = await supabase
          .from('loot_tables')
          .insert({ name: `${creatureName} Drops` })
          .select('id')
          .single();
        if (ltErr) throw ltErr;

        // Insert loot table entries (weight = drop_chance * 100)
        for (const { item_id, drop_chance } of realItemIds) {
          const weight = Math.round(drop_chance * 100);
          const { error: lteErr } = await supabase
            .from('loot_table_entries')
            .insert({ loot_table_id: ltData.id, item_id, weight });
          if (lteErr) throw lteErr;
        }

        // Max drop_chance across all items for this creature
        const maxDropChance = Math.max(...realItemIds.map(e => e.drop_chance));

        // Update the creature to point to the new shared loot table
        const { error: crErr } = await supabase
          .from('creatures')
          .update({
            loot_table_id: ltData.id,
            drop_chance: maxDropChance,
            loot_table: [],
          })
          .eq('id', creatureId);
        if (crErr) throw crErr;

        totalCreatures++;
      }

      toast.success(`Applied ${totalItems} items across ${totalCreatures} creatures.`);
      setGenerated([]);
      setSelectedIds(new Set());
      await loadData();
      onDataChanged?.();
    } catch (e: any) {
      toast.error(e.message || 'Apply failed');
    } finally {
      setApplying(false);
    }
  };

  // Group generated items by creature for display
  const generatedByCreature = new Map<string, ForgedItem[]>();
  for (const item of generated) {
    if (!generatedByCreature.has(item.creature_id)) generatedByCreature.set(item.creature_id, []);
    generatedByCreature.get(item.creature_id)!.push(item);
  }

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      {/* Left: Creature Selector */}
      <div className="w-80 shrink-0 flex flex-col border-r border-border bg-card/30 min-h-0">
        <div className="px-3 py-2 border-b border-border bg-card/50 shrink-0 space-y-2">
          <p className="font-display text-xs text-primary">Select Creatures</p>

          {/* Region filter */}
          <Select value={selectedRegionId} onValueChange={v => { setSelectedRegionId(v); setSelectedNodeId('all'); }}>
            <SelectTrigger className="h-7 text-xs">
              <SelectValue placeholder="All regions" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All regions</SelectItem>
              {regions.map(r => (
                <SelectItem key={r.id} value={r.id}>{r.name} (Lv {r.min_level}–{r.max_level})</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Node filter */}
          <Select value={selectedNodeId} onValueChange={setSelectedNodeId}>
            <SelectTrigger className="h-7 text-xs">
              <SelectValue placeholder="All nodes" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All nodes</SelectItem>
              {regionNodes.map(n => (
                <SelectItem key={n.id} value={n.id}>{n.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Toggles */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <Switch id="no-loot" checked={noLootOnly} onCheckedChange={setNoLootOnly} className="h-4 w-7" />
              <Label htmlFor="no-loot" className="text-[10px] text-muted-foreground cursor-pointer">No loot only</Label>
            </div>
            <div className="flex items-center gap-1.5">
              <Switch id="humanoid" checked={humanoidOnly} onCheckedChange={setHumanoidOnly} className="h-4 w-7" />
              <Label htmlFor="humanoid" className="text-[10px] text-muted-foreground cursor-pointer">Humanoid only</Label>
            </div>
          </div>

          {/* Select controls */}
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">{filteredCreatures.length} shown · {selectedIds.size} selected</span>
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" className="h-5 text-[10px] px-1.5" onClick={selectAll}>All</Button>
              <Button variant="ghost" size="sm" className="h-5 text-[10px] px-1.5" onClick={deselectAll}>None</Button>
            </div>
          </div>
        </div>

        <ScrollArea className="flex-1 min-h-0">
          <div className="p-2 space-y-1">
            {filteredCreatures.length === 0 && (
              <p className="text-[10px] text-muted-foreground text-center py-4">No creatures match the current filters.</p>
            )}
            {filteredCreatures.map(c => {
              const selected = selectedIds.has(c.id);
              const noLoot = hasNoLoot(c);
              return (
                <div
                  key={c.id}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors ${selected ? 'bg-primary/10 border border-primary/20' : 'hover:bg-muted/40'}`}
                  onClick={() => toggleId(c.id)}
                >
                  <Checkbox checked={selected} onCheckedChange={() => toggleId(c.id)} className="h-3 w-3 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1">
                      <span className="text-[11px] font-display truncate">{c.name}</span>
                      {c.is_humanoid && <span title="Humanoid" className="text-[9px] text-muted-foreground">🧑</span>}
                      {noLoot && <span title="No loot configured" className="text-[9px] text-yellow-500">⚠</span>}
                    </div>
                    <div className="flex items-center gap-1 text-[9px] text-muted-foreground">
                      <span className={RARITY_COLORS[c.rarity]}>{c.rarity}</span>
                      <span>·</span>
                      <span>Lv {c.level}</span>
                      {c.node_name && <><span>·</span><span className="truncate">{c.node_name}</span></>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </div>

      {/* Right: Controls + Preview */}
      <div className="flex-1 flex flex-col min-h-0">
        {/* Prompt + Generate */}
        <div className="px-4 py-3 border-b border-border bg-card/30 shrink-0 space-y-2">
          <div className="flex items-center gap-2">
            <Wand2 className="w-4 h-4 text-primary" />
            <span className="font-display text-sm text-primary">🪄 Item Forge</span>
          </div>
          <Textarea
            placeholder="Optional flavor prompt — e.g. 'dark cult relics', 'worn bandit gear', 'mystical forest drops'…"
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            className="text-xs min-h-[52px] resize-none"
          />
          <div className="flex items-center gap-2">
            <Button
              onClick={generate}
              disabled={loading || selectedIds.size === 0}
              size="sm"
              className="font-display text-xs"
            >
              {loading ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" />Generating…</> : <><Wand2 className="w-3 h-3 mr-1" />Generate Items</>}
            </Button>
            {selectedIds.size > 0 && (
              <span className="text-[10px] text-muted-foreground">for {selectedIds.size} creature{selectedIds.size !== 1 ? 's' : ''}</span>
            )}
            {generated.length > 0 && !loading && (
              <Button
                onClick={applyAll}
                disabled={applying}
                size="sm"
                variant="default"
                className="font-display text-xs ml-auto bg-primary"
              >
                {applying ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" />Applying…</> : <><Check className="w-3 h-3 mr-1" />Apply All ({generated.length} items)</>}
              </Button>
            )}
          </div>
        </div>

        {/* Preview */}
        <ScrollArea className="flex-1 min-h-0">
          {generated.length === 0 && !loading && (
            <div className="flex flex-col items-center justify-center h-full text-center p-8 gap-3">
              <Package className="w-10 h-10 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">Select creatures, then generate items to preview them here.</p>
              {noLootOnly && <p className="text-xs text-muted-foreground/70">⚠ tip: "No loot only" filter shows creatures that still need items.</p>}
            </div>
          )}

          {loading && (
            <div className="flex flex-col items-center justify-center h-full gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">The forge is working…</p>
            </div>
          )}

          {generated.length > 0 && !loading && (
            <div className="p-4 space-y-4">
              <p className="text-xs text-muted-foreground">
                {generated.length} item{generated.length !== 1 ? 's' : ''} generated for {generatedByCreature.size} creature{generatedByCreature.size !== 1 ? 's' : ''} — click Apply All to write to database.
              </p>

              {Array.from(generatedByCreature.entries()).map(([creatureId, items]) => {
                const first = items[0];
                return (
                  <Card key={creatureId} className="p-3 space-y-2 bg-card/50">
                    {/* Creature header */}
                    <div className="flex items-center gap-2">
                      <Sword className="w-3 h-3 text-muted-foreground" />
                      <span className="font-display text-xs text-foreground">{first.creature_name}</span>
                      <Badge variant="outline" className={`text-[9px] px-1 py-0 ${RARITY_COLORS[first.creature_rarity]}`}>
                        {first.creature_rarity}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground">Lv {first.creature_level}</span>
                    </div>

                    {/* Items */}
                    <div className="space-y-1.5 pl-4">
                      {items.map((item, idx) => (
                        <div key={idx} className="flex items-start gap-2 text-[11px]">
                          <Package className="w-3 h-3 text-muted-foreground mt-0.5 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center flex-wrap gap-1">
                              <span className="font-display">{item.name}</span>
                              <Badge variant="outline" className={`text-[9px] px-1 py-0 ${ITEM_RARITY_COLORS[item.rarity]}`}>
                                {item.rarity}
                              </Badge>
                              {item.slot && (
                                <Badge variant="secondary" className="text-[9px] px-1 py-0">{item.slot.replace('_', ' ')}</Badge>
                              )}
                              {item.item_type === 'consumable' && (
                                <Badge variant="secondary" className="text-[9px] px-1 py-0">consumable</Badge>
                              )}
                              <span className="text-muted-foreground">·</span>
                              <span className="text-muted-foreground">{Math.round(item.drop_chance * 100)}% drop</span>
                              <span className="text-muted-foreground">·</span>
                              <span className="text-muted-foreground">{item.value}g</span>
                            </div>
                            <p className="text-muted-foreground text-[10px] mt-0.5">{item.description}</p>
                            {Object.keys(item.stats || {}).length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-0.5">
                                {Object.entries(item.stats).map(([k, v]) => (
                                  <span key={k} className="text-[9px] bg-primary/10 text-primary px-1 rounded">
                                    {k} +{v}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </div>
    </div>
  );
}
