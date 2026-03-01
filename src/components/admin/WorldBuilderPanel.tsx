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
import { Loader2, Wand2, ChevronDown, Check, MapPin, Swords, MessageSquare, Plus, Expand, Bug, Book, TreePine } from 'lucide-react';
import WorldBuilderPreviewGraph from './WorldBuilderPreviewGraph';
import PopulateNodeSelector from './PopulateNodeSelector';
import WorldBuilderRulebook from './WorldBuilderRulebook';
import { calculateHumanoidGold } from '@/lib/game-data';

interface GeneratedRegion {
  name: string;
  description: string;
  min_level: number;
  max_level: number;
}

interface GeneratedArea {
  temp_id: string;
  name: string;
  description: string;
  area_type: string;
}

interface GeneratedNode {
  temp_id: string;
  name: string;
  description: string;
  area_temp_id: string;
  is_inn?: boolean;
  is_vendor?: boolean;
  is_blacksmith?: boolean;
  connections: { target_temp_id: string; direction: string }[];
}

interface GeneratedCreature {
  temp_id?: string;
  name: string;
  description: string;
  node_temp_id: string;
  level: number;
  hp: number;
  max_hp: number;
  ac: number;
  rarity: string;
  is_aggressive: boolean;
  is_humanoid?: boolean;
  respawn_seconds?: number;
  stats: Record<string, number>;
  loot_table?: any[];
  loot_table_id?: string | null;
  drop_chance?: number;
}

interface GeneratedNPC {
  name: string;
  description: string;
  dialogue: string;
  node_temp_id: string;
}

interface GeneratedWorld {
  region: GeneratedRegion;
  areas: GeneratedArea[];
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
  connections: Array<{ node_id: string; direction: string }>;
}

interface LootTableInfo {
  id: string;
  name: string;
}

const DIRECTION_OPPOSITES: Record<string, string> = {
  N: 'S', S: 'N',
  E: 'W', W: 'E',
  NE: 'SW', SW: 'NE',
  NW: 'SE', SE: 'NW',
};

const AREA_TYPE_EMOJI: Record<string, string> = {
  forest: '🌲', town: '🏘️', cave: '🕳️', ruins: '🏚️', plains: '🌾',
  mountain: '⛰️', swamp: '🌿', desert: '🏜️', coast: '🌊', dungeon: '🏰', other: '📍',
};

type Mode = 'rulebook' | 'new' | 'expand' | 'populate';

interface WorldBuilderPanelProps {
  onDataChanged?: () => void;
}

export default function WorldBuilderPanel({ onDataChanged }: WorldBuilderPanelProps = {}) {
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [generated, setGenerated] = useState<GeneratedWorld | null>(null);
  const [mode, setMode] = useState<Mode>('new');
  const [regions, setRegions] = useState<ExistingRegion[]>([]);
  const [selectedRegionId, setSelectedRegionId] = useState<string>('');
  const [allNodes, setAllNodes] = useState<ExistingNode[]>([]);
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
  const [mapCollapsed, setMapCollapsed] = useState(false);
  const [creatureCounts, setCreatureCounts] = useState<Map<string, { total: number; aggressive: number }>>(new Map());
  const [npcCounts, setNPCCounts] = useState<Map<string, number>>(new Map());
  const [lootTables, setLootTables] = useState<LootTableInfo[]>([]);

  useEffect(() => {
    const load = async () => {
      const [regRes, nodeRes, crRes, npRes, ltRes] = await Promise.all([
        supabase.from('regions').select('id, name, description, min_level, max_level').order('min_level'),
        supabase.from('nodes').select('id, name, description, region_id, connections').order('name'),
        supabase.from('creatures').select('id, node_id, is_aggressive, is_alive'),
        supabase.from('npcs').select('id, node_id'),
        supabase.from('loot_tables').select('id, name'),
      ]);
      const regs = regRes.data || [];
      setRegions(regs);
      const ns = (nodeRes.data || []).map((n: any) => {
        const r = regs.find((reg: any) => reg.id === n.region_id);
        return { ...n, region_name: r?.name, min_level: r?.min_level, max_level: r?.max_level, connections: (n.connections as any[]) || [] };
      });
      setAllNodes(ns);
      setLootTables((ltRes.data || []) as LootTableInfo[]);

      const cc = new Map<string, { total: number; aggressive: number }>();
      for (const cr of (crRes.data || [])) {
        if (!cr.node_id || !cr.is_alive) continue;
        const entry = cc.get(cr.node_id) || { total: 0, aggressive: 0 };
        entry.total++;
        if (cr.is_aggressive) entry.aggressive++;
        cc.set(cr.node_id, entry);
      }
      setCreatureCounts(cc);

      const nc = new Map<string, number>();
      for (const npc of (npRes.data || [])) {
        if (!npc.node_id) continue;
        nc.set(npc.node_id, (nc.get(npc.node_id) || 0) + 1);
      }
      setNPCCounts(nc);
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
    setMapCollapsed(true);

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
      // Ensure areas array exists in response
      if (!data.areas) data.areas = [];
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
            is_humanoid: creature.is_humanoid || false,
            respawn_seconds: creature.respawn_seconds || 300,
            stats: creature.stats,
            loot_table: [],
            loot_table_id: creature.loot_table_id || null,
            drop_chance: creature.drop_chance || 0.3,
          });
        }
        toast.success(`Populated ${generated.creatures.length} creatures across ${selectedNodeIds.size} nodes.`);
        setGenerated(null);
        setPrompt('');
        setApplying(false);
        onDataChanged?.();
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

      // Insert areas and build temp_id → real_id map
      const areaTempToReal = new Map<string, string>();
      for (const area of (generated.areas || [])) {
        const { data: areaData, error: areaErr } = await supabase
          .from('areas')
          .insert({
            name: area.name,
            description: area.description,
            area_type: area.area_type as any,
            region_id: regionId,
          })
          .select('id')
          .single();
        if (areaErr) throw areaErr;
        areaTempToReal.set(area.temp_id, areaData.id);
      }

      const resolveAreaId = (areaTempId: string): string | null => {
        if (!areaTempId) return null;
        if (areaTempId.startsWith('existing_area:')) {
          return areaTempId.replace('existing_area:', '');
        }
        return areaTempToReal.get(areaTempId) || null;
      };

      // Insert new nodes
      const tempToReal = new Map<string, string>();
      for (const node of generated.nodes) {
        const areaId = resolveAreaId(node.area_temp_id);
        const { data: nodeData, error: nodeErr } = await supabase
          .from('nodes')
          .insert({
            name: node.name || '',
            description: node.description || '',
            region_id: regionId,
            area_id: areaId,
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

        const isHumanoid = creature.is_humanoid || false;
        const goldLoot = isHumanoid
          ? [calculateHumanoidGold(creature.level, creature.rarity)]
          : [];

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
          is_humanoid: isHumanoid,
          respawn_seconds: creature.respawn_seconds || 300,
          stats: creature.stats,
          loot_table: goldLoot,
          loot_table_id: creature.loot_table_id || null,
          drop_chance: creature.drop_chance || 0.3,
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
      toast.success(`${action} ${generated.region.name}: ${generated.areas.length} areas, ${generated.nodes.length} nodes, ${generated.creatures.length} creatures, ${generated.npcs.length} NPCs.`);
      setGenerated(null);
      setPrompt('');
      const [newRegRes, newNodeRes, newCrRes, newNpRes] = await Promise.all([
        supabase.from('regions').select('id, name, description, min_level, max_level').order('min_level'),
        supabase.from('nodes').select('id, name, description, region_id, connections').order('name'),
        supabase.from('creatures').select('id, node_id, is_aggressive, is_alive'),
        supabase.from('npcs').select('id, node_id'),
      ]);
      const newRegs = newRegRes.data || [];
      setRegions(newRegs);
      setAllNodes((newNodeRes.data || []).map((n: any) => {
        const r = newRegs.find((reg: any) => reg.id === n.region_id);
        return { ...n, region_name: r?.name, min_level: r?.min_level, max_level: r?.max_level, connections: (n.connections as any[]) || [] };
      }));
      const newCc = new Map<string, { total: number; aggressive: number }>();
      for (const cr of (newCrRes.data || [])) {
        if (!cr.node_id || !cr.is_alive) continue;
        const entry = newCc.get(cr.node_id) || { total: 0, aggressive: 0 };
        entry.total++;
        if (cr.is_aggressive) entry.aggressive++;
        newCc.set(cr.node_id, entry);
      }
      setCreatureCounts(newCc);
      const newNc = new Map<string, number>();
      for (const npc of (newNpRes.data || [])) {
        if (!npc.node_id) continue;
        newNc.set(npc.node_id, (newNc.get(npc.node_id) || 0) + 1);
      }
      setNPCCounts(newNc);
      onDataChanged?.();
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

  const getNodeNameForCreature = (nodeTempId: string) => {
    if (mode === 'populate') {
      const node = allNodes.find(n => n.id === nodeTempId);
      return node?.name || nodeTempId;
    }
    const node = generated?.nodes.find(n => n.temp_id === nodeTempId);
    if (!node) return nodeTempId;
    if (node.name) return node.name;
    // Fallback to area name
    const area = generated?.areas.find(a => a.temp_id === node.area_temp_id);
    return area?.name || nodeTempId;
  };

  const getLootTableName = (id?: string | null) => {
    if (!id) return null;
    return lootTables.find(lt => lt.id === id)?.name || null;
  };

  const getNodeDisplayName = (node: GeneratedNode) => {
    if (node.name) return node.name;
    const area = generated?.areas.find(a => a.temp_id === node.area_temp_id);
    return area?.name || node.temp_id;
  };

  return (
    <div className="flex flex-col h-full">
      {/* Mode & Input area */}
      <div className="p-4 border-b border-border bg-card/30 space-y-2 shrink-0">
        {/* Mode toggle */}
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={mode === 'rulebook' ? 'default' : 'outline'}
            onClick={() => { setMode('rulebook'); setGenerated(null); }}
            className="text-xs"
          >
            <Book className="w-3 h-3 mr-1" /> Rulebook
          </Button>
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

        {mode !== 'rulebook' && (
          <>
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
              <Collapsible open={!mapCollapsed} onOpenChange={(open) => setMapCollapsed(!open)}>
                <CollapsibleTrigger className="flex items-center gap-1 text-[10px] text-muted-foreground font-medium w-full hover:text-foreground">
                  <ChevronDown className={`w-3 h-3 transition-transform ${mapCollapsed ? '-rotate-90' : ''}`} />
                  Node Map ({selectedNodeIds.size}/{regionNodes.length} selected)
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <PopulateNodeSelector
                    nodes={regionNodes}
                    selectedIds={selectedNodeIds}
                    creatureCounts={creatureCounts}
                    npcCounts={npcCounts}
                    onToggle={toggleNode}
                    onSelectAll={selectAllNodes}
                    onDeselectAll={deselectAllNodes}
                  />
                </CollapsibleContent>
              </Collapsible>
            )}
          </div>
        )}

        <Textarea
          placeholder={
            mode === 'populate'
              ? 'e.g. "Add lore-appropriate creatures to these nodes, mix of aggressive and passive"'
              : mode === 'expand'
              ? 'e.g. "Add a dark forest area with 4 nodes and a hidden cave area with 2 nodes including a boss"'
              : 'e.g. "Create a coastal region for levels 10-20 with a fishing village area and a sea cave area"'
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
        </>
        )}
      </div>

      {mode === 'rulebook' ? (
        <WorldBuilderRulebook />
      ) : (
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
              items={[]}
              areas={generated.areas}
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

            {/* Areas */}
            {mode !== 'populate' && generated.areas.length > 0 && (
              <Collapsible defaultOpen>
                <CollapsibleTrigger className="flex items-center gap-1 text-xs font-display text-primary w-full">
                  <ChevronDown className="w-3 h-3" />
                  <TreePine className="w-3 h-3" /> Areas ({generated.areas.length})
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-1 mt-1">
                  {generated.areas.map((area, i) => {
                    const areaNodes = generated.nodes.filter(n => n.area_temp_id === area.temp_id);
                    return (
                      <Card key={i} className="p-2">
                        <div className="flex items-center gap-1 flex-wrap">
                          <span className="text-xs">{AREA_TYPE_EMOJI[area.area_type] || '📍'}</span>
                          <span className="text-xs font-medium">{area.name}</span>
                          <Badge variant="outline" className="text-[9px]">{area.area_type}</Badge>
                          <span className="text-[9px] text-muted-foreground">{areaNodes.length} nodes</span>
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-0.5">{area.description}</p>
                        {areaNodes.length > 0 && (
                          <div className="text-[9px] text-muted-foreground mt-1 flex flex-wrap gap-1">
                            {areaNodes.map(n => {
                              const flags = [n.is_inn && '🏨', n.is_vendor && '🛒', n.is_blacksmith && '🔨'].filter(Boolean).join('');
                              return (
                                <span key={n.temp_id} className="bg-muted px-1 py-0.5 rounded">
                                  {n.name || '(unnamed)'} {flags}
                                </span>
                              );
                            })}
                          </div>
                        )}
                      </Card>
                    );
                  })}
                </CollapsibleContent>
              </Collapsible>
            )}

            {/* Creatures */}
            {generated.creatures.length > 0 && (
              <Collapsible defaultOpen>
                <CollapsibleTrigger className="flex items-center gap-1 text-xs font-display text-primary w-full">
                  <ChevronDown className="w-3 h-3" />
                  <Swords className="w-3 h-3" /> Creatures ({generated.creatures.length})
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-1 mt-1">
                  {generated.creatures.map((cr, i) => {
                    const ltName = getLootTableName(cr.loot_table_id);
                    return (
                      <Card key={i} className="p-2">
                        <div className="flex items-center gap-1 flex-wrap">
                          <span className="text-xs font-medium">{cr.name}</span>
                          <Badge variant={rarityColor(cr.rarity)} className="text-[9px]">{cr.rarity}</Badge>
                          <span className="text-[9px] text-muted-foreground">Lvl {cr.level}</span>
                          <span className="text-[9px] text-muted-foreground">HP {cr.hp}</span>
                          {cr.is_aggressive && <Badge variant="destructive" className="text-[9px]">⚔ Aggressive</Badge>}
                          {cr.is_humanoid && <Badge variant="outline" className="text-[9px]">🧑 Humanoid</Badge>}
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-0.5">{cr.description}</p>
                        <div className="text-[9px] text-muted-foreground">
                          📍 {getNodeNameForCreature(cr.node_temp_id)}
                        </div>
                        {ltName && (
                          <div className="text-[9px] text-muted-foreground mt-0.5">
                            📦 Loot: {ltName} ({Math.round((cr.drop_chance || 0.3) * 100)}% drop)
                          </div>
                        )}
                      </Card>
                    );
                  })}
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
                        📍 {getNodeNameForCreature(npc.node_temp_id)}
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
                  : `Apply All (${generated.areas.length} areas, ${generated.nodes.length} nodes, ${generated.creatures.length} creatures, ${generated.npcs.length} NPCs)`
                }
              </Button>
            </div>
          </div>
        )}
      </ScrollArea>
      )}
    </div>
  );
}
