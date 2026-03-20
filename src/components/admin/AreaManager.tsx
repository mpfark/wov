import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Plus, Save, Trash2, Pencil, X, Sparkles, Loader2, Settings } from 'lucide-react';
import { type Area } from '@/hooks/useNodes';
import { useAreaTypes } from '@/hooks/useAreaTypes';

interface Region {
  id: string;
  name: string;
  min_level: number;
  max_level: number;
}

interface Props {
  onDataChanged?: () => void;
}

export default function AreaManager({ onDataChanged }: Props) {
  const [areas, setAreas] = useState<Area[]>([]);
  const [regions, setRegions] = useState<Region[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', description: '', region_id: '', area_type: 'other', min_level: 0, max_level: 0, creature_types: '', flavor_text: '' });
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [filterRegionId, setFilterRegionId] = useState<string>('');
  const [aiLoading, setAiLoading] = useState(false);

  // Area types
  const { areaTypes, emojiMap, refetch: refetchTypes } = useAreaTypes();
  const [typeDialogOpen, setTypeDialogOpen] = useState(false);
  const [typeForm, setTypeForm] = useState({ name: '', emoji: '📍' });
  const [editingType, setEditingType] = useState<string | null>(null);
  const [typeSaving, setTypeSaving] = useState(false);

  const aiSuggest = async () => {
    if (!form.region_id) return toast.error('Select a region first');
    setAiLoading(true);
    try {
      const region = regions.find(r => r.id === form.region_id);
      const existingAreas = areas.filter(a => a.region_id === form.region_id).map(a => a.name).join(', ');
      const { data, error } = await supabase.functions.invoke('ai-name-suggest', {
        body: {
          type: 'area',
          context: {
            area_type: form.area_type,
            region_name: region?.name || '',
            min_level: region?.min_level,
            max_level: region?.max_level,
            existing_areas: existingAreas || 'none',
          },
        },
      });
      if (error) throw error;
      setForm(prev => ({ ...prev, name: data.name, description: data.description }));
      toast.success('AI suggestion applied');
    } catch (e: any) {
      toast.error(e.message || 'AI suggestion failed');
    } finally {
      setAiLoading(false);
    }
  };

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

  /* ── Area Type Management ── */
  const openTypeCreate = () => {
    setEditingType(null);
    setTypeForm({ name: '', emoji: '📍' });
    setTypeDialogOpen(true);
  };

  const openTypeEdit = (t: { name: string; emoji: string }) => {
    setEditingType(t.name);
    setTypeForm({ name: t.name, emoji: t.emoji });
    setTypeDialogOpen(true);
  };

  const saveType = async () => {
    if (!typeForm.name.trim()) return toast.error('Name is required');
    setTypeSaving(true);
    if (editingType) {
      // Update existing
      if (editingType !== typeForm.name.trim()) {
        // Name changed: insert new, update areas, delete old
        const { error: insertErr } = await supabase.from('area_types').insert({ name: typeForm.name.trim().toLowerCase(), emoji: typeForm.emoji } as any);
        if (insertErr) { toast.error(insertErr.message); setTypeSaving(false); return; }
        await supabase.from('areas').update({ area_type: typeForm.name.trim().toLowerCase() } as any).eq('area_type', editingType);
        await supabase.from('area_types').delete().eq('name', editingType);
      } else {
        const { error } = await supabase.from('area_types').update({ emoji: typeForm.emoji } as any).eq('name', editingType);
        if (error) { toast.error(error.message); setTypeSaving(false); return; }
      }
      toast.success('Type updated');
    } else {
      const { error } = await supabase.from('area_types').insert({ name: typeForm.name.trim().toLowerCase(), emoji: typeForm.emoji } as any);
      if (error) { toast.error(error.message); setTypeSaving(false); return; }
      toast.success('Type created');
    }
    setTypeSaving(false);
    setTypeDialogOpen(false);
    refetchTypes();
  };

  const deleteType = async (name: string) => {
    const usageCount = areas.filter(a => a.area_type === name).length;
    const msg = usageCount > 0
      ? `Type "${name}" is used by ${usageCount} area${usageCount > 1 ? 's' : ''}. Deleting it will remove it from dropdowns but those areas will keep the value. Continue?`
      : `Delete type "${name}"?`;
    if (!window.confirm(msg)) return;
    const { error } = await supabase.from('area_types').delete().eq('name', name);
    if (error) return toast.error(error.message);
    toast.success('Type deleted');
    refetchTypes();
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
        <Button variant="outline" size="sm" onClick={() => setTypeDialogOpen(true)} className="font-display text-xs h-7" title="Manage area types">
          <Settings className="w-3 h-3 mr-1" /> Types
        </Button>
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
              <div className="flex gap-2">
                <Textarea placeholder="Shared description for all nodes in this area" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} className="text-xs flex-1" />
                <Button variant="outline" size="sm" onClick={aiSuggest} disabled={aiLoading} title="AI Suggest name & description" className="h-8 shrink-0">
                  {aiLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                </Button>
              </div>
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
                  <Select value={form.area_type} onValueChange={v => setForm(f => ({ ...f, area_type: v }))}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {areaTypes.map(t => (
                        <SelectItem key={t.name} value={t.name} className="text-xs">{t.emoji} {t.name}</SelectItem>
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
                <span className="text-sm">{emojiMap[area.area_type] || '📍'}</span>
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

      {/* Area Types Management Dialog */}
      <Dialog open={typeDialogOpen} onOpenChange={setTypeDialogOpen}>
        <DialogContent className="bg-card border-border max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-display text-primary text-sm">Manage Area Types</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {/* Existing types */}
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {areaTypes.map(t => (
                <div key={t.name} className="flex items-center gap-2 p-1.5 rounded border border-border bg-background/40">
                  <span className="text-sm">{t.emoji}</span>
                  <span className="text-xs flex-1 capitalize">{t.name}</span>
                  <Button variant="ghost" size="sm" onClick={() => openTypeEdit(t)} className="h-5 w-5 p-0">
                    <Pencil className="w-2.5 h-2.5" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => deleteType(t.name)} className="h-5 w-5 p-0 text-destructive">
                    <Trash2 className="w-2.5 h-2.5" />
                  </Button>
                </div>
              ))}
            </div>

            {/* Add/Edit form */}
            <div className="border-t border-border pt-3 space-y-2">
              <span className="font-display text-xs text-muted-foreground">{editingType ? 'Edit Type' : 'New Type'}</span>
              <div className="flex gap-2">
                <Input placeholder="Emoji" value={typeForm.emoji} onChange={e => setTypeForm(f => ({ ...f, emoji: e.target.value }))} className="h-8 text-xs w-16" maxLength={4} />
                <Input placeholder="Type name" value={typeForm.name} onChange={e => setTypeForm(f => ({ ...f, name: e.target.value }))} className="h-8 text-xs flex-1" />
              </div>
              <div className="flex gap-2">
                <Button onClick={saveType} disabled={typeSaving} className="font-display text-xs flex-1">
                  <Save className="w-3 h-3 mr-1" /> {editingType ? 'Save' : 'Add Type'}
                </Button>
                {editingType && (
                  <Button variant="outline" onClick={openTypeCreate} className="font-display text-xs">
                    <Plus className="w-3 h-3 mr-1" /> New
                  </Button>
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
