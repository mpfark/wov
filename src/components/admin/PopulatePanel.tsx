import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2, Wand2, ChevronDown, Check, Swords, X } from 'lucide-react';
import WorldBuilderPreviewGraph from './WorldBuilderPreviewGraph';

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

interface GeneratedWorld {
  region: any;
  areas: any[];
  nodes: any[];
  creatures: GeneratedCreature[];
  npcs: any[];
}

interface LootTableInfo {
  id: string;
  name: string;
}

interface PopulatePanelProps {
  selectedNodeIds: Set<string>;
  allNodes: any[];
  onClose: () => void;
  onDataChanged?: () => void;
}

export default function PopulatePanel({ selectedNodeIds, allNodes, onClose, onDataChanged }: PopulatePanelProps) {
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [generated, setGenerated] = useState<GeneratedWorld | null>(null);
  const [lootTables, setLootTables] = useState<LootTableInfo[]>([]);

  useEffect(() => {
    supabase.from('loot_tables').select('id, name').then(({ data }) => {
      setLootTables((data || []) as LootTableInfo[]);
    });
  }, []);

  const selectedNodes = allNodes.filter(n => selectedNodeIds.has(n.id));

  const generate = async () => {
    if (!prompt.trim()) return;
    if (selectedNodeIds.size === 0) {
      toast.error('Select at least one node to populate');
      return;
    }
    setLoading(true);
    setGenerated(null);

    try {
      const body: any = {
        prompt: prompt.trim(),
        populate_nodes: selectedNodes.map(n => ({
          id: n.id,
          name: n.name,
          description: n.description,
          region_name: n.region_name,
          min_level: n.min_level,
          max_level: n.max_level,
        })),
      };

      const { data, error } = await supabase.functions.invoke('ai-world-builder', { body });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (!data.areas) data.areas = [];
      setGenerated(data as GeneratedWorld);
      toast.success('Creatures generated! Review below.');
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
      onDataChanged?.();
    } catch (e: any) {
      toast.error('Apply failed: ' + (e.message || 'Unknown error'));
    } finally {
      setApplying(false);
    }
  };

  const rarityColor = (r: string) => {
    if (r === 'boss') return 'destructive' as const;
    if (r === 'rare') return 'secondary' as const;
    return 'outline' as const;
  };

  const getNodeName = (nodeTempId: string) => {
    const node = allNodes.find((n: any) => n.id === nodeTempId);
    return node?.name || nodeTempId;
  };

  const getLootTableName = (id?: string | null) => {
    if (!id) return null;
    return lootTables.find(lt => lt.id === id)?.name || null;
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-card/50 shrink-0">
        <Swords className="w-3.5 h-3.5 text-primary" />
        <span className="font-display text-xs text-primary">Populate Nodes</span>
        <Badge variant="outline" className="text-[9px]">{selectedNodeIds.size} selected</Badge>
        <div className="flex-1" />
        <Button variant="ghost" size="sm" onClick={onClose} className="h-6 w-6 p-0">
          <X className="w-3 h-3" />
        </Button>
      </div>

      {/* Prompt input */}
      <div className="p-3 border-b border-border space-y-2 shrink-0">
        <Textarea
          placeholder='e.g. "Add lore-appropriate creatures, mix of aggressive and passive"'
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          className="min-h-[50px] text-xs resize-none"
          onKeyDown={e => { if (e.key === 'Enter' && e.metaKey) generate(); }}
        />
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={generate}
            disabled={loading || !prompt.trim() || selectedNodeIds.size === 0}
            className="text-xs"
          >
            {loading ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Wand2 className="w-3 h-3 mr-1" />}
            {loading ? 'Generating…' : 'Populate'}
          </Button>
          <span className="text-[10px] text-muted-foreground">⌘+Enter</span>
        </div>
      </div>

      {/* Results */}
      <ScrollArea className="flex-1">
        {!generated && !loading && (
          <div className="flex items-center justify-center h-32 text-muted-foreground text-xs px-4 text-center">
            Click nodes on the map to select them, then describe what creatures to generate
          </div>
        )}

        {loading && (
          <div className="flex flex-col items-center justify-center h-32 gap-2">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
            <span className="text-xs text-muted-foreground">Generating creatures…</span>
          </div>
        )}

        {generated && (
          <div className="p-3 space-y-3">
            {/* Preview graph */}
            <WorldBuilderPreviewGraph
              nodes={generated.nodes}
              creatures={generated.creatures}
              npcs={generated.npcs}
              items={[]}
              areas={generated.areas}
              mode="populate"
              populateNodeNames={
                new Map(selectedNodes.map(n => [n.id, n.name]))
              }
            />

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
                          📍 {getNodeName(cr.node_temp_id)}
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

            {/* Apply button */}
            <div className="pt-2 border-t border-border">
              <Button onClick={applyAll} disabled={applying} className="w-full text-xs">
                {applying ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Check className="w-3 h-3 mr-1" />}
                {applying ? 'Applying…' : `Apply ${generated.creatures.length} Creatures`}
              </Button>
            </div>
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
