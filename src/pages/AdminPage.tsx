import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { ArrowLeft, BookOpen, Bug } from 'lucide-react';
import AdminWorldMapView from '@/components/admin/AdminWorldMapView';
import NodeEditorPanel from '@/components/admin/NodeEditorPanel';
import RegionManager from '@/components/admin/RegionManager';
import ItemManager from '@/components/admin/ItemManager';
import CreatureManager from '@/components/admin/CreatureManager';
import UserManager from '@/components/admin/UserManager';
import RaceClassManager from '@/components/admin/RaceClassManager';
import RoadmapManager from '@/components/admin/RoadmapManager';
import NPCManager from '@/components/admin/NPCManager';
import LootTableManager from '@/components/admin/LootTableManager';
import ItemForgePanel from '@/components/admin/ItemForgePanel';
import GameManual from '@/components/admin/GameManual';
import XpBoostPanel from '@/components/admin/XpBoostPanel';
import AreaManager from '@/components/admin/AreaManager';
import WorldBuilderRulebook from '@/components/admin/WorldBuilderRulebook';
import PopulatePanel from '@/components/admin/PopulatePanel';
import IssueReportManager from '@/components/admin/IssueReportManager';
import AdminChatWidget from '@/components/admin/AdminChatWidget';

interface AdminPageProps {
  onBack: () => void;
  isValar: boolean;
}

export default function AdminPage({ onBack, isValar }: AdminPageProps) {
  const [regions, setRegions] = useState<any[]>([]);
  const [nodes, setNodes] = useState<any[]>([]);
  const [creatureCounts, setCreatureCounts] = useState<Map<string, { total: number; aggressive: number }>>(new Map());
  const [npcCounts, setNPCCounts] = useState<Map<string, number>>(new Map());
  const [selectedRegion, setSelectedRegion] = useState<string>('');
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [isNewNode, setIsNewNode] = useState(false);
  const [adjacentToNodeId, setAdjacentToNodeId] = useState<string | null>(null);
  const [adjacentDirection, setAdjacentDirection] = useState<string | null>(null);
  const [editingRegionId, setEditingRegionId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('world');
  const [populateMode, setPopulateMode] = useState(false);
  const [populateSelectedIds, setPopulateSelectedIds] = useState<Set<string>>(new Set());
  const [nodePositions, setNodePositions] = useState<Map<string, { px: number; py: number }>>(new Map());

  const [areas, setAreas] = useState<any[]>([]);

  const loadData = useCallback(async () => {
    const [r, n, c, np, a] = await Promise.all([
      supabase.from('regions').select('*').order('sort_order'),
      supabase.from('nodes').select('*').order('name'),
      supabase.from('creatures').select('id, node_id, is_aggressive, is_alive'),
      supabase.from('npcs').select('id, node_id'),
      supabase.from('areas').select('*'),
    ]);
    setRegions(r.data || []);
    setNodes(n.data || []);
    setAreas(a.data || []);

    // Build creature counts per node
    const counts = new Map<string, { total: number; aggressive: number }>();
    for (const cr of (c.data || [])) {
      if (!cr.node_id || !cr.is_alive) continue;
      const entry = counts.get(cr.node_id) || { total: 0, aggressive: 0 };
      entry.total++;
      if (cr.is_aggressive) entry.aggressive++;
      counts.set(cr.node_id, entry);
    }
    setCreatureCounts(counts);

    // Build NPC counts per node
    const nCounts = new Map<string, number>();
    for (const npc of (np.data || [])) {
      if (!npc.node_id) continue;
      nCounts.set(npc.node_id, (nCounts.get(npc.node_id) || 0) + 1);
    }
    setNPCCounts(nCounts);
  }, []);

  useEffect(() => { loadData(); }, []);

  const handleNodeClick = (nodeId: string) => {
    const node = nodes.find(n => n.id === nodeId);
    if (node) setSelectedRegion(node.region_id);
    setEditingNodeId(nodeId);
    setIsNewNode(false);
    setAdjacentToNodeId(null);
    setPanelOpen(true);
  };

  const handleAddNodeAdjacent = (fromId: string, direction?: string) => {
    if (fromId) {
      const node = nodes.find(n => n.id === fromId);
      if (node) setSelectedRegion(node.region_id);
    }
    setEditingNodeId(null);
    setIsNewNode(true);
    setAdjacentToNodeId(fromId || null);
    setAdjacentDirection(direction || null);
    setPanelOpen(true);
  };

  const handleAddNodeBetween = (_fromId: string, _toId: string) => {
    // No longer used
  };

  const handleEditorSaved = () => {
    loadData();
  };

  const deleteRegion = async (id: string) => {
    const region = regions.find(r => r.id === id);
    const nodeCount = nodes.filter(n => n.region_id === id).length;
    const confirmed = window.confirm(
      `Delete region "${region?.name || 'Unknown'}"?${nodeCount > 0 ? ` It has ${nodeCount} node(s) that will also be affected.` : ''}`
    );
    if (!confirmed) return;
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
          {isValar ? '⚡ Overlord' : '✨ Steward'} World Editor
        </h1>
        <div className="flex-1" />
      </div>

      {/* XP Boost Controls */}
      <XpBoostPanel />


      <Tabs defaultValue="world" value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0 overflow-hidden">
        <div className="px-4 pt-2 border-b border-border bg-card/30 shrink-0">
          <TabsList className="h-8">
            <TabsTrigger value="world" className="font-display text-xs">World</TabsTrigger>
            <TabsTrigger value="creatures" className="font-display text-xs">Creatures</TabsTrigger>
            <TabsTrigger value="npcs" className="font-display text-xs">NPCs</TabsTrigger>
            <TabsTrigger value="items" className="font-display text-xs">Items</TabsTrigger>
            <TabsTrigger value="loot-tables" className="font-display text-xs">Loot Tables</TabsTrigger>
            <TabsTrigger value="users" className="font-display text-xs">Users</TabsTrigger>
            <TabsTrigger value="races-classes" className="font-display text-xs">Races & Classes</TabsTrigger>
            <TabsTrigger value="roadmap" className="font-display text-xs">Roadmap</TabsTrigger>
            <TabsTrigger value="rulebook" className="font-display text-xs">📖 Rulebook</TabsTrigger>
            <TabsTrigger value="item-forge" className="font-display text-xs">🪄 Item Forge</TabsTrigger>
            <TabsTrigger value="areas" className="font-display text-xs">🗺️ Areas</TabsTrigger>
            <TabsTrigger value="manual" className="font-display text-xs"><BookOpen className="w-3 h-3 mr-1 inline" />Manual</TabsTrigger>
            <TabsTrigger value="issues" className="font-display text-xs"><Bug className="w-3 h-3 mr-1 inline" />Issues</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="world" className="flex-1 flex flex-col min-h-0 mt-0 overflow-hidden">
          {/* Region controls */}
          <div className="flex items-center gap-2 px-4 py-1.5 border-b border-border bg-card/30 shrink-0">
            <RegionManager
              regions={regions}
              onCreated={loadData}
              isValar={isValar}
              onDelete={deleteRegion}
              editingRegionId={editingRegionId}
              onEditDone={() => setEditingRegionId(null)}
            />
            <span className="text-xs text-muted-foreground ml-2">
              {regions.length} regions · {nodes.length} nodes
            </span>
            <div className="flex-1" />
            <Button
              size="sm"
              variant={populateMode ? 'default' : 'outline'}
              onClick={() => {
                setPopulateMode(m => !m);
                if (populateMode) setPopulateSelectedIds(new Set());
                if (!populateMode) setPanelOpen(false);
              }}
              className="text-xs"
            >
              <Bug className="w-3 h-3 mr-1" />
              {populateMode ? 'Exit Populate' : 'Populate'}
            </Button>
          </div>

          {/* Resizable map + properties panel */}
          <div className="flex-1 overflow-hidden">
            <ResizablePanelGroup direction="horizontal">
              <ResizablePanel defaultSize={panelOpen ? 65 : 100} minSize={40}>
                <AdminWorldMapView
                  regions={regions}
                  nodes={nodes}
                  areas={areas}
                  creatureCounts={creatureCounts}
                  npcCounts={npcCounts}
                  onNodeClick={handleNodeClick}
                  onAddNodeAdjacent={handleAddNodeAdjacent}
                  onEditRegion={(region) => setEditingRegionId(region.id)}
                  onDeleteRegion={deleteRegion}
                  populateMode={populateMode}
                  populateSelectedIds={populateSelectedIds}
                  onPopulateToggleNode={(id) => {
                    setPopulateSelectedIds(prev => {
                      const next = new Set(prev);
                      if (next.has(id)) next.delete(id);
                      else next.add(id);
                      return next;
                    });
                  }}
                  onPositionsComputed={setNodePositions}
                  onConnectionCreated={loadData}
                  panelOpen={panelOpen}
                />
              </ResizablePanel>
              {(panelOpen && !populateMode) && (
                <>
                  <ResizableHandle withHandle />
                  <ResizablePanel defaultSize={35} minSize={25}>
                    <NodeEditorPanel
                      nodeId={editingNodeId}
                      regions={regions}
                      initialRegionId={selectedRegion || (regions[0]?.id ?? '')}
                      allNodesGlobal={nodes}
                      onClose={() => setPanelOpen(false)}
                      onSaved={handleEditorSaved}
                      isValar={isValar}
                      adjacentToNodeId={adjacentToNodeId}
                      adjacentDirection={adjacentDirection}
                      nodePositions={nodePositions}
                    />
                  </ResizablePanel>
                </>
              )}
              {populateMode && populateSelectedIds.size > 0 && (
                <>
                  <ResizableHandle withHandle />
                  <ResizablePanel defaultSize={35} minSize={25}>
                    <PopulatePanel
                      selectedNodeIds={populateSelectedIds}
                      allNodes={nodes.map(n => {
                        const r = regions.find(reg => reg.id === n.region_id);
                        return { ...n, region_name: r?.name, min_level: r?.min_level, max_level: r?.max_level };
                      })}
                      onClose={() => { setPopulateMode(false); setPopulateSelectedIds(new Set()); }}
                      onDataChanged={loadData}
                    />
                  </ResizablePanel>
                </>
              )}
            </ResizablePanelGroup>
          </div>
        </TabsContent>

        <TabsContent value="creatures" className="flex-1 min-h-0 mt-0 overflow-hidden">
          {activeTab === 'creatures' && <CreatureManager />}
        </TabsContent>

        <TabsContent value="npcs" className="flex-1 min-h-0 mt-0 overflow-hidden">
          {activeTab === 'npcs' && <NPCManager />}
        </TabsContent>

        <TabsContent value="items" className="flex-1 min-h-0 mt-0 overflow-hidden">
          {activeTab === 'items' && <ItemManager />}
        </TabsContent>

        <TabsContent value="loot-tables" className="flex-1 min-h-0 mt-0 overflow-hidden">
          {activeTab === 'loot-tables' && <LootTableManager />}
        </TabsContent>

        <TabsContent value="users" className="flex-1 min-h-0 mt-0 overflow-hidden">
          {activeTab === 'users' && <UserManager isValar={isValar} />}
        </TabsContent>

        <TabsContent value="races-classes" className="flex-1 min-h-0 mt-0 overflow-hidden">
          {activeTab === 'races-classes' && <RaceClassManager />}
        </TabsContent>

        <TabsContent value="roadmap" className="flex-1 min-h-0 mt-0 overflow-hidden">
          {activeTab === 'roadmap' && <RoadmapManager />}
        </TabsContent>

        <TabsContent value="rulebook" className="flex-1 min-h-0 mt-0 overflow-hidden">
          {activeTab === 'rulebook' && <WorldBuilderRulebook />}
        </TabsContent>

        <TabsContent value="item-forge" className="flex-1 min-h-0 mt-0 overflow-hidden">
          {activeTab === 'item-forge' && <ItemForgePanel onDataChanged={loadData} />}
        </TabsContent>

        <TabsContent value="areas" className="flex-1 min-h-0 mt-0 overflow-hidden">
          {activeTab === 'areas' && <AreaManager onDataChanged={loadData} />}
        </TabsContent>

        <TabsContent value="manual" className="flex-1 min-h-0 mt-0 overflow-hidden">
          {activeTab === 'manual' && <GameManual />}
        </TabsContent>

        <TabsContent value="issues" className="flex-1 min-h-0 mt-0 overflow-hidden">
          {activeTab === 'issues' && <IssueReportManager />}
        </TabsContent>
      </Tabs>

      <AdminChatWidget />
    </div>
  );
}