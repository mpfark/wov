import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { ArrowLeft, Plus, Trash2, Save } from 'lucide-react';

interface AdminPageProps {
  onBack: () => void;
  isValar: boolean;
}

// ─── Regions Tab ───
function RegionsTab({ isValar }: { isValar: boolean }) {
  const [regions, setRegions] = useState<any[]>([]);
  const [form, setForm] = useState({ name: '', description: '', min_level: 1, max_level: 10 });

  const load = async () => {
    const { data } = await supabase.from('regions').select('*').order('min_level');
    setRegions(data || []);
  };
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!form.name) return toast.error('Name required');
    const { error } = await supabase.from('regions').insert(form);
    if (error) return toast.error(error.message);
    toast.success('Region created');
    setForm({ name: '', description: '', min_level: 1, max_level: 10 });
    load();
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from('regions').delete().eq('id', id);
    if (error) return toast.error(error.message);
    toast.success('Region deleted');
    load();
  };

  return (
    <div className="space-y-4">
      <Card className="bg-card/80 border-border">
        <CardHeader><CardTitle className="font-display text-sm text-primary">New Region</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <Input placeholder="Region name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          <Textarea placeholder="Description" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          <div className="flex gap-2">
            <Input type="number" placeholder="Min level" value={form.min_level} onChange={e => setForm(f => ({ ...f, min_level: +e.target.value }))} />
            <Input type="number" placeholder="Max level" value={form.max_level} onChange={e => setForm(f => ({ ...f, max_level: +e.target.value }))} />
          </div>
          <Button onClick={create} className="font-display text-xs"><Plus className="w-3 h-3 mr-1" /> Create Region</Button>
        </CardContent>
      </Card>

      <div className="space-y-2">
        {regions.map(r => (
          <div key={r.id} className="flex items-center justify-between p-3 bg-card/60 rounded border border-border">
            <div>
              <span className="font-display text-sm text-primary">{r.name}</span>
              <span className="text-xs text-muted-foreground ml-2">Lvl {r.min_level}–{r.max_level}</span>
              <p className="text-xs text-muted-foreground mt-0.5">{r.description}</p>
            </div>
            {isValar && (
              <Button size="sm" variant="destructive" onClick={() => remove(r.id)} className="text-xs h-7">
                <Trash2 className="w-3 h-3" />
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Nodes Tab ───
function NodesTab() {
  const [nodes, setNodes] = useState<any[]>([]);
  const [regions, setRegions] = useState<any[]>([]);
  const [form, setForm] = useState({ name: '', description: '', region_id: '', is_vendor: false, connections: '[]', searchable_items: '[]' });

  const load = async () => {
    const [n, r] = await Promise.all([
      supabase.from('nodes').select('*').order('name'),
      supabase.from('regions').select('id, name').order('name'),
    ]);
    setNodes(n.data || []);
    setRegions(r.data || []);
  };
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!form.name || !form.region_id) return toast.error('Name and region required');
    let connections: any, searchable_items: any;
    try { connections = JSON.parse(form.connections); } catch { return toast.error('Invalid connections JSON'); }
    try { searchable_items = JSON.parse(form.searchable_items); } catch { return toast.error('Invalid searchable_items JSON'); }
    const { error } = await supabase.from('nodes').insert({
      name: form.name, description: form.description, region_id: form.region_id,
      is_vendor: form.is_vendor, connections, searchable_items,
    });
    if (error) return toast.error(error.message);
    toast.success('Node created');
    setForm({ name: '', description: '', region_id: form.region_id, is_vendor: false, connections: '[]', searchable_items: '[]' });
    load();
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from('nodes').delete().eq('id', id);
    if (error) return toast.error(error.message);
    toast.success('Node deleted');
    load();
  };

  return (
    <div className="space-y-4">
      <Card className="bg-card/80 border-border">
        <CardHeader><CardTitle className="font-display text-sm text-primary">New Node</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <Input placeholder="Node name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          <Textarea placeholder="Description" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          <Select value={form.region_id} onValueChange={v => setForm(f => ({ ...f, region_id: v }))}>
            <SelectTrigger><SelectValue placeholder="Select region" /></SelectTrigger>
            <SelectContent>
              {regions.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Textarea placeholder='Connections JSON, e.g. [{"node_id":"...","direction":"N","label":"Path"}]' value={form.connections} onChange={e => setForm(f => ({ ...f, connections: e.target.value }))} className="font-mono text-xs" rows={3} />
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={form.is_vendor} onChange={e => setForm(f => ({ ...f, is_vendor: e.target.checked }))} />
            Is Vendor
          </label>
          <Button onClick={create} className="font-display text-xs"><Plus className="w-3 h-3 mr-1" /> Create Node</Button>
        </CardContent>
      </Card>

      <div className="space-y-2">
        {nodes.map(n => {
          const region = regions.find(r => r.id === n.region_id);
          return (
            <div key={n.id} className="flex items-center justify-between p-3 bg-card/60 rounded border border-border">
              <div>
                <span className="font-display text-sm text-primary">{n.name}</span>
                <span className="text-xs text-muted-foreground ml-2">{region?.name || 'Unknown'}</span>
                {n.is_vendor && <span className="text-xs text-elvish ml-2">🛒 Vendor</span>}
                <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-md">{n.description}</p>
                <p className="text-xs text-muted-foreground font-mono">{(n.connections as any[]).length} connections</p>
              </div>
              <Button size="sm" variant="destructive" onClick={() => remove(n.id)} className="text-xs h-7">
                <Trash2 className="w-3 h-3" />
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Creatures Tab ───
function CreaturesTab() {
  const [creatures, setCreatures] = useState<any[]>([]);
  const [nodes, setNodes] = useState<any[]>([]);
  const [form, setForm] = useState({
    name: '', description: '', node_id: '', level: 1, hp: 10, max_hp: 10, ac: 10,
    rarity: 'regular', is_aggressive: false, respawn_seconds: 300,
    stats: '{"str":10,"dex":10,"con":10,"int":10,"wis":10,"cha":10}',
    loot_table: '[]',
  });

  const load = async () => {
    const [c, n] = await Promise.all([
      supabase.from('creatures').select('*').order('name'),
      supabase.from('nodes').select('id, name').order('name'),
    ]);
    setCreatures(c.data || []);
    setNodes(n.data || []);
  };
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!form.name) return toast.error('Name required');
    let stats: any, loot_table: any;
    try { stats = JSON.parse(form.stats); } catch { return toast.error('Invalid stats JSON'); }
    try { loot_table = JSON.parse(form.loot_table); } catch { return toast.error('Invalid loot_table JSON'); }
    const { error } = await supabase.from('creatures').insert({
      name: form.name, description: form.description,
      node_id: form.node_id || null, level: form.level,
      hp: form.hp, max_hp: form.max_hp, ac: form.ac,
      rarity: form.rarity as any, is_aggressive: form.is_aggressive,
      respawn_seconds: form.respawn_seconds, stats, loot_table,
    });
    if (error) return toast.error(error.message);
    toast.success('Creature created');
    load();
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from('creatures').delete().eq('id', id);
    if (error) return toast.error(error.message);
    toast.success('Creature deleted');
    load();
  };

  return (
    <div className="space-y-4">
      <Card className="bg-card/80 border-border">
        <CardHeader><CardTitle className="font-display text-sm text-primary">New Creature</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder="Name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            <Select value={form.rarity} onValueChange={v => setForm(f => ({ ...f, rarity: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="regular">Regular</SelectItem>
                <SelectItem value="rare">Rare</SelectItem>
                <SelectItem value="boss">Boss</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Textarea placeholder="Description" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          <Select value={form.node_id} onValueChange={v => setForm(f => ({ ...f, node_id: v }))}>
            <SelectTrigger><SelectValue placeholder="Spawn node" /></SelectTrigger>
            <SelectContent>
              {nodes.map(n => <SelectItem key={n.id} value={n.id}>{n.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="grid grid-cols-4 gap-2">
            <Input type="number" placeholder="Level" value={form.level} onChange={e => setForm(f => ({ ...f, level: +e.target.value }))} />
            <Input type="number" placeholder="HP" value={form.hp} onChange={e => setForm(f => ({ ...f, hp: +e.target.value, max_hp: +e.target.value }))} />
            <Input type="number" placeholder="AC" value={form.ac} onChange={e => setForm(f => ({ ...f, ac: +e.target.value }))} />
            <Input type="number" placeholder="Respawn (s)" value={form.respawn_seconds} onChange={e => setForm(f => ({ ...f, respawn_seconds: +e.target.value }))} />
          </div>
          <Textarea placeholder='Stats JSON' value={form.stats} onChange={e => setForm(f => ({ ...f, stats: e.target.value }))} className="font-mono text-xs" rows={2} />
          <Textarea placeholder='Loot table JSON' value={form.loot_table} onChange={e => setForm(f => ({ ...f, loot_table: e.target.value }))} className="font-mono text-xs" rows={2} />
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={form.is_aggressive} onChange={e => setForm(f => ({ ...f, is_aggressive: e.target.checked }))} />
            Aggressive
          </label>
          <Button onClick={create} className="font-display text-xs"><Plus className="w-3 h-3 mr-1" /> Create Creature</Button>
        </CardContent>
      </Card>

      <div className="space-y-2">
        {creatures.map(c => {
          const node = nodes.find(n => n.id === c.node_id);
          return (
            <div key={c.id} className="flex items-center justify-between p-3 bg-card/60 rounded border border-border">
              <div>
                <span className={`font-display text-sm ${c.rarity === 'boss' ? 'text-primary text-glow' : c.rarity === 'rare' ? 'text-dwarvish' : 'text-foreground'}`}>{c.name}</span>
                <span className="text-xs text-muted-foreground ml-2">Lvl {c.level} | HP {c.hp}/{c.max_hp} | AC {c.ac}</span>
                <span className="text-xs text-muted-foreground ml-2">{c.is_alive ? '✅' : '💀'}</span>
                {node && <span className="text-xs text-muted-foreground ml-2">@ {node.name}</span>}
              </div>
              <Button size="sm" variant="destructive" onClick={() => remove(c.id)} className="text-xs h-7">
                <Trash2 className="w-3 h-3" />
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Items Tab ───
function ItemsTab() {
  const [items, setItems] = useState<any[]>([]);
  const [form, setForm] = useState({
    name: '', description: '', item_type: 'equipment', rarity: 'common',
    slot: '', value: 0, max_durability: 100, stats: '{}',
  });

  const load = async () => {
    const { data } = await supabase.from('items').select('*').order('name');
    setItems(data || []);
  };
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!form.name) return toast.error('Name required');
    let stats: any;
    try { stats = JSON.parse(form.stats); } catch { return toast.error('Invalid stats JSON'); }
    const { error } = await supabase.from('items').insert({
      name: form.name, description: form.description, item_type: form.item_type,
      rarity: form.rarity as any, slot: (form.slot || null) as any, value: form.value,
      max_durability: form.max_durability, stats,
    } as any);
    if (error) return toast.error(error.message);
    toast.success('Item created');
    load();
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from('items').delete().eq('id', id);
    if (error) return toast.error(error.message);
    toast.success('Item deleted');
    load();
  };

  const slots = ['head', 'amulet', 'shoulders', 'chest', 'gloves', 'belt', 'pants', 'ring', 'trinket'];

  return (
    <div className="space-y-4">
      <Card className="bg-card/80 border-border">
        <CardHeader><CardTitle className="font-display text-sm text-primary">New Item</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder="Item name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            <Select value={form.rarity} onValueChange={v => setForm(f => ({ ...f, rarity: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="common">Common</SelectItem>
                <SelectItem value="uncommon">Uncommon</SelectItem>
                <SelectItem value="rare">Rare</SelectItem>
                <SelectItem value="unique">Unique</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Textarea placeholder="Description" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          <div className="grid grid-cols-3 gap-2">
            <Input placeholder="Type (equipment)" value={form.item_type} onChange={e => setForm(f => ({ ...f, item_type: e.target.value }))} />
            <Select value={form.slot} onValueChange={v => setForm(f => ({ ...f, slot: v }))}>
              <SelectTrigger><SelectValue placeholder="Slot (optional)" /></SelectTrigger>
              <SelectContent>
                {slots.map(s => <SelectItem key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input type="number" placeholder="Gold value" value={form.value} onChange={e => setForm(f => ({ ...f, value: +e.target.value }))} />
          </div>
          <Textarea placeholder='Stats JSON, e.g. {"str":2,"ac":1}' value={form.stats} onChange={e => setForm(f => ({ ...f, stats: e.target.value }))} className="font-mono text-xs" rows={2} />
          <Button onClick={create} className="font-display text-xs"><Plus className="w-3 h-3 mr-1" /> Create Item</Button>
        </CardContent>
      </Card>

      <div className="space-y-2">
        {items.map(item => (
          <div key={item.id} className="flex items-center justify-between p-3 bg-card/60 rounded border border-border">
            <div>
              <span className={`font-display text-sm ${
                item.rarity === 'unique' ? 'text-primary text-glow' :
                item.rarity === 'rare' ? 'text-dwarvish' :
                item.rarity === 'uncommon' ? 'text-elvish' : 'text-foreground'
              }`}>{item.name}</span>
              <span className="text-xs text-muted-foreground ml-2">{item.rarity} {item.slot || item.item_type}</span>
              <span className="text-xs text-muted-foreground ml-2">{item.value}g</span>
            </div>
            <Button size="sm" variant="destructive" onClick={() => remove(item.id)} className="text-xs h-7">
              <Trash2 className="w-3 h-3" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main Admin Page ───
export default function AdminPage({ onBack, isValar }: AdminPageProps) {
  return (
    <div className="h-screen flex flex-col parchment-bg">
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-card/50">
        <Button variant="ghost" size="sm" onClick={onBack} className="text-xs">
          <ArrowLeft className="w-3 h-3 mr-1" /> Back to Game
        </Button>
        <h1 className="font-display text-sm text-primary text-glow">
          {isValar ? '⚡ Valar' : '✨ Maiar'} Admin Panel
        </h1>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <Tabs defaultValue="regions">
          <TabsList className="mb-4">
            <TabsTrigger value="regions" className="font-display text-xs">Regions</TabsTrigger>
            <TabsTrigger value="nodes" className="font-display text-xs">Nodes</TabsTrigger>
            <TabsTrigger value="creatures" className="font-display text-xs">Creatures</TabsTrigger>
            <TabsTrigger value="items" className="font-display text-xs">Items</TabsTrigger>
          </TabsList>
          <TabsContent value="regions"><RegionsTab isValar={isValar} /></TabsContent>
          <TabsContent value="nodes"><NodesTab /></TabsContent>
          <TabsContent value="creatures"><CreaturesTab /></TabsContent>
          <TabsContent value="items"><ItemsTab /></TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
