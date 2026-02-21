import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Save, Trash2, Plus, X, Unlink, Skull, MessageSquare, Shield, Swords, Clock } from 'lucide-react';
import ItemPickerList from './ItemPickerList';

interface VendorEntry {
  id: string;
  item_id: string;
  price: number;
  stock: number;
  item?: { name: string; rarity: string };
}

interface NodeEditorPanelProps {
  nodeId: string | null;
  regions: any[];
  initialRegionId: string;
  allNodesGlobal: any[];
  onClose: () => void;
  onSaved: () => void;
  isValar: boolean;
  adjacentToNodeId?: string | null;
}

const DIRECTIONS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
const REVERSE_DIR: Record<string, string> = {
  N: 'S', S: 'N', E: 'W', W: 'E',
  NE: 'SW', SW: 'NE', NW: 'SE', SE: 'NW',
};

const RARITY_COLORS: Record<string, string> = {
  regular: 'text-foreground',
  rare: 'text-blue-400',
  boss: 'text-primary',
};

const ITEM_RARITY_COLORS: Record<string, string> = {
  common: 'text-muted-foreground',
  uncommon: 'text-green-400',
  rare: 'text-blue-400',
  unique: 'text-primary',
};

function formatRespawn(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

/* ─── ConnectionsManager ─────────────────────────────── */
function ConnectionsManager({ nodeId, connections, allNodesGlobal, onUpdated }: {
  nodeId: string;
  connections: string;
  allNodesGlobal: any[];
  onUpdated: () => void;
}) {
  const [addDir, setAddDir] = useState('N');
  const [addNodeId, setAddNodeId] = useState('');
  const [addLabel, setAddLabel] = useState('');
  const [addHidden, setAddHidden] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingConnId, setEditingConnId] = useState<string | null>(null);
  const [editDir, setEditDir] = useState('N');
  const [editLabel, setEditLabel] = useState('');
  const [editHidden, setEditHidden] = useState(false);

  const parsed: { node_id: string; direction: string; label?: string; hidden?: boolean }[] = (() => {
    try { return JSON.parse(connections) || []; } catch { return []; }
  })();

  const nodeName = (id: string) => allNodesGlobal.find((n: any) => n.id === id)?.name || id.slice(0, 8);

  const startEditConnection = (c: { node_id: string; direction: string; label?: string; hidden?: boolean }) => {
    setEditingConnId(c.node_id);
    setEditDir(c.direction);
    setEditLabel(c.label || '');
    setEditHidden(!!c.hidden);
  };

  const saveEditConnection = async () => {
    if (!editingConnId) return;
    setSaving(true);
    const newConns = parsed.map(c =>
      c.node_id === editingConnId
        ? { node_id: c.node_id, direction: editDir, ...(editLabel ? { label: editLabel } : {}), ...(editHidden ? { hidden: true } : {}) }
        : c
    );
    await supabase.from('nodes').update({ connections: newConns }).eq('id', nodeId);
    const { data: targetNode } = await supabase.from('nodes').select('connections').eq('id', editingConnId).single();
    if (targetNode) {
      const targetConns: any[] = Array.isArray(targetNode.connections) ? [...targetNode.connections as any[]] : [];
      const reverseIdx = targetConns.findIndex((c: any) => c.node_id === nodeId);
      if (reverseIdx >= 0) {
        targetConns[reverseIdx] = { ...targetConns[reverseIdx], direction: REVERSE_DIR[editDir] || targetConns[reverseIdx].direction, ...(editHidden ? { hidden: true } : { hidden: undefined }) };
        if (!targetConns[reverseIdx].hidden) delete targetConns[reverseIdx].hidden;
        await supabase.from('nodes').update({ connections: targetConns }).eq('id', editingConnId);
      }
    }
    toast.success('Connection updated');
    setEditingConnId(null);
    setSaving(false);
    onUpdated();
  };

  const addConnection = async () => {
    if (!addNodeId) return toast.error('Select a target node');
    if (parsed.some(c => c.node_id === addNodeId)) return toast.error('Already connected to that node');
    setSaving(true);
    const newConns = [...parsed, { node_id: addNodeId, direction: addDir, ...(addLabel ? { label: addLabel } : {}), ...(addHidden ? { hidden: true } : {}) }];
    await supabase.from('nodes').update({ connections: newConns }).eq('id', nodeId);
    const { data: targetNode } = await supabase.from('nodes').select('connections').eq('id', addNodeId).single();
    if (targetNode) {
      const targetConns: any[] = Array.isArray(targetNode.connections) ? [...targetNode.connections as any[]] : [];
      if (!targetConns.some((c: any) => c.node_id === nodeId)) {
        targetConns.push({ node_id: nodeId, direction: REVERSE_DIR[addDir] || 'S', ...(addHidden ? { hidden: true } : {}) });
        await supabase.from('nodes').update({ connections: targetConns }).eq('id', addNodeId);
      }
    }
    toast.success('Connection added');
    setAddNodeId('');
    setAddLabel('');
    setAddHidden(false);
    setSaving(false);
    onUpdated();
  };

  const removeConnection = async (targetId: string) => {
    setSaving(true);
    const newConns = parsed.filter(c => c.node_id !== targetId);
    await supabase.from('nodes').update({ connections: newConns }).eq('id', nodeId);
    const { data: targetNode } = await supabase.from('nodes').select('connections').eq('id', targetId).single();
    if (targetNode) {
      const targetConns: any[] = Array.isArray(targetNode.connections) ? (targetNode.connections as any[]).filter((c: any) => c.node_id !== nodeId) : [];
      await supabase.from('nodes').update({ connections: targetConns }).eq('id', targetId);
    }
    toast.success('Connection removed');
    setSaving(false);
    onUpdated();
  };

  const availableNodes = allNodesGlobal.filter((n: any) => n.id !== nodeId && !parsed.some(c => c.node_id === n.id));

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        {parsed.length === 0 && (
          <p className="text-xs text-muted-foreground italic">No connections yet.</p>
        )}
        {parsed.map(c => (
          <div key={c.node_id}>
            {editingConnId === c.node_id ? (
              <div className="p-2 rounded border border-primary/50 bg-primary/5 space-y-2">
                <p className="font-display text-xs text-primary">Editing: {nodeName(c.node_id)}</p>
                <div className="grid grid-cols-[auto_1fr] gap-2">
                  <div>
                    <label className="text-[10px] text-muted-foreground">Direction</label>
                    <Select value={editDir} onValueChange={setEditDir}>
                      <SelectTrigger className="h-8 text-xs w-20"><SelectValue /></SelectTrigger>
                      <SelectContent className="bg-popover border-border z-50">
                        {DIRECTIONS.map(d => (
                          <SelectItem key={d} value={d} className="text-xs">{d}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground">Label</label>
                    <Input value={editLabel} onChange={e => setEditLabel(e.target.value)} className="h-8 text-xs" placeholder="Label (optional)" />
                  </div>
                </div>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input type="checkbox" checked={editHidden} onChange={e => setEditHidden(e.target.checked)} />
                  Hidden (discoverable via search)
                </label>
                <div className="flex gap-2">
                  <Button size="sm" onClick={saveEditConnection} disabled={saving} className="h-7 text-xs font-display">
                    <Save className="w-3 h-3 mr-1" /> Save
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditingConnId(null)} className="h-7 text-xs">Cancel</Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 p-2 rounded border border-border bg-background/40">
                <span className="font-display text-sm flex-1">{nodeName(c.node_id)}</span>
                <span className="text-xs text-muted-foreground font-mono">{c.direction}</span>
                {c.label && <span className="text-xs text-muted-foreground italic">{c.label}</span>}
                {c.hidden && <span className="text-[10px] text-primary/70 font-mono">🔒 Hidden</span>}
                <Button size="sm" variant="ghost" disabled={saving} onClick={() => startEditConnection(c)} className="h-6 px-2 text-[10px]">
                  Edit
                </Button>
                <Button size="sm" variant="destructive" disabled={saving} onClick={() => removeConnection(c.node_id)} className="h-6 w-6 p-0">
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="border-t border-border pt-3 space-y-2">
        <p className="font-display text-xs text-primary">Add Connection</p>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <div>
            <label className="text-[10px] text-muted-foreground">Target Node</label>
            <Select value={addNodeId} onValueChange={setAddNodeId}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select node..." /></SelectTrigger>
              <SelectContent className="bg-popover border-border z-50 max-h-60">
                {availableNodes.map((n: any) => (
                  <SelectItem key={n.id} value={n.id} className="text-xs">{n.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground">Direction</label>
            <Select value={addDir} onValueChange={setAddDir}>
              <SelectTrigger className="h-8 text-xs w-20"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-popover border-border z-50">
                {DIRECTIONS.map(d => (
                  <SelectItem key={d} value={d} className="text-xs">{d}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <Input placeholder="Label (optional)" value={addLabel}
          onChange={e => setAddLabel(e.target.value)} className="h-8 text-xs" />
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={addHidden} onChange={e => setAddHidden(e.target.checked)} />
          Hidden (discoverable via search)
        </label>
        <Button onClick={addConnection} disabled={saving || !addNodeId} className="font-display text-xs">
          <Plus className="w-3 h-3 mr-1" /> Add Connection
        </Button>
      </div>
    </div>
  );
}

/* ─── Main component ────────────────────────────────── */

export default function NodeEditorPanel({
  nodeId, regions, initialRegionId, allNodesGlobal, onClose, onSaved, isValar, adjacentToNodeId,
}: NodeEditorPanelProps) {
  const [form, setForm] = useState({
    name: '', description: '', is_vendor: false, is_inn: false, is_blacksmith: false, is_teleport: false,
    connections: '[]', searchable_items: [] as { item_id: string; chance: number }[],
  });
  const [selectedRegionId, setSelectedRegionId] = useState(initialRegionId);
  const [creatures, setCreatures] = useState<any[]>([]);
  const [npcs, setNpcs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [vendorItems, setVendorItems] = useState<VendorEntry[]>([]);
  const [allItems, setAllItems] = useState<{ id: string; name: string; rarity: string; value: number }[]>([]);
  const [vendorForm, setVendorForm] = useState({ item_id: '', price: 10, stock: -1 });
  const [activeNodeId, setActiveNodeId] = useState<string | null>(nodeId);

  // For assigning existing entities
  const [allCreatures, setAllCreatures] = useState<any[]>([]);
  const [allNpcs, setAllNpcs] = useState<any[]>([]);
  const [assignCreatureId, setAssignCreatureId] = useState('');
  const [assignNpcId, setAssignNpcId] = useState('');
  const [assigning, setAssigning] = useState(false);

  // Loot table info for creature display
  const [lootTableMap, setLootTableMap] = useState<Record<string, string>>({});

  useEffect(() => {
    setActiveNodeId(nodeId);
    setSelectedRegionId(initialRegionId);
    supabase.from('items').select('id, name, rarity, value').order('name').then(({ data }) => {
      if (data) setAllItems(data);
    });
    // Load all unassigned creatures and NPCs for the picker
    Promise.all([
      supabase.from('creatures').select('id, name, level, rarity, is_aggressive, is_humanoid, hp, max_hp, ac, node_id').order('name'),
      supabase.from('npcs').select('id, name, description, dialogue, node_id').order('name'),
      supabase.from('loot_tables').select('id, name'),
    ]).then(([cr, np, lt]) => {
      setAllCreatures(cr.data || []);
      setAllNpcs(np.data || []);
      const map: Record<string, string> = {};
      for (const t of (lt.data || [])) map[t.id] = t.name;
      setLootTableMap(map);
    });
    if (nodeId) {
      loadNode(nodeId);
      loadCreatures(nodeId);
      loadNpcs(nodeId);
      loadVendorInventory(nodeId);
    } else {
      setForm({ name: '', description: '', is_vendor: false, is_inn: false, is_blacksmith: false, is_teleport: false, connections: '[]', searchable_items: [] });
      setCreatures([]);
      setNpcs([]);
      setVendorItems([]);
    }
    setAssignCreatureId('');
    setAssignNpcId('');
    setVendorForm({ item_id: '', price: 10, stock: -1 });
  }, [nodeId, initialRegionId]);

  const loadNode = async (id: string) => {
    const { data } = await supabase.from('nodes').select('*').eq('id', id).single();
    if (data) {
      setForm({
        name: data.name, description: data.description, is_vendor: data.is_vendor,
        is_inn: data.is_inn ?? false,
        is_blacksmith: (data as any).is_blacksmith ?? false,
        is_teleport: (data as any).is_teleport ?? false,
        connections: JSON.stringify(data.connections, null, 2),
        searchable_items: Array.isArray(data.searchable_items) ? data.searchable_items as any : [],
      });
      setSelectedRegionId(data.region_id);
    }
  };

  const loadCreatures = async (id: string) => {
    const { data } = await supabase
      .from('creatures')
      .select('id, name, level, rarity, is_aggressive, is_humanoid, hp, max_hp, ac, loot_table_id, loot_table, drop_chance, respawn_seconds, is_alive, stats')
      .eq('node_id', id)
      .order('name');
    setCreatures(data || []);
  };

  const loadNpcs = async (id: string) => {
    const { data } = await supabase.from('npcs').select('*').eq('node_id', id).order('name');
    setNpcs(data || []);
  };

  /* ── Assign existing creature to this node ── */
  const assignCreature = async () => {
    if (!activeNodeId || !assignCreatureId) return;
    setAssigning(true);
    const { error } = await supabase.from('creatures').update({ node_id: activeNodeId }).eq('id', assignCreatureId);
    if (error) { toast.error(error.message); setAssigning(false); return; }
    const name = allCreatures.find(c => c.id === assignCreatureId)?.name || 'Creature';
    toast.success(`${name} assigned to node`);
    setAssignCreatureId('');
    setAssigning(false);
    loadCreatures(activeNodeId);
    // Refresh global creature list
    const { data } = await supabase.from('creatures').select('id, name, level, rarity, is_aggressive, is_humanoid, hp, max_hp, ac, node_id').order('name');
    if (data) setAllCreatures(data);
  };

  /* ── Unassign creature from node (set node_id = null) ── */
  const unassignCreature = async (id: string, name: string) => {
    const { error } = await supabase.from('creatures').update({ node_id: null }).eq('id', id);
    if (error) { toast.error(error.message); return; }
    toast.success(`${name} unassigned`);
    if (activeNodeId) loadCreatures(activeNodeId);
    const { data } = await supabase.from('creatures').select('id, name, level, rarity, is_aggressive, is_humanoid, hp, max_hp, ac, node_id').order('name');
    if (data) setAllCreatures(data);
  };

  /* ── Assign existing NPC to this node ── */
  const assignNpc = async () => {
    if (!activeNodeId || !assignNpcId) return;
    setAssigning(true);
    const { error } = await supabase.from('npcs').update({ node_id: activeNodeId }).eq('id', assignNpcId);
    if (error) { toast.error(error.message); setAssigning(false); return; }
    const name = allNpcs.find(n => n.id === assignNpcId)?.name || 'NPC';
    toast.success(`${name} assigned to node`);
    setAssignNpcId('');
    setAssigning(false);
    loadNpcs(activeNodeId);
    const { data } = await supabase.from('npcs').select('id, name, description, dialogue, node_id').order('name');
    if (data) setAllNpcs(data);
  };

  /* ── Unassign NPC from node ── */
  const unassignNpc = async (id: string, name: string) => {
    const { error } = await supabase.from('npcs').update({ node_id: null }).eq('id', id);
    if (error) { toast.error(error.message); return; }
    toast.success(`${name} unassigned`);
    if (activeNodeId) loadNpcs(activeNodeId);
    const { data } = await supabase.from('npcs').select('id, name, description, dialogue, node_id').order('name');
    if (data) setAllNpcs(data);
  };

  /* ── Vendor ── */
  const loadVendorInventory = async (id: string) => {
    const { data } = await supabase
      .from('vendor_inventory')
      .select('*, item:items(name, rarity)')
      .eq('node_id', id)
      .order('created_at');
    if (data) setVendorItems(data as unknown as VendorEntry[]);
  };

  const addVendorItem = async () => {
    if (!activeNodeId || !vendorForm.item_id) return toast.error('Select an item');
    if (vendorItems.some(v => v.item_id === vendorForm.item_id)) return toast.error('Item already in vendor stock');
    const { error } = await supabase.from('vendor_inventory').insert({
      node_id: activeNodeId, item_id: vendorForm.item_id,
      price: Math.max(0, vendorForm.price), stock: vendorForm.stock,
    });
    if (error) return toast.error(error.message);
    toast.success('Item added to vendor');
    setVendorForm({ item_id: '', price: 10, stock: -1 });
    loadVendorInventory(activeNodeId);
  };

  const updateVendorItem = async (id: string, updates: { price?: number; stock?: number }) => {
    const { error } = await supabase.from('vendor_inventory').update(updates).eq('id', id);
    if (error) return toast.error(error.message);
    if (activeNodeId) loadVendorInventory(activeNodeId);
  };

  const removeVendorItem = async (id: string) => {
    const { error } = await supabase.from('vendor_inventory').delete().eq('id', id);
    if (error) return toast.error(error.message);
    toast.success('Item removed from vendor');
    if (activeNodeId) loadVendorInventory(activeNodeId);
  };

  /* ── Save node ── */
  const saveNode = async () => {
    if (!form.name) return toast.error('Name required');
    if (!selectedRegionId) return toast.error('Select a region');
    let connections: any;
    const searchable_items = form.searchable_items;
    try { connections = JSON.parse(form.connections); } catch { return toast.error('Invalid connections JSON'); }

    setLoading(true);
    if (activeNodeId) {
      const { error } = await supabase.from('nodes').update({
        name: form.name, description: form.description, is_vendor: form.is_vendor,
        is_inn: form.is_inn, is_blacksmith: form.is_blacksmith, is_teleport: form.is_teleport, connections, searchable_items, region_id: selectedRegionId,
      } as any).eq('id', activeNodeId);
      if (error) { toast.error(error.message); setLoading(false); return; }
      toast.success('Node updated');
    } else {
      if (adjacentToNodeId) {
        const parentNode = allNodesGlobal.find(n => n.id === adjacentToNodeId);
        if (parentNode) {
          connections = [{ node_id: adjacentToNodeId, direction: 'S', label: '' }];
        }
      }
      const { data: inserted, error } = await supabase.from('nodes').insert({
        name: form.name, description: form.description, region_id: selectedRegionId,
        is_vendor: form.is_vendor, is_inn: form.is_inn, is_blacksmith: form.is_blacksmith, is_teleport: form.is_teleport, connections, searchable_items,
      }).select().single();
      if (error) { toast.error(error.message); setLoading(false); return; }

      if (adjacentToNodeId && inserted) {
        const parentNode = allNodesGlobal.find(n => n.id === adjacentToNodeId);
        if (parentNode) {
          const parentConns = Array.isArray(parentNode.connections) ? [...parentNode.connections] : [];
          parentConns.push({ node_id: inserted.id, direction: 'N', label: form.name });
          await supabase.from('nodes').update({ connections: parentConns }).eq('id', adjacentToNodeId);
        }
      }

      toast.success('Node created');
      if (inserted) {
        setActiveNodeId(inserted.id);
        loadNode(inserted.id);
      }
    }
    setLoading(false);
    onSaved();
  };

  const deleteNode = async () => {
    if (!activeNodeId) return;
    const { data: allNodes } = await supabase.from('nodes').select('id, connections');
    if (allNodes) {
      for (const n of allNodes) {
        if (n.id === activeNodeId) continue;
        const conns = (n.connections as any[]) || [];
        const filtered = conns.filter((c: any) => c.node_id !== activeNodeId);
        if (filtered.length !== conns.length) {
          await supabase.from('nodes').update({ connections: filtered }).eq('id', n.id);
        }
      }
    }
    const { error } = await supabase.from('nodes').delete().eq('id', activeNodeId);
    if (error) return toast.error(error.message);
    toast.success('Node deleted');
    onSaved();
    onClose();
  };

  /* ── Pickers: only show entities not already assigned to THIS node ── */
  const unassignedCreatures = allCreatures.filter(c => c.node_id !== activeNodeId);
  const unassignedNpcs = allNpcs.filter(n => n.node_id !== activeNodeId);

  /* ─── Render ──────────────────────────────────────── */
  return (
    <div className="h-full flex flex-col bg-card/50">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <h2 className="font-display text-sm text-primary text-glow truncate">
          {activeNodeId ? `Edit: ${form.name || 'Node'}` : 'New Node'}
        </h2>
        <Button variant="ghost" size="sm" onClick={onClose} className="h-6 w-6 p-0">
          <X className="w-4 h-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-3">
          <Tabs defaultValue="details">
            <TabsList className="mb-3 h-8">
              <TabsTrigger value="details" className="font-display text-xs">Details</TabsTrigger>
              {activeNodeId && <TabsTrigger value="creatures" className="font-display text-xs">
                Creatures {creatures.length > 0 && <span className="ml-1 text-[9px] bg-primary/20 text-primary rounded px-1">{creatures.length}</span>}
              </TabsTrigger>}
              {activeNodeId && <TabsTrigger value="npcs" className="font-display text-xs">
                NPCs {npcs.length > 0 && <span className="ml-1 text-[9px] bg-primary/20 text-primary rounded px-1">{npcs.length}</span>}
              </TabsTrigger>}
              {activeNodeId && form.is_vendor && <TabsTrigger value="vendor" className="font-display text-xs">Vendor Stock</TabsTrigger>}
              {activeNodeId && <TabsTrigger value="connections" className="font-display text-xs">Connections</TabsTrigger>}
            </TabsList>

            {/* ── Details ── */}
            <TabsContent value="details" className="space-y-3">
              <div>
                <label className="text-[10px] text-muted-foreground">Region</label>
                <Select value={selectedRegionId} onValueChange={setSelectedRegionId}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select region..." /></SelectTrigger>
                  <SelectContent className="bg-popover border-border z-50 max-h-60">
                    {regions.map(r => (
                      <SelectItem key={r.id} value={r.id} className="text-xs">
                        {r.name} <span className="text-muted-foreground">(Lv {r.min_level}–{r.max_level})</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Input placeholder="Node name" value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="h-8 text-xs" />
              <Textarea placeholder="Description" value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={3} className="text-xs" />
              <ItemPickerList label="Searchable Items" value={form.searchable_items}
                onChange={v => setForm(f => ({ ...f, searchable_items: v }))} />

              <div className="space-y-1.5">
                <p className="font-display text-[10px] text-muted-foreground">Node Services</p>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input type="checkbox" checked={form.is_vendor}
                    onChange={e => setForm(f => ({ ...f, is_vendor: e.target.checked }))} />
                  🛒 Is Vendor
                </label>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input type="checkbox" checked={form.is_inn}
                    onChange={e => setForm(f => ({ ...f, is_inn: e.target.checked }))} />
                  🏨 Is Inn (3× HP regen)
                </label>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input type="checkbox" checked={form.is_blacksmith}
                    onChange={e => setForm(f => ({ ...f, is_blacksmith: e.target.checked }))} />
                  🔨 Is Blacksmith (repair items)
                </label>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input type="checkbox" checked={form.is_teleport}
                    onChange={e => setForm(f => ({ ...f, is_teleport: e.target.checked }))} />
                  🌀 Is Teleport Point (fast travel destination)
                </label>
              </div>

              <div className="flex gap-2">
                <Button onClick={saveNode} disabled={loading} className="font-display text-xs">
                  <Save className="w-3 h-3 mr-1" /> {activeNodeId ? 'Save' : 'Create'}
                </Button>
                {activeNodeId && isValar && (
                  <Button variant="destructive" onClick={deleteNode} className="font-display text-xs">
                    <Trash2 className="w-3 h-3 mr-1" /> Delete
                  </Button>
                )}
              </div>
            </TabsContent>

            {/* ── Creatures ── */}
            {activeNodeId && (
              <TabsContent value="creatures" className="space-y-3">
                {/* Assigned creatures list */}
                <div className="space-y-2">
                  {creatures.length === 0 && (
                    <p className="text-xs text-muted-foreground italic">No creatures spawned at this node.</p>
                  )}
                  {creatures.map(c => {
                    const lootName = c.loot_table_id ? lootTableMap[c.loot_table_id] : null;
                    const legacyLoot = Array.isArray(c.loot_table) ? (c.loot_table as any[]).filter((e: any) => e.type !== 'gold') : [];
                    return (
                      <div key={c.id} className="rounded border border-border bg-background/40 p-2.5 space-y-1.5">
                        {/* Header row */}
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <Skull className={`w-3.5 h-3.5 shrink-0 ${RARITY_COLORS[c.rarity] || 'text-foreground'}`} />
                            <span className={`font-display text-sm leading-none ${RARITY_COLORS[c.rarity] || 'text-foreground'} ${c.rarity === 'boss' ? 'text-glow' : ''}`}>
                              {c.name}
                            </span>
                            <span className="text-[9px] text-muted-foreground capitalize">{c.rarity}</span>
                            {c.is_aggressive && (
                              <span className="text-[9px] px-1 rounded bg-destructive/20 text-destructive">aggressive</span>
                            )}
                            {c.is_humanoid && (
                              <span className="text-[9px] px-1 rounded bg-muted/50 text-muted-foreground">humanoid</span>
                            )}
                          </div>
                          <Button
                            size="sm" variant="ghost"
                            onClick={() => unassignCreature(c.id, c.name)}
                            className="h-6 w-6 p-0 shrink-0 text-muted-foreground hover:text-foreground"
                            title="Unassign from node"
                          >
                            <Unlink className="w-3 h-3" />
                          </Button>
                        </div>

                        {/* Stats row */}
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
                          <span className="flex items-center gap-0.5">
                            <span className="text-destructive">Lv {c.level}</span>
                          </span>
                          <span className="flex items-center gap-0.5">
                            HP <strong className="text-foreground ml-0.5">{c.max_hp}</strong>
                          </span>
                          <span className="flex items-center gap-0.5">
                            <Shield className="w-2.5 h-2.5" /> AC <strong className="text-foreground ml-0.5">{c.ac}</strong>
                          </span>
                          <span className="flex items-center gap-0.5">
                            <Clock className="w-2.5 h-2.5" /> {formatRespawn(c.respawn_seconds)}
                          </span>
                          <span>{c.is_alive ? '✅ alive' : '💀 dead'}</span>
                        </div>

                        {/* Stats */}
                        {c.stats && (
                          <div className="flex flex-wrap gap-x-2 gap-y-0 text-[9px] font-mono text-muted-foreground">
                            {['str','dex','con','int','wis','cha'].map(s => (
                              <span key={s}>{s.toUpperCase()} {(c.stats as any)[s] ?? '?'}</span>
                            ))}
                          </div>
                        )}

                        {/* Loot */}
                        <div className="text-[10px] text-muted-foreground">
                          {lootName ? (
                            <span>🎲 <span className="text-foreground">{lootName}</span> · {Math.round(c.drop_chance * 100)}% drop</span>
                          ) : legacyLoot.length > 0 ? (
                            <span>🎲 {legacyLoot.length} legacy item{legacyLoot.length !== 1 ? 's' : ''}</span>
                          ) : (
                            <span className="text-destructive/80">⚠ No loot configured</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Assign existing creature */}
                <div className="border-t border-border pt-3 space-y-2">
                  <p className="font-display text-xs text-primary">Assign Creature to Node</p>
                  <p className="text-[10px] text-muted-foreground">Pick an existing creature from the Creature Manager to spawn here.</p>
                  <div className="flex gap-2">
                    <Select value={assignCreatureId} onValueChange={setAssignCreatureId}>
                      <SelectTrigger className="h-8 text-xs flex-1">
                        <SelectValue placeholder="Select creature…" />
                      </SelectTrigger>
                      <SelectContent className="bg-popover border-border z-50 max-h-60">
                        {unassignedCreatures.length === 0 ? (
                          <div className="px-2 py-3 text-xs text-muted-foreground text-center">All creatures are assigned</div>
                        ) : unassignedCreatures.map((c: any) => (
                          <SelectItem key={c.id} value={c.id} className="text-xs">
                            <span className={RARITY_COLORS[c.rarity]}>{c.name}</span>
                            <span className="text-muted-foreground ml-1">Lv {c.level} {c.rarity}</span>
                            {c.node_id && <span className="text-[9px] text-muted-foreground/60 ml-1">(currently elsewhere)</span>}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      disabled={!assignCreatureId || assigning}
                      onClick={assignCreature}
                      className="font-display text-xs h-8"
                    >
                      <Plus className="w-3 h-3 mr-1" /> Assign
                    </Button>
                  </div>
                </div>
              </TabsContent>
            )}

            {/* ── NPCs ── */}
            {activeNodeId && (
              <TabsContent value="npcs" className="space-y-3">
                {/* Assigned NPCs list */}
                <div className="space-y-2">
                  {npcs.length === 0 && (
                    <p className="text-xs text-muted-foreground italic">No NPCs at this location.</p>
                  )}
                  {npcs.map(n => (
                    <div key={n.id} className="rounded border border-border bg-background/40 p-2.5 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <MessageSquare className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                          <span className="font-display text-sm text-foreground truncate">{n.name}</span>
                        </div>
                        <Button
                          size="sm" variant="ghost"
                          onClick={() => unassignNpc(n.id, n.name)}
                          className="h-6 w-6 p-0 shrink-0 text-muted-foreground hover:text-foreground"
                          title="Unassign from node"
                        >
                          <Unlink className="w-3 h-3" />
                        </Button>
                      </div>
                      {n.description && (
                        <p className="text-[10px] text-muted-foreground italic leading-snug">{n.description}</p>
                      )}
                      {n.dialogue && (
                        <p className="text-[10px] text-foreground/70 leading-snug border-l-2 border-primary/30 pl-2">
                          "{n.dialogue.length > 120 ? n.dialogue.slice(0, 120) + '…' : n.dialogue}"
                        </p>
                      )}
                    </div>
                  ))}
                </div>

                {/* Assign existing NPC */}
                <div className="border-t border-border pt-3 space-y-2">
                  <p className="font-display text-xs text-primary">Assign NPC to Node</p>
                  <p className="text-[10px] text-muted-foreground">Pick an existing NPC from the NPC Manager to place here.</p>
                  <div className="flex gap-2">
                    <Select value={assignNpcId} onValueChange={setAssignNpcId}>
                      <SelectTrigger className="h-8 text-xs flex-1">
                        <SelectValue placeholder="Select NPC…" />
                      </SelectTrigger>
                      <SelectContent className="bg-popover border-border z-50 max-h-60">
                        {unassignedNpcs.length === 0 ? (
                          <div className="px-2 py-3 text-xs text-muted-foreground text-center">All NPCs are assigned</div>
                        ) : unassignedNpcs.map((n: any) => (
                          <SelectItem key={n.id} value={n.id} className="text-xs">
                            {n.name}
                            {n.node_id && <span className="text-[9px] text-muted-foreground/60 ml-1">(currently elsewhere)</span>}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      disabled={!assignNpcId || assigning}
                      onClick={assignNpc}
                      className="font-display text-xs h-8"
                    >
                      <Plus className="w-3 h-3 mr-1" /> Assign
                    </Button>
                  </div>
                </div>
              </TabsContent>
            )}

            {/* ── Vendor Stock ── */}
            {activeNodeId && form.is_vendor && (
              <TabsContent value="vendor" className="space-y-3">
                <div className="space-y-2">
                  {vendorItems.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">No items stocked. Add items below.</p>
                  ) : vendorItems.map(v => (
                    <div key={v.id} className="flex items-center gap-2 p-2 rounded border border-border bg-background/40">
                      <span className={`font-display text-sm flex-1 ${ITEM_RARITY_COLORS[v.item?.rarity || 'common']}`}>
                        {v.item?.name || v.item_id}
                      </span>
                      <div className="flex items-center gap-1">
                        <label className="text-[10px] text-muted-foreground">Price:</label>
                        <Input type="number" min={0} value={v.price}
                          onChange={e => updateVendorItem(v.id, { price: Math.max(0, +e.target.value) })}
                          className="w-20 h-7 text-xs" />
                      </div>
                      <div className="flex items-center gap-1">
                        <label className="text-[10px] text-muted-foreground">Stock:</label>
                        <Input type="number" min={-1} value={v.stock}
                          onChange={e => updateVendorItem(v.id, { stock: +e.target.value })}
                          className="w-16 h-7 text-xs" />
                        <span className="text-[9px] text-muted-foreground">(-1=∞)</span>
                      </div>
                      <Button size="sm" variant="destructive" onClick={() => removeVendorItem(v.id)} className="h-7 w-7 p-0">
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  ))}
                </div>
                <div className="border-t border-border pt-3 space-y-2">
                  <p className="font-display text-xs text-primary">Add Item to Vendor</p>
                  <div className="flex gap-2 items-end flex-wrap">
                    <div className="flex-1 min-w-[120px]">
                      <label className="text-[10px] text-muted-foreground">Item</label>
                      <Select value={vendorForm.item_id} onValueChange={v => {
                        const item = allItems.find(i => i.id === v);
                        setVendorForm(f => ({ ...f, item_id: v, price: item?.value || 10 }));
                      }}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select item..." /></SelectTrigger>
                        <SelectContent className="bg-popover border-border z-50 max-h-60">
                          {allItems.filter(i => !vendorItems.some(v => v.item_id === i.id)).map(item => (
                            <SelectItem key={item.id} value={item.id} className="text-xs">
                              {item.name} <span className="text-muted-foreground capitalize">({item.rarity})</span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground">Price</label>
                      <Input type="number" min={0} value={vendorForm.price}
                        onChange={e => setVendorForm(f => ({ ...f, price: Math.max(0, +e.target.value) }))}
                        className="w-20 h-8 text-xs" />
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground">Stock</label>
                      <Input type="number" min={-1} value={vendorForm.stock}
                        onChange={e => setVendorForm(f => ({ ...f, stock: +e.target.value }))}
                        className="w-16 h-8 text-xs" />
                    </div>
                    <Button onClick={addVendorItem} className="font-display text-xs h-8">
                      <Plus className="w-3 h-3 mr-1" /> Add
                    </Button>
                  </div>
                  <p className="text-[10px] text-muted-foreground">Stock -1 = unlimited. Price defaults to item's gold value.</p>
                </div>
              </TabsContent>
            )}

            {/* ── Connections ── */}
            {activeNodeId && (
              <TabsContent value="connections" className="space-y-3">
                <ConnectionsManager
                  nodeId={activeNodeId}
                  connections={form.connections}
                  allNodesGlobal={allNodesGlobal}
                  onUpdated={() => { onSaved(); loadNode(activeNodeId); }}
                />
              </TabsContent>
            )}
          </Tabs>
        </div>
      </ScrollArea>
    </div>
  );
}
