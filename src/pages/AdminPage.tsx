import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Bug, MousePointer2, Plus, Settings } from 'lucide-react';
import AdminWorldMapView from '@/components/admin/AdminWorldMapView';
import NodeEditorPanel from '@/components/admin/NodeEditorPanel';
import RegionManager from '@/components/admin/RegionManager';
import ItemManager from '@/components/admin/ItemManager';
import CreatureManager from '@/components/admin/CreatureManager';
import UserManager from '@/components/admin/users/UserManager';
import RaceClassManager from '@/components/admin/RaceClassManager';
import RoadmapManager from '@/components/admin/RoadmapManager';
import NPCManager from '@/components/admin/NPCManager';
import LootTableManager from '@/components/admin/LootTableManager';
import ItemForgePanel from '@/components/admin/ItemForgePanel';

import GameManual from '@/components/admin/GameManual';
import XpBoostPanel from '@/components/admin/XpBoostPanel';
import WorldBuilderRulebook from '@/components/admin/WorldBuilderRulebook';
import PopulatePanel from '@/components/admin/PopulatePanel';
import IssueReportManager from '@/components/admin/IssueReportManager';
import MarketplaceManager from '@/components/admin/MarketplaceManager';
import UniqueReclaimManager from '@/components/admin/UniqueReclaimManager';
import AdminChatWidget from '@/components/admin/AdminChatWidget';
import RegionEditorPanel from '@/components/admin/RegionEditorPanel';
import AreaEditorPanel from '@/components/admin/AreaEditorPanel';
import AreaTypeDialog from '@/components/admin/AreaTypeDialog';
import BatchNodeEditPanel from '@/components/admin/BatchNodeEditPanel';
import AdminLayout from '@/components/admin/AdminLayout';
import AdminDashboard from '@/components/admin/AdminDashboard';

interface AdminPageProps {
  isValar: boolean;
}

export default function AdminPage({ isValar }: AdminPageProps) {
  const [regions, setRegions] = useState<any[]>([]);
  const [nodes, setNodes] = useState<any[]>([]);
  const [creatureCounts, setCreatureCounts] = useState<Map<string, { total: number; aggressive: number }>>(new Map());
  const [npcCounts, setNPCCounts] = useState<Map<string, number>>(new Map());
  const [selectedRegion, setSelectedRegion] = useState<string>('');
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [, setIsNewNode] = useState(false);
  const [adjacentToNodeId, setAdjacentToNodeId] = useState<string | null>(null);
  const [adjacentDirection, setAdjacentDirection] = useState<string | null>(null);
  const [editingRegionId, setEditingRegionId] = useState<string | null>(null);
  const [editingAreaId, setEditingAreaId] = useState<string | null>(null);
  const [isNewArea, setIsNewArea] = useState(false);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [populateMode, setPopulateMode] = useState(false);
  const [populateSelectedIds, setPopulateSelectedIds] = useState<Set<string>>(new Set());
  const [nodePositions, setNodePositions] = useState<Map<string, { px: number; py: number }>>(new Map());
  const [typeDialogOpen, setTypeDialogOpen] = useState(false);
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [multiSelectedIds, setMultiSelectedIds] = useState<Set<string>>(new Set());

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

    const counts = new Map<string, { total: number; aggressive: number }>();
    for (const cr of (c.data || [])) {
      if (!cr.node_id || !cr.is_alive) continue;
      const entry = counts.get(cr.node_id) || { total: 0, aggressive: 0 };
      entry.total++;
      if (cr.is_aggressive) entry.aggressive++;
      counts.set(cr.node_id, entry);
    }
    setCreatureCounts(counts);

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
    setEditingRegionId(null);
    setEditingAreaId(null);
    setIsNewArea(false);
  };

  const handleAddNodeAdjacent = async (fromId: string, direction?: string) => {
    if (fromId && direction) {
      const parentNode = nodes.find(n => n.id === fromId);
      if (parentNode) {
        const DIRECTION_OFFSETS: Record<string, [number, number]> = {
          N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0],
          NE: [1, -1], NW: [-1, -1], SE: [1, 1], SW: [-1, 1],
        };
        const REVERSE_DIR: Record<string, string> = {
          N: 'S', S: 'N', E: 'W', W: 'E',
          NE: 'SW', SW: 'NE', NW: 'SE', SE: 'NW',
        };
        const offset = DIRECTION_OFFSETS[direction] || [1, 0];
        const newX = (parentNode.x ?? 0) + offset[0];
        const newY = (parentNode.y ?? 0) + offset[1];
        const reverseDir = REVERSE_DIR[direction] || 'S';

        const { data: inserted, error } = await supabase.from('nodes').insert({
          name: '',
          description: '',
          region_id: parentNode.region_id,
          area_id: parentNode.area_id || null,
          connections: [{ node_id: fromId, direction: reverseDir, label: '' }],
          x: newX,
          y: newY,
        } as any).select().single();

        if (error) { toast.error(error.message); return; }

        if (inserted) {
          const parentConns = Array.isArray(parentNode.connections) ? [...parentNode.connections] : [];
          parentConns.push({ node_id: inserted.id, direction, label: '' });
          await supabase.from('nodes').update({ connections: parentConns }).eq('id', fromId);

          await loadData();
          setSelectedRegion(parentNode.region_id);
          setEditingNodeId(inserted.id);
          setIsNewNode(false);
          setAdjacentToNodeId(null);
          setAdjacentDirection(null);
          setPanelOpen(true);
          setEditingRegionId(null);
          setEditingAreaId(null);
          setIsNewArea(false);
          toast.success('Node created');
        }
        return;
      }
    }

    if (fromId) {
      const node = nodes.find(n => n.id === fromId);
      if (node) setSelectedRegion(node.region_id);
    }
    setEditingNodeId(null);
    setIsNewNode(true);
    setAdjacentToNodeId(fromId || null);
    setAdjacentDirection(direction || null);
    setPanelOpen(true);
    setEditingRegionId(null);
    setEditingAreaId(null);
    setIsNewArea(false);
  };

  const handleEditorSaved = (newNodeId?: string) => {
    loadData();
    if (newNodeId) {
      setEditingNodeId(newNodeId);
      setIsNewNode(false);
      setAdjacentToNodeId(null);
      setAdjacentDirection(null);
    }
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

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return <AdminDashboard onNavigate={setActiveTab} />;

      case 'world':
        return (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            {/* Region & Area controls */}
            <div className="flex items-center gap-2 px-4 py-1.5 border-b border-border bg-card/30 shrink-0">
              <RegionManager
                regions={regions}
                allNodes={nodes}
                onCreated={loadData}
                isValar={isValar}
                onDelete={deleteRegion}
              />
              <Button variant="outline" size="sm" onClick={() => {
                setIsNewArea(true);
                setEditingAreaId(null);
                setPanelOpen(false);
                setEditingRegionId(null);
                setPopulateMode(false);
                setPopulateSelectedIds(new Set());
              }} className="font-display text-xs">
                <Plus className="w-3 h-3 mr-1" /> New Area
              </Button>
              <Button variant="outline" size="sm" onClick={() => setTypeDialogOpen(true)} className="font-display text-xs" title="Manage area types">
                <Settings className="w-3 h-3 mr-1" /> Types
              </Button>
              <span className="text-xs text-muted-foreground ml-2">
                {regions.length} regions · {nodes.length} nodes · {areas.length} areas
              </span>
              <div className="flex-1" />
              <Button
                size="sm"
                variant={multiSelectMode ? 'default' : 'outline'}
                onClick={() => {
                  setMultiSelectMode(m => !m);
                  if (multiSelectMode) setMultiSelectedIds(new Set());
                  if (!multiSelectMode) { setPanelOpen(false); setEditingAreaId(null); setIsNewArea(false); setPopulateMode(false); setPopulateSelectedIds(new Set()); }
                }}
                className="text-xs"
              >
                <MousePointer2 className="w-3 h-3 mr-1" />
                {multiSelectMode ? 'Exit Select' : 'Multi-Select'}
              </Button>
              <Button
                size="sm"
                variant={populateMode ? 'default' : 'outline'}
                onClick={() => {
                  setPopulateMode(m => !m);
                  if (populateMode) setPopulateSelectedIds(new Set());
                  if (!populateMode) { setPanelOpen(false); setEditingAreaId(null); setIsNewArea(false); setMultiSelectMode(false); setMultiSelectedIds(new Set()); }
                }}
                className="text-xs"
              >
                <Bug className="w-3 h-3 mr-1" />
                {populateMode ? 'Exit Populate' : 'Populate'}
              </Button>
            </div>

            {/* Overlay map + properties panel */}
            <div className="flex-1 overflow-hidden relative">
              <AdminWorldMapView
                regions={regions}
                nodes={nodes}
                areas={areas}
                creatureCounts={creatureCounts}
                npcCounts={npcCounts}
                onNodeClick={handleNodeClick}
                onAddNodeAdjacent={handleAddNodeAdjacent}
                onEditRegion={(region) => {
                  setEditingRegionId(region.id);
                  setPanelOpen(false);
                  setPopulateMode(false);
                  setPopulateSelectedIds(new Set());
                  setEditingAreaId(null);
                  setIsNewArea(false);
                }}
                onDeleteRegion={deleteRegion}
                onEditArea={(area) => {
                  setEditingAreaId(area.id);
                  setIsNewArea(false);
                  setPanelOpen(false);
                  setEditingRegionId(null);
                  setPopulateMode(false);
                  setPopulateSelectedIds(new Set());
                }}
                onDeleteArea={async (areaId) => {
                  const area = areas.find(a => a.id === areaId);
                  if (!window.confirm(`Delete area "${area?.name}"?`)) return;
                  const { error } = await supabase.from('areas').delete().eq('id', areaId);
                  if (error) return toast.error(error.message);
                  toast.success('Area deleted');
                  loadData();
                }}
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
                panelOpen={panelOpen || !!editingRegionId || !!editingAreaId || isNewArea || (multiSelectMode && multiSelectedIds.size > 0)}
                multiSelectMode={multiSelectMode}
                multiSelectedIds={multiSelectedIds}
                onMultiSelectToggleNode={(id) => {
                  setMultiSelectedIds(prev => {
                    const next = new Set(prev);
                    if (next.has(id)) next.delete(id);
                    else next.add(id);
                    return next;
                  });
                }}
              />

              {/* Overlay editor panels */}
              {(panelOpen && !populateMode && !editingRegionId && !editingAreaId && !isNewArea) && (
                <div className="absolute top-0 right-0 h-full w-[35%] min-w-[360px] bg-card border-l border-border shadow-xl z-10">
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
                </div>
              )}
              {editingRegionId && !populateMode && (
                <div className="absolute top-0 right-0 h-full w-[35%] min-w-[360px] bg-card border-l border-border shadow-xl z-10">
                  <RegionEditorPanel
                    regionId={editingRegionId}
                    regions={regions}
                    onClose={() => setEditingRegionId(null)}
                    onSaved={() => { setEditingRegionId(null); loadData(); }}
                  />
                </div>
              )}
              {(editingAreaId || isNewArea) && !populateMode && !editingRegionId && (
                <div className="absolute top-0 right-0 h-full w-[35%] min-w-[360px] bg-card border-l border-border shadow-xl z-10">
                  <AreaEditorPanel
                    areaId={editingAreaId}
                    isNew={isNewArea}
                    regions={regions}
                    areas={areas}
                    initialRegionId={selectedRegion || regions[0]?.id}
                    onClose={() => { setEditingAreaId(null); setIsNewArea(false); }}
                    onSaved={() => { setEditingAreaId(null); setIsNewArea(false); loadData(); }}
                    onDeleted={() => { setEditingAreaId(null); setIsNewArea(false); loadData(); }}
                  />
                </div>
              )}
              {populateMode && populateSelectedIds.size > 0 && (
                <div className="absolute top-0 right-0 h-full w-[35%] min-w-[360px] bg-card border-l border-border shadow-xl z-10">
                  <PopulatePanel
                    selectedNodeIds={populateSelectedIds}
                    allNodes={nodes.map(n => {
                      const r = regions.find(reg => reg.id === n.region_id);
                      return { ...n, region_name: r?.name, min_level: r?.min_level, max_level: r?.max_level };
                    })}
                    onClose={() => { setPopulateMode(false); setPopulateSelectedIds(new Set()); }}
                    onDataChanged={loadData}
                  />
                </div>
              )}
              {multiSelectMode && multiSelectedIds.size > 0 && !populateMode && (
                <div className="absolute top-0 right-0 h-full w-[35%] min-w-[360px] bg-card border-l border-border shadow-xl z-10">
                  <BatchNodeEditPanel
                    selectedNodeIds={multiSelectedIds}
                    regions={regions}
                    areas={areas}
                    onClose={() => { setMultiSelectMode(false); setMultiSelectedIds(new Set()); }}
                    onSaved={() => { setMultiSelectedIds(new Set()); loadData(); }}
                  />
                </div>
              )}
            </div>

            <AreaTypeDialog open={typeDialogOpen} onOpenChange={setTypeDialogOpen} />
          </div>
        );

      case 'creatures':
        return <CreatureManager />;
      case 'npcs':
        return <NPCManager />;
      case 'items':
        return <ItemManager />;
      case 'loot-tables':
        return <LootTableManager />;
      case 'item-forge':
        return <ItemForgePanel onDataChanged={loadData} />;
      case 'races-classes':
        return <RaceClassManager />;
      case 'xp-boost':
        return (
          <div className="p-6">
            <XpBoostPanel />
          </div>
        );
      case 'users':
        return <UserManager isValar={isValar} />;
      case 'issues':
        return <IssueReportManager />;
      case 'marketplace':
        return <MarketplaceManager />;
      case 'roadmap':
        return <RoadmapManager />;
      case 'rulebook':
        return <WorldBuilderRulebook />;
      case 'manual':
        return <GameManual />;
      default:
        return <AdminDashboard onNavigate={setActiveTab} />;
    }
  };

  return (
    <AdminLayout
      activeTab={activeTab}
      onNavigate={setActiveTab}
      isValar={isValar}
    >
      {renderContent()}
      <AdminChatWidget />
    </AdminLayout>
  );
}
