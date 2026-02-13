import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Pencil, Trash2, X, Check } from 'lucide-react';

interface RoadmapItem {
  id: string;
  title: string;
  description: string;
  category: string;
  is_done: boolean;
  sort_order: number;
  created_at: string;
}

const CATEGORIES = ['Combat', 'Classes', 'Analytics', 'NPCs', 'Quests', 'Mechanics', 'Items', 'UI', 'Admin', 'General'];

const CATEGORY_COLORS: Record<string, string> = {
  Combat: 'bg-red-900/60 text-red-200 border-red-700',
  Classes: 'bg-purple-900/60 text-purple-200 border-purple-700',
  Analytics: 'bg-cyan-900/60 text-cyan-200 border-cyan-700',
  NPCs: 'bg-green-900/60 text-green-200 border-green-700',
  Quests: 'bg-yellow-900/60 text-yellow-200 border-yellow-700',
  Mechanics: 'bg-orange-900/60 text-orange-200 border-orange-700',
  Items: 'bg-amber-900/60 text-amber-200 border-amber-700',
  UI: 'bg-blue-900/60 text-blue-200 border-blue-700',
  Admin: 'bg-indigo-900/60 text-indigo-200 border-indigo-700',
  General: 'bg-muted text-muted-foreground border-border',
};

export default function RoadmapManager() {
  const [items, setItems] = useState<RoadmapItem[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('General');
  const [filterCat, setFilterCat] = useState<string>('all');

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('roadmap_items')
      .select('*')
      .order('is_done')
      .order('sort_order')
      .order('created_at');
    setItems((data as RoadmapItem[]) || []);
  }, []);

  useEffect(() => { load(); }, [load]);

  const resetForm = () => {
    setTitle('');
    setDescription('');
    setCategory('General');
    setShowForm(false);
    setEditingId(null);
  };

  const startEdit = (item: RoadmapItem) => {
    setEditingId(item.id);
    setTitle(item.title);
    setDescription(item.description);
    setCategory(item.category);
    setShowForm(true);
  };

  const save = async () => {
    if (!title.trim()) return toast.error('Title required');
    if (editingId) {
      const { error } = await supabase.from('roadmap_items').update({ title, description, category }).eq('id', editingId);
      if (error) return toast.error(error.message);
      toast.success('Updated');
    } else {
      const maxOrder = items.reduce((m, i) => Math.max(m, i.sort_order), 0);
      const { error } = await supabase.from('roadmap_items').insert({ title, description, category, sort_order: maxOrder + 1 });
      if (error) return toast.error(error.message);
      toast.success('Added');
    }
    resetForm();
    load();
  };

  const toggleDone = async (item: RoadmapItem) => {
    await supabase.from('roadmap_items').update({ is_done: !item.is_done }).eq('id', item.id);
    load();
  };

  const deleteItem = async (id: string) => {
    if (!confirm('Delete this roadmap entry?')) return;
    await supabase.from('roadmap_items').delete().eq('id', id);
    toast.success('Deleted');
    load();
  };

  const filtered = filterCat === 'all' ? items : items.filter(i => i.category === filterCat);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-card/30 shrink-0 flex-wrap">
        <h2 className="font-display text-sm text-primary">Roadmap</h2>
        <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => { resetForm(); setShowForm(!showForm); }}>
          <Plus className="w-3 h-3 mr-1" /> Add Entry
        </Button>
        <Select value={filterCat} onValueChange={setFilterCat}>
          <SelectTrigger className="w-32 h-7 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground ml-auto">
          {items.filter(i => i.is_done).length}/{items.length} done
        </span>
      </div>

      {/* Add / Edit form */}
      {showForm && (
        <div className="px-4 py-3 border-b border-border bg-card/50 space-y-2 shrink-0">
          <Input placeholder="Title" value={title} onChange={e => setTitle(e.target.value)} className="h-8 text-xs" />
          <Textarea placeholder="Description" value={description} onChange={e => setDescription(e.target.value)} className="text-xs min-h-[60px]" />
          <div className="flex items-center gap-2">
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="w-36 h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button size="sm" className="h-7 text-xs" onClick={save}>
              <Check className="w-3 h-3 mr-1" /> {editingId ? 'Update' : 'Save'}
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={resetForm}>
              <X className="w-3 h-3" />
            </Button>
          </div>
        </div>
      )}

      {/* Item list */}
      <div className="flex-1 overflow-y-auto px-4 py-2 space-y-1">
        {filtered.map(item => (
          <div
            key={item.id}
            className={`flex items-start gap-2 p-2 rounded border border-border/50 ${item.is_done ? 'opacity-50' : ''}`}
          >
            <Checkbox
              checked={item.is_done}
              onCheckedChange={() => toggleDone(item)}
              className="mt-0.5"
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`font-display text-xs ${item.is_done ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
                  {item.title}
                </span>
                <Badge className={`text-[10px] px-1.5 py-0 ${CATEGORY_COLORS[item.category] || CATEGORY_COLORS.General}`}>
                  {item.category}
                </Badge>
              </div>
              {item.description && (
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{item.description}</p>
              )}
            </div>
            <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0" onClick={() => startEdit(item)}>
              <Pencil className="w-3 h-3" />
            </Button>
            <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0 text-destructive" onClick={() => deleteItem(item.id)}>
              <Trash2 className="w-3 h-3" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
