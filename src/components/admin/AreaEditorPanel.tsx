import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Sparkles, Loader2, Trash2 } from 'lucide-react';
import { useAreaTypes } from '@/features/world';
import IllustrationEditor from './IllustrationEditor';
import { AdminEditorHeader, AdminFormSection, AdminStickyActions } from './common';

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
  const [form, setForm] = useState({ name: '', description: '', region_id: '', area_type: 'other', min_level: 0, max_level: 0, creature_types: '', flavor_text: '', illustration_url: '', illustration_metadata: {} as Record<string, string> });
  const [aiLoading, setAiLoading] = useState(false);

  useEffect(() => {
    if (isNew) {
      setForm({ name: '', description: '', region_id: initialRegionId || regions[0]?.id || '', area_type: 'other', min_level: 0, max_level: 0, creature_types: '', flavor_text: '', illustration_url: '', illustration_metadata: {} });
    } else if (areaId) {
      const area = areas.find(a => a.id === areaId);
      if (area) {
        setForm({ name: area.name, description: area.description, region_id: area.region_id, area_type: area.area_type, min_level: area.min_level ?? 0, max_level: area.max_level ?? 0, creature_types: area.creature_types ?? '', flavor_text: area.flavor_text ?? '', illustration_url: area.illustration_url || '', illustration_metadata: area.illustration_metadata || {} });
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
            creature_types: form.creature_types || undefined,
            flavor_text: form.flavor_text || undefined,
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

    const payload = {
      name: form.name.trim(),
      description: form.description.trim(),
      region_id: form.region_id,
      area_type: form.area_type,
      min_level: form.min_level,
      max_level: form.max_level,
      creature_types: form.creature_types.trim(),
      flavor_text: form.flavor_text.trim(),
      illustration_url: form.illustration_url,
      illustration_metadata: form.illustration_metadata,
    } as any;

    if (isNew) {
      const { error } = await supabase.from('areas').insert(payload);
      if (error) return toast.error(error.message);
      toast.success('Area created');
    } else if (areaId) {
      const { error } = await supabase.from('areas').update(payload).eq('id', areaId);
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

  const deleteButton = !isNew && areaId ? (
    <Button variant="destructive" onClick={handleDelete} className="font-display text-xs">
      <Trash2 className="w-3 h-3 mr-1" /> Delete
    </Button>
  ) : undefined;

  return (
    <div className="h-full flex flex-col bg-card border-l border-border">
      <AdminEditorHeader title={isNew ? 'New Area' : 'Edit Area'} onClose={onClose} />
      <ScrollArea className="flex-1">
        <div className="p-3 space-y-3">
          <AdminFormSection title="Identity">
            <div>
              <label className="text-[10px] text-muted-foreground mb-1 block">Name</label>
              <div className="flex gap-2">
                <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="flex-1" />
                <Button variant="outline" size="sm" onClick={aiSuggest} disabled={aiLoading} title="AI Suggest">
                  {aiLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                </Button>
              </div>
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground mb-1 block">Description</label>
              <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={4} />
            </div>
          </AdminFormSection>

          <AdminFormSection title="Region & Type">
            <div>
              <label className="text-[10px] text-muted-foreground mb-1 block">Region</label>
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
              <label className="text-[10px] text-muted-foreground mb-1 block">Type</label>
              <Select value={form.area_type} onValueChange={v => setForm(f => ({ ...f, area_type: v }))}>
                <SelectTrigger className="text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {areaTypes.map(t => (
                    <SelectItem key={t.name} value={t.name} className="text-xs">{t.emoji} {t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </AdminFormSection>

          <AdminFormSection title="Level Range">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-muted-foreground mb-1 block">Min Level</label>
                <Input type="number" min={0} max={99} value={form.min_level} onChange={e => setForm(f => ({ ...f, min_level: parseInt(e.target.value) || 0 }))} className="text-xs" />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground mb-1 block">Max Level</label>
                <Input type="number" min={0} max={99} value={form.max_level} onChange={e => setForm(f => ({ ...f, max_level: parseInt(e.target.value) || 0 }))} className="text-xs" />
              </div>
            </div>
          </AdminFormSection>

          <AdminFormSection title="Content Hints">
            <div>
              <label className="text-[10px] text-muted-foreground mb-1 block">Creature Types</label>
              <Input placeholder="e.g. undead, wolves, bandits" value={form.creature_types} onChange={e => setForm(f => ({ ...f, creature_types: e.target.value }))} className="text-xs" />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground mb-1 block">Flavor Text</label>
              <Textarea placeholder="Atmospheric hints for AI generation..." value={form.flavor_text} onChange={e => setForm(f => ({ ...f, flavor_text: e.target.value }))} rows={3} className="text-xs" />
            </div>
          </AdminFormSection>

          <AdminFormSection title="Illustration">
            <IllustrationEditor
              illustrationUrl={form.illustration_url}
              onUrlChange={url => setForm(f => ({ ...f, illustration_url: url }))}
              metadata={form.illustration_metadata}
              onMetadataChange={m => setForm(f => ({ ...f, illustration_metadata: m }))}
              inheritedUrl={(() => {
                const region = regions.find(r => r.id === form.region_id);
                return (region as any)?.illustration_url || '';
              })()}
              inheritedSource={(() => {
                const region = regions.find(r => r.id === form.region_id);
                return (region as any)?.illustration_url ? 'Region' : '';
              })()}
            />
          </AdminFormSection>

          <AdminStickyActions
            onSave={save}
            onCancel={onClose}
            saveLabel={isNew ? 'Create Area' : 'Save Changes'}
            extraActions={deleteButton}
          />
        </div>
      </ScrollArea>
    </div>
  );
}
