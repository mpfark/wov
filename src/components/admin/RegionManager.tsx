import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Plus, Sparkles, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { createSubmissionFence } from './admin-operation-guards';
import { createRegionRequestTracker, submitRegionCreation } from './region-creation-admin';

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

export default function RegionManager({ regions, onCreated, isValar: _isValar, onDelete: _onDelete }: Props) {
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', min_level: 1, max_level: 10 });
  const [aiLoading, setAiLoading] = useState(false);
  const [createInitialNode, setCreateInitialNode] = useState(true);
  const [creating, setCreating] = useState(false);
  const creationFence = useRef(createSubmissionFence());
  const requestTracker = useRef(createRegionRequestTracker());

  useEffect(() => () => creationFence.current.invalidate(), []);

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
    if (!form.name.trim()) return toast.error('Region name is required');
    if (!Number.isInteger(form.min_level) || !Number.isInteger(form.max_level) || form.min_level < 1 || form.max_level < form.min_level) {
      return toast.error('Enter a valid whole-number level range');
    }
    const operation = creationFence.current.tryAcquire();
    if (operation === false) return;
    setCreating(true);
    const result = await submitRegionCreation({
      regionName: form.name,
      regionDescription: form.description,
      minLevel: form.min_level,
      maxLevel: form.max_level,
      createInitialNode,
    }, requestTracker.current);
    if (!creationFence.current.release(operation)) return;
    setCreating(false);
    if (!result.ok) {
      toast.error(`Region creation refused: ${result.kind}`);
      return;
    }

    toast.success(createInitialNode ? 'Region and initial node created' : 'Region created');
    setForm({ name: '', description: '', min_level: 1, max_level: 10 });
    setCreateInitialNode(true);
    setCreateOpen(false);
    onCreated();
  };

  const setDialogOpen = (open: boolean) => {
    if (creating) return;
    if (!open) {
      creationFence.current.invalidate();
      requestTracker.current = createRegionRequestTracker();
    }
    setCreateOpen(open);
  };




  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setCreateOpen(true)} className="font-display text-xs">
        <Plus className="w-3 h-3 mr-1" /> New Region
      </Button>

      <Dialog open={createOpen} onOpenChange={setDialogOpen}>
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

            <div className="border border-border rounded-md p-3 space-y-2">
              <label className="flex items-center gap-2 text-xs font-display">
                <Checkbox checked={createInitialNode} onCheckedChange={checked => setCreateInitialNode(checked === true)} disabled={creating} />
                Create an initial node
              </label>
              {createInitialNode && (
                <div className="pl-6 text-xs text-muted-foreground space-y-1">
                  <p>The server creates “{form.name.trim() || 'Region'} Entrance” with empty connections and places it beyond the current eastern edge.</p>
                  <p>Connect it to the world afterward using the Node Editor.</p>
                </div>
              )}
            </div>

            <Button onClick={create} className="font-display text-xs w-full" disabled={creating || aiLoading}>
              {creating ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Plus className="w-3 h-3 mr-1" />}
              {creating ? 'Creating…' : createInitialNode ? 'Create Region and Initial Node' : 'Create Region'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
