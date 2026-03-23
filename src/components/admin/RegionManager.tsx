import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import NodePicker from './NodePicker';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Plus, Sparkles, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const DIRECTION_OFFSETS: Record<string, [number, number]> = {
  N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0],
  NE: [1, -1], NW: [-1, -1], SE: [1, 1], SW: [-1, 1],
};

const REVERSE_DIR: Record<string, string> = {
  N: 'S', S: 'N', E: 'W', W: 'E',
  NE: 'SW', NW: 'SE', SE: 'NW', SW: 'NE',
};

interface Region {
  id: string;
  name: string;
  description: string;
  min_level: number;
  max_level: number;
}

interface NodeData {
  id: string;
  name: string;
  region_id: string;
  x: number;
  y: number;
  connections: any[];
}

interface Props {
  regions: Region[];
  allNodes: NodeData[];
  onCreated: () => void;
  isValar: boolean;
  onDelete: (id: string) => void;
}

export default function RegionManager({ regions, allNodes, onCreated, isValar, onDelete }: Props) {
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', min_level: 1, max_level: 10 });
  const [aiLoading, setAiLoading] = useState(false);
  const [connectNodeId, setConnectNodeId] = useState<string>('');
  const [connectDirection, setConnectDirection] = useState<string>('S');

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
      const parentNode = connectNodeId ? allNodes.find(n => n.id === connectNodeId) : null;
      let newX = 0;
      let newY = 0;
      const newConnections: any[] = [];

      if (parentNode) {
        const offset = DIRECTION_OFFSETS[connectDirection] || [0, 1];
        newX = parentNode.x + offset[0];
        newY = parentNode.y + offset[1];
        newConnections.push({ node_id: parentNode.id, direction: REVERSE_DIR[connectDirection] || 'N' });
      } else {
        // Place standalone region far from existing nodes
        const maxX = allNodes.length > 0 ? Math.max(...allNodes.map(n => n.x)) : 0;
        newX = maxX + 10;
        newY = 0;
      }

      const { data: newNode } = await supabase.from('nodes').insert({
        name: `${form.name} Entrance`,
        description: '',
        region_id: region.id,
        connections: newConnections,
        x: newX,
        y: newY,
      }).select().single();

      // Update parent node's connections to include new node
      if (parentNode && newNode) {
        const updatedConns = [
          ...(parentNode.connections || []),
          { node_id: newNode.id, direction: connectDirection },
        ];
        await supabase.from('nodes').update({ connections: updatedConns }).eq('id', parentNode.id);
      }
    }

    toast.success('Region created with starting node');
    setForm({ name: '', description: '', min_level: 1, max_level: 10 });
    setConnectNodeId('');
    setConnectDirection('S');
    setCreateOpen(false);
    onCreated();
  };

  const getNodeLabel = (node: NodeData) => {
    const region = regions.find(r => r.id === node.region_id);
    const nodeName = node.name || 'Unnamed';
    return region ? `${nodeName} (${region.name})` : nodeName;
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

            {/* Connect to existing node */}
            <div className="border border-border rounded-md p-2 space-y-2">
              <label className="text-xs text-muted-foreground font-display block">Connect to existing node (optional)</label>
              <NodePicker
                nodes={allNodes.map(n => ({ id: n.id, name: n.name, region_id: n.region_id, x: n.x, y: n.y }))}
                regions={regions}
                value={connectNodeId || null}
                onChange={v => setConnectNodeId(v || '')}
                allowNone
                placeholder="No connection"
              />
              {connectNodeId && connectNodeId !== 'none' && (
                <div>
                  <label className="text-xs text-muted-foreground font-display block mb-1">Direction from parent</label>
                  <Select value={connectDirection} onValueChange={setConnectDirection}>
                    <SelectTrigger className="text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.keys(DIRECTION_OFFSETS).map(dir => (
                        <SelectItem key={dir} value={dir}>{dir}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
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
