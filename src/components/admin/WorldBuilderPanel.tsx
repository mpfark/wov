import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2, Wand2, ChevronDown, Check, MapPin, Swords, MessageSquare } from 'lucide-react';

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

const DIRECTION_OPPOSITES: Record<string, string> = {
  north: 'south', south: 'north',
  east: 'west', west: 'east',
  northeast: 'southwest', southwest: 'northeast',
  northwest: 'southeast', southeast: 'northwest',
  up: 'down', down: 'up',
  inside: 'outside', outside: 'inside',
};

export default function WorldBuilderPanel() {
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [generated, setGenerated] = useState<GeneratedWorld | null>(null);

  const generate = async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    setGenerated(null);

    try {
      const { data, error } = await supabase.functions.invoke('ai-world-builder', {
        body: { prompt: prompt.trim() },
      });

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
      // 1. Insert region
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
      const regionId = regionData.id;

      // 2. Insert nodes (without connections first to get real IDs)
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

      // 3. Update connections with real IDs (bidirectional)
      for (const node of generated.nodes) {
        const realId = tempToReal.get(node.temp_id)!;
        const connections = node.connections
          .filter(c => tempToReal.has(c.target_temp_id))
          .map(c => ({
            node_id: tempToReal.get(c.target_temp_id)!,
            direction: c.direction,
          }));

        await supabase.from('nodes').update({ connections }).eq('id', realId);
      }

      // Also add reverse connections for bidirectionality
      const reverseMap = new Map<string, { node_id: string; direction: string }[]>();
      for (const node of generated.nodes) {
        const realId = tempToReal.get(node.temp_id)!;
        for (const c of node.connections) {
          const targetReal = tempToReal.get(c.target_temp_id);
          if (!targetReal) continue;
          const opposite = DIRECTION_OPPOSITES[c.direction] || c.direction;
          if (!reverseMap.has(targetReal)) reverseMap.set(targetReal, []);
          // Only add if not already present from the node's own connections
          const existing = reverseMap.get(targetReal)!;
          if (!existing.some(e => e.node_id === realId)) {
            existing.push({ node_id: realId, direction: opposite });
          }
        }
      }

      // Merge reverse connections into existing
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

      // 4. Insert creatures
      for (const creature of generated.creatures) {
        const nodeId = tempToReal.get(creature.node_temp_id);
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

      // 5. Insert NPCs
      for (const npc of generated.npcs) {
        const nodeId = tempToReal.get(npc.node_temp_id);
        if (!nodeId) continue;
        await supabase.from('npcs').insert({
          name: npc.name,
          description: npc.description,
          dialogue: npc.dialogue,
          node_id: nodeId,
        });
      }

      toast.success(`Applied! Created ${generated.region.name} with ${generated.nodes.length} nodes, ${generated.creatures.length} creatures, ${generated.npcs.length} NPCs.`);
      setGenerated(null);
      setPrompt('');
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
      {/* Input area */}
      <div className="p-4 border-b border-border bg-card/30 space-y-2 shrink-0">
        <Textarea
          placeholder={'e.g. "Create the Rivendell region for levels 15-25 with 6 nodes including Elrond\'s House as an inn"'}
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          className="min-h-[60px] text-xs resize-none"
          onKeyDown={e => { if (e.key === 'Enter' && e.metaKey) generate(); }}
        />
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={generate} disabled={loading || !prompt.trim()} className="text-xs">
            {loading ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Wand2 className="w-3 h-3 mr-1" />}
            {loading ? 'Generating…' : 'Generate'}
          </Button>
          <span className="text-[10px] text-muted-foreground">⌘+Enter to generate</span>
        </div>
      </div>

      {/* Preview area */}
      <ScrollArea className="flex-1">
        {!generated && !loading && (
          <div className="flex items-center justify-center h-48 text-muted-foreground text-xs">
            Describe a region to generate world content
          </div>
        )}

        {loading && (
          <div className="flex flex-col items-center justify-center h-48 gap-2">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
            <span className="text-xs text-muted-foreground">Building your world…</span>
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
              </div>
              <p className="text-[11px] text-muted-foreground">{generated.region.description}</p>
            </Card>

            {/* Nodes */}
            <Collapsible defaultOpen>
              <CollapsibleTrigger className="flex items-center gap-1 text-xs font-display text-primary w-full">
                <ChevronDown className="w-3 h-3" />
                Nodes ({generated.nodes.length})
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
                      Exits: {node.connections.map(c => `${c.direction} → ${generated.nodes.find(n => n.temp_id === c.target_temp_id)?.name || c.target_temp_id}`).join(', ')}
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
