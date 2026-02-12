import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2, Save, X, Skull } from 'lucide-react';
import { generateCreatureStats } from '@/lib/game-data';
import ItemPickerList from './ItemPickerList';

interface Creature {
  id: string;
  name: string;
  description: string;
  node_id: string | null;
  rarity: string;
  level: number;
  hp: number;
  max_hp: number;
  ac: number;
  stats: Record<string, number>;
  is_aggressive: boolean;
  loot_table: { item_id: string; chance: number }[];
  respawn_seconds: number;
  is_alive: boolean;
}

interface NodeOption {
  id: string;
  name: string;
  region_name?: string;
}

const RARITIES = ['regular', 'rare', 'boss'] as const;

const RARITY_COLORS: Record<string, string> = {
  regular: 'text-foreground',
  rare: 'text-dwarvish',
  boss: 'text-primary text-glow',
};

const defaultForm = () => ({
  name: '', description: '', node_id: '' as string | null,
  level: 1, rarity: 'regular',
  is_aggressive: false, respawn_seconds: 300,
  loot_table: [] as { item_id: string; chance: number }[],
});

export default function CreatureManager() {
  const [creatures, setCreatures] = useState<Creature[]>([]);
  const [nodes, setNodes] = useState<NodeOption[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(defaultForm());
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(false);

  const loadData = async () => {
    const [c, n, r] = await Promise.all([
      supabase.from('creatures').select('*').order('name'),
      supabase.from('nodes').select('id, name, region_id').order('name'),
      supabase.from('regions').select('id, name'),
    ]);
    if (c.data) setCreatures(c.data as unknown as Creature[]);
    if (n.data && r.data) {
      const regionMap = Object.fromEntries(r.data.map(reg => [reg.id, reg.name]));
      setNodes(n.data.map(node => ({
        id: node.id,
        name: node.name,
        region_name: regionMap[node.region_id] || 'Unknown',
      })));
    }
  };

  useEffect(() => { loadData(); }, []);

  const getNodeName = (id: string | null) => {
    if (!id) return 'Unassigned';
    return nodes.find(n => n.id === id)?.name || 'Unknown';
  };

  const openNew = () => {
    setEditingId(null);
    setForm(defaultForm());
    setDialogOpen(true);
  };

  const openEdit = (c: Creature) => {
    setEditingId(c.id);
    setForm({
      name: c.name, description: c.description, node_id: c.node_id,
      level: c.level, rarity: c.rarity,
      is_aggressive: c.is_aggressive, respawn_seconds: c.respawn_seconds,
      loot_table: Array.isArray(c.loot_table) ? c.loot_table : [],
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return toast.error('Name is required');
    setLoading(true);

    const generated = generateCreatureStats(form.level, form.rarity);
    const payload = {
      name: form.name.trim(),
      description: form.description.trim(),
      node_id: form.node_id || null,
      level: form.level,
      rarity: form.rarity as any,
      hp: generated.hp,
      max_hp: generated.hp,
      ac: generated.ac,
      stats: generated.stats,
      is_aggressive: form.is_aggressive,
      respawn_seconds: Math.max(0, form.respawn_seconds),
      loot_table: form.loot_table,
    };

    if (editingId) {
      const { error } = await supabase.from('creatures').update(payload).eq('id', editingId);
      if (error) { toast.error(error.message); setLoading(false); return; }
      toast.success('Creature updated');
    } else {
      const { error } = await supabase.from('creatures').insert(payload);
      if (error) { toast.error(error.message); setLoading(false); return; }
      toast.success('Creature created');
    }
    setLoading(false);
    setDialogOpen(false);
    loadData();
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from('creatures').delete().eq('id', id);
    if (error) return toast.error(error.message);
    toast.success('Creature deleted');
    loadData();
  };

  const previewStats = generateCreatureStats(form.level, form.rarity);

  const formatRespawn = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  };

  const filtered = creatures.filter(c =>
    c.name.toLowerCase().includes(filter.toLowerCase()) ||
    c.rarity.includes(filter.toLowerCase()) ||
    getNodeName(c.node_id).toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <Skull className="w-4 h-4 text-primary" />
        <h2 className="font-display text-sm text-primary">Creature Database</h2>
        <span className="text-xs text-muted-foreground">({creatures.length} creatures)</span>
        <div className="flex-1" />
        <Input
          placeholder="Search creatures..."
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className="w-48 h-7 text-xs"
        />
        <Button size="sm" onClick={openNew} className="font-display text-xs h-7">
          <Plus className="w-3 h-3 mr-1" /> New Creature
        </Button>
      </div>

      {/* Creature List */}
      <div className="flex-1 overflow-y-auto p-4">
        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8 italic">
            {creatures.length === 0 ? 'No creatures yet. Create your first creature!' : 'No creatures match your search.'}
          </p>
        ) : (
          <div className="grid gap-2">
            {filtered.map(creature => (
              <div key={creature.id} className="flex items-center justify-between p-2.5 rounded border border-border bg-card/50 hover:bg-card/80 transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`font-display text-sm ${RARITY_COLORS[creature.rarity]}`}>{creature.name}</span>
                    <span className="text-[10px] text-muted-foreground capitalize px-1.5 py-0.5 rounded bg-background/50 border border-border">
                      {creature.rarity}
                    </span>
                    <span className="text-[10px] text-muted-foreground px-1.5 py-0.5 rounded bg-background/50 border border-border">
                      Lvl {creature.level}
                    </span>
                    {!creature.is_alive && <span className="text-[10px]">💀</span>}
                    {creature.is_aggressive && <span className="text-[10px]" title="Aggressive">⚔️</span>}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5">
                    <span className="text-xs text-muted-foreground">
                      📍 {getNodeName(creature.node_id)}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      HP {creature.hp}/{creature.max_hp} | AC {creature.ac}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      ⏱ {formatRespawn(creature.respawn_seconds)}
                    </span>
                    {(creature.loot_table?.length || 0) > 0 && (
                      <span className="text-[10px] text-chart-2">
                        {creature.loot_table.length} loot entries
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex gap-1 shrink-0 ml-2">
                  <Button size="sm" variant="outline" onClick={() => openEdit(creature)} className="h-7 w-7 p-0">
                    <Pencil className="w-3 h-3" />
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => handleDelete(creature.id)} className="h-7 w-7 p-0">
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={v => !v && setDialogOpen(false)}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto bg-card border-border">
          <DialogHeader>
            <DialogTitle className="font-display text-primary text-glow">
              {editingId ? 'Edit Creature' : 'New Creature'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <Input placeholder="Creature name" value={form.name} maxLength={100}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />

            <Textarea placeholder="Description" value={form.description} maxLength={500}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} />

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-muted-foreground">Rarity</label>
                <Select value={form.rarity} onValueChange={v => setForm(f => ({ ...f, rarity: v }))}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-popover border-border z-50">
                    {RARITIES.map(r => (
                      <SelectItem key={r} value={r} className="capitalize text-xs">
                        <span className={RARITY_COLORS[r]}>{r}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground">Level</label>
                <Input type="number" min={1} max={40} value={form.level}
                  onChange={e => setForm(f => ({ ...f, level: Math.max(1, Math.min(40, +e.target.value)) }))}
                  className="h-8 text-xs" />
              </div>
            </div>

            {/* Spawn Location */}
            <div>
              <label className="text-[10px] text-muted-foreground">Spawn Location</label>
              <Select value={form.node_id || 'none'} onValueChange={v => setForm(f => ({ ...f, node_id: v === 'none' ? null : v }))}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select node" /></SelectTrigger>
                <SelectContent className="bg-popover border-border z-50 max-h-60">
                  <SelectItem value="none" className="text-xs text-muted-foreground">Unassigned</SelectItem>
                  {nodes.map(n => (
                    <SelectItem key={n.id} value={n.id} className="text-xs">
                      {n.name} <span className="text-muted-foreground ml-1">({n.region_name})</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-muted-foreground">Respawn Timer (seconds)</label>
                <div className="flex items-center gap-1">
                  <Input type="number" min={0} value={form.respawn_seconds}
                    onChange={e => setForm(f => ({ ...f, respawn_seconds: Math.max(0, +e.target.value) }))}
                    className="h-8 text-xs" />
                  <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                    ({formatRespawn(form.respawn_seconds)})
                  </span>
                </div>
              </div>
              <div className="flex items-end pb-1">
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input type="checkbox" checked={form.is_aggressive}
                    onChange={e => setForm(f => ({ ...f, is_aggressive: e.target.checked }))} />
                  Aggressive
                </label>
              </div>
            </div>

            {/* Auto-generated stats preview */}
            <div className="p-2 bg-background/50 rounded border border-border">
              <p className="text-[10px] text-muted-foreground mb-1">
                Auto-generated stats (Lvl {form.level} {form.rarity})
              </p>
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

            {/* Loot Table */}
            <ItemPickerList label="Loot Table" value={form.loot_table}
              onChange={v => setForm(f => ({ ...f, loot_table: v }))} />

            <div className="flex gap-2 pt-2">
              <Button onClick={handleSave} disabled={loading} className="font-display text-xs">
                <Save className="w-3 h-3 mr-1" /> {editingId ? 'Update' : 'Create'}
              </Button>
              <Button variant="outline" onClick={() => setDialogOpen(false)} className="font-display text-xs">
                <X className="w-3 h-3 mr-1" /> Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
