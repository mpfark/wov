import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Plus, Sparkles, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface Region {
  id: string;
  name: string;
  description: string;
  min_level: number;
  max_level: number;
}

interface Props {
  regions: Region[];
  onCreated: () => void;
  isValar: boolean;
  onDelete: (id: string) => void;
}

export default function RegionManager({ regions, onCreated, isValar, onDelete }: Props) {
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', min_level: 1, max_level: 10 });
  const [aiLoading, setAiLoading] = useState(false);

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

  const create = async () => {
    if (!form.name) return toast.error('Name required');
    const { data: region, error } = await supabase.from('regions').insert({
      name: form.name,
      description: form.description,
      min_level: form.min_level,
      max_level: form.max_level,
    }).select().single();
    if (error) return toast.error(error.message);

    if (region) {
      await supabase.from('nodes').insert({
        name: `${form.name} Entrance`,
        description: '',
        region_id: region.id,
        connections: [],
      });
    }

    toast.success('Region created with starting node');
    setForm({ name: '', description: '', min_level: 1, max_level: 10 });
    setCreateOpen(false);
    onCreated();
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setCreateOpen(true)} className="font-display text-xs">
        <Plus className="w-3 h-3 mr-1" /> New Region
      </Button>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle className="font-display text-primary">New Region</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <div className="flex gap-2">
              <Input placeholder="Region name" value={form.name} className="flex-1"
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              <Button variant="outline" size="sm" onClick={aiSuggest} disabled={aiLoading} title="AI Suggest">
                {aiLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              </Button>
            </div>
            <Textarea placeholder="Description" value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            <div className="flex gap-2">
              <Input type="number" placeholder="Min level" value={form.min_level}
                onChange={e => setForm(f => ({ ...f, min_level: +e.target.value }))} />
              <Input type="number" placeholder="Max level" value={form.max_level}
                onChange={e => setForm(f => ({ ...f, max_level: +e.target.value }))} />
            </div>
            <Button onClick={create} className="font-display text-xs w-full">
              <Plus className="w-3 h-3 mr-1" /> Create Region
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
