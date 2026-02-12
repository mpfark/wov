import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { ArrowLeft } from 'lucide-react';
import AdminWorldMapView from '@/components/admin/AdminWorldMapView';
import NodeEditorDialog from '@/components/admin/NodeEditorDialog';
import RegionManager from '@/components/admin/RegionManager';
import ItemManager from '@/components/admin/ItemManager';
import CreatureManager from '@/components/admin/CreatureManager';
import UserManager from '@/components/admin/UserManager';
import RaceClassManager from '@/components/admin/RaceClassManager';

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
  }, []);

  useEffect(() => { loadData(); }, []);

  const handleNodeClick = (nodeId: string) => {
    const node = nodes.find(n => n.id === nodeId);
    if (node) setSelectedRegion(node.region_id);
    setEditingNodeId(nodeId);
    setIsNewNode(false);
    setAdjacentToNodeId(null);
    setEditorOpen(true);
  };

  const handleAddNodeAdjacent = (fromId: string) => {
    // Derive region from the source node if possible
    if (fromId) {
      const node = nodes.find(n => n.id === fromId);
      if (node) setSelectedRegion(node.region_id);
    }
    setEditingNodeId(null);
    setIsNewNode(true);
    setAdjacentToNodeId(fromId || null);
    setEditorOpen(true);
  };

  const handleAddNodeBetween = (fromId: string, toId: string) => {
    const node = nodes.find(n => n.id === fromId);
    if (node) setSelectedRegion(node.region_id);
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

  // Nodes for the selected region (used by NodeEditorDialog)
  const regionNodes = nodes.filter(n => n.region_id === selectedRegion);

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
      </div>

      <Tabs defaultValue="world" className="flex-1 flex flex-col min-h-0 overflow-hidden">
        <div className="px-4 pt-2 border-b border-border bg-card/30 shrink-0">
          <TabsList className="h-8">
            <TabsTrigger value="world" className="font-display text-xs">World</TabsTrigger>
            <TabsTrigger value="creatures" className="font-display text-xs">Creatures</TabsTrigger>
            <TabsTrigger value="items" className="font-display text-xs">Items</TabsTrigger>
            <TabsTrigger value="users" className="font-display text-xs">Users</TabsTrigger>
            <TabsTrigger value="races-classes" className="font-display text-xs">Races & Classes</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="world" className="flex-1 flex flex-col min-h-0 mt-0 overflow-hidden">
          {/* Region controls — just the manager button */}
          <div className="flex items-center gap-2 px-4 py-1.5 border-b border-border bg-card/30 shrink-0">
            <RegionManager
              regions={regions}
              onCreated={loadData}
              isValar={isValar}
              onDelete={deleteRegion}
            />
            <span className="text-xs text-muted-foreground ml-2">
              {regions.length} regions · {nodes.length} nodes
            </span>
          </div>

          {/* World map view */}
          <div className="flex-1 overflow-hidden">
            <AdminWorldMapView
              regions={regions}
              nodes={nodes}
              onNodeClick={handleNodeClick}
              onAddNodeBetween={handleAddNodeBetween}
              onAddNodeAdjacent={handleAddNodeAdjacent}
            />
          </div>
        </TabsContent>

        <TabsContent value="creatures" className="flex-1 min-h-0 mt-0 overflow-hidden">
          <CreatureManager />
        </TabsContent>

        <TabsContent value="items" className="flex-1 min-h-0 mt-0 overflow-hidden">
          <ItemManager />
        </TabsContent>

        <TabsContent value="users" className="flex-1 min-h-0 mt-0 overflow-hidden">
          <UserManager isValar={isValar} />
        </TabsContent>

        <TabsContent value="races-classes" className="flex-1 min-h-0 mt-0 overflow-hidden">
          <RaceClassManager />
        </TabsContent>
      </Tabs>

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
