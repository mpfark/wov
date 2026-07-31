import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import ItemPicker from './ItemPicker';
import { toast } from 'sonner';
import { Plus, Trash2, MessageCircle } from 'lucide-react';
import { AdminEditorHeader, AdminFormSection, AdminStickyActions, AdminEmptyState, AdminPageShell, AdminToolSection } from './common';
import NodePicker from './NodePicker';
import { CLASS_LABELS, getPlayableClassKeys } from '@/shared/formulas/classes';
import type { DialogueTopic, TopicKind } from '@/features/creatures/utils/dialogue-topics';

type NPCServiceRole = 'vendor' | 'blacksmith' | 'trainer' | 'jewelcrafter' | 'recruiter' | 'heraldry';

interface NPC {
  id: string;
  name: string;
  description: string;
  dialogue: string;
  node_id: string | null;
  created_at: string;
  service_role: NPCServiceRole | null;
  dialogue_topics?: DialogueTopic[] | null;
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
  service_role: 'none' as 'none' | NPCServiceRole,
  dialogue_topics: [] as DialogueTopic[],
});

export default function NPCManager() {
  const [npcs, setNPCs] = useState<NPC[]>([]);
  const [nodes, setNodes] = useState<NodeOption[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [form, setForm] = useState(defaultForm());
  const [filter, setFilter] = useState('');
  const [regionFilter, setRegionFilter] = useState('all');
  const [areaFilter, setAreaFilter] = useState('all');
  const [serviceFilter, setServiceFilter] = useState<'all' | 'none' | NPCServiceRole>('all');
  const [assignmentFilter, setAssignmentFilter] = useState<'all' | 'assigned' | 'unassigned'>('all');
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
    if (n.data) setNPCs(n.data as unknown as NPC[]);
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
      service_role: (npc.service_role ?? 'none') as 'none' | NPCServiceRole,
      dialogue_topics: Array.isArray(npc.dialogue_topics) ? npc.dialogue_topics : [],
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
      service_role: form.service_role === 'none' ? null : form.service_role,
      dialogue_topics: form.dialogue_topics,
    };

    let savedId = selectedId;
    if (selectedId) {
      const { error } = await supabase.from('npcs').update(payload as any).eq('id', selectedId);
      if (error) { toast.error(error.message); setLoading(false); return; }
      toast.success('NPC updated');
    } else {
      const { data, error } = await supabase.from('npcs').insert(payload as any).select().single();
      if (error) { toast.error(error.message); setLoading(false); return; }
      toast.success('NPC created');
      if (data) { savedId = data.id; setSelectedId(data.id); setIsNew(false); }
    }
    setLoading(false);
    const { data: refreshed } = await supabase.from('npcs').select('*').order('name');
    if (refreshed) {
      setNPCs(refreshed as unknown as NPC[]);
      const updated = refreshed.find((n: any) => n.id === savedId);
      if (updated) openEdit(updated as unknown as NPC);
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

  const getNodeAreaId = (nodeId: string | null) => {
    if (!nodeId) return null;
    return nodes.find(n => n.id === nodeId)?.area_id || null;
  };

  // Areas available depend on selected region
  const areasForRegion = regionFilter === 'all'
    ? npcAreas
    : (() => {
        const regionId = npcRegions.find(r => r.name === regionFilter)?.id;
        if (!regionId) return [] as AreaOption[];
        const areaIds = new Set(nodes.filter(n => n.region_id === regionId).map(n => n.area_id).filter(Boolean) as string[]);
        return npcAreas.filter(a => areaIds.has(a.id));
      })();

  const filtered = npcs.filter(n => {
    const matchesText = n.name.toLowerCase().includes(filter.toLowerCase()) ||
      getNodeName(n.node_id).toLowerCase().includes(filter.toLowerCase());
    const matchesRegion = regionFilter === 'all' || getNodeRegion(n.node_id) === regionFilter;
    const matchesArea = areaFilter === 'all' || getNodeAreaId(n.node_id) === areaFilter;
    const matchesService = serviceFilter === 'all'
      || (serviceFilter === 'none' ? !n.service_role : n.service_role === serviceFilter);
    const matchesAssignment = assignmentFilter === 'all'
      || (assignmentFilter === 'assigned' ? !!n.node_id : !n.node_id);
    return matchesText && matchesRegion && matchesArea && matchesService && matchesAssignment;
  });

  const tools = (
    <>
      <AdminToolSection title="Search">
        <Input placeholder="Search..." value={filter} onChange={e => setFilter(e.target.value)} className="h-7 text-xs" />
        <Button size="sm" onClick={openNew} className="font-display text-xs h-7 w-full">
          <Plus className="w-3 h-3 mr-1" /> New NPC
        </Button>
      </AdminToolSection>
      <AdminToolSection title="Region">
        <Select value={regionFilter} onValueChange={(v) => { setRegionFilter(v); setAreaFilter('all'); }}>
          <SelectTrigger className="w-full h-7 text-xs"><SelectValue placeholder="Region" /></SelectTrigger>
          <SelectContent className="bg-popover border-border z-50 max-h-60">
            <SelectItem value="all" className="text-xs">All Regions</SelectItem>
            {regionNames.map(r => (
              <SelectItem key={r} value={r!} className="text-xs">{r}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </AdminToolSection>
      <AdminToolSection title="Area">
        <Select value={areaFilter} onValueChange={setAreaFilter}>
          <SelectTrigger className="w-full h-7 text-xs"><SelectValue placeholder="Area" /></SelectTrigger>
          <SelectContent className="bg-popover border-border z-50 max-h-60">
            <SelectItem value="all" className="text-xs">All Areas</SelectItem>
            {areasForRegion.map(a => (
              <SelectItem key={a.id} value={a.id} className="text-xs">{a.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </AdminToolSection>
      <AdminToolSection title="Service Role">
        <Select value={serviceFilter} onValueChange={(v) => setServiceFilter(v as typeof serviceFilter)}>
          <SelectTrigger className="w-full h-7 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent className="bg-popover border-border z-50">
            <SelectItem value="all" className="text-xs">All Roles</SelectItem>
            <SelectItem value="none" className="text-xs">None (regular)</SelectItem>
            <SelectItem value="recruiter" className="text-xs">🏰 Recruiter</SelectItem>
            <SelectItem value="heraldry" className="text-xs">📜 Herald</SelectItem>
            <SelectItem value="trainer" className="text-xs">🏛️ Renown Trainer</SelectItem>
            <SelectItem value="vendor" className="text-xs">🪙 Vendor</SelectItem>
            <SelectItem value="blacksmith" className="text-xs">🔨 Blacksmith</SelectItem>
            <SelectItem value="jewelcrafter" className="text-xs">💎 Jewelcrafter</SelectItem>
          </SelectContent>
        </Select>
      </AdminToolSection>
      <AdminToolSection title="Assignment">
        <Select value={assignmentFilter} onValueChange={(v) => setAssignmentFilter(v as typeof assignmentFilter)}>
          <SelectTrigger className="w-full h-7 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent className="bg-popover border-border z-50">
            <SelectItem value="all" className="text-xs">All</SelectItem>
            <SelectItem value="assigned" className="text-xs">Assigned to node</SelectItem>
            <SelectItem value="unassigned" className="text-xs">Unassigned</SelectItem>
          </SelectContent>
        </Select>
      </AdminToolSection>
    </>
  );

  return (
    <AdminPageShell icon={<MessageCircle className="w-4 h-4" />} title="NPCs" count={npcs.length} tools={tools}>
      <div className="flex-1 flex min-h-0">
      {/* Left: NPC List */}
      <div className="flex flex-col w-1/2 border-r border-border transition-all">
        <ScrollArea className="flex-1">
          <div className="p-3 space-y-1.5">
            {filtered.length === 0 ? (
              <AdminEmptyState message={npcs.length === 0 ? 'No NPCs yet.' : 'No match.'} />
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
            <AdminEditorHeader title={selectedId ? `Edit: ${form.name || 'NPC'}` : 'New NPC'} onClose={closePanel} />
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

                <AdminFormSection title="Service Role">
                  <Select
                    value={form.service_role}
                    onValueChange={(v) => setForm(f => ({ ...f, service_role: v as 'none' | NPCServiceRole }))}
                  >
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent className="bg-popover border-border z-50">
                      <SelectItem value="none" className="text-xs">None (regular NPC)</SelectItem>
                      <SelectItem value="recruiter" className="text-xs">🏰 Order Recruiter</SelectItem>
                      <SelectItem value="heraldry" className="text-xs">📜 Herald</SelectItem>
                      <SelectItem value="trainer" className="text-xs">🏛️ Renown Trainer</SelectItem>
                      <SelectItem value="vendor" className="text-xs">🪙 Vendor</SelectItem>
                      <SelectItem value="blacksmith" className="text-xs">🔨 Blacksmith</SelectItem>
                      <SelectItem value="jewelcrafter" className="text-xs">💎 Jewelcrafter</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Service-role NPCs open the matching service panel when talked to (only at nodes with the matching flag).
                  </p>
                </AdminFormSection>

                <AdminFormSection title="Dialogue Topics">
                  <TopicsEditor
                    topics={form.dialogue_topics}
                    onChange={(next) => setForm(f => ({ ...f, dialogue_topics: next }))}
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Topics appear as clickable questions in the dialog. Use <strong>Class Hall Directions</strong> for a single class, or <strong>Class Hall Menu</strong> to auto-list every known order hall.
                  </p>
                </AdminFormSection>


                <AdminFormSection title="Location">
                  <NodePicker
                    nodes={nodes}
                    regions={npcRegions}
                    areas={npcAreas}
                    value={form.node_id}
                    onChange={v => setForm(f => ({ ...f, node_id: v }))}
                    allowNone
                    placeholder="Select node"
                  />
                </AdminFormSection>

                <AdminStickyActions onSave={handleSave} onCancel={closePanel} saveLabel={selectedId ? 'Update' : 'Create'} loading={loading} />
              </div>
            </ScrollArea>
          </>
        ) : (
          <AdminEmptyState message="Select an NPC to edit" />
        )}
      </div>
      </div>
    </AdminPageShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Topics editor — small inline component for authoring dialogue_topics.
// ─────────────────────────────────────────────────────────────────────────

const KIND_LABELS: Record<TopicKind, string> = {
  text: 'Text',
  class_hall_dir: 'Class Hall Directions',
  class_hall_menu: 'Class Hall Menu (auto-lists all)',
  hunt_dir: 'Hunting Grounds (auto, level-matched)',
  assassin_contract: 'Assassin Contract (take/abandon)',
  give_item: 'Give Item / Map',
};


const CLASS_KEYS = getPlayableClassKeys();

function slugId(label: string): string {
  return (label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'topic')
    + '_' + Math.random().toString(36).slice(2, 6);
}

function TopicsEditor({
  topics,
  onChange,
}: {
  topics: DialogueTopic[];
  onChange: (next: DialogueTopic[]) => void;
}) {
  const [giveItems, setGiveItems] = useState<Array<{ id: string; name: string; item_type: string; rarity: string; level?: number; slot?: string | null }>>([]);
  useEffect(() => {
    supabase.from('items').select('id, name, item_type, rarity, level, slot').order('name').then(({ data }) => {
      if (data) setGiveItems(data as any);
    });
  }, []);
  const update = (idx: number, patch: Partial<DialogueTopic>) => {
    onChange(topics.map((t, i) => (i === idx ? { ...t, ...patch } : t)));
  };
  const remove = (idx: number) => onChange(topics.filter((_, i) => i !== idx));
  const move = (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= topics.length) return;
    const next = topics.slice();
    [next[idx], next[j]] = [next[j], next[idx]];
    onChange(next);
  };
  const add = () => {
    onChange([
      ...topics,
      { id: slugId('new'), label: 'New topic', kind: 'text', response: '' },
    ]);
  };

  return (
    <div className="space-y-2">
      {topics.length === 0 && (
        <p className="text-[10px] text-muted-foreground italic">No topics yet.</p>
      )}
      {topics.map((t, idx) => (
        <div key={t.id + idx} className="border border-border rounded p-2 space-y-1.5 bg-background/30">
          <div className="flex items-center gap-1">
            <Input
              className="h-7 text-xs flex-1"
              placeholder="Player question (e.g. Where is the Templar Hall?)"
              value={t.label}
              maxLength={120}
              onChange={e => update(idx, { label: e.target.value })}
            />
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => move(idx, -1)} title="Move up">↑</Button>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => move(idx, 1)} title="Move down">↓</Button>
            <Button size="sm" variant="destructive" className="h-7 w-7 p-0" onClick={() => remove(idx)} title="Remove">
              <Trash2 className="w-3 h-3" />
            </Button>
          </div>

          <Select
            value={t.kind}
            onValueChange={v => update(idx, { kind: v as TopicKind })}
          >
            <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent className="bg-popover border-border z-50">
              {Object.entries(KIND_LABELS).map(([k, label]) => (
                <SelectItem key={k} value={k} className="text-xs">{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {t.kind === 'text' && (
            <Textarea
              className="text-xs"
              placeholder="What the NPC says when this topic is chosen"
              value={t.response ?? ''}
              maxLength={1000}
              rows={3}
              onChange={e => update(idx, { response: e.target.value })}
            />
          )}

          {t.kind === 'class_hall_dir' && (
            <Select
              value={String(t.params?.class ?? '')}
              onValueChange={v => update(idx, { params: { ...(t.params ?? {}), class: v } })}
            >
              <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Pick class" /></SelectTrigger>
              <SelectContent className="bg-popover border-border z-50">
                {CLASS_KEYS.map(k => (
                  <SelectItem key={k} value={k} className="text-xs">{CLASS_LABELS[k]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {t.kind === 'class_hall_menu' && (
            <p className="text-[10px] text-muted-foreground italic">
              Expands automatically into one question per known order hall.
            </p>
          )}

          {t.kind === 'hunt_dir' && (
            <p className="text-[10px] text-muted-foreground italic">
              Auto-picks an area whose level range covers the asking character's level, preferring the player's current region.
            </p>
          )}

          {t.kind === 'give_item' && (
            <div className="space-y-1.5">
              <Textarea
                className="text-xs"
                placeholder="What the NPC says when handing over the item (e.g. *Take this map. Burn it after you arrive.*)"
                value={t.response ?? ''}
                maxLength={1000}
                rows={2}
                onChange={e => update(idx, { response: e.target.value })}
              />
              <ItemPicker
                items={giveItems as any}
                value={(t.params?.item_id as string) || null}
                onChange={v => update(idx, { params: { ...(t.params ?? {}), item_id: v } })}
                placeholder="Pick item to give"
                allowNone
              />
              <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={(t.params?.once_per_character ?? true) as boolean}
                  onChange={e => update(idx, { params: { ...(t.params ?? {}), once_per_character: e.target.checked } })}
                />
                Only give once per character
              </label>
            </div>
          )}

        </div>
      ))}
      <Button size="sm" variant="outline" className="h-7 text-xs w-full" onClick={add}>
        <Plus className="w-3 h-3 mr-1" /> Add topic
      </Button>
    </div>
  );
}

