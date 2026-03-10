import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { X, Save, Sparkles, Loader2, Trash2 } from 'lucide-react';
import { useAreaTypes } from '@/hooks/useAreaTypes';

interface Region {
  id: string;
  name: string;
  min_level: number;
  max_level: number;
}

interface Props {
  areaId: string | null;
  isNew?: boolean;
  regions: Region[];
  areas: any[];
  initialRegionId?: string;
  onClose: () => void;
  onSaved: () => void;
  onDeleted?: (id: string) => void;
}

export default function AreaEditorPanel({ areaId, isNew, regions, areas, initialRegionId, onClose, onSaved, onDeleted }: Props) {
  const { areaTypes } = useAreaTypes();
  const [form, setForm] = useState({ name: '', description: '', region_id: '', area_type: 'other' });
  const [aiLoading, setAiLoading] = useState(false);

  useEffect(() => {
    if (isNew) {
      setForm({ name: '', description: '', region_id: initialRegionId || regions[0]?.id || '', area_type: 'other' });
    } else if (areaId) {
      const area = areas.find(a => a.id === areaId);
      if (area) {
        setForm({ name: area.name, description: area.description, region_id: area.region_id, area_type: area.area_type });
      }
    }
  }, [areaId, isNew, initialRegionId]);

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

  const save = async () => {
    if (!form.name.trim()) return toast.error('Name is required');
    if (!form.region_id) return toast.error('Select a region');

    if (isNew) {
      const { error } = await supabase.from('areas').insert({
        name: form.name.trim(),
        description: form.description.trim(),
        region_id: form.region_id,
        area_type: form.area_type,
      } as any);
      if (error) return toast.error(error.message);
      toast.success('Area created');
    } else if (areaId) {
      const { error } = await supabase.from('areas').update({
        name: form.name.trim(),
        description: form.description.trim(),
        region_id: form.region_id,
        area_type: form.area_type,
      } as any).eq('id', areaId);
      if (error) return toast.error(error.message);
      toast.success('Area updated');
    }
    onSaved();
  };

  const handleDelete = async () => {
    if (!areaId) return;
    if (!window.confirm(`Delete area "${form.name}"?`)) return;
    const { error } = await supabase.from('areas').delete().eq('id', areaId);
    if (error) return toast.error(error.message);
    toast.success('Area deleted');
    onDeleted?.(areaId);
  };

  return (
    <div className="h-full flex flex-col bg-card border-l border-border">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <h3 className="font-display text-sm text-primary">{isNew ? 'New Area' : 'Edit Area'}</h3>
        <div className="flex items-center gap-1">
          {!isNew && areaId && (
            <Button variant="ghost" size="sm" onClick={handleDelete} className="h-6 w-6 p-0 text-destructive">
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onClose} className="h-6 w-6 p-0">
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-3 space-y-3">
          <div>
            <label className="text-xs text-muted-foreground font-display mb-1 block">Name</label>
            <div className="flex gap-2">
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="flex-1" />
              <Button variant="outline" size="sm" onClick={aiSuggest} disabled={aiLoading} title="AI Suggest">
                {aiLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              </Button>
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground font-display mb-1 block">Description</label>
            <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={4} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground font-display mb-1 block">Region</label>
            <Select value={form.region_id} onValueChange={v => setForm(f => ({ ...f, region_id: v }))}>
              <SelectTrigger className="text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {regions.map(r => (
                  <SelectItem key={r.id} value={r.id} className="text-xs">{r.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground font-display mb-1 block">Type</label>
            <Select value={form.area_type} onValueChange={v => setForm(f => ({ ...f, area_type: v }))}>
              <SelectTrigger className="text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {areaTypes.map(t => (
                  <SelectItem key={t.name} value={t.name} className="text-xs">{t.emoji} {t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={save} className="font-display text-xs w-full">
            <Save className="w-3 h-3 mr-1" /> {isNew ? 'Create Area' : 'Save Changes'}
          </Button>
        </div>
      </ScrollArea>
    </div>
  );
}
