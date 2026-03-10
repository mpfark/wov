import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { X, Save, Sparkles, Loader2 } from 'lucide-react';

interface Region {
  id: string;
  name: string;
  description: string;
  min_level: number;
  max_level: number;
}

interface Props {
  regionId: string;
  regions: Region[];
  onClose: () => void;
  onSaved: () => void;
}

export default function RegionEditorPanel({ regionId, regions, onClose, onSaved }: Props) {
  const region = regions.find(r => r.id === regionId);
  const [form, setForm] = useState({ name: '', description: '', min_level: 1, max_level: 10 });
  const [aiLoading, setAiLoading] = useState(false);

  useEffect(() => {
    if (region) {
      setForm({
        name: region.name,
        description: region.description,
        min_level: region.min_level,
        max_level: region.max_level,
      });
    }
  }, [regionId, region]);

  const aiSuggest = async () => {
    setAiLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('ai-name-suggest', {
        body: {
          type: 'region',
          context: {
            min_level: form.min_level,
            max_level: form.max_level,
            existing_regions: regions.map(r => r.name).join(', '),
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
    if (!form.name) return toast.error('Name required');
    const { error } = await supabase.from('regions').update({
      name: form.name,
      description: form.description,
      min_level: form.min_level,
      max_level: form.max_level,
    }).eq('id', regionId);
    if (error) return toast.error(error.message);
    toast.success('Region updated');
    onSaved();
  };

  if (!region) return null;

  return (
    <div className="h-full flex flex-col bg-card border-l border-border">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <h3 className="font-display text-sm text-primary">Edit Region</h3>
        <Button variant="ghost" size="sm" onClick={onClose} className="h-6 w-6 p-0">
          <X className="w-3.5 h-3.5" />
        </Button>
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
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-muted-foreground font-display mb-1 block">Min Level</label>
              <Input type="number" value={form.min_level} onChange={e => setForm(f => ({ ...f, min_level: +e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground font-display mb-1 block">Max Level</label>
              <Input type="number" value={form.max_level} onChange={e => setForm(f => ({ ...f, max_level: +e.target.value }))} />
            </div>
          </div>
          <Button onClick={save} className="font-display text-xs w-full">
            <Save className="w-3 h-3 mr-1" /> Save Changes
          </Button>
        </div>
      </ScrollArea>
    </div>
  );
}
