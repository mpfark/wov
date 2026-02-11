import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Save, Trash2, Plus } from 'lucide-react';

interface NodeEditorProps {
  nodeId: string | null;
  regionId: string;
  allNodes: any[];
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  isValar: boolean;
}

export default function NodeEditorDialog({ nodeId, regionId, open, allNodes, onClose, onSaved, isValar }: NodeEditorProps) {
  const [form, setForm] = useState({
    name: '', description: '', is_vendor: false,
    connections: '[]', searchable_items: '[]',
  });
  const [creatures, setCreatures] = useState<any[]>([]);
  const [creatureForm, setCreatureForm] = useState({
    name: '', description: '', level: 1, hp: 10, max_hp: 10, ac: 10,
    rarity: 'regular', is_aggressive: false, respawn_seconds: 300,
    stats: '{"str":10,"dex":10,"con":10,"int":10,"wis":10,"cha":10}',
    loot_table: '[]',
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (nodeId) {
      loadNode(nodeId);
      loadCreatures(nodeId);
    } else {
      setForm({ name: '', description: '', is_vendor: false, connections: '[]', searchable_items: '[]' });
      setCreatures([]);
    }
  }, [nodeId, open]);

  const loadNode = async (id: string) => {
    const { data } = await supabase.from('nodes').select('*').eq('id', id).single();
    if (data) {
      setForm({
        name: data.name,
        description: data.description,
        is_vendor: data.is_vendor,
        connections: JSON.stringify(data.connections, null, 2),
        searchable_items: JSON.stringify(data.searchable_items, null, 2),
      });
    }
  };

  const loadCreatures = async (id: string) => {
    const { data } = await supabase.from('creatures').select('*').eq('node_id', id).order('name');
    setCreatures(data || []);
  };

  const saveNode = async () => {
    if (!form.name) return toast.error('Name required');
    let connections: any, searchable_items: any;
    try { connections = JSON.parse(form.connections); } catch { return toast.error('Invalid connections JSON'); }
    try { searchable_items = JSON.parse(form.searchable_items); } catch { return toast.error('Invalid searchable_items JSON'); }

    setLoading(true);
    if (nodeId) {
      const { error } = await supabase.from('nodes').update({
        name: form.name, description: form.description, is_vendor: form.is_vendor,
        connections, searchable_items,
      }).eq('id', nodeId);
      if (error) { toast.error(error.message); setLoading(false); return; }
      toast.success('Node updated');
    } else {
      const { error } = await supabase.from('nodes').insert({
        name: form.name, description: form.description, region_id: regionId,
        is_vendor: form.is_vendor, connections, searchable_items,
      });
      if (error) { toast.error(error.message); setLoading(false); return; }
      toast.success('Node created');
    }
    setLoading(false);
    onSaved();
  };

  const deleteNode = async () => {
    if (!nodeId) return;
    const { error } = await supabase.from('nodes').delete().eq('id', nodeId);
    if (error) return toast.error(error.message);
    toast.success('Node deleted');
    onSaved();
    onClose();
  };

  const addCreature = async () => {
    if (!nodeId || !creatureForm.name) return toast.error('Save the node first and provide a creature name');
    let stats: any, loot_table: any;
    try { stats = JSON.parse(creatureForm.stats); } catch { return toast.error('Invalid stats JSON'); }
    try { loot_table = JSON.parse(creatureForm.loot_table); } catch { return toast.error('Invalid loot_table JSON'); }
    const { error } = await supabase.from('creatures').insert({
      name: creatureForm.name, description: creatureForm.description,
      node_id: nodeId, level: creatureForm.level,
      hp: creatureForm.hp, max_hp: creatureForm.max_hp, ac: creatureForm.ac,
      rarity: creatureForm.rarity as any, is_aggressive: creatureForm.is_aggressive,
      respawn_seconds: creatureForm.respawn_seconds, stats, loot_table,
    });
    if (error) return toast.error(error.message);
    toast.success('Creature added');
    setCreatureForm(f => ({ ...f, name: '', description: '' }));
    loadCreatures(nodeId);
  };

  const removeCreature = async (id: string) => {
    const { error } = await supabase.from('creatures').delete().eq('id', id);
    if (error) return toast.error(error.message);
    toast.success('Creature removed');
    if (nodeId) loadCreatures(nodeId);
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
            {nodeId && <TabsTrigger value="connections" className="font-display text-xs">Connections</TabsTrigger>}
          </TabsList>

          <TabsContent value="details" className="space-y-3">
            <Input placeholder="Node name" value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            <Textarea placeholder="Description" value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={3} />
            <Textarea placeholder='Searchable items JSON' value={form.searchable_items}
              onChange={e => setForm(f => ({ ...f, searchable_items: e.target.value }))}
              className="font-mono text-xs" rows={2} />
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
              <div className="space-y-2">
                {creatures.map(c => (
                  <div key={c.id} className="flex items-center justify-between p-2 bg-background/40 rounded border border-border">
                    <div>
                      <span className={`font-display text-sm ${c.rarity === 'boss' ? 'text-primary text-glow' : c.rarity === 'rare' ? 'text-dwarvish' : 'text-foreground'}`}>
                        {c.name}
                      </span>
                      <span className="text-xs text-muted-foreground ml-2">
                        Lvl {c.level} | HP {c.hp}/{c.max_hp} | {c.is_alive ? '✅' : '💀'}
                      </span>
                    </div>
                    <Button size="sm" variant="destructive" onClick={() => removeCreature(c.id)} className="text-xs h-6">
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                ))}
              </div>

              <div className="border-t border-border pt-3 space-y-2">
                <p className="font-display text-xs text-primary">Add Creature</p>
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
                <div className="grid grid-cols-4 gap-2">
                  <Input type="number" placeholder="Lvl" value={creatureForm.level}
                    onChange={e => setCreatureForm(f => ({ ...f, level: +e.target.value }))} />
                  <Input type="number" placeholder="HP" value={creatureForm.hp}
                    onChange={e => setCreatureForm(f => ({ ...f, hp: +e.target.value, max_hp: +e.target.value }))} />
                  <Input type="number" placeholder="AC" value={creatureForm.ac}
                    onChange={e => setCreatureForm(f => ({ ...f, ac: +e.target.value }))} />
                  <Input type="number" placeholder="Respawn" value={creatureForm.respawn_seconds}
                    onChange={e => setCreatureForm(f => ({ ...f, respawn_seconds: +e.target.value }))} />
                </div>
                <Textarea placeholder='Stats JSON' value={creatureForm.stats}
                  onChange={e => setCreatureForm(f => ({ ...f, stats: e.target.value }))}
                  className="font-mono text-xs" rows={2} />
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input type="checkbox" checked={creatureForm.is_aggressive}
                    onChange={e => setCreatureForm(f => ({ ...f, is_aggressive: e.target.checked }))} />
                  Aggressive
                </label>
                <Button onClick={addCreature} className="font-display text-xs">
                  <Plus className="w-3 h-3 mr-1" /> Add Creature
                </Button>
              </div>
            </TabsContent>
          )}

          {nodeId && (
            <TabsContent value="connections" className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Edit the raw connections JSON. Each entry needs a <code>node_id</code>, <code>direction</code>, and optional <code>label</code>.
              </p>
              <Textarea
                value={form.connections}
                onChange={e => setForm(f => ({ ...f, connections: e.target.value }))}
                className="font-mono text-xs" rows={10}
              />
              <div className="text-xs text-muted-foreground space-y-1">
                <p>Available nodes in this region:</p>
                {allNodes.map(n => (
                  <p key={n.id} className="font-mono text-[10px]">{n.id} — {n.name}</p>
                ))}
              </div>
              <Button onClick={saveNode} disabled={loading} className="font-display text-xs">
                <Save className="w-3 h-3 mr-1" /> Save Connections
              </Button>
            </TabsContent>
          )}
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
