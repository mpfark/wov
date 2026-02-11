import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { ArrowLeft, Trash2 } from 'lucide-react';
import RegionGraphView from '@/components/admin/RegionGraphView';
import NodeEditorDialog from '@/components/admin/NodeEditorDialog';
import RegionManager from '@/components/admin/RegionManager';

interface AdminPageProps {
  onBack: () => void;
  isValar: boolean;
}

export default function AdminPage({ onBack, isValar }: AdminPageProps) {
  const [regions, setRegions] = useState<any[]>([]);
  const [nodes, setNodes] = useState<any[]>([]);
  const [selectedRegion, setSelectedRegion] = useState<string>('');
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [isNewNode, setIsNewNode] = useState(false);
  const [adjacentToNodeId, setAdjacentToNodeId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    const [r, n] = await Promise.all([
      supabase.from('regions').select('*').order('min_level'),
      supabase.from('nodes').select('*').order('name'),
    ]);
    setRegions(r.data || []);
    setNodes(n.data || []);
    if (!selectedRegion && r.data && r.data.length > 0) {
      setSelectedRegion(r.data[0].id);
    }
  }, [selectedRegion]);

  useEffect(() => { loadData(); }, []);

  const regionNodes = nodes.filter(n => n.region_id === selectedRegion);
  const currentRegion = regions.find(r => r.id === selectedRegion);

  const handleNodeClick = (nodeId: string) => {
    setEditingNodeId(nodeId);
    setIsNewNode(false);
    setAdjacentToNodeId(null);
    setEditorOpen(true);
  };

  const handleAddNodeAdjacent = (fromId: string) => {
    setEditingNodeId(null);
    setIsNewNode(true);
    setAdjacentToNodeId(fromId || null);
    setEditorOpen(true);
  };

  const handleAddNodeBetween = (fromId: string, toId: string) => {
    // Open new node editor — user will manually set connections after creation
    setEditingNodeId(null);
    setIsNewNode(true);
    setEditorOpen(true);
  };

  const handleEditorSaved = () => {
    loadData();
    if (isNewNode) {
      setEditorOpen(false);
    }
  };

  const deleteRegion = async (id: string) => {
    const { error } = await supabase.from('regions').delete().eq('id', id);
    if (error) return toast.error(error.message);
    toast.success('Region deleted');
    if (selectedRegion === id) setSelectedRegion('');
    loadData();
  };

  return (
    <div className="h-screen flex flex-col parchment-bg">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-card/50">
        <Button variant="ghost" size="sm" onClick={onBack} className="text-xs">
          <ArrowLeft className="w-3 h-3 mr-1" /> Back
        </Button>
        <h1 className="font-display text-sm text-primary text-glow">
          {isValar ? '⚡ Valar' : '✨ Maiar'} World Editor
        </h1>
        <div className="flex-1" />

        {/* Region selector */}
        <Select value={selectedRegion} onValueChange={setSelectedRegion}>
          <SelectTrigger className="w-48 h-8 text-xs font-display">
            <SelectValue placeholder="Select region" />
          </SelectTrigger>
          <SelectContent>
            {regions.map(r => (
              <SelectItem key={r.id} value={r.id} className="text-xs">
                {r.name} <span className="text-muted-foreground ml-1">(Lvl {r.min_level}–{r.max_level})</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {isValar && currentRegion && (
          <Button variant="destructive" size="sm" onClick={() => deleteRegion(selectedRegion)} className="text-xs h-8">
            <Trash2 className="w-3 h-3" />
          </Button>
        )}

        <RegionManager
          regions={regions}
          onCreated={loadData}
          isValar={isValar}
          onDelete={deleteRegion}
        />
      </div>

      {/* Region info bar */}
      {currentRegion && (
        <div className="px-4 py-1.5 border-b border-border bg-card/30 flex items-center gap-4">
          <span className="font-display text-xs text-primary">{currentRegion.name}</span>
          <span className="text-xs text-muted-foreground">Level {currentRegion.min_level}–{currentRegion.max_level}</span>
          <span className="text-xs text-muted-foreground">{regionNodes.length} nodes</span>
          {currentRegion.description && (
            <span className="text-xs text-muted-foreground truncate">{currentRegion.description}</span>
          )}
        </div>
      )}

      {/* Graph view */}
      <div className="flex-1 overflow-hidden">
        {selectedRegion ? (
          <RegionGraphView
            nodes={regionNodes}
            onNodeClick={handleNodeClick}
            onAddNodeBetween={handleAddNodeBetween}
            onAddNodeAdjacent={handleAddNodeAdjacent}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground font-display text-sm">
            Select or create a region to begin
          </div>
        )}
      </div>

      {/* Node editor dialog */}
      <NodeEditorDialog
        nodeId={editingNodeId}
        regionId={selectedRegion}
        allNodes={regionNodes}
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        onSaved={handleEditorSaved}
        isValar={isValar}
        adjacentToNodeId={adjacentToNodeId}
      />
    </div>
  );
}
