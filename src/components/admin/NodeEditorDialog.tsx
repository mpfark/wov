import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Save, Trash2, Plus, Pencil, X, ShoppingCart } from 'lucide-react';
import { generateCreatureStats } from '@/lib/game-data';
import ItemPickerList from './ItemPickerList';
import NodePicker from './NodePicker';
import ItemPicker from './ItemPicker';

interface VendorEntry {
  id: string;
  item_id: string;
  price: number;
  stock: number;
  item?: { name: string; rarity: string };
}

interface NodeEditorProps {
  nodeId: string | null;
  regionId: string;
  allNodes: any[];
  allNodesGlobal: any[];
  open: boolean;
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

  const parsed: { node_id: string; direction: string; label?: string; hidden?: boolean }[] = (() => {
    try { return JSON.parse(connections) || []; } catch { return []; }
  })();

  const nodeName = (id: string) => allNodesGlobal.find((n: any) => n.id === id)?.name || id.slice(0, 8);

  const addConnection = async () => {
    if (!addNodeId) return toast.error('Select a target node');
    if (parsed.some(c => c.node_id === addNodeId)) return toast.error('Already connected to that node');
    setSaving(true);

    // Update current node
    const newConns = [...parsed, { node_id: addNodeId, direction: addDir, ...(addLabel ? { label: addLabel } : {}), ...(addHidden ? { hidden: true } : {}) }];
    await supabase.from('nodes').update({ connections: newConns }).eq('id', nodeId);

    // Update target node with reverse connection (also hidden if source is hidden)
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
    // Remove from current node
    const newConns = parsed.filter(c => c.node_id !== targetId);
    await supabase.from('nodes').update({ connections: newConns }).eq('id', nodeId);

    // Remove reverse from target node
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
      {/* Current connections */}
      <div className="space-y-1.5">
        {parsed.length === 0 && (
          <p className="text-xs text-muted-foreground italic">No connections yet.</p>
        )}
        {parsed.map(c => (
          <div key={c.node_id} className="flex items-center gap-2 p-2 rounded border border-border bg-background/40">
            <span className="font-display text-sm flex-1">{nodeName(c.node_id)}</span>
            <span className="text-xs text-muted-foreground font-mono">{c.direction}</span>
            {c.label && <span className="text-xs text-muted-foreground italic">{c.label}</span>}
            {c.hidden && <span className="text-[10px] text-primary/70 font-mono">🔒 Hidden</span>}
            <Button size="sm" variant="destructive" disabled={saving} onClick={() => removeConnection(c.node_id)} className="h-6 w-6 p-0">
              <Trash2 className="w-3 h-3" />
            </Button>
          </div>
        ))}
      </div>

      {/* Add connection */}
      <div className="border-t border-border pt-3 space-y-2">
        <p className="font-display text-xs text-primary">Add Connection</p>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <div>
            <label className="text-[10px] text-muted-foreground">Target Node</label>
            <NodePicker
              nodes={availableNodes}
              regions={[]}
              value={addNodeId || null}
              onChange={v => setAddNodeId(v || '')}
              placeholder="Select node..."
            />
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

const defaultCreatureForm = () => ({
  name: '', description: '', level: 1, rarity: 'regular',
  is_aggressive: false, respawn_seconds: 300, loot_table: [] as { item_id: string; chance: number }[],
});

export default function NodeEditorDialog({ nodeId, regionId, open, allNodes, allNodesGlobal, onClose, onSaved, isValar, adjacentToNodeId }: NodeEditorProps) {
  const [form, setForm] = useState({
    name: '', description: '', is_vendor: false,
    connections: '[]', searchable_items: [] as { item_id: string; chance: number }[],
  });
  const [creatures, setCreatures] = useState<any[]>([]);
  const [creatureForm, setCreatureForm] = useState(defaultCreatureForm());
  const [editingCreatureId, setEditingCreatureId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [vendorItems, setVendorItems] = useState<VendorEntry[]>([]);
  const [allItems, setAllItems] = useState<{ id: string; name: string; rarity: string; value: number }[]>([]);
  const [vendorForm, setVendorForm] = useState({ item_id: '', price: 10, stock: -1 });

  useEffect(() => {
    if (!open) return;
    supabase.from('items').select('id, name, rarity, value').order('name').then(({ data }) => {
      if (data) setAllItems(data);
    });
    if (nodeId) {
      loadNode(nodeId);
      loadCreatures(nodeId);
      loadVendorInventory(nodeId);
    } else {
      setForm({ name: '', description: '', is_vendor: false, connections: '[]', searchable_items: [] });
      setCreatures([]);
      setVendorItems([]);
    }
    setEditingCreatureId(null);
    setCreatureForm(defaultCreatureForm());
    setVendorForm({ item_id: '', price: 10, stock: -1 });
  }, [nodeId, open]);

  const loadNode = async (id: string) => {
    const { data } = await supabase.from('nodes').select('*').eq('id', id).single();
    if (data) {
      setForm({
        name: data.name, description: data.description, is_vendor: data.is_vendor,
        connections: JSON.stringify(data.connections, null, 2),
        searchable_items: Array.isArray(data.searchable_items) ? data.searchable_items as any : [],
      });
    }
  };

  const loadCreatures = async (id: string) => {
    const { data } = await supabase.from('creatures').select('*').eq('node_id', id).order('name');
    setCreatures(data || []);
  };

  const loadVendorInventory = async (id: string) => {
    const { data } = await supabase
      .from('vendor_inventory')
      .select('*, item:items(name, rarity)')
      .eq('node_id', id)
      .order('created_at');
    if (data) setVendorItems(data as unknown as VendorEntry[]);
  };

  const addVendorItem = async () => {
    if (!nodeId || !vendorForm.item_id) return toast.error('Select an item');
    if (vendorItems.some(v => v.item_id === vendorForm.item_id)) return toast.error('Item already in vendor stock');
    const { error } = await supabase.from('vendor_inventory').insert({
      node_id: nodeId, item_id: vendorForm.item_id,
      price: Math.max(0, vendorForm.price), stock: vendorForm.stock,
    });
    if (error) return toast.error(error.message);
    toast.success('Item added to vendor');
    setVendorForm({ item_id: '', price: 10, stock: -1 });
    loadVendorInventory(nodeId);
  };

  const updateVendorItem = async (id: string, updates: { price?: number; stock?: number }) => {
    const { error } = await supabase.from('vendor_inventory').update(updates).eq('id', id);
    if (error) return toast.error(error.message);
    if (nodeId) loadVendorInventory(nodeId);
  };

  const removeVendorItem = async (id: string) => {
    const { error } = await supabase.from('vendor_inventory').delete().eq('id', id);
    if (error) return toast.error(error.message);
    toast.success('Item removed from vendor');
    if (nodeId) loadVendorInventory(nodeId);
  };

  const saveNode = async () => {
    if (!form.name) return toast.error('Name required');
    let connections: any;
    const searchable_items = form.searchable_items;
    try { connections = JSON.parse(form.connections); } catch { return toast.error('Invalid connections JSON'); }

    setLoading(true);
    if (nodeId) {
      const { error } = await supabase.from('nodes').update({
        name: form.name, description: form.description, is_vendor: form.is_vendor,
        connections, searchable_items,
      }).eq('id', nodeId);
      if (error) { toast.error(error.message); setLoading(false); return; }
      toast.success('Node updated');
    } else {
      // If adjacent to an existing node, auto-set bidirectional connections
      if (adjacentToNodeId) {
        const parentNode = allNodes.find(n => n.id === adjacentToNodeId);
        if (parentNode) {
          // Add connection from new node back to parent (direction S by default)
          connections = [{ node_id: adjacentToNodeId, direction: 'S', label: '' }];
        }
      }

      // Calculate x/y from adjacent node
      let newX = 0, newY = 0;
      if (adjacentToNodeId) {
        const parentNode = allNodes.find(n => n.id === adjacentToNodeId);
        if (parentNode) {
          const dirOffsets: Record<string, [number, number]> = {
            N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0],
            NE: [1, -1], NW: [-1, -1], SE: [1, 1], SW: [-1, 1],
          };
          // Use the direction from parent's connection or default S
          const dir = connections?.[0]?.direction === 'S' ? 'N' : 'S';
          const offset = dirOffsets[dir] || [0, 1];
          newX = (parentNode.x ?? 0) + offset[0];
          newY = (parentNode.y ?? 0) + offset[1];
        }
      }
      const { data: inserted, error } = await supabase.from('nodes').insert({
        name: form.name, description: form.description, region_id: regionId,
        is_vendor: form.is_vendor, connections, searchable_items,
        x: newX, y: newY,
      }).select().single();
      if (error) { toast.error(error.message); setLoading(false); return; }

      // Update parent node to add connection to the new node
      if (adjacentToNodeId && inserted) {
        const parentNode = allNodes.find(n => n.id === adjacentToNodeId);
        if (parentNode) {
          const parentConns = Array.isArray(parentNode.connections) ? [...parentNode.connections] : [];
          parentConns.push({ node_id: inserted.id, direction: 'N', label: form.name });
          await supabase.from('nodes').update({ connections: parentConns }).eq('id', adjacentToNodeId);
        }
      }

      toast.success('Node created');
    }
    setLoading(false);
    onSaved();
  };

  const deleteNode = async () => {
    if (!nodeId) return;
    // Remove this node from all other nodes' connections
    const { data: allNodes } = await supabase.from('nodes').select('id, connections');
    if (allNodes) {
      for (const n of allNodes) {
        if (n.id === nodeId) continue;
        const conns = (n.connections as any[]) || [];
        const filtered = conns.filter((c: any) => c.node_id !== nodeId);
        if (filtered.length !== conns.length) {
          await supabase.from('nodes').update({ connections: filtered }).eq('id', n.id);
        }
      }
    }
    const { error } = await supabase.from('nodes').delete().eq('id', nodeId);
    if (error) return toast.error(error.message);
    toast.success('Node deleted');
    onSaved();
    onClose();
  };

  const saveCreature = async () => {
    if (!nodeId || !creatureForm.name) return toast.error('Save the node first and provide a creature name');
    const loot_table = creatureForm.loot_table;

    const generated = generateCreatureStats(creatureForm.level, creatureForm.rarity);
    const payload = {
      name: creatureForm.name, description: creatureForm.description,
      node_id: nodeId, level: creatureForm.level,
      hp: generated.hp, max_hp: generated.hp, ac: generated.ac,
      rarity: creatureForm.rarity as any, is_aggressive: creatureForm.is_aggressive,
      respawn_seconds: creatureForm.respawn_seconds, stats: generated.stats, loot_table,
    };

    if (editingCreatureId) {
      const { error } = await supabase.from('creatures').update(payload).eq('id', editingCreatureId);
      if (error) return toast.error(error.message);
      toast.success('Creature updated');
    } else {
      const { error } = await supabase.from('creatures').insert(payload);
      if (error) return toast.error(error.message);
      toast.success('Creature added');
    }
    setCreatureForm(defaultCreatureForm());
    setEditingCreatureId(null);
    loadCreatures(nodeId);
  };

  const editCreature = (c: any) => {
    setEditingCreatureId(c.id);
    setCreatureForm({
      name: c.name, description: c.description || '', level: c.level,
      rarity: c.rarity, is_aggressive: c.is_aggressive,
      respawn_seconds: c.respawn_seconds,
      loot_table: Array.isArray(c.loot_table) ? c.loot_table as any : [],
    });
  };

  const cancelEdit = () => {
    setEditingCreatureId(null);
    setCreatureForm(defaultCreatureForm());
  };

  const removeCreature = async (id: string) => {
    const { error } = await supabase.from('creatures').delete().eq('id', id);
    if (error) return toast.error(error.message);
    toast.success('Creature removed');
    if (nodeId) loadCreatures(nodeId);
  };

  // Preview generated stats
  const previewStats = generateCreatureStats(creatureForm.level, creatureForm.rarity);

  const formatRespawn = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto bg-card border-border">
        <DialogHeader>
          <DialogTitle className="font-display text-primary text-glow">
            {nodeId ? `Edit: ${form.name || 'Node'}` : 'New Node'}
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="details">
          <TabsList className="mb-3">
            <TabsTrigger value="details" className="font-display text-xs">Details</TabsTrigger>
            {nodeId && <TabsTrigger value="creatures" className="font-display text-xs">Creatures</TabsTrigger>}
            {nodeId && form.is_vendor && <TabsTrigger value="vendor" className="font-display text-xs">Vendor Stock</TabsTrigger>}
            {nodeId && <TabsTrigger value="connections" className="font-display text-xs">Connections</TabsTrigger>}
          </TabsList>

          <TabsContent value="details" className="space-y-3">
            <Input placeholder="Node name" value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            <Textarea placeholder="Description" value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={3} />
            <ItemPickerList label="Searchable Items" value={form.searchable_items}
              onChange={v => setForm(f => ({ ...f, searchable_items: v }))} />
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={form.is_vendor}
                onChange={e => setForm(f => ({ ...f, is_vendor: e.target.checked }))} />
              Is Vendor
            </label>
            <div className="flex gap-2">
              <Button onClick={saveNode} disabled={loading} className="font-display text-xs">
                <Save className="w-3 h-3 mr-1" /> {nodeId ? 'Save' : 'Create'}
              </Button>
              {nodeId && isValar && (
                <Button variant="destructive" onClick={deleteNode} className="font-display text-xs">
                  <Trash2 className="w-3 h-3 mr-1" /> Delete
                </Button>
              )}
            </div>
          </TabsContent>

          {nodeId && (
            <TabsContent value="creatures" className="space-y-3">
              {/* Existing creatures list */}
              <div className="space-y-2">
                {creatures.map(c => (
                  <div key={c.id} className={`flex items-center justify-between p-2 rounded border ${
                    editingCreatureId === c.id ? 'border-primary bg-primary/10' : 'border-border bg-background/40'
                  }`}>
                    <div>
                      <span className={`font-display text-sm ${c.rarity === 'boss' ? 'text-primary text-glow' : c.rarity === 'rare' ? 'text-dwarvish' : 'text-foreground'}`}>
                        {c.name}
                      </span>
                      <span className="text-xs text-muted-foreground ml-2">
                        Lvl {c.level} | HP {c.hp}/{c.max_hp} | AC {c.ac} | ⏱ {formatRespawn(c.respawn_seconds)} | {c.is_alive ? '✅' : '💀'}
                      </span>
                    </div>
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" onClick={() => editCreature(c)} className="text-xs h-6 px-2">
                        <Pencil className="w-3 h-3" />
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => removeCreature(c.id)} className="text-xs h-6 px-2">
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                ))}
                {creatures.length === 0 && (
                  <p className="text-xs text-muted-foreground italic">No creatures spawned here.</p>
                )}
              </div>

              {/* Add / Edit creature form */}
              <div className="border-t border-border pt-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="font-display text-xs text-primary">
                    {editingCreatureId ? 'Edit Creature' : 'Add Creature'}
                  </p>
                  {editingCreatureId && (
                    <Button size="sm" variant="ghost" onClick={cancelEdit} className="text-xs h-6 px-2">
                      <X className="w-3 h-3 mr-1" /> Cancel
                    </Button>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <Input placeholder="Name" value={creatureForm.name}
                    onChange={e => setCreatureForm(f => ({ ...f, name: e.target.value }))} />
                  <Select value={creatureForm.rarity} onValueChange={v => setCreatureForm(f => ({ ...f, rarity: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="regular">Regular</SelectItem>
                      <SelectItem value="rare">Rare</SelectItem>
                      <SelectItem value="boss">Boss</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <Textarea placeholder="Description" value={creatureForm.description}
                  onChange={e => setCreatureForm(f => ({ ...f, description: e.target.value }))} rows={2} />

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-muted-foreground">Level</label>
                    <Input type="number" min={1} value={creatureForm.level}
                      onChange={e => setCreatureForm(f => ({ ...f, level: Math.max(1, +e.target.value) }))} />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground">Respawn Timer</label>
                    <div className="flex gap-1 items-center">
                      <Input type="number" min={0} value={creatureForm.respawn_seconds}
                        onChange={e => setCreatureForm(f => ({ ...f, respawn_seconds: Math.max(0, +e.target.value) }))} />
                      <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                        ({formatRespawn(creatureForm.respawn_seconds)})
                      </span>
                    </div>
                  </div>
                </div>

                {/* Auto-generated stats preview */}
                <div className="p-2 bg-background/50 rounded border border-border">
                  <p className="text-[10px] text-muted-foreground mb-1">Auto-generated stats (Lvl {creatureForm.level} {creatureForm.rarity})</p>
                  <div className="grid grid-cols-4 gap-x-3 gap-y-0.5 text-xs">
                    <span>HP: <strong>{previewStats.hp}</strong></span>
                    <span>AC: <strong>{previewStats.ac}</strong></span>
                    <span>STR: <strong>{previewStats.stats.str}</strong></span>
                    <span>DEX: <strong>{previewStats.stats.dex}</strong></span>
                    <span>CON: <strong>{previewStats.stats.con}</strong></span>
                    <span>INT: <strong>{previewStats.stats.int}</strong></span>
                    <span>WIS: <strong>{previewStats.stats.wis}</strong></span>
                    <span>CHA: <strong>{previewStats.stats.cha}</strong></span>
                  </div>
                </div>

                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input type="checkbox" checked={creatureForm.is_aggressive}
                    onChange={e => setCreatureForm(f => ({ ...f, is_aggressive: e.target.checked }))} />
                  Aggressive
                </label>

                <ItemPickerList label="Loot Table" value={creatureForm.loot_table}
                  onChange={v => setCreatureForm(f => ({ ...f, loot_table: v }))} />

                <Button onClick={saveCreature} className="font-display text-xs">
                  {editingCreatureId ? (
                    <><Save className="w-3 h-3 mr-1" /> Update Creature</>
                  ) : (
                    <><Plus className="w-3 h-3 mr-1" /> Add Creature</>
                  )}
                </Button>
              </div>
            </TabsContent>
          )}

          {nodeId && form.is_vendor && (
            <TabsContent value="vendor" className="space-y-3">
              {/* Current vendor stock */}
              <div className="space-y-2">
                {vendorItems.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">No items stocked. Add items below.</p>
                ) : vendorItems.map(v => (
                  <div key={v.id} className="flex items-center gap-2 p-2 rounded border border-border bg-background/40">
                    <span className={`font-display text-sm flex-1 ${
                      v.item?.rarity === 'unique' ? 'text-primary text-glow' :
                      v.item?.rarity === 'rare' ? 'text-dwarvish' :
                      v.item?.rarity === 'uncommon' ? 'text-elvish' : 'text-foreground'
                    }`}>{v.item?.name || v.item_id}</span>
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

              {/* Add new vendor item */}
              <div className="border-t border-border pt-3 space-y-2">
                <p className="font-display text-xs text-primary">Add Item to Vendor</p>
                <div className="flex gap-2 items-end">
                  <div className="flex-1">
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

          {nodeId && (
            <TabsContent value="connections" className="space-y-3">
              <ConnectionsManager
                nodeId={nodeId}
                connections={form.connections}
                allNodesGlobal={allNodesGlobal}
                onUpdated={() => { onSaved(); if (nodeId) loadNode(nodeId); }}
              />
            </TabsContent>
          )}
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
