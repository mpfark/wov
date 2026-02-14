import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2, Wand2, ChevronDown, Check, MapPin, Swords, MessageSquare, Plus, Expand, Bug } from 'lucide-react';
import WorldBuilderPreviewGraph from './WorldBuilderPreviewGraph';

// ... keep existing code (interfaces GeneratedRegion through ExistingRegion, lines 13-65)
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

interface ExistingNode {
  id: string;
  name: string;
  description: string;
  region_id: string;
  region_name?: string;
  min_level?: number;
  max_level?: number;
}

const DIRECTION_OPPOSITES: Record<string, string> = {
  N: 'S', S: 'N',
  E: 'W', W: 'E',
  NE: 'SW', SW: 'NE',
  NW: 'SE', SE: 'NW',
};

type Mode = 'new' | 'expand' | 'populate';

export default function WorldBuilderPanel() {
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [generated, setGenerated] = useState<GeneratedWorld | null>(null);
  const [mode, setMode] = useState<Mode>('new');
  const [regions, setRegions] = useState<ExistingRegion[]>([]);
  const [selectedRegionId, setSelectedRegionId] = useState<string>('');
  const [allNodes, setAllNodes] = useState<ExistingNode[]>([]);
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const load = async () => {
      const [regRes, nodeRes] = await Promise.all([
        supabase.from('regions').select('id, name, description, min_level, max_level').order('min_level'),
        supabase.from('nodes').select('id, name, description, region_id').order('name'),
      ]);
      const regs = regRes.data || [];
      setRegions(regs);
      const ns = (nodeRes.data || []).map((n: any) => {
        const r = regs.find((reg: any) => reg.id === n.region_id);
        return { ...n, region_name: r?.name, min_level: r?.min_level, max_level: r?.max_level };
      });
      setAllNodes(ns);
    };
    load();
  }, []);

  const selectedRegion = regions.find(r => r.id === selectedRegionId);
  const regionNodes = allNodes.filter(n => n.region_id === selectedRegionId);

  const toggleNode = (nodeId: string) => {
    setSelectedNodeIds(prev => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };

  const selectAllNodes = () => {
    setSelectedNodeIds(new Set(regionNodes.map(n => n.id)));
  };

  const deselectAllNodes = () => {
    setSelectedNodeIds(new Set());
  };

  const generate = async () => {
    if (!prompt.trim()) return;
    if (mode === 'expand' && !selectedRegionId) {
      toast.error('Select a region to expand');
      return;
    }
    if (mode === 'populate' && selectedNodeIds.size === 0) {
      toast.error('Select at least one node to populate');
      return;
    }
    setLoading(true);
    setGenerated(null);

    try {
      const body: any = { prompt: prompt.trim() };
      if (mode === 'expand' && selectedRegion) {
        body.expand_region = { id: selectedRegion.id, name: selectedRegion.name };
      }
      if (mode === 'populate') {
        body.populate_nodes = allNodes
          .filter(n => selectedNodeIds.has(n.id))
          .map(n => ({ id: n.id, name: n.name, description: n.description, region_name: n.region_name, min_level: n.min_level, max_level: n.max_level }));
      }

      const { data, error } = await supabase.functions.invoke('ai-world-builder', { body });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setGenerated(data as GeneratedWorld);
      toast.success('Content generated! Review below.');
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
      if (mode === 'populate') {
        // Populate mode: only insert creatures, using real node IDs directly
        for (const creature of generated.creatures) {
          const nodeId = creature.node_temp_id; // Already a real UUID
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
        toast.success(`Populated ${generated.creatures.length} creatures across ${selectedNodeIds.size} nodes.`);
        setGenerated(null);
        setPrompt('');
        setApplying(false);
        return;
      }

      let regionId: string;

      if (mode === 'expand' && selectedRegionId) {
        regionId = selectedRegionId;
      } else {
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

      // Insert new nodes
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

      const resolveTarget = (target: string): string | null => {
        if (target.startsWith('existing:')) {
          return target.replace('existing:', '');
        }
        return tempToReal.get(target) || null;
      };

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

      // Reverse connections
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

  // For populate mode, map node IDs to names for the preview
  const getNodeNameForCreature = (nodeTempId: string) => {
    if (mode === 'populate') {
      const node = allNodes.find(n => n.id === nodeTempId);
      return node?.name || nodeTempId;
    }
    return generated?.nodes.find(n => n.temp_id === nodeTempId)?.name || nodeTempId;
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
          <Button
            size="sm"
            variant={mode === 'populate' ? 'default' : 'outline'}
            onClick={() => { setMode('populate'); setGenerated(null); setSelectedNodeIds(new Set()); }}
            className="text-xs"
          >
            <Bug className="w-3 h-3 mr-1" /> Populate Nodes
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

        {/* Region + node picker for populate mode */}
        {mode === 'populate' && (
          <div className="space-y-2">
            <Select value={selectedRegionId} onValueChange={(v) => { setSelectedRegionId(v); setSelectedNodeIds(new Set()); }}>
              <SelectTrigger className="text-xs h-8">
                <SelectValue placeholder="Select region…" />
              </SelectTrigger>
              <SelectContent>
                {regions.map(r => (
                  <SelectItem key={r.id} value={r.id} className="text-xs">
                    {r.name} (Lvl {r.min_level}–{r.max_level})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedRegionId && regionNodes.length > 0 && (
              <div className="border border-border rounded p-2 max-h-40 overflow-y-auto space-y-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] text-muted-foreground font-medium">Select nodes ({selectedNodeIds.size}/{regionNodes.length})</span>
                  <Button variant="link" size="sm" onClick={selectAllNodes} className="text-[10px] h-4 p-0">All</Button>
                  <Button variant="link" size="sm" onClick={deselectAllNodes} className="text-[10px] h-4 p-0">None</Button>
                </div>
                {regionNodes.map(n => (
                  <label key={n.id} className="flex items-center gap-2 cursor-pointer hover:bg-accent/30 rounded px-1 py-0.5">
                    <Checkbox
                      checked={selectedNodeIds.has(n.id)}
                      onCheckedChange={() => toggleNode(n.id)}
                      className="h-3 w-3"
                    />
                    <span className="text-xs">{n.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}

        <Textarea
          placeholder={
            mode === 'populate'
              ? 'e.g. "Add lore-appropriate creatures to these nodes, mix of aggressive and passive"'
              : mode === 'expand'
              ? 'e.g. "Add 10 more nodes to the south, including a dark forest with wolves and a hidden cave with a boss"'
              : 'e.g. "Create the Rivendell region for levels 15-25 with 6 nodes including Elrond\'s House as an inn"'
          }
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          className="min-h-[60px] text-xs resize-none"
          onKeyDown={e => { if (e.key === 'Enter' && e.metaKey) generate(); }}
        />
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={generate}
            disabled={loading || !prompt.trim() || (mode === 'expand' && !selectedRegionId) || (mode === 'populate' && selectedNodeIds.size === 0)}
            className="text-xs"
          >
            {loading ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Wand2 className="w-3 h-3 mr-1" />}
            {loading ? 'Generating…' : mode === 'populate' ? 'Populate' : mode === 'expand' ? 'Expand' : 'Generate'}
          </Button>
          <span className="text-[10px] text-muted-foreground">⌘+Enter to generate</span>
        </div>
      </div>

      {/* Preview area */}
      <ScrollArea className="flex-1">
        {!generated && !loading && (
          <div className="flex items-center justify-center h-48 text-muted-foreground text-xs">
            {mode === 'populate'
              ? 'Select a region & nodes, then describe what creatures to generate'
              : mode === 'expand'
              ? 'Select a region and describe how to expand it'
              : 'Describe a region to generate world content'}
          </div>
        )}

        {loading && (
          <div className="flex flex-col items-center justify-center h-48 gap-2">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
            <span className="text-xs text-muted-foreground">
              {mode === 'populate' ? 'Generating creatures…' : mode === 'expand' ? 'Expanding region…' : 'Building your world…'}
            </span>
          </div>
        )}

        {generated && (
          <div className="p-4 space-y-3">
            {/* Visual Node Graph Preview */}
            <WorldBuilderPreviewGraph
              nodes={generated.nodes}
              creatures={generated.creatures}
              npcs={generated.npcs}
              mode={mode}
              existingAnchors={
                mode === 'expand'
                  ? generated.nodes
                      .flatMap(n => n.connections)
                      .filter(c => c.target_temp_id.startsWith('existing:'))
                      .map(c => {
                        const realId = c.target_temp_id.replace('existing:', '');
                        const node = allNodes.find(n => n.id === realId);
                        return { id: realId, name: node?.name || realId };
                      })
                      .filter((v, i, a) => a.findIndex(x => x.id === v.id) === i)
                  : []
              }
              populateNodeNames={
                mode === 'populate'
                  ? new Map(
                      allNodes
                        .filter(n => selectedNodeIds.has(n.id))
                        .map(n => [n.id, n.name])
                    )
                  : undefined
              }
            />

            {/* Region info (hide for populate mode) */}
            {mode !== 'populate' && (
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
            )}

            {/* Creatures */}
            {generated.creatures.length > 0 && (
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
                        📍 {getNodeNameForCreature(cr.node_temp_id)}
                      </div>
                    </Card>
                  ))}
                </CollapsibleContent>
              </Collapsible>
            )}

            {/* NPCs (hide for populate mode) */}
            {mode !== 'populate' && generated.npcs.length > 0 && (
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
            )}

            {/* Apply button */}
            <div className="pt-2 border-t border-border">
              <Button onClick={applyAll} disabled={applying} className="w-full text-xs">
                {applying ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Check className="w-3 h-3 mr-1" />}
                {applying
                  ? 'Applying…'
                  : mode === 'populate'
                  ? `Apply ${generated.creatures.length} Creatures`
                  : `Apply All (${generated.nodes.length} nodes, ${generated.creatures.length} creatures, ${generated.npcs.length} NPCs)`
                }
              </Button>
            </div>
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
