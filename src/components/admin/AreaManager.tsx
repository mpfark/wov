import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Plus, Save, Trash2, Pencil, X } from 'lucide-react';
import { AREA_TYPES, type AreaType, type Area } from '@/hooks/useNodes';

interface Region {
  id: string;
  name: string;
  min_level: number;
  max_level: number;
}

interface Props {
  onDataChanged?: () => void;
}

const AREA_TYPE_EMOJI: Record<AreaType, string> = {
  forest: '🌲', town: '🏘️', cave: '🕳️', ruins: '🏚️', plains: '🌾',
  mountain: '⛰️', swamp: '🌿', desert: '🏜️', coast: '🌊', dungeon: '⚔️', other: '📍',
};

export default function AreaManager({ onDataChanged }: Props) {
  const [areas, setAreas] = useState<Area[]>([]);
  const [regions, setRegions] = useState<Region[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', description: '', region_id: '', area_type: 'other' as AreaType });
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [filterRegionId, setFilterRegionId] = useState<string>('');

  const load = async () => {
    const [aRes, rRes] = await Promise.all([
      supabase.from('areas').select('*').order('name'),
      supabase.from('regions').select('id, name, min_level, max_level').order('min_level'),
    ]);
    setAreas((aRes.data || []) as unknown as Area[]);
    setRegions(rRes.data || []);
  };

  useEffect(() => { load(); }, []);

  const startCreate = () => {
    setEditingId(null);
    setForm({ name: '', description: '', region_id: regions[0]?.id || '', area_type: 'other' });
    setCreating(true);
  };

  const startEdit = (area: Area) => {
    setCreating(false);
    setEditingId(area.id);
    setForm({ name: area.name, description: area.description, region_id: area.region_id, area_type: area.area_type });
  };

  const cancel = () => { setCreating(false); setEditingId(null); };

  const save = async () => {
    if (!form.name.trim()) return toast.error('Name is required');
    if (!form.region_id) return toast.error('Select a region');
    setSaving(true);

    if (creating) {
      const { error } = await supabase.from('areas').insert({
        name: form.name.trim(),
        description: form.description.trim(),
        region_id: form.region_id,
        area_type: form.area_type,
      } as any);
      if (error) { toast.error(error.message); setSaving(false); return; }
      toast.success('Area created');
    } else if (editingId) {
      const { error } = await supabase.from('areas').update({
        name: form.name.trim(),
        description: form.description.trim(),
        region_id: form.region_id,
        area_type: form.area_type,
      } as any).eq('id', editingId);
      if (error) { toast.error(error.message); setSaving(false); return; }
      toast.success('Area updated');
    }

    setSaving(false);
    cancel();
    load();
    onDataChanged?.();
  };

  const deleteArea = async (id: string, name: string) => {
    if (!window.confirm(`Delete area "${name}"? Nodes will keep their area_id but it won't resolve.`)) return;
    const { error } = await supabase.from('areas').delete().eq('id', id);
    if (error) return toast.error(error.message);
    toast.success('Area deleted');
    if (editingId === id) cancel();
    load();
    onDataChanged?.();
  };

  const filteredAreas = filterRegionId ? areas.filter(a => a.region_id === filterRegionId) : areas;
  const getRegionName = (id: string) => regions.find(r => r.id === id)?.name || '?';

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-border bg-card/30 flex items-center gap-2 shrink-0">
        <h2 className="font-display text-sm text-primary">Areas</h2>
        <span className="text-xs text-muted-foreground">{areas.length} total</span>
        <div className="flex-1" />
        <Select value={filterRegionId} onValueChange={setFilterRegionId}>
          <SelectTrigger className="h-7 text-xs w-44"><SelectValue placeholder="All regions" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">All regions</SelectItem>
            {regions.map(r => (
              <SelectItem key={r.id} value={r.id} className="text-xs">{r.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" onClick={startCreate} className="font-display text-xs h-7">
          <Plus className="w-3 h-3 mr-1" /> New Area
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-2">
          {/* Create / Edit form */}
          {(creating || editingId) && (
            <div className="p-3 rounded border border-primary/50 bg-primary/5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-display text-xs text-primary">{creating ? 'New Area' : 'Edit Area'}</span>
                <Button variant="ghost" size="sm" onClick={cancel} className="h-5 w-5 p-0"><X className="w-3 h-3" /></Button>
              </div>
              <Input placeholder="Area name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="h-8 text-xs" />
              <Textarea placeholder="Shared description for all nodes in this area" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} className="text-xs" />
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-muted-foreground">Region</label>
                  <Select value={form.region_id} onValueChange={v => setForm(f => ({ ...f, region_id: v }))}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {regions.map(r => (
                        <SelectItem key={r.id} value={r.id} className="text-xs">{r.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground">Type</label>
                  <Select value={form.area_type} onValueChange={v => setForm(f => ({ ...f, area_type: v as AreaType }))}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {AREA_TYPES.map(t => (
                        <SelectItem key={t} value={t} className="text-xs">{AREA_TYPE_EMOJI[t]} {t}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button onClick={save} disabled={saving} className="font-display text-xs">
                <Save className="w-3 h-3 mr-1" /> {creating ? 'Create' : 'Save'}
              </Button>
            </div>
          )}

          {/* Area list */}
          {filteredAreas.length === 0 && !creating && (
            <p className="text-xs text-muted-foreground italic text-center py-8">No areas yet. Create one to group nodes.</p>
          )}
          {filteredAreas.map(area => (
            <div key={area.id} className={`p-2.5 rounded border ${editingId === area.id ? 'border-primary/50 bg-primary/5' : 'border-border bg-background/40'}`}>
              <div className="flex items-center gap-2">
                <span className="text-sm">{AREA_TYPE_EMOJI[area.area_type]}</span>
                <span className="font-display text-sm flex-1 truncate">{area.name}</span>
                <Badge variant="outline" className="text-[9px] capitalize">{area.area_type}</Badge>
                <span className="text-[10px] text-muted-foreground">{getRegionName(area.region_id)}</span>
                <Button variant="ghost" size="sm" onClick={() => startEdit(area)} className="h-6 w-6 p-0">
                  <Pencil className="w-3 h-3" />
                </Button>
                <Button variant="ghost" size="sm" onClick={() => deleteArea(area.id, area.name)} className="h-6 w-6 p-0 text-destructive">
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
              {area.description && (
                <p className="text-[10px] text-muted-foreground mt-1 line-clamp-2">{area.description}</p>
              )}
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
