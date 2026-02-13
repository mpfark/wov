import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Plus, Trash2, Save, X, Package } from 'lucide-react';

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
  hands: number | null;
}

const RARITIES = ['common', 'uncommon', 'rare', 'unique'];
const SLOTS = ['head', 'amulet', 'shoulders', 'chest', 'gloves', 'belt', 'pants', 'ring', 'trinket', 'main_hand', 'off_hand', 'boots'];
const ITEM_TYPES = ['equipment', 'consumable', 'material', 'quest', 'shield'];
const STAT_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha', 'ac', 'hp'];

const RARITY_COLORS: Record<string, string> = {
  common: 'text-foreground',
  uncommon: 'text-chart-2',
  rare: 'text-dwarvish',
  unique: 'text-primary text-glow',
};

const defaultForm = (): Omit<Item, 'id'> => ({
  name: '', description: '', item_type: 'equipment', rarity: 'common',
  slot: null, stats: {}, value: 0, max_durability: 100, hands: null,
});

export default function ItemManager() {
  const [items, setItems] = useState<Item[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [form, setForm] = useState(defaultForm());
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(false);

  const loadItems = async () => {
    const { data } = await supabase.from('items').select('*').order('name');
    if (data) setItems(data as Item[]);
  };

  useEffect(() => { loadItems(); }, []);

  const openNew = () => {
    setSelectedId(null);
    setIsNew(true);
    setForm(defaultForm());
  };

  const openEdit = (item: Item) => {
    setSelectedId(item.id);
    setIsNew(false);
    setForm({
      name: item.name, description: item.description, item_type: item.item_type,
      rarity: item.rarity, slot: item.slot, stats: { ...item.stats },
      value: item.value, max_durability: item.max_durability, hands: item.hands,
    });
  };

  const closePanel = () => {
    setSelectedId(null);
    setIsNew(false);
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
      slot: (form.item_type === 'equipment' || form.item_type === 'shield') ? form.slot as any : null,
      stats: form.stats,
      value: Math.max(0, form.value),
      max_durability: Math.max(1, form.max_durability),
      hands: (form.item_type === 'equipment' && (form.slot === 'main_hand' || form.slot === 'off_hand')) || form.item_type === 'shield' ? form.hands : null,
    };

    if (selectedId) {
      const { error } = await supabase.from('items').update(payload).eq('id', selectedId);
      if (error) { toast.error(error.message); setLoading(false); return; }
      toast.success('Item updated');
    } else {
      const { data, error } = await supabase.from('items').insert(payload).select().single();
      if (error) { toast.error(error.message); setLoading(false); return; }
      toast.success('Item created');
      if (data) { setSelectedId(data.id); setIsNew(false); }
    }
    setLoading(false);
    loadItems();
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from('items').delete().eq('id', id);
    if (error) return toast.error(error.message);
    toast.success('Item deleted');
    if (selectedId === id) closePanel();
    loadItems();
  };

  const setStat = (key: string, val: number) => {
    setForm(f => {
      const stats = { ...f.stats };
      if (val === 0) { delete stats[key]; } else { stats[key] = val; }
      return { ...f, stats };
    });
  };

  const panelOpen = isNew || selectedId !== null;

  const filtered = items.filter(i =>
    i.name.toLowerCase().includes(filter.toLowerCase()) ||
    i.rarity.includes(filter.toLowerCase()) ||
    i.item_type.includes(filter.toLowerCase())
  );

  return (
    <div className="h-full flex">
      {/* Left: Item List */}
      <div className="flex flex-col w-1/2 border-r border-border transition-all">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
          <Package className="w-4 h-4 text-primary" />
          <h2 className="font-display text-sm text-primary">Items</h2>
          <span className="text-xs text-muted-foreground">({items.length})</span>
          <div className="flex-1" />
          <Input placeholder="Search..." value={filter} onChange={e => setFilter(e.target.value)} className="w-36 h-7 text-xs" />
          <Button size="sm" onClick={openNew} className="font-display text-xs h-7">
            <Plus className="w-3 h-3 mr-1" /> New
          </Button>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-3 space-y-1.5">
            {filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8 italic">
                {items.length === 0 ? 'No items yet.' : 'No match.'}
              </p>
            ) : filtered.map(item => (
              <div
                key={item.id}
                className={`flex items-center justify-between p-2 rounded border transition-colors cursor-pointer ${
                  selectedId === item.id ? 'border-primary bg-primary/10' : 'border-border bg-card/50 hover:bg-card/80'
                }`}
                onClick={() => openEdit(item)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`font-display text-sm ${RARITY_COLORS[item.rarity]}`}>{item.name}</span>
                    <span className="text-[10px] text-muted-foreground capitalize px-1 py-0.5 rounded bg-background/50 border border-border">{item.rarity}</span>
                    {item.slot && (
                      <span className="text-[10px] text-muted-foreground capitalize px-1 py-0.5 rounded bg-background/50 border border-border">{item.slot.replace('_', ' ')}</span>
                    )}
                    <span className="text-[10px] text-muted-foreground">{item.item_type}</span>
                  </div>
                  <div className="flex items-center gap-3 mt-0.5">
                    <span className="text-[10px] text-primary shrink-0">{item.value}g</span>
                    <span className="text-[10px] text-muted-foreground shrink-0">Dur: {item.max_durability}</span>
                    {item.hands && <span className="text-[10px] text-muted-foreground shrink-0">{item.hands}H</span>}
                    {Object.entries(item.stats || {}).map(([k, v]) => (
                      <span key={k} className="text-[10px] text-chart-2 shrink-0">+{v} {k.toUpperCase()}</span>
                    ))}
                  </div>
                </div>
                <Button size="sm" variant="destructive" onClick={(e) => { e.stopPropagation(); handleDelete(item.id); }} className="h-7 w-7 p-0 shrink-0 ml-2">
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            ))}
          </div>
        </ScrollArea>
      </div>

      {/* Right: Properties Panel */}
      <div className="w-1/2 flex flex-col bg-card/50">
        {panelOpen ? (
          <>
          <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
            <h2 className="font-display text-sm text-primary text-glow truncate">
              {selectedId ? `Edit: ${form.name || 'Item'}` : 'New Item'}
            </h2>
            <Button variant="ghost" size="sm" onClick={closePanel} className="h-6 w-6 p-0">
              <X className="w-4 h-4" />
            </Button>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-3 space-y-3">
              <Input placeholder="Item name" value={form.name} maxLength={100}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="h-8 text-xs" />
              <Textarea placeholder="Description" value={form.description} maxLength={500}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} className="text-xs" />

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-muted-foreground">Type</label>
                  <Select value={form.item_type} onValueChange={v => setForm(f => ({ ...f, item_type: v, slot: v === 'shield' ? 'off_hand' : f.slot, hands: v === 'shield' ? 1 : f.hands }))}>
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

              {(form.item_type === 'equipment' || form.item_type === 'shield') && (
                <div>
                  <label className="text-[10px] text-muted-foreground">Equipment Slot</label>
                  <Select value={form.slot || ''} onValueChange={v => setForm(f => ({ ...f, slot: v || null }))}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select slot" /></SelectTrigger>
                    <SelectContent className="bg-popover border-border z-50">
                      {(form.item_type === 'shield' ? ['off_hand'] : SLOTS).map(s => (
                        <SelectItem key={s} value={s} className="capitalize text-xs">{s.replace('_', ' ')}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {form.item_type === 'equipment' && (form.slot === 'main_hand' || form.slot === 'off_hand') && (
                <div>
                  <label className="text-[10px] text-muted-foreground">Hands Required</label>
                  <Select value={String(form.hands || 1)} onValueChange={v => setForm(f => ({ ...f, hands: +v }))}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent className="bg-popover border-border z-50">
                      <SelectItem value="1" className="text-xs">One-Handed</SelectItem>
                      <SelectItem value="2" className="text-xs">Two-Handed</SelectItem>
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

              <div>
                <label className="text-[10px] text-muted-foreground">Stat Bonuses</label>
                <div className="grid grid-cols-4 gap-1.5 mt-1">
                  {STAT_KEYS.map(key => (
                    <div key={key} className="flex items-center gap-1">
                      <span className="text-[10px] text-muted-foreground uppercase w-6">{key}</span>
                      <Input type="number" min={0} max={99}
                        value={form.stats[key] || 0}
                        onChange={e => setStat(key, Math.max(0, +e.target.value))}
                        className="h-7 text-xs text-center" />
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <Button onClick={handleSave} disabled={loading} className="font-display text-xs">
                  <Save className="w-3 h-3 mr-1" /> {selectedId ? 'Update' : 'Create'}
                </Button>
                <Button variant="outline" onClick={closePanel} className="font-display text-xs">
                  <X className="w-3 h-3 mr-1" /> Cancel
                </Button>
              </div>
            </div>
          </ScrollArea>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground/50 text-sm italic font-display">
            Select an item to edit
          </div>
        )}
      </div>
    </div>
  );
}
