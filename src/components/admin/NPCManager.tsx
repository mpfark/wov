import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Plus, Trash2, Save, X, MessageCircle } from 'lucide-react';
import NodePicker from './NodePicker';

interface NPC {
  id: string;
  name: string;
  description: string;
  dialogue: string;
  node_id: string | null;
  created_at: string;
}

interface NodeOption {
  id: string;
  name: string;
  region_id: string;
  region_name?: string;
  area_id?: string | null;
  is_inn?: boolean;
  is_vendor?: boolean;
  is_blacksmith?: boolean;
  is_teleport?: boolean;
  is_trainer?: boolean;
}

interface RegionOption {
  id: string;
  name: string;
}

interface AreaOption {
  id: string;
  name: string;
}

const defaultForm = () => ({
  name: '',
  description: '',
  dialogue: '',
  node_id: '' as string | null,
});

export default function NPCManager() {
  const [npcs, setNPCs] = useState<NPC[]>([]);
  const [nodes, setNodes] = useState<NodeOption[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [form, setForm] = useState(defaultForm());
  const [filter, setFilter] = useState('');
  const [regionFilter, setRegionFilter] = useState('all');
  const [loading, setLoading] = useState(false);
  const [npcRegions, setNpcRegions] = useState<RegionOption[]>([]);
  const [npcAreas, setNpcAreas] = useState<AreaOption[]>([]);

  const loadData = async () => {
    const [n, nd, r, a] = await Promise.all([
      supabase.from('npcs').select('*').order('name'),
      supabase.from('nodes').select('id, name, region_id, area_id, is_inn, is_vendor, is_blacksmith, is_teleport, is_trainer').order('name'),
      supabase.from('regions').select('id, name'),
      supabase.from('areas').select('id, name'),
    ]);
    if (n.data) setNPCs(n.data as NPC[]);
    if (r.data) setNpcRegions(r.data as RegionOption[]);
    if (a.data) setNpcAreas(a.data as AreaOption[]);
    if (nd.data && r.data) {
      const regionMap = Object.fromEntries(r.data.map(reg => [reg.id, reg.name]));
      setNodes(nd.data.map(node => ({
        id: node.id,
        name: node.name,
        region_id: node.region_id,
        region_name: regionMap[node.region_id] || 'Unknown',
        area_id: node.area_id,
        is_inn: node.is_inn,
        is_vendor: node.is_vendor,
        is_blacksmith: node.is_blacksmith,
        is_teleport: node.is_teleport,
        is_trainer: node.is_trainer,
      })));
    }
  };

  useEffect(() => { loadData(); }, []);

  const getNodeName = (id: string | null) => {
    if (!id) return 'Unassigned';
    return nodes.find(n => n.id === id)?.name || 'Unknown';
  };

  const openNew = () => {
    setSelectedId(null);
    setIsNew(true);
    setForm(defaultForm());
  };

  const openEdit = (npc: NPC) => {
    setSelectedId(npc.id);
    setIsNew(false);
    setForm({
      name: npc.name,
      description: npc.description,
      dialogue: npc.dialogue,
      node_id: npc.node_id,
    });
  };

  const closePanel = () => {
    setSelectedId(null);
    setIsNew(false);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return toast.error('Name is required');
    setLoading(true);

    const payload = {
      name: form.name.trim(),
      description: form.description.trim(),
      dialogue: form.dialogue.trim(),
      node_id: form.node_id || null,
    };

    let savedId = selectedId;
    if (selectedId) {
      const { error } = await supabase.from('npcs').update(payload).eq('id', selectedId);
      if (error) { toast.error(error.message); setLoading(false); return; }
      toast.success('NPC updated');
    } else {
      const { data, error } = await supabase.from('npcs').insert(payload).select().single();
      if (error) { toast.error(error.message); setLoading(false); return; }
      toast.success('NPC created');
      if (data) { savedId = data.id; setSelectedId(data.id); setIsNew(false); }
    }
    setLoading(false);
    const { data: refreshed } = await supabase.from('npcs').select('*').order('name');
    if (refreshed) {
      setNPCs(refreshed as NPC[]);
      const updated = refreshed.find((n: any) => n.id === savedId);
      if (updated) openEdit(updated as NPC);
    }
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from('npcs').delete().eq('id', id);
    if (error) return toast.error(error.message);
    toast.success('NPC deleted');
    if (selectedId === id) closePanel();
    loadData();
  };

  const panelOpen = isNew || selectedId !== null;

  const regionNames = [...new Set(nodes.map(n => n.region_name).filter(Boolean))].sort();

  const getNodeRegion = (nodeId: string | null) => {
    if (!nodeId) return '';
    return nodes.find(n => n.id === nodeId)?.region_name || '';
  };

  const filtered = npcs.filter(n => {
    const matchesText = n.name.toLowerCase().includes(filter.toLowerCase()) ||
      getNodeName(n.node_id).toLowerCase().includes(filter.toLowerCase());
    const matchesRegion = regionFilter === 'all' || getNodeRegion(n.node_id) === regionFilter;
    return matchesText && matchesRegion;
  });

  return (
    <div className="h-full flex">
      {/* Left: NPC List */}
      <div className="flex flex-col w-1/2 border-r border-border transition-all">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
          <MessageCircle className="w-4 h-4 text-primary" />
          <h2 className="font-display text-sm text-primary">NPCs</h2>
          <span className="text-xs text-muted-foreground">({npcs.length})</span>
          <div className="flex-1" />
          <Select value={regionFilter} onValueChange={setRegionFilter}>
            <SelectTrigger className="w-32 h-7 text-xs"><SelectValue placeholder="Region" /></SelectTrigger>
            <SelectContent className="bg-popover border-border z-50 max-h-60">
              <SelectItem value="all" className="text-xs">All Regions</SelectItem>
              {regionNames.map(r => (
                <SelectItem key={r} value={r!} className="text-xs">{r}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input placeholder="Search..." value={filter} onChange={e => setFilter(e.target.value)} className="w-36 h-7 text-xs" />
          <Button size="sm" onClick={openNew} className="font-display text-xs h-7">
            <Plus className="w-3 h-3 mr-1" /> New
          </Button>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-3 space-y-1.5">
            {filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8 italic">
                {npcs.length === 0 ? 'No NPCs yet.' : 'No match.'}
              </p>
            ) : filtered.map(npc => (
              <div
                key={npc.id}
                className={`flex items-center justify-between p-2 rounded border transition-colors cursor-pointer ${
                  selectedId === npc.id ? 'border-primary bg-primary/10' : 'border-border bg-card/50 hover:bg-card/80'
                }`}
                onClick={() => openEdit(npc)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">💬</span>
                    <span className="font-display text-sm text-foreground">{npc.name}</span>
                  </div>
                  <div className="flex items-center gap-3 mt-0.5">
                    <span className="text-xs text-muted-foreground">📍 {getNodeName(npc.node_id)}</span>
                    {npc.dialogue && (
                      <span className="text-[10px] text-muted-foreground truncate max-w-[150px]">
                        "{npc.dialogue.slice(0, 40)}{npc.dialogue.length > 40 ? '...' : ''}"
                      </span>
                    )}
                  </div>
                </div>
                <Button size="sm" variant="destructive" onClick={(e) => { e.stopPropagation(); handleDelete(npc.id); }} className="h-7 w-7 p-0 shrink-0 ml-2">
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
                {selectedId ? `Edit: ${form.name || 'NPC'}` : 'New NPC'}
              </h2>
              <Button variant="ghost" size="sm" onClick={closePanel} className="h-6 w-6 p-0">
                <X className="w-4 h-4" />
              </Button>
            </div>
            <ScrollArea className="flex-1">
              <div className="p-3 space-y-3">
                <Input placeholder="NPC name" value={form.name} maxLength={100}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="h-8 text-xs" />
                <Textarea placeholder="Description (optional)" value={form.description} maxLength={500}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} className="text-xs" />
                <div>
                  <label className="text-[10px] text-muted-foreground">Dialogue</label>
                  <Textarea placeholder="What does this NPC say when talked to?" value={form.dialogue} maxLength={2000}
                    onChange={e => setForm(f => ({ ...f, dialogue: e.target.value }))} rows={4} className="text-xs" />
                </div>

                <div>
                  <label className="text-[10px] text-muted-foreground">Location</label>
                  <NodePicker
                    nodes={nodes}
                    regions={npcRegions}
                    areas={npcAreas}
                    value={form.node_id}
                    onChange={v => setForm(f => ({ ...f, node_id: v }))}
                    allowNone
                    placeholder="Select node"
                  />
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
            Select an NPC to edit
          </div>
        )}
      </div>
    </div>
  );
}
