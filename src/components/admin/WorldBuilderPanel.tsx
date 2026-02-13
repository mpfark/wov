import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2, Wand2, ChevronDown, Check, MapPin, Swords, MessageSquare, Plus, Expand } from 'lucide-react';

interface GeneratedRegion {
  name: string;
  description: string;
  min_level: number;
  max_level: number;
}

interface GeneratedNode {
  temp_id: string;
  name: string;
  description: string;
  is_inn?: boolean;
  is_vendor?: boolean;
  is_blacksmith?: boolean;
  connections: { target_temp_id: string; direction: string }[];
}

interface GeneratedCreature {
  name: string;
  description: string;
  node_temp_id: string;
  level: number;
  hp: number;
  max_hp: number;
  ac: number;
  rarity: string;
  is_aggressive: boolean;
  respawn_seconds?: number;
  stats: Record<string, number>;
  loot_table?: any[];
}

interface GeneratedNPC {
  name: string;
  description: string;
  dialogue: string;
  node_temp_id: string;
}

interface GeneratedWorld {
  region: GeneratedRegion;
  nodes: GeneratedNode[];
  creatures: GeneratedCreature[];
  npcs: GeneratedNPC[];
}

interface ExistingRegion {
  id: string;
  name: string;
  description: string;
  min_level: number;
  max_level: number;
}

const DIRECTION_OPPOSITES: Record<string, string> = {
  N: 'S', S: 'N',
  E: 'W', W: 'E',
  NE: 'SW', SW: 'NE',
  NW: 'SE', SE: 'NW',
};

type Mode = 'new' | 'expand';

export default function WorldBuilderPanel() {
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [generated, setGenerated] = useState<GeneratedWorld | null>(null);
  const [mode, setMode] = useState<Mode>('new');
  const [regions, setRegions] = useState<ExistingRegion[]>([]);
  const [selectedRegionId, setSelectedRegionId] = useState<string>('');

  useEffect(() => {
    supabase.from('regions').select('id, name, description, min_level, max_level').order('min_level').then(({ data }) => {
      setRegions(data || []);
    });
  }, []);

  const selectedRegion = regions.find(r => r.id === selectedRegionId);

  const generate = async () => {
    if (!prompt.trim()) return;
    if (mode === 'expand' && !selectedRegionId) {
      toast.error('Select a region to expand');
      return;
    }
    setLoading(true);
    setGenerated(null);

    try {
      const body: any = { prompt: prompt.trim() };
      if (mode === 'expand' && selectedRegion) {
        body.expand_region = { id: selectedRegion.id, name: selectedRegion.name };
      }

      const { data, error } = await supabase.functions.invoke('ai-world-builder', { body });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setGenerated(data as GeneratedWorld);
      toast.success('World content generated! Review below.');
    } catch (e: any) {
      toast.error(e.message || 'Generation failed');
    } finally {
      setLoading(false);
    }
  };

  const applyAll = async () => {
    if (!generated) return;
    setApplying(true);

    try {
      let regionId: string;

      if (mode === 'expand' && selectedRegionId) {
        // Use existing region
        regionId = selectedRegionId;
      } else {
        // Insert new region
        const { data: regionData, error: regErr } = await supabase
          .from('regions')
          .insert({
            name: generated.region.name,
            description: generated.region.description,
            min_level: generated.region.min_level,
            max_level: generated.region.max_level,
          })
          .select('id')
          .single();
        if (regErr) throw regErr;
        regionId = regionData.id;
      }

      // Insert new nodes (without connections first to get real IDs)
      const tempToReal = new Map<string, string>();
      for (const node of generated.nodes) {
        const { data: nodeData, error: nodeErr } = await supabase
          .from('nodes')
          .insert({
            name: node.name,
            description: node.description,
            region_id: regionId,
            is_inn: node.is_inn || false,
            is_vendor: node.is_vendor || false,
            is_blacksmith: node.is_blacksmith || false,
            connections: [],
          })
          .select('id')
          .single();
        if (nodeErr) throw nodeErr;
        tempToReal.set(node.temp_id, nodeData.id);
      }

      // Resolve target IDs (temp or existing)
      const resolveTarget = (target: string): string | null => {
        if (target.startsWith('existing:')) {
          return target.replace('existing:', '');
        }
        return tempToReal.get(target) || null;
      };

      // Update connections on new nodes
      for (const node of generated.nodes) {
        const realId = tempToReal.get(node.temp_id)!;
        const connections = node.connections
          .map(c => {
            const targetId = resolveTarget(c.target_temp_id);
            if (!targetId) return null;
            return { node_id: targetId, direction: c.direction };
          })
          .filter(Boolean);

        await supabase.from('nodes').update({ connections }).eq('id', realId);
      }

      // Add reverse connections (both to new and existing nodes)
      const reverseMap = new Map<string, { node_id: string; direction: string }[]>();
      for (const node of generated.nodes) {
        const realId = tempToReal.get(node.temp_id)!;
        for (const c of node.connections) {
          const targetReal = resolveTarget(c.target_temp_id);
          if (!targetReal) continue;
          const opposite = DIRECTION_OPPOSITES[c.direction] || c.direction;
          if (!reverseMap.has(targetReal)) reverseMap.set(targetReal, []);
          const existing = reverseMap.get(targetReal)!;
          if (!existing.some(e => e.node_id === realId)) {
            existing.push({ node_id: realId, direction: opposite });
          }
        }
      }

      for (const [nodeId, reverseConns] of reverseMap) {
        const { data: existing } = await supabase.from('nodes').select('connections').eq('id', nodeId).single();
        const current = (existing?.connections as any[]) || [];
        const merged = [...current];
        for (const rc of reverseConns) {
          if (!merged.some((m: any) => m.node_id === rc.node_id)) {
            merged.push(rc);
          }
        }
        await supabase.from('nodes').update({ connections: merged }).eq('id', nodeId);
      }

      // Insert creatures
      for (const creature of generated.creatures) {
        const nodeId = resolveTarget(creature.node_temp_id);
        if (!nodeId) continue;
        await supabase.from('creatures').insert({
          name: creature.name,
          description: creature.description,
          node_id: nodeId,
          level: creature.level,
          hp: creature.hp,
          max_hp: creature.max_hp,
          ac: creature.ac,
          rarity: creature.rarity as any,
          is_aggressive: creature.is_aggressive,
          respawn_seconds: creature.respawn_seconds || 300,
          stats: creature.stats,
          loot_table: creature.loot_table || [],
        });
      }

      // Insert NPCs
      for (const npc of generated.npcs) {
        const nodeId = resolveTarget(npc.node_temp_id);
        if (!nodeId) continue;
        await supabase.from('npcs').insert({
          name: npc.name,
          description: npc.description,
          dialogue: npc.dialogue,
          node_id: nodeId,
        });
      }

      const action = mode === 'expand' ? 'Expanded' : 'Created';
      toast.success(`${action} ${generated.region.name}: ${generated.nodes.length} nodes, ${generated.creatures.length} creatures, ${generated.npcs.length} NPCs.`);
      setGenerated(null);
      setPrompt('');
      // Refresh regions list
      const { data: newRegions } = await supabase.from('regions').select('id, name, description, min_level, max_level').order('min_level');
      setRegions(newRegions || []);
    } catch (e: any) {
      toast.error('Apply failed: ' + (e.message || 'Unknown error'));
    } finally {
      setApplying(false);
    }
  };

  const rarityColor = (r: string) => {
    if (r === 'boss') return 'destructive';
    if (r === 'rare') return 'secondary';
    return 'outline';
  };

  return (
    <div className="flex flex-col h-full">
      {/* Mode & Input area */}
      <div className="p-4 border-b border-border bg-card/30 space-y-2 shrink-0">
        {/* Mode toggle */}
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={mode === 'new' ? 'default' : 'outline'}
            onClick={() => { setMode('new'); setGenerated(null); }}
            className="text-xs"
          >
            <Plus className="w-3 h-3 mr-1" /> New Region
          </Button>
          <Button
            size="sm"
            variant={mode === 'expand' ? 'default' : 'outline'}
            onClick={() => { setMode('expand'); setGenerated(null); }}
            className="text-xs"
          >
            <Expand className="w-3 h-3 mr-1" /> Expand Region
          </Button>
        </div>

        {/* Region picker for expand mode */}
        {mode === 'expand' && (
          <Select value={selectedRegionId} onValueChange={setSelectedRegionId}>
            <SelectTrigger className="text-xs h-8">
              <SelectValue placeholder="Select region to expand…" />
            </SelectTrigger>
            <SelectContent>
              {regions.map(r => (
                <SelectItem key={r.id} value={r.id} className="text-xs">
                  {r.name} (Lvl {r.min_level}–{r.max_level})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <Textarea
          placeholder={mode === 'expand'
            ? 'e.g. "Add 10 more nodes to the south, including a dark forest with wolves and a hidden cave with a boss"'
            : 'e.g. "Create the Rivendell region for levels 15-25 with 6 nodes including Elrond\'s House as an inn"'
          }
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          className="min-h-[60px] text-xs resize-none"
          onKeyDown={e => { if (e.key === 'Enter' && e.metaKey) generate(); }}
        />
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={generate} disabled={loading || !prompt.trim() || (mode === 'expand' && !selectedRegionId)} className="text-xs">
            {loading ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Wand2 className="w-3 h-3 mr-1" />}
            {loading ? 'Generating…' : mode === 'expand' ? 'Expand' : 'Generate'}
          </Button>
          <span className="text-[10px] text-muted-foreground">⌘+Enter to generate</span>
        </div>
      </div>

      {/* Preview area */}
      <ScrollArea className="flex-1">
        {!generated && !loading && (
          <div className="flex items-center justify-center h-48 text-muted-foreground text-xs">
            {mode === 'expand' ? 'Select a region and describe how to expand it' : 'Describe a region to generate world content'}
          </div>
        )}

        {loading && (
          <div className="flex flex-col items-center justify-center h-48 gap-2">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
            <span className="text-xs text-muted-foreground">{mode === 'expand' ? 'Expanding region…' : 'Building your world…'}</span>
          </div>
        )}

        {generated && (
          <div className="p-4 space-y-3">
            {/* Region */}
            <Card className="p-3">
              <div className="flex items-center gap-2 mb-1">
                <MapPin className="w-3 h-3 text-primary" />
                <span className="font-display text-sm text-primary">{generated.region.name}</span>
                <Badge variant="outline" className="text-[10px]">
                  Lvl {generated.region.min_level}–{generated.region.max_level}
                </Badge>
                {mode === 'expand' && <Badge variant="secondary" className="text-[9px]">Expanding</Badge>}
              </div>
              <p className="text-[11px] text-muted-foreground">{generated.region.description}</p>
            </Card>

            {/* Nodes */}
            <Collapsible defaultOpen>
              <CollapsibleTrigger className="flex items-center gap-1 text-xs font-display text-primary w-full">
                <ChevronDown className="w-3 h-3" />
                New Nodes ({generated.nodes.length})
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-1 mt-1">
                {generated.nodes.map((node, i) => (
                  <Card key={i} className="p-2">
                    <div className="flex items-center gap-1 flex-wrap">
                      <span className="text-xs font-medium">{node.name}</span>
                      {node.is_inn && <Badge variant="outline" className="text-[9px]">🏨 Inn</Badge>}
                      {node.is_vendor && <Badge variant="outline" className="text-[9px]">🛒 Vendor</Badge>}
                      {node.is_blacksmith && <Badge variant="outline" className="text-[9px]">🔨 Smith</Badge>}
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{node.description}</p>
                    <div className="text-[9px] text-muted-foreground mt-0.5">
                      Exits: {node.connections.map(c => {
                        const isExisting = c.target_temp_id.startsWith('existing:');
                        const targetName = isExisting
                          ? `⟵ existing node`
                          : generated.nodes.find(n => n.temp_id === c.target_temp_id)?.name || c.target_temp_id;
                        return `${c.direction} → ${targetName}`;
                      }).join(', ')}
                    </div>
                  </Card>
                ))}
              </CollapsibleContent>
            </Collapsible>

            {/* Creatures */}
            <Collapsible defaultOpen>
              <CollapsibleTrigger className="flex items-center gap-1 text-xs font-display text-primary w-full">
                <ChevronDown className="w-3 h-3" />
                <Swords className="w-3 h-3" /> Creatures ({generated.creatures.length})
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-1 mt-1">
                {generated.creatures.map((cr, i) => (
                  <Card key={i} className="p-2">
                    <div className="flex items-center gap-1 flex-wrap">
                      <span className="text-xs font-medium">{cr.name}</span>
                      <Badge variant={rarityColor(cr.rarity)} className="text-[9px]">{cr.rarity}</Badge>
                      <span className="text-[9px] text-muted-foreground">Lvl {cr.level}</span>
                      <span className="text-[9px] text-muted-foreground">HP {cr.hp}</span>
                      {cr.is_aggressive && <Badge variant="destructive" className="text-[9px]">⚔ Aggressive</Badge>}
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{cr.description}</p>
                    <div className="text-[9px] text-muted-foreground">
                      📍 {generated.nodes.find(n => n.temp_id === cr.node_temp_id)?.name || cr.node_temp_id}
                    </div>
                  </Card>
                ))}
              </CollapsibleContent>
            </Collapsible>

            {/* NPCs */}
            <Collapsible defaultOpen>
              <CollapsibleTrigger className="flex items-center gap-1 text-xs font-display text-primary w-full">
                <ChevronDown className="w-3 h-3" />
                <MessageSquare className="w-3 h-3" /> NPCs ({generated.npcs.length})
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-1 mt-1">
                {generated.npcs.map((npc, i) => (
                  <Card key={i} className="p-2">
                    <span className="text-xs font-medium">{npc.name}</span>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{npc.description}</p>
                    <p className="text-[10px] italic text-muted-foreground mt-0.5">"{npc.dialogue.slice(0, 120)}{npc.dialogue.length > 120 ? '…' : ''}"</p>
                    <div className="text-[9px] text-muted-foreground">
                      📍 {generated.nodes.find(n => n.temp_id === npc.node_temp_id)?.name || npc.node_temp_id}
                    </div>
                  </Card>
                ))}
              </CollapsibleContent>
            </Collapsible>

            {/* Apply button */}
            <div className="pt-2 border-t border-border">
              <Button onClick={applyAll} disabled={applying} className="w-full text-xs">
                {applying ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Check className="w-3 h-3 mr-1" />}
                {applying ? 'Applying…' : `Apply All (${generated.nodes.length} nodes, ${generated.creatures.length} creatures, ${generated.npcs.length} NPCs)`}
              </Button>
            </div>
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
