import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Plus, Trash2, Skull } from 'lucide-react';
import { AdminEditorHeader, AdminFormSection, AdminStickyActions, AdminEmptyState, AdminPageShell, AdminToolSection } from './common';
import { generateCreatureStats, getCreatureDamageDie, getStatModifier } from '@/lib/game-data';
import { TICK_RATE_MS } from '@/shared/formulas/combat';
import NodePicker from './NodePicker';
import LootTablePicker from './LootTablePicker';
import { FLAVOR_TOKENS } from './FlavorField';
import { DAMAGE_TYPES, DAMAGE_TYPE_NONE } from './damage-types';
import { renderFlavor } from '@shared/proc-log-format';
import { bossCastFormFromCreature, buildBossCastSave, type BossCastTargeting } from './boss-cast-form';


interface Creature {
  id: string;
  name: string;
  description: string;
  node_id: string | null;
  rarity: string;
  level: number;
  hp: number;
  max_hp: number;
  ac: number;
  stats: Record<string, number>;
  is_aggressive: boolean;
  is_humanoid: boolean;
  loot_table: any[];
  respawn_seconds: number;
  is_alive: boolean;
  loot_table_id: string | null;
  drop_chance: number;
  gold_enabled?: boolean; gold_min?: number; gold_max?: number; gold_chance?: number;
  salvage_enabled?: boolean; item_source?: 'none'|'world_pool'|'assigned_table'|'unique_boss_drop';
  unique_item_id?: string|null; unique_drop_chance?: number|null;
}

interface LootTableOption {
  id: string;
  name: string;
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

type RewardMutationResult =
  | { ok: true; kind: 'updated' }
  | { ok: false; kind: 'stale'; current: Record<string, unknown> }
  | { ok: false; kind: 'not_authorized' | 'not_found' | 'request_conflict' | 'invalid_request' | 'invalid_config' };

function decodeRewardMutationResult(value: unknown): RewardMutationResult | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (row.ok === true && row.kind === 'updated') return { ok: true, kind: 'updated' };
  if (row.ok !== false || typeof row.kind !== 'string') return null;
  if (row.kind === 'stale' && row.current && typeof row.current === 'object') return { ok: false, kind: 'stale', current: row.current as Record<string, unknown> };
  if (['not_authorized', 'not_found', 'request_conflict', 'invalid_request', 'invalid_config'].includes(row.kind)) return { ok: false, kind: row.kind as Exclude<RewardMutationResult, { ok: true } | { kind: 'stale' }>['kind'] };
  return null;
}

const RARITIES = ['regular', 'rare', 'boss'] as const;

const RARITY_COLORS: Record<string, string> = {
  regular: 'text-foreground',
  rare: 'text-dwarvish',
  boss: 'text-primary text-glow',
};

interface BossCritFlavor {
  name: string;
  text: string;
  weight: number;
  damage_type: string;
}

const defaultForm = () => ({
  name: '', description: '', node_id: '' as string | null,
  level: 1, rarity: 'regular',
  is_aggressive: false, is_humanoid: false, respawn_seconds: 300,
  loot_table: [] as { item_id: string; chance: number }[],
  gold_min: 0, gold_max: 0, gold_chance: 0.5,
  gold_enabled: false, salvage_enabled: false,
  item_source: 'none' as 'none'|'world_pool'|'assigned_table'|'unique_boss_drop',
  unique_item_id: null as string|null, unique_drop_chance: 0.5,
  loot_table_id: null as string | null,
  drop_chance: 0.5,
  boss_crit_flavors: [] as BossCritFlavor[],
  boss_death_cry: '',
  boss_cast_enabled: false,
  boss_cast_label: 'Cataclysm',
  boss_cast_ability_key: '',
  boss_cast_damage_type: '',
  boss_cast_targeting: 'current_tank_at_resolution' as BossCastTargeting,
  boss_cast_windup_ticks: 2,
  boss_cast_cooldown_ticks: 10,
  boss_cast_selection_weight: 0.3,
  boss_cast_base_amount: 20,
  boss_cast_base_aoe_amount: 0,
  boss_cast_raw: null as Record<string, unknown> | null,

});

export default function CreatureManager() {
  const [creatures, setCreatures] = useState<Creature[]>([]);
  const [nodes, setNodes] = useState<NodeOption[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [form, setForm] = useState(defaultForm());
  const [filter, setFilter] = useState('');
  const [regionFilter, setRegionFilter] = useState('all');
  const [areaFilter, setAreaFilter] = useState<string>('all');
  const [rarityTab, setRarityTab] = useState<string>('all');
  const [typeTab, setTypeTab] = useState<'all' | 'creature' | 'humanoid'>('all');
  // showUnassigned removed — now handled via regionFilter === 'unassigned'
  const [showNoLoot, setShowNoLoot] = useState(false);
  const [sortBy, setSortBy] = useState<'name' | 'level' | 'rarity' | 'location'>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [loading, setLoading] = useState(false);
  const [lootTables, setLootTables] = useState<LootTableOption[]>([]);
  const [uniqueItems,setUniqueItems]=useState<{id:string;name:string;origin_id:string|null}[]>([]);
  const [rewardExpected,setRewardExpected]=useState<Record<string,unknown>|null>(null);
  const rewardRequestRef=useRef<{key:string;id:string}|null>(null);

  // A new creature's permanent UUID, allocated client-side when the blank
  // editor opens. The insert carries it explicitly, so the boss-cast identity is
  // anchored to the same immutable id the row is stored under — no placeholder,
  // no post-insert identity repair.
  const [newCreatureId, setNewCreatureId] = useState<string>(() => crypto.randomUUID());
  const [cmRegions, setCmRegions] = useState<RegionOption[]>([]);
  const [cmAreas, setCmAreas] = useState<AreaOption[]>([]);

  const loadData = async () => {
    const [c, n, r, lt, a, ui] = await Promise.all([
      supabase.from('creatures').select('*').order('name'),
      supabase.from('nodes').select('id, name, region_id, area_id, is_inn, is_vendor, is_blacksmith, is_teleport, is_trainer').order('name'),
      supabase.from('regions').select('id, name'),
      supabase.from('loot_tables').select('id, name').order('name'),
      supabase.from('areas').select('id, name'),
      supabase.from('items').select('id,name,origin_id').eq('rarity','unique').order('name'),
    ]);
    if (lt.data) setLootTables(lt.data as LootTableOption[]);
    if (c.data) setCreatures(c.data as unknown as Creature[]);
    if (r.data) setCmRegions(r.data as RegionOption[]);
    if (a.data) setCmAreas(a.data as AreaOption[]);
    if (n.data && r.data) {
      const regionMap = Object.fromEntries(r.data.map(reg => [reg.id, reg.name]));
      setNodes(n.data.map(node => ({
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
    if(ui.data)setUniqueItems(ui.data as typeof uniqueItems);
  };

  useEffect(() => { loadData(); }, []);

  const getNodeName = (id: string | null) => {
    if (!id) return 'Unassigned';
    return nodes.find(n => n.id === id)?.name || 'Unknown';
  };

  const openNew = () => {
    setSelectedId(null);
    setIsNew(true);
    setNewCreatureId(crypto.randomUUID());
    setForm(defaultForm());
    setRewardExpected(null);
    rewardRequestRef.current = null;
  };

  const openEdit = (c: Creature) => {
    setSelectedId(c.id);
    setIsNew(false);
    const rawLoot = Array.isArray(c.loot_table) ? c.loot_table : [];
    const goldEntry = rawLoot.find((e: any) => e.type === 'gold');
    const itemLoot = rawLoot.filter((e: any) => e.type !== 'gold');
    const reward={gold_enabled:!!c.gold_enabled,gold_min:c.gold_min??goldEntry?.min??0,gold_max:c.gold_max??goldEntry?.max??0,gold_chance:c.gold_chance??goldEntry?.chance??0,salvage_enabled:!!c.salvage_enabled,item_source:c.item_source??'none',loot_table_id:c.loot_table_id??null,drop_chance:c.drop_chance??0.5,unique_item_id:c.unique_item_id??null,unique_drop_chance:c.unique_drop_chance??null};
    setRewardExpected(reward);
    setForm({
      name: c.name, description: c.description, node_id: c.node_id,
      level: c.level, rarity: c.rarity,
      is_aggressive: c.is_aggressive, is_humanoid: c.is_humanoid ?? false,
      respawn_seconds: c.respawn_seconds,
      loot_table: itemLoot,
      gold_min: reward.gold_min as number,
      gold_max: reward.gold_max as number,
      gold_chance: reward.gold_chance as number,
      gold_enabled: reward.gold_enabled, salvage_enabled: reward.salvage_enabled,
      item_source: reward.item_source as typeof form.item_source,
      unique_item_id: reward.unique_item_id as string|null,
      unique_drop_chance: (reward.unique_drop_chance as number|null) ?? 0.5,
      loot_table_id: c.loot_table_id || null,
      drop_chance: c.drop_chance ?? 0.5,
      boss_crit_flavors: Array.isArray((c as any).boss_crit_flavors) ? (c as any).boss_crit_flavors : [],
      boss_death_cry: typeof (c as any).boss_death_cry === 'string' ? (c as any).boss_death_cry : '',
      // Boss cast: loaded through the shared pure transform, so the checkbox
      // mirrors runtime eligibility (rarity + stored `enabled`) instead of mere
      // presence, and every unexposed key is carried in `boss_cast_raw`.
      ...bossCastFormFromCreature(
        { rarity: c.rarity, boss_cast: (c as any).boss_cast },
        TICK_RATE_MS,
      ),


    });
  };

  const closePanel = () => {
    setSelectedId(null);
    setIsNew(false);
    setRewardExpected(null);
    rewardRequestRef.current = null;
  };

  const handleSave = async () => {
    if (loading) return;
    if (!form.name.trim()) return toast.error('Name is required');
    if (form.gold_enabled && form.gold_max < form.gold_min) return toast.error('Gold maximum must be at least the minimum.');
    if (form.item_source === 'assigned_table' && !form.loot_table_id) return toast.error('Select a loot table.');
    if (form.item_source === 'unique_boss_drop' && form.rarity !== 'boss') return toast.error('Unique boss drops require boss rarity.');
    if (form.item_source === 'unique_boss_drop' && !form.unique_item_id) return toast.error('Select an eligible unique item.');
    if ((form.item_source === 'assigned_table' || form.item_source === 'world_pool') && (form.drop_chance < 0 || form.drop_chance > 1)) return toast.error('Item drop chance must be between 0 and 1.');
    if (form.item_source === 'unique_boss_drop' && ((form.unique_drop_chance ?? -1) < 0 || (form.unique_drop_chance ?? 2) > 1)) return toast.error('Unique drop chance must be between 0 and 1.');
    setLoading(true);

    const generated = generateCreatureStats(form.level, form.rarity);

    // ── Boss cast: canonical write, preservation, validation ──────────────
    // One authoritative stored shape, one pure transform (`buildBossCastSave`).
    // A new creature's permanent id is allocated *before* the insert so the cast
    // identity is anchored to the immutable id it will actually be stored under
    // — never a placeholder, never a best-effort follow-up update.
    const creatureId = selectedId ?? newCreatureId;
    const castSave = buildBossCastSave(form, {
      rarity: form.rarity,
      creatureId,
      level: form.level,
      tickRateMs: TICK_RATE_MS,
    });
    if (castSave.problems.length > 0) {
      setLoading(false);
      toast.error(`Boss cast cannot be saved: ${castSave.problems[0]}`);
      return;
    }
    const bossCastPayload = castSave.payload;



    const payload = {
      name: form.name.trim(),

      description: form.description.trim(),
      node_id: form.node_id || null,
      level: form.level,
      rarity: form.rarity as any,
      hp: generated.hp,
      max_hp: generated.hp,
      ac: generated.ac,
      stats: generated.stats,
      is_aggressive: form.is_aggressive,
      base_aggressive: form.is_aggressive,
      is_humanoid: form.is_humanoid,
      respawn_seconds: Math.max(0, form.respawn_seconds),
      boss_crit_flavors: form.boss_crit_flavors
        .map(f => ({
          name: f.name?.trim() || '',
          text: f.text?.trim() || '',
          weight: Number.isFinite(f.weight) && f.weight > 0 ? f.weight : 1,
          damage_type: f.damage_type?.trim() || undefined,
        }))
        .filter(f => f.text.length > 0),
      boss_death_cry: form.rarity === 'boss' ? form.boss_death_cry.trim() : '',
      boss_cast: bossCastPayload,

    } as any;

    let savedId = selectedId;
    if (selectedId) {
      const { error } = await supabase.from('creatures').update(payload).eq('id', selectedId);
      if (error) { toast.error(error.message); setLoading(false); return; }
    } else {
      const { data, error } = await supabase
        .from('creatures')
        .insert({ ...payload, id: creatureId })
        .select()
        .single();
      if (error) { toast.error(error.message); setLoading(false); return; }
      if (data) { savedId = data.id; setSelectedId(data.id); setIsNew(false); }
    }
    if(savedId){
      const desired={gold_enabled:form.gold_enabled,gold_min:form.gold_min,gold_max:form.gold_max,gold_chance:form.gold_chance,salvage_enabled:form.salvage_enabled,item_source:form.item_source,loot_table_id:form.item_source==='assigned_table'?form.loot_table_id:null,drop_chance:form.item_source==='assigned_table'||form.item_source==='world_pool'?form.drop_chance:null,unique_item_id:form.item_source==='unique_boss_drop'?form.unique_item_id:null,unique_drop_chance:form.item_source==='unique_boss_drop'?form.unique_drop_chance:null};
      const expected=rewardExpected??{gold_enabled:false,gold_min:0,gold_max:0,gold_chance:0,salvage_enabled:false,item_source:'none',loot_table_id:null,drop_chance:null,unique_item_id:null,unique_drop_chance:null};
      const key=JSON.stringify({savedId,expected,desired});
      if(rewardRequestRef.current?.key!==key)rewardRequestRef.current={key,id:crypto.randomUUID()};
      const {data,error}=await supabase.rpc('admin_set_creature_rewards' as any,{_creature_id:savedId,_expected:expected,_desired:desired,_request_id:rewardRequestRef.current.id});
      const result=decodeRewardMutationResult(data);
      if(error||!result){toast.error(error?.message||'Malformed reward response');setLoading(false);return;}
      if(!result.ok){if(result.kind==='stale')setRewardExpected(result.current);toast.error(result.kind);setLoading(false);return;}
      rewardRequestRef.current=null;
      setRewardExpected(desired); toast.success(selectedId?'Creature updated':'Creature created');
    }
    setLoading(false);
    const { data: refreshed } = await supabase.from('creatures').select('*').order('name');
    if (refreshed) {
      setCreatures(refreshed as unknown as Creature[]);
      const updated = refreshed.find((c: any) => c.id === savedId);
      if (updated) openEdit(updated as unknown as Creature);
    }
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from('creatures').delete().eq('id', id);
    if (error) return toast.error(error.message);
    toast.success('Creature deleted');
    if (selectedId === id) closePanel();
    loadData();
  };

  const previewStats = generateCreatureStats(form.level, form.rarity);
  const panelOpen = isNew || selectedId !== null;

  const formatRespawn = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  };

  const regionNames = [...new Set(nodes.map(n => n.region_name).filter(Boolean))].sort();

  const getNodeRegion = (nodeId: string | null) => {
    if (!nodeId) return '';
    return nodes.find(n => n.id === nodeId)?.region_name || '';
  };

  const hasNoLoot = (c: Creature) => !c.gold_enabled && !c.salvage_enabled && (c.item_source ?? 'none') === 'none';

  const RARITY_ORDER: Record<string, number> = { regular: 0, rare: 1, boss: 2 };

  const filtered = creatures.filter(c => {
    if (regionFilter === 'unassigned' && c.node_id) return false;
    if (showNoLoot && !hasNoLoot(c)) return false;
    if (rarityTab !== 'all' && c.rarity !== rarityTab) return false;
    if (typeTab === 'humanoid' && !c.is_humanoid) return false;
    if (typeTab === 'creature' && c.is_humanoid) return false;
    const matchesText = c.name.toLowerCase().includes(filter.toLowerCase()) ||
      c.rarity.includes(filter.toLowerCase()) ||
      getNodeName(c.node_id).toLowerCase().includes(filter.toLowerCase());
    const matchesRegion = regionFilter === 'all' || regionFilter === 'unassigned' || getNodeRegion(c.node_id) === regionFilter;
    const node = c.node_id ? nodes.find(n => n.id === c.node_id) : null;
    const matchesArea = areaFilter === 'all' || (node && node.area_id === areaFilter);
    return matchesText && matchesRegion && matchesArea;
  }).sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1;
    switch (sortBy) {
      case 'level': return (a.level - b.level) * dir;
      case 'rarity': return ((RARITY_ORDER[a.rarity] ?? 0) - (RARITY_ORDER[b.rarity] ?? 0)) * dir;
      case 'location': return getNodeName(a.node_id).localeCompare(getNodeName(b.node_id)) * dir;
      default: return a.name.localeCompare(b.name) * dir;
    }
  });

  const unassignedCount = creatures.filter(c => !c.node_id).length;
  const noLootCount = creatures.filter(hasNoLoot).length;

  const tools = (
    <>
      <AdminToolSection title="Search">
        <Input placeholder="Search..." value={filter} onChange={e => setFilter(e.target.value)} className="h-7 text-xs" />
        <Button size="sm" onClick={openNew} className="font-display text-xs h-7 w-full">
          <Plus className="w-3 h-3 mr-1" /> New Creature
        </Button>
        <button
          onClick={() => setShowNoLoot(v => !v)}
          className={`w-full px-2 py-1 rounded text-[10px] font-display transition-colors ${
            showNoLoot
              ? 'bg-amber-500/20 text-amber-400 border border-amber-500/50'
              : 'bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground border border-transparent'
          }`}
        >
          No Loot ({noLootCount})
        </button>
      </AdminToolSection>

      <AdminToolSection title="Region">
        <Select value={regionFilter} onValueChange={(v) => { setRegionFilter(v); setAreaFilter('all'); }}>
          <SelectTrigger className="w-full h-7 text-xs"><SelectValue placeholder="Region" /></SelectTrigger>
          <SelectContent className="bg-popover border-border z-50 max-h-60">
            <SelectItem value="all" className="text-xs">All Regions</SelectItem>
            <SelectItem value="unassigned" className="text-xs text-destructive"> Unassigned ({unassignedCount})</SelectItem>
            {regionNames.map(r => (
              <SelectItem key={r} value={r!} className="text-xs">{r}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {regionFilter !== 'all' && regionFilter !== 'unassigned' && (() => {
          const region = cmRegions.find(r => r.name === regionFilter);
          if (!region) return null;
          const regionNodeIds = new Set(nodes.filter(n => n.region_id === region.id).map(n => n.id));
          const areaIdsInRegion = new Set(
            nodes.filter(n => n.region_id === region.id && n.area_id).map(n => n.area_id as string)
          );
          const areasInRegion = cmAreas.filter(a => areaIdsInRegion.has(a.id)).sort((a, b) => a.name.localeCompare(b.name));
          if (areasInRegion.length === 0) return null;
          const countFor = (aid: string) =>
            creatures.filter(c => {
              if (!c.node_id || !regionNodeIds.has(c.node_id)) return false;
              const node = nodes.find(n => n.id === c.node_id);
              return node?.area_id === aid;
            }).length;
          return (
            <Select value={areaFilter} onValueChange={setAreaFilter}>
              <SelectTrigger className="w-full h-7 text-xs mt-1"><SelectValue placeholder="Area" /></SelectTrigger>
              <SelectContent className="bg-popover border-border z-50 max-h-60">
                <SelectItem value="all" className="text-xs">All Areas</SelectItem>
                {areasInRegion.map(a => (
                  <SelectItem key={a.id} value={a.id} className="text-xs">{a.name} ({countFor(a.id)})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          );
        })()}
      </AdminToolSection>

      <AdminToolSection title="Rarity">
        <div className="flex flex-wrap gap-1">
          {['all', ...RARITIES].map(r => {
            const count = creatures.filter(c => r === 'all' || c.rarity === r).length;
            return (
              <button
                key={r}
                onClick={() => setRarityTab(r)}
                className={`px-1.5 py-0.5 rounded text-[9px] font-display capitalize transition-colors ${
                  rarityTab === r
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                } ${r !== 'all' ? RARITY_COLORS[r] : ''}`}
              >
                {r === 'all' ? 'All' : r} ({count})
              </button>
            );
          })}
        </div>
      </AdminToolSection>

      <AdminToolSection title="Type">
        <div className="flex flex-wrap gap-1">
          {([
            { key: 'all', label: 'All' },
            { key: 'creature', label: 'Creature' },
            { key: 'humanoid', label: 'Humanoid' },
          ] as const).map(({ key, label }) => {
            const count = creatures.filter(c =>
              key === 'all' ? true : key === 'humanoid' ? c.is_humanoid : !c.is_humanoid
            ).length;
            return (
              <button
                key={key}
                onClick={() => setTypeTab(key)}
                className={`px-1.5 py-0.5 rounded text-[9px] font-display transition-colors ${
                  typeTab === key
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                {label} ({count})
              </button>
            );
          })}
        </div>
      </AdminToolSection>

      <AdminToolSection title="Sort">
        <div className="flex flex-wrap gap-1">
          {(['name', 'level', 'rarity', 'location'] as const).map(s => (
            <button
              key={s}
              onClick={() => {
                if (sortBy === s) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
                else { setSortBy(s); setSortDir('asc'); }
              }}
              className={`px-1.5 py-0.5 rounded text-[9px] font-display capitalize transition-colors ${
                sortBy === s
                  ? 'bg-primary/20 text-primary border border-primary/40'
                  : 'bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              }`}
            >
              {s}{sortBy === s ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
            </button>
          ))}
        </div>
      </AdminToolSection>
    </>
  );

  return (
    <AdminPageShell icon={<Skull className="w-4 h-4" />} title="Creatures" count={creatures.length} tools={tools}>
      <div className="flex-1 flex min-h-0">
      {/* Left: Creature List */}
      <div className="flex flex-col w-1/2 border-r border-border transition-all">
        <ScrollArea className="flex-1">
          <div className="p-3 space-y-1.5">
            {filtered.length === 0 ? (
              <AdminEmptyState message={creatures.length === 0 ? 'No creatures yet.' : 'No match.'} />
            ) : filtered.map(creature => (
              <div
                key={creature.id}
                className={`flex items-center justify-between p-2 rounded border transition-colors cursor-pointer ${
                  selectedId === creature.id ? 'border-primary bg-primary/10' : 'border-border bg-card/50 hover:bg-card/80'
                }`}
                onClick={() => openEdit(creature)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`font-display text-sm ${RARITY_COLORS[creature.rarity]}`}>{creature.name}</span>
                    <span className="text-[10px] text-muted-foreground capitalize px-1 py-0.5 rounded bg-background/50 border border-border">{creature.rarity}</span>
                    <span className="text-[10px] text-muted-foreground">Lvl {creature.level}</span>
                    {!creature.is_alive && <span className="text-[10px]"> </span>}
                    {creature.is_aggressive && <span className="text-[10px]"> </span>}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5">
                    <span className="text-xs text-muted-foreground"> {getNodeName(creature.node_id)}</span>
                    <span className="text-[10px] text-muted-foreground">HP {creature.hp}/{creature.max_hp} | AC {creature.ac}</span>
                  </div>
                </div>
                <Button size="sm" variant="destructive" onClick={(e) => { e.stopPropagation(); handleDelete(creature.id); }} className="h-7 w-7 p-0 shrink-0 ml-2">
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
          <AdminEditorHeader title={selectedId ? `Edit: ${form.name || 'Creature'}` : 'New Creature'} onClose={closePanel} />
          <ScrollArea className="flex-1">
            <div className="p-3 space-y-3">
              <Input placeholder="Creature name" value={form.name} maxLength={100}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="h-8 text-xs" />
              <Textarea placeholder="Description" value={form.description} maxLength={2000}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} className="text-xs" />

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-muted-foreground">Rarity</label>
                  <Select value={form.rarity} onValueChange={v => setForm(f => ({ ...f, rarity: v }))}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent className="bg-popover border-border z-50">
                      {RARITIES.map(r => (
                        <SelectItem key={r} value={r} className="capitalize text-xs">
                          <span className={RARITY_COLORS[r]}>{r}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground">Level</label>
                  <Input type="number" min={1} value={form.level}
                    onChange={e => setForm(f => ({ ...f, level: Math.max(1, +e.target.value) }))}
                    className="h-8 text-xs" />
                </div>
              </div>

              <AdminFormSection title="Spawn & Behavior">
                <div>
                  <label className="text-[10px] text-muted-foreground">Spawn Location</label>
                  <NodePicker
                    nodes={nodes}
                    regions={cmRegions}
                    areas={cmAreas}
                    value={form.node_id}
                    onChange={v => setForm(f => ({ ...f, node_id: v }))}
                    allowNone
                    placeholder="Select node"
                  />
                </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-muted-foreground">Respawn (seconds)</label>
                  <div className="flex items-center gap-1">
                    <Input type="number" min={0} value={form.respawn_seconds}
                      onChange={e => setForm(f => ({ ...f, respawn_seconds: Math.max(0, +e.target.value) }))}
                      className="h-8 text-xs" />
                    <span className="text-[10px] text-muted-foreground whitespace-nowrap">({formatRespawn(form.respawn_seconds)})</span>
                  </div>
                </div>
                <div className="flex flex-col items-start gap-1.5 pb-1">
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <input type="checkbox" checked={form.is_aggressive}
                      onChange={e => setForm(f => ({ ...f, is_aggressive: e.target.checked }))} />
                    Aggressive
                  </label>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <input type="checkbox" checked={form.is_humanoid}
                      onChange={e => setForm(f => ({ ...f, is_humanoid: e.target.checked }))} />
                    Humanoid
                  </label>
                </div>
              </div>
              </AdminFormSection>

              <AdminFormSection title="Stats" description={`Auto-generated for Lvl ${form.level} ${form.rarity}`}>
              <div className="p-2 bg-background/50 rounded border border-border">
                <div className="grid grid-cols-4 gap-x-3 gap-y-0.5 text-xs">
                  <span>HP: <strong>{previewStats.hp}</strong></span>
                  <span>AC: <strong>{previewStats.ac}</strong></span>
                  <span>STR: <strong>{previewStats.stats.str}</strong></span>
                  <span>DEX: <strong>{previewStats.stats.dex}</strong></span>
                </div>
                <div className="mt-1.5 pt-1.5 border-t border-border/50 flex items-center gap-3 text-xs">
                  <span> Damage: <strong className="text-primary">1d{getCreatureDamageDie(form.level, form.rarity)} + {getStatModifier(previewStats.stats.str)}</strong></span>
                  <span className="text-muted-foreground">({1 + getStatModifier(previewStats.stats.str)}–{getCreatureDamageDie(form.level, form.rarity) + getStatModifier(previewStats.stats.str)})</span>
                </div>
              </div>
              </AdminFormSection>

              {/* World Emote on Death — atmospheric narration broadcast to all players when this boss dies */}
              {form.rarity === 'boss' && (
                <div className="space-y-1.5">
                  <p className="font-display text-xs text-primary">World Emote on Death</p>
                  <p className="text-[10px] text-muted-foreground">
                    An atmospheric line shown to all players when this boss dies. Written as world narration, not the boss speaking.
                    Broadcast verbatim, prefixed with <span className="font-mono"> </span>. Use <span className="font-mono">%a</span> for the killer's name. Leave empty to disable.
                  </p>
                  <Textarea
                    value={form.boss_death_cry}
                    onChange={e => setForm(f => ({ ...f, boss_death_cry: e.target.value }))}
                    placeholder="For a brief moment, something feels… missing. Then the world settles, as if correcting itself."
                    rows={3}
                    maxLength={300}
                    className="text-xs"
                  />
                </div>
              )}

              {/* Telegraphed cast — bosses by default, rares opt-in (unified card) */}
              {(form.rarity === 'boss' || form.rarity === 'rare') && (
                <div className="space-y-1.5 p-2 border border-border rounded bg-background/50">
                  <div className="flex items-center justify-between">
                    <p className="font-display text-xs text-primary">
                      {form.rarity === 'boss' ? 'Boss Cast' : 'Telegraphed Cast (Rare)'}
                    </p>
                    <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={form.boss_cast_enabled}
                        onChange={e => setForm(f => ({ ...f, boss_cast_enabled: e.target.checked }))}
                      />
                      Enabled
                    </label>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    Targets are chosen from living participants when the cast completes. The boss does not perform a basic attack while starting, continuing, or resolving a cast.
                  </p>
                  {form.boss_cast_enabled && (
                    <>
                      <label className="text-[10px] text-muted-foreground block">
                        Cast label
                        <Input
                          value={form.boss_cast_label}
                          onChange={e => setForm(f => ({ ...f, boss_cast_label: e.target.value }))}
                          placeholder="Cataclysm"
                          className="h-7 text-xs mt-0.5"
                        />
                      </label>
                      <label className="text-[10px] text-muted-foreground block">
                        Stable ability key
                        <Input
                          value={form.boss_cast_ability_key}
                          onChange={e => setForm(f => ({ ...f, boss_cast_ability_key: e.target.value }))}
                          placeholder="Generated from label and creature ID for a new cast"
                          className="h-7 text-xs font-mono mt-0.5"
                        />
                        <span className="text-[9px] opacity-70">Changing the label does not change an existing key.</span>
                      </label>
                      <label className="text-[10px] text-muted-foreground block">
                        Damage type
                        <Select
                          value={form.boss_cast_damage_type || DAMAGE_TYPE_NONE}
                          onValueChange={v => setForm(f => ({ ...f, boss_cast_damage_type: v === DAMAGE_TYPE_NONE ? '' : v }))}
                        >
                          <SelectTrigger className="h-7 text-xs mt-0.5">
                            <SelectValue placeholder="Damage type (optional)" />
                          </SelectTrigger>
                          <SelectContent className="bg-popover border-border z-50">
                            <SelectItem value={DAMAGE_TYPE_NONE} className="text-xs">— No damage type —</SelectItem>
                            {DAMAGE_TYPES.map(d => (
                              <SelectItem key={d.value} value={d.value} className="text-xs">{d.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </label>
                      <label className="text-[10px] text-muted-foreground block">
                        Targeting at resolution
                        <Select value={form.boss_cast_targeting} onValueChange={v => setForm(f => ({ ...f, boss_cast_targeting: v as typeof f.boss_cast_targeting }))}>
                          <SelectTrigger className="h-7 text-xs mt-0.5"><SelectValue /></SelectTrigger>
                          <SelectContent className="bg-popover border-border z-50">
                            <SelectItem value="current_tank_at_resolution" className="text-xs">Current authoritative tank</SelectItem>
                            <SelectItem value="all_present_at_resolution" className="text-xs">All living present participants</SelectItem>
                            <SelectItem value="tank_plus_others" className="text-xs">Tank primary + everyone else secondary</SelectItem>
                            <SelectItem value="random_present_at_resolution" className="text-xs">One random living present participant</SelectItem>
                          </SelectContent>
                        </Select>
                      </label>

                      <div className="grid grid-cols-2 gap-1">
                        <label className="text-[10px] text-muted-foreground">
                          Primary damage
                          <Input
                            type="number" min={0} step={1}
                            value={form.boss_cast_base_amount}
                            onChange={e => setForm(f => ({ ...f, boss_cast_base_amount: Number(e.target.value) }))}
                            className="h-7 text-xs"
                          />
                        </label>
                        {form.boss_cast_targeting === 'tank_plus_others' && <label className="text-[10px] text-muted-foreground">
                          Secondary damage to everyone else
                          <Input
                            type="number" min={0} step={1}
                            value={form.boss_cast_base_aoe_amount}
                            onChange={e => setForm(f => ({ ...f, boss_cast_base_aoe_amount: Number(e.target.value) }))}
                            className="h-7 text-xs"
                          />
                        </label>}
                        <label className="text-[10px] text-muted-foreground">
                          Selection weight
                          <Input
                            type="number"
                            step={0.01}
                            min={0}
                            value={form.boss_cast_selection_weight}
                            onChange={e => setForm(f => ({ ...f, boss_cast_selection_weight: Number(e.target.value) }))}
                            className="h-7 text-xs"
                          />
                          <span className="text-[9px] opacity-70">Deterministic relative selection among available casts; not an independent percentage.</span>
                        </label>
                        <label className="text-[10px] text-muted-foreground">
                          Cooldown ticks
                          <Input
                            type="number"
                            min={0}
                            step={1}
                            value={form.boss_cast_cooldown_ticks}
                            onChange={e => setForm(f => ({ ...f, boss_cast_cooldown_ticks: Number(e.target.value) }))}
                            className="h-7 text-xs"
                          />
                          <span className="text-[9px] opacity-70">= {Math.max(0, Math.floor(form.boss_cast_cooldown_ticks)) * TICK_RATE_MS / 1000}s</span>
                        </label>
                        <label className="text-[10px] text-muted-foreground">
                          Windup ticks
                          <Input
                            type="number"
                            min={1}
                            step={1}
                            value={form.boss_cast_windup_ticks}
                            onChange={e => setForm(f => ({ ...f, boss_cast_windup_ticks: Number(e.target.value) }))}
                            className="h-7 text-xs"
                          />
                          <span className="text-[9px] opacity-70">= {Math.max(1, Math.floor(form.boss_cast_windup_ticks)) * TICK_RATE_MS / 1000}s</span>
                        </label>
                      </div>
                    </>
                  )}
                </div>
              )}



              {/* Boss Crit Flavors */}
              <div className="space-y-1.5">
                <p className="font-display text-xs text-primary">Boss Crit Flavors</p>
                <p className="text-[10px] text-muted-foreground">
                  Optional. Same placeholders as Boss Cast flavor: <span className="font-mono">{FLAVOR_TOKENS}</span> (legacy <span className="font-mono">%a/%e/%v</span> still works).
                  Example: "{'{creature}'} unleashes fire upon {'{target}'}".
                </p>

                {form.boss_crit_flavors.map((flavor, idx) => (
                  <div key={idx} className="p-2 bg-background/50 rounded border border-border space-y-1">
                    <div className="flex items-center gap-1">
                      <Input
                        value={flavor.name}
                        onChange={e => {
                          const updated = [...form.boss_crit_flavors];
                          updated[idx] = { ...updated[idx], name: e.target.value };
                          setForm(f => ({ ...f, boss_crit_flavors: updated }));
                        }}
                        placeholder="Fire Breath"
                        className="flex-1 h-7 text-xs"
                      />
                      <Input
                        type="number"
                        value={flavor.weight}
                        onChange={e => {
                          const updated = [...form.boss_crit_flavors];
                          updated[idx] = { ...updated[idx], weight: Number(e.target.value) };
                          setForm(f => ({ ...f, boss_crit_flavors: updated }));
                        }}
                        placeholder="1"
                        className="w-14 h-7 text-xs"
                        min={1}
                      />
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => {
                        setForm(f => ({ ...f, boss_crit_flavors: f.boss_crit_flavors.filter((_, i) => i !== idx) }));
                      }}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                    <Input
                      value={flavor.text}
                      onChange={e => {
                        const updated = [...form.boss_crit_flavors];
                        updated[idx] = { ...updated[idx], text: e.target.value };
                        setForm(f => ({ ...f, boss_crit_flavors: updated }));
                      }}
                      placeholder="{creature} unleashes a searing breath upon {target}"
                      className="h-7 text-xs"
                    />
                    <Select
                      value={flavor.damage_type || DAMAGE_TYPE_NONE}
                      onValueChange={v => {
                        const updated = [...form.boss_crit_flavors];
                        updated[idx] = { ...updated[idx], damage_type: v === DAMAGE_TYPE_NONE ? '' : v };
                        setForm(f => ({ ...f, boss_crit_flavors: updated }));
                      }}
                    >
                      <SelectTrigger className="h-7 text-[10px] text-muted-foreground">
                        <SelectValue placeholder="Damage type (optional)" />
                      </SelectTrigger>
                      <SelectContent className="bg-popover border-border z-50">
                        <SelectItem value={DAMAGE_TYPE_NONE} className="text-xs">— No damage type —</SelectItem>
                        {DAMAGE_TYPES.map(d => (
                          <SelectItem key={d.value} value={d.value} className="text-xs">{d.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {flavor.text && (
                      <p className="text-[9px] text-muted-foreground italic truncate">
                        Preview:                         {renderFlavor(flavor.text, {
                          creature: form.name || 'Dragon',
                          target: 'Hero',
                          cast: flavor.name || '',
                          damage: 25,
                        })}!
                      </p>
                    )}

                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full h-7 text-xs"
                  onClick={() => setForm(f => ({
                    ...f,
                    boss_crit_flavors: [...f.boss_crit_flavors, { name: '', text: '', weight: 1, damage_type: '' }],
                  }))}
                >
                  <Plus className="h-3 w-3 mr-1" /> Add Flavor
                </Button>
              </div>

              <AdminFormSection title="Rewards" description="Gold and salvage are independent. Item source is exclusive.">
                <label className="flex gap-2 text-xs"><input type="checkbox" checked={form.gold_enabled} onChange={e=>setForm(f=>({...f,gold_enabled:e.target.checked}))}/>Gold</label>
                <label className="flex gap-2 text-xs"><input type="checkbox" checked={form.salvage_enabled} onChange={e=>setForm(f=>({...f,salvage_enabled:e.target.checked}))}/>Salvage</label>
                <p className="text-[9px] text-muted-foreground">Salvage grants every qualified recipient 1 / 2 / 4 for regular / rare / boss.</p>
                {form.gold_enabled && <>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-[10px] text-muted-foreground">Min</label>
                    <Input type="number" min={0} value={form.gold_min}
                      onChange={e => setForm(f => ({ ...f, gold_min: Math.max(0, +e.target.value) }))}
                      className="h-7 text-xs" />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground">Max</label>
                    <Input type="number" min={0} value={form.gold_max}
                      onChange={e => setForm(f => ({ ...f, gold_max: Math.max(0, +e.target.value) }))}
                      className="h-7 text-xs" />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground">Chance</label>
                    <Input type="number" min={0} max={1} step={0.05} value={form.gold_chance}
                      onChange={e => setForm(f => ({ ...f, gold_chance: Math.min(1, Math.max(0, +e.target.value)) }))}
                      className="h-7 text-xs" />
                  </div>
                </div>
                </>}
                <label className="text-[10px] text-muted-foreground">Item source</label>
                <Select value={form.item_source} onValueChange={v=>setForm(f=>({...f,item_source:v as typeof f.item_source,loot_table_id:v==='assigned_table'?f.loot_table_id:null,unique_item_id:v==='unique_boss_drop'?f.unique_item_id:null}))}>
                  <SelectTrigger className="h-8"><SelectValue/></SelectTrigger><SelectContent>
                    <SelectItem value="none">No item drop</SelectItem><SelectItem value="world_pool">World item pool</SelectItem><SelectItem value="assigned_table">Assigned loot table</SelectItem>{form.rarity==='boss'&&<SelectItem value="unique_boss_drop">Unique boss drop</SelectItem>}
                  </SelectContent>
                </Select>
                {form.item_source==='world_pool'&&<><label className="text-[10px] text-muted-foreground">Overall item drop chance</label><Input type="number" min={0} max={1} step={0.05} value={form.drop_chance} onChange={e=>setForm(f=>({...f,drop_chance:+e.target.value}))}/><p className="text-[9px] text-muted-foreground">Global rarity chances and level ranges are managed under Pool Rules.</p></>}
                {form.item_source==='assigned_table'&&<><LootTablePicker tables={lootTables} value={form.loot_table_id} onChange={v=>setForm(f=>({...f,loot_table_id:v}))} placeholder="Select loot table"/><label className="text-[10px] text-muted-foreground">Overall item drop chance</label><Input type="number" min={0} max={1} step={0.05} value={form.drop_chance} onChange={e=>setForm(f=>({...f,drop_chance:+e.target.value}))}/></>}
                {form.item_source==='unique_boss_drop'&&<><Select value={form.unique_item_id??''} onValueChange={v=>setForm(f=>({...f,unique_item_id:v}))}><SelectTrigger><SelectValue placeholder="Unique item"/></SelectTrigger><SelectContent>{uniqueItems.filter(i=>i.origin_id===selectedId||i.origin_id===newCreatureId).map(i=><SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>)}</SelectContent></Select><Input type="number" min={0} max={1} step={0.05} value={form.unique_drop_chance??0} onChange={e=>setForm(f=>({...f,unique_drop_chance:+e.target.value}))}/><p className="text-[9px] text-muted-foreground">Only one copy may exist globally. It drops on the ground and may be stolen.</p></>}
              </AdminFormSection>

              <AdminStickyActions onSave={handleSave} onCancel={closePanel} saveLabel={selectedId ? 'Update' : 'Create'} loading={loading} />
            </div>
          </ScrollArea>
          </>
        ) : (
          <AdminEmptyState message="Select a creature to edit" />
        )}
      </div>
      </div>
    </AdminPageShell>
  );
}
