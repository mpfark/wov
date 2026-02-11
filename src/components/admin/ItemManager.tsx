import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2, Save, X, Package } from 'lucide-react';

interface Item {
  id: string;
  name: string;
  description: string;
  item_type: string;
  rarity: string;
  slot: string | null;
  stats: Record<string, number>;
  value: number;
  max_durability: number;
}

const RARITIES = ['common', 'uncommon', 'rare', 'unique'];
const SLOTS = ['head', 'amulet', 'shoulders', 'chest', 'gloves', 'belt', 'pants', 'ring', 'trinket'];
const ITEM_TYPES = ['equipment', 'consumable', 'material', 'quest'];
const STAT_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha', 'ac', 'hp'];

const RARITY_COLORS: Record<string, string> = {
  common: 'text-foreground',
  uncommon: 'text-chart-2',
  rare: 'text-dwarvish',
  unique: 'text-primary text-glow',
};

const defaultForm = (): Omit<Item, 'id'> => ({
  name: '', description: '', item_type: 'equipment', rarity: 'common',
  slot: null, stats: {}, value: 0, max_durability: 100,
});

export default function ItemManager() {
  const [items, setItems] = useState<Item[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(defaultForm());
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(false);

  const loadItems = async () => {
    const { data } = await supabase.from('items').select('*').order('name');
    if (data) setItems(data as Item[]);
  };

  useEffect(() => { loadItems(); }, []);

  const openNew = () => {
    setEditingId(null);
    setForm(defaultForm());
    setDialogOpen(true);
  };

  const openEdit = (item: Item) => {
    setEditingId(item.id);
    setForm({
      name: item.name, description: item.description, item_type: item.item_type,
      rarity: item.rarity, slot: item.slot, stats: { ...item.stats },
      value: item.value, max_durability: item.max_durability,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return toast.error('Name is required');
    if (form.name.length > 100) return toast.error('Name must be under 100 characters');
    setLoading(true);

    const payload = {
      name: form.name.trim(),
      description: form.description.trim(),
      item_type: form.item_type,
      rarity: form.rarity as any,
      slot: form.item_type === 'equipment' ? form.slot as any : null,
      stats: form.stats,
      value: Math.max(0, form.value),
      max_durability: Math.max(1, form.max_durability),
    };

    if (editingId) {
      const { error } = await supabase.from('items').update(payload).eq('id', editingId);
      if (error) { toast.error(error.message); setLoading(false); return; }
      toast.success('Item updated');
    } else {
      const { error } = await supabase.from('items').insert(payload);
      if (error) { toast.error(error.message); setLoading(false); return; }
      toast.success('Item created');
    }
    setLoading(false);
    setDialogOpen(false);
    loadItems();
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from('items').delete().eq('id', id);
    if (error) return toast.error(error.message);
    toast.success('Item deleted');
    loadItems();
  };

  const setStat = (key: string, val: number) => {
    setForm(f => {
      const stats = { ...f.stats };
      if (val === 0) { delete stats[key]; } else { stats[key] = val; }
      return { ...f, stats };
    });
  };

  const filtered = items.filter(i =>
    i.name.toLowerCase().includes(filter.toLowerCase()) ||
    i.rarity.includes(filter.toLowerCase()) ||
    i.item_type.includes(filter.toLowerCase())
  );

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <Package className="w-4 h-4 text-primary" />
        <h2 className="font-display text-sm text-primary">Item Database</h2>
        <span className="text-xs text-muted-foreground">({items.length} items)</span>
        <div className="flex-1" />
        <Input
          placeholder="Search items..."
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className="w-48 h-7 text-xs"
        />
        <Button size="sm" onClick={openNew} className="font-display text-xs h-7">
          <Plus className="w-3 h-3 mr-1" /> New Item
        </Button>
      </div>

      {/* Item List */}
      <div className="flex-1 overflow-y-auto p-4">
        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8 italic">
            {items.length === 0 ? 'No items yet. Create your first item!' : 'No items match your search.'}
          </p>
        ) : (
          <div className="grid gap-2">
            {filtered.map(item => (
              <div key={item.id} className="flex items-center justify-between p-2.5 rounded border border-border bg-card/50 hover:bg-card/80 transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`font-display text-sm ${RARITY_COLORS[item.rarity]}`}>{item.name}</span>
                    <span className="text-[10px] text-muted-foreground capitalize px-1.5 py-0.5 rounded bg-background/50 border border-border">
                      {item.rarity}
                    </span>
                    {item.slot && (
                      <span className="text-[10px] text-muted-foreground capitalize px-1.5 py-0.5 rounded bg-background/50 border border-border">
                        {item.slot}
                      </span>
                    )}
                    <span className="text-[10px] text-muted-foreground">{item.item_type}</span>
                  </div>
                  <div className="flex items-center gap-3 mt-0.5">
                    {item.description && (
                      <span className="text-xs text-muted-foreground truncate max-w-xs">{item.description}</span>
                    )}
                    <span className="text-[10px] text-primary shrink-0">{item.value}g</span>
                    <span className="text-[10px] text-muted-foreground shrink-0">Dur: {item.max_durability}</span>
                    {Object.entries(item.stats || {}).map(([k, v]) => (
                      <span key={k} className="text-[10px] text-chart-2 shrink-0">+{v} {k.toUpperCase()}</span>
                    ))}
                  </div>
                </div>
                <div className="flex gap-1 shrink-0 ml-2">
                  <Button size="sm" variant="outline" onClick={() => openEdit(item)} className="h-7 w-7 p-0">
                    <Pencil className="w-3 h-3" />
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => handleDelete(item.id)} className="h-7 w-7 p-0">
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
              {editingId ? 'Edit Item' : 'New Item'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <Input placeholder="Item name" value={form.name} maxLength={100}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />

            <Textarea placeholder="Description" value={form.description} maxLength={500}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} />

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-muted-foreground">Type</label>
                <Select value={form.item_type} onValueChange={v => setForm(f => ({ ...f, item_type: v }))}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-popover border-border z-50">
                    {ITEM_TYPES.map(t => (
                      <SelectItem key={t} value={t} className="capitalize text-xs">{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
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
            </div>

            {form.item_type === 'equipment' && (
              <div>
                <label className="text-[10px] text-muted-foreground">Equipment Slot</label>
                <Select value={form.slot || ''} onValueChange={v => setForm(f => ({ ...f, slot: v || null }))}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select slot" /></SelectTrigger>
                  <SelectContent className="bg-popover border-border z-50">
                    {SLOTS.map(s => (
                      <SelectItem key={s} value={s} className="capitalize text-xs">{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-muted-foreground">Gold Value</label>
                <Input type="number" min={0} value={form.value}
                  onChange={e => setForm(f => ({ ...f, value: Math.max(0, +e.target.value) }))} className="h-8 text-xs" />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground">Max Durability</label>
                <Input type="number" min={1} value={form.max_durability}
                  onChange={e => setForm(f => ({ ...f, max_durability: Math.max(1, +e.target.value) }))} className="h-8 text-xs" />
              </div>
            </div>

            {/* Stats */}
            <div>
              <label className="text-[10px] text-muted-foreground">Stat Bonuses</label>
              <div className="grid grid-cols-4 gap-1.5 mt-1">
                {STAT_KEYS.map(key => (
                  <div key={key} className="flex items-center gap-1">
                    <span className="text-[10px] text-muted-foreground uppercase w-6">{key}</span>
                    <Input
                      type="number" min={0} max={99}
                      value={form.stats[key] || 0}
                      onChange={e => setStat(key, Math.max(0, +e.target.value))}
                      className="h-7 text-xs text-center"
                    />
                  </div>
                ))}
              </div>
            </div>

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
