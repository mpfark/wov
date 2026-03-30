import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  Loader2, Wand2, Check, Package, Sword, Sparkles,
  ChevronRight, Layers, Star, Hash, BarChart2, ArrowRight,
} from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import CreaturePicker from './CreaturePicker';



/* ─── Types ─────────────────────────────────────────────── */

interface ForgedItem {
  name: string;
  description: string;
  item_type: 'equipment' | 'consumable';
  rarity: 'common' | 'uncommon';
  slot: string | null;
  level: number;
  hands: number | null;
  stats: Record<string, number>;
  value: number;
  max_durability: number;
  drop_chance: number;
}

interface LootTable { id: string; name: string; }
interface Creature { id: string; name: string; level: number; rarity: string; node_id: string | null; loot_table_id: string | null; }

/* ─── Constants ─────────────────────────────────────────── */

const ITEM_RARITY_COLORS: Record<string, string> = {
  common: 'text-muted-foreground',
  uncommon: 'text-elvish',
  rare: 'text-blue-400',
};

const SLOT_GROUPS = [
  { label: '— Any —', value: 'random' },
  { label: '⚔ Any Weapon', value: 'any_weapon' },
  { label: '🛡 Any Armor', value: 'any_armor' },
  { label: '💍 Any Accessory', value: 'any_accessory' },
  { label: '─ Specific ─', value: '__divider__', disabled: true },
  { label: 'Main Hand', value: 'main_hand' },
  { label: 'Off Hand', value: 'off_hand' },
  { label: 'Head', value: 'head' },
  { label: 'Chest', value: 'chest' },
  { label: 'Shoulders', value: 'shoulders' },
  { label: 'Gloves', value: 'gloves' },
  { label: 'Belt', value: 'belt' },
  { label: 'Pants', value: 'pants' },
  { label: 'Boots', value: 'boots' },
  { label: 'Amulet', value: 'amulet' },
  { label: 'Ring', value: 'ring' },
  { label: 'Trinket', value: 'trinket' },
];

const STAT_LABELS: Record<string, string> = {
  str: 'STR', dex: 'DEX', con: 'CON', int: 'INT', wis: 'WIS', cha: 'CHA',
  ac: 'AC', hp: 'HP', hp_regen: 'HP Regen',
};

/* ─── Component ─────────────────────────────────────────── */

interface ItemForgePanelProps {
  onDataChanged?: () => void;
}

export default function ItemForgePanel({ onDataChanged }: ItemForgePanelProps = {}) {
  /* Forge mode */
  const [forgeMode, setForgeMode] = useState<'loot_table' | 'single'>('loot_table');

  /* Generation params */
  const [count, setCount] = useState(6);
  const [levelMin, setLevelMin] = useState(1);
  const [levelMax, setLevelMax] = useState(10);
  const [itemType, setItemType] = useState<string>('random');
  const [slot, setSlot] = useState<string>('random');
  const [rarity, setRarity] = useState<string>('random');
  const [statsFocus, setStatsFocus] = useState<string>('random');
  const [prompt, setPrompt] = useState('');

  /* Output / loot table */
  const [tableName, setTableName] = useState('');
  const [generated, setGenerated] = useState<ForgedItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [savedTableId, setSavedTableId] = useState<string | null>(null);
  const [savedItemIds, setSavedItemIds] = useState<string[]>([]);

  /* For assigning table to creatures */
  const [creatures, setCreatures] = useState<Creature[]>([]);
  const [_lootTables, setLootTables] = useState<LootTable[]>([]);
  const [assignCreatureId, setAssignCreatureId] = useState<string>('');
  const [assigning, setAssigning] = useState(false);

  const loadSupport = useCallback(async () => {
    const [crRes, ltRes] = await Promise.all([
      supabase.from('creatures').select('id, name, level, rarity, node_id, loot_table_id').order('name'),
      supabase.from('loot_tables').select('id, name').order('name'),
    ]);
    setCreatures(crRes.data || []);
    setLootTables(ltRes.data || []);
  }, []);

  useEffect(() => { loadSupport(); }, [loadSupport]);

  /* Validate level range */
  const safeMin = Math.max(1, Math.min(levelMin, levelMax));
  const safeMax = Math.max(safeMin, levelMax);

  /* ── Generate ── */
  const generate = async () => {
    setLoading(true);
    setGenerated([]);
    setSavedTableId(null);
    setSavedItemIds([]);
    const actualCount = forgeMode === 'single' ? 1 : count;
    try {
      const { data, error } = await supabase.functions.invoke('ai-item-forge', {
        body: {
          prompt: prompt.trim() || undefined,
          count: actualCount,
          level_min: safeMin,
          level_max: safeMax,
          item_type: itemType,
          slot,
          rarity,
          stats_focus: statsFocus,
        },
      });
      if (error) throw error;
      if (data?.error) {
        if (data.error.includes('Rate limit') || data.status === 429) {
          toast.error('Rate limit hit — wait a moment and try again.');
        } else if (data.error.includes('credits') || data.status === 402) {
          toast.error('AI credits exhausted. Add funds in Settings → Workspace → Usage.');
        } else {
          throw new Error(data.error);
        }
        return;
      }
      const items: ForgedItem[] = data.items || [];
      if (items.length === 0) {
        toast.warning('No items were generated. Try adjusting the parameters.');
        return;
      }
      setGenerated(items);
      // Auto-suggest a table name (only for loot table mode)
      if (forgeMode === 'loot_table' && !tableName) {
        const slotLabel = slot === 'random' ? 'Mixed' : SLOT_GROUPS.find(s => s.value === slot)?.label?.replace(/[⚔🛡💍─ ]/g, '').trim() || slot;
        const rarLabel = rarity === 'random' ? '' : ` (${rarity})`;
        setTableName(`Lv${safeMin}-${safeMax} ${slotLabel}${rarLabel} Drops`);
      }
      if (forgeMode === 'single') {
        toast.success(`Item generated — review and save below.`);
      } else {
        toast.success(`${items.length} items generated — name the table and apply below.`);
      }
    } catch (e: any) {
      toast.error(e.message || 'Generation failed');
    } finally {
      setLoading(false);
    }
  };

  /* ── Apply: create loot table + entries ── */
  const applyAll = async () => {
    if (generated.length === 0) return;
    setApplying(true);
    try {
      {
        // Insert items into items table
        const insertedIds: Array<{ item_id: string; drop_chance: number }> = [];
        for (const item of generated) {
          const { data: itemData, error: itemErr } = await supabase
            .from('items')
            .insert({
              name: item.name,
              description: item.description,
              item_type: item.item_type,
              rarity: item.rarity as any,
              slot: item.slot as any || null,
              level: item.level,
              hands: item.hands || null,
              stats: item.stats || {},
              value: item.value,
              max_durability: 100,
            })
            .select('id')
            .single();
          if (itemErr) throw itemErr;
          insertedIds.push({ item_id: itemData.id, drop_chance: item.drop_chance });
        }

        if (forgeMode === 'single') {
          setSavedItemIds(insertedIds.map(i => i.item_id));
          toast.success(`Item "${generated[0].name}" saved to the database!`);
          onDataChanged?.();
        } else {
          if (!tableName.trim()) { toast.error('Enter a loot table name first.'); setApplying(false); return; }

          const { data: ltData, error: ltErr } = await supabase
            .from('loot_tables')
            .insert({ name: tableName.trim() })
            .select('id')
            .single();
          if (ltErr) throw ltErr;

          for (const { item_id, drop_chance } of insertedIds) {
            const weight = Math.round(drop_chance * 100);
            const { error: lteErr } = await supabase
              .from('loot_table_entries')
              .insert({ loot_table_id: ltData.id, item_id, weight });
            if (lteErr) throw lteErr;
          }

          setSavedTableId(ltData.id);
          toast.success(`Loot table "${tableName}" created with ${generated.length} items!`);
          await loadSupport();
          onDataChanged?.();
        }
      }
    } catch (e: any) {
      toast.error(e.message || 'Apply failed');
    } finally {
      setApplying(false);
    }
  };

  /* ── Assign table to creature ── */
  const assignToCreature = async () => {
    if (!assignCreatureId || !savedTableId) return;
    setAssigning(true);
    try {
      const maxDrop = Math.max(...generated.map(i => i.drop_chance), 0.3);
      const { error } = await supabase
        .from('creatures')
        .update({ loot_table_id: savedTableId, drop_chance: maxDrop, loot_table: [] })
        .eq('id', assignCreatureId);
      if (error) throw error;
      const name = creatures.find(c => c.id === assignCreatureId)?.name || 'Creature';
      toast.success(`Assigned to ${name}`);
      setAssignCreatureId('');
      await loadSupport();
      onDataChanged?.();
    } catch (e: any) {
      toast.error(e.message || 'Assignment failed');
    } finally {
      setAssigning(false);
    }
  };

  /* ─── Render ─────────────────────────────────────────── */
  return (
    <div className="flex h-full min-h-0 overflow-hidden">

      {/* ── Left: Generation Controls ── */}
      <div className="w-72 shrink-0 flex flex-col border-r border-border bg-card/30 min-h-0">
        <div className="px-3 py-2 border-b border-border bg-card/50 shrink-0 flex items-center gap-2">
          <Wand2 className="w-3.5 h-3.5 text-primary" />
          <span className="font-display text-xs text-primary">Forge Parameters</span>
        </div>

        <ScrollArea className="flex-1 min-h-0">
          <div className="p-3 space-y-4">

            {/* Forge Mode */}
            <div className="space-y-1.5">
              <Label className="text-[10px] text-muted-foreground font-display flex items-center gap-1">
                <Layers className="w-3 h-3" /> Forge Mode
              </Label>
               <Select value={forgeMode} onValueChange={(v) => { setForgeMode(v as any); setGenerated([]); setSavedTableId(null); setSavedItemIds([]); }}>
                <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="loot_table">📦 Loot Table (batch)</SelectItem>
                  <SelectItem value="single">🔮 Single Item</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Count (only for loot table mode) */}
            {forgeMode !== 'single' && (
            <div className="space-y-1.5">
              <Label className="text-[10px] text-muted-foreground font-display flex items-center gap-1">
                <Hash className="w-3 h-3" /> Items to Generate
              </Label>
              <div className="flex items-center gap-2">
                <Slider
                  value={[count]}
                  onValueChange={([v]) => setCount(v)}
                  min={1} max={20} step={1}
                  className="flex-1"
                />
                <span className="text-xs font-mono text-primary w-5 text-right">{count}</span>
              </div>
            </div>
            )}

            {/* Level Range */}
            <div className="space-y-1.5">
              <Label className="text-[10px] text-muted-foreground font-display flex items-center gap-1">
                <BarChart2 className="w-3 h-3" /> Level Range
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number" min={1} max={99}
                  value={levelMin}
                  onChange={e => setLevelMin(Math.max(1, parseInt(e.target.value) || 1))}
                  className="h-7 text-xs text-center w-16"
                />
                <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" />
                <Input
                  type="number" min={1} max={99}
                  value={levelMax}
                  onChange={e => setLevelMax(Math.max(levelMin, parseInt(e.target.value) || 1))}
                  className="h-7 text-xs text-center w-16"
                />
              </div>
              {levelMin > levelMax && (
                <p className="text-[9px] text-destructive">Min must be ≤ max</p>
              )}
            </div>

            {/* Item Type */}
            <div className="space-y-1.5">
              <Label className="text-[10px] text-muted-foreground font-display flex items-center gap-1">
                <Package className="w-3 h-3" /> Item Type
              </Label>
              <Select value={itemType} onValueChange={setItemType}>
                <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="random">🎲 Random mix</SelectItem>
                  <SelectItem value="equipment">⚔ Equipment only</SelectItem>
                  <SelectItem value="consumable">🧪 Consumables only</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Slot */}
            {itemType !== 'consumable' && (
              <div className="space-y-1.5">
                <Label className="text-[10px] text-muted-foreground font-display flex items-center gap-1">
                  <Sword className="w-3 h-3" /> Equipment Slot
                </Label>
                <Select value={slot} onValueChange={setSlot}>
                  <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent className="max-h-64">
                    {SLOT_GROUPS.map(s =>
                      s.disabled ? (
                        <div key={s.value} className="px-2 py-1 text-[10px] text-muted-foreground/50 select-none">{s.label}</div>
                      ) : (
                        <SelectItem key={s.value} value={s.value} className="text-xs">{s.label}</SelectItem>
                      )
                    )}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Rarity */}
            <div className="space-y-1.5">
              <Label className="text-[10px] text-muted-foreground font-display flex items-center gap-1">
                <Star className="w-3 h-3" /> Rarity
              </Label>
              <Select value={rarity} onValueChange={setRarity}>
                <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="random">🎲 Mixed</SelectItem>
                  <SelectItem value="common">Common</SelectItem>
                  <SelectItem value="uncommon">Uncommon</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Stat Focus */}
            <div className="space-y-1.5">
              <Label className="text-[10px] text-muted-foreground font-display flex items-center gap-1">
                <Sparkles className="w-3 h-3" /> Stat Focus
              </Label>
              <Select value={statsFocus} onValueChange={setStatsFocus}>
                <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="random">🎲 Random</SelectItem>
                  <SelectItem value="offensive">⚔ Offensive (STR/DEX/INT)</SelectItem>
                  <SelectItem value="defensive">🛡 Defensive (CON/AC/HP)</SelectItem>
                  <SelectItem value="utility">✨ Utility (WIS/CHA/INT)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Flavor Prompt */}
            <div className="space-y-1.5">
              <Label className="text-[10px] text-muted-foreground font-display">Flavor Prompt (optional)</Label>
              <Textarea
                placeholder="e.g. 'dark cult relics', 'worn bandit gear', 'elven forest drops'…"
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                className="text-xs min-h-[60px] resize-none"
              />
            </div>

            {/* Generate Button */}
            <Button
              onClick={generate}
              disabled={loading || levelMin > levelMax}
              size="sm"
              className="w-full font-display text-xs"
            >
              {loading
                ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" />Forging…</>
                : <><Wand2 className="w-3 h-3 mr-1" />{forgeMode === 'single' ? 'Forge Item' : `Forge ${count} Items`}</>}
            </Button>

          </div>
        </ScrollArea>
      </div>

      {/* ── Right: Preview + Apply ── */}
      <div className="flex-1 flex flex-col min-h-0">

        {/* Apply bar */}
        {generated.length > 0 && !loading && (
          <div className="px-4 py-2.5 border-b border-border bg-card/50 shrink-0 space-y-2">
            {forgeMode === 'loot_table' ? (
              <>
                <div className="flex items-center gap-2">
                  <Layers className="w-3.5 h-3.5 text-primary" />
                  <span className="font-display text-xs text-primary">Save as Loot Table</span>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    placeholder="Loot table name…"
                    value={tableName}
                    onChange={e => setTableName(e.target.value)}
                    className="h-7 text-xs flex-1"
                  />
                  <Button
                    onClick={applyAll}
                    disabled={applying || !tableName.trim()}
                    size="sm"
                    className="font-display text-xs shrink-0"
                  >
                    {applying
                      ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" />Saving…</>
                      : <><Check className="w-3 h-3 mr-1" />Apply ({generated.length})</>}
                  </Button>
                </div>

                {/* Assign to creature (after save) */}
                {savedTableId && (
                  <div className="flex items-center gap-2 pt-1 border-t border-border">
                    <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />
                    <span className="text-[10px] text-muted-foreground shrink-0">Assign to creature:</span>
                    <div className="flex-1">
                      <CreaturePicker
                        creatures={creatures}
                        value={assignCreatureId || null}
                        onChange={v => setAssignCreatureId(v || '')}
                        placeholder="Pick a creature…"
                        className="h-6"
                      />
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 text-[10px] px-2 shrink-0"
                      disabled={!assignCreatureId || assigning}
                      onClick={assignToCreature}
                    >
                      {assigning ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : 'Assign'}
                    </Button>
                  </div>
                )}
              </>
            ) : (
              <div className="flex items-center gap-2">
                <Package className="w-3.5 h-3.5 text-primary" />
                <span className="font-display text-xs text-primary">Save Single Item</span>
                <div className="flex-1" />
                <Button
                  onClick={applyAll}
                  disabled={applying || savedItemIds.length > 0}
                  size="sm"
                  className="font-display text-xs shrink-0"
                >
                  {applying
                    ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" />Saving…</>
                    : savedItemIds.length > 0
                      ? <><Check className="w-3 h-3 mr-1" />Saved</>
                      : <><Check className="w-3 h-3 mr-1" />Save to Items</>}
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Item Preview */}
        <ScrollArea className="flex-1 min-h-0">
          {generated.length === 0 && !loading && (
            <div className="flex flex-col items-center justify-center h-full text-center p-8 gap-3">
              <Wand2 className="w-10 h-10 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">Configure parameters and forge items to preview them here.</p>
              <p className="text-xs text-muted-foreground/60">
                {forgeMode === 'single'
                  ? 'Generate a single item to save directly to the database.'
                  : 'The generated items will form a reusable loot table you can assign to any creature.'}
              </p>
            </div>
          )}

          {loading && (
            <div className="flex flex-col items-center justify-center h-full gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">The forge is working…</p>
            </div>
          )}

          {generated.length > 0 && !loading && (
            <div className="p-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {generated.map((item, i) => (
                <Card key={i} className="p-3 space-y-1.5 bg-card/50 hover:bg-card/70 transition-colors">
                  {/* Name + rarity */}
                  <div className="flex items-start justify-between gap-1">
                    <span className={`font-display text-xs font-semibold leading-tight ${ITEM_RARITY_COLORS[item.rarity]}`}>
                      {item.name}
                    </span>
                    <span className={`text-[9px] shrink-0 ${ITEM_RARITY_COLORS[item.rarity]}`}>{item.rarity}</span>
                  </div>

                  {/* Description */}
                  <p className="text-[10px] text-muted-foreground leading-snug">{item.description}</p>

                  {/* Meta row */}
                  <div className="flex flex-wrap items-center gap-1 text-[9px] text-muted-foreground">
                    <span className="bg-muted/50 rounded px-1 py-0.5">Lv {item.level}</span>
                    {item.item_type === 'equipment' && item.slot && (
                      <span className="bg-muted/50 rounded px-1 py-0.5">{item.slot.replace('_', ' ')}</span>
                    )}
                    {item.hands === 2 && <span className="bg-muted/50 rounded px-1 py-0.5">2H</span>}
                    {item.item_type === 'consumable' && (
                      <span className="bg-muted/50 rounded px-1 py-0.5 text-accent-foreground">consumable</span>
                    )}
                    <span className="ml-auto">{item.value}g · {Math.round(item.drop_chance * 100)}% drop</span>
                  </div>

                  {/* Stats */}
                  {item.stats && Object.keys(item.stats).length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-0.5">
                      {Object.entries(item.stats).map(([k, v]) => (
                        <span
                          key={k}
                          className="text-[9px] px-1 py-0.5 rounded bg-primary/10 text-primary font-mono leading-none"
                        >
                          +{v} {STAT_LABELS[k] || k}
                        </span>
                      ))}
                    </div>
                  )}
                </Card>
              ))}
            </div>
          )}
        </ScrollArea>
      </div>
    </div>
  );
}
