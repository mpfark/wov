import { useState, useEffect, useCallback, useMemo } from 'react';
import { useActivityLog } from '@/hooks/useActivityLog';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from 'sonner';
import { Search, KeyRound, Shield, Ban, UserCheck, Pencil, Save, X, ScrollText, Gift, MapPin, Sparkles, Heart, Trash2, RotateCcw } from 'lucide-react';
import { CLASS_LABELS, RACE_LABELS, STAT_LABELS, getStatModifier, getXpForLevel, CLASS_PRIMARY_STAT, getCpRegenRate, getCharacterTitle } from '@/lib/game-data';

interface AdminInventoryItem {
  id: string;
  character_id: string;
  item_id: string;
  equipped_slot: string | null;
  current_durability: number;
  item: {
    id: string;
    name: string;
    description: string;
    item_type: string;
    rarity: string;
    slot: string | null;
    stats: Record<string, number>;
    value: number;
    max_durability: number;
    hands: number | null;
  };
}

interface AdminCharacter {
  id: string;
  name: string;
  gender: 'male' | 'female';
  level: number;
  class: string;
  race: string;
  hp: number;
  max_hp: number;
  gold: number;
  current_node_id: string | null;
  str: number;
  dex: number;
  con: number;
  int: number;
  wis: number;
  cha: number;
  ac: number;
  xp: number;
  cp: number;
  max_cp: number;
  unspent_stat_points: number;
  inventory: AdminInventoryItem[];
}

interface AdminUser {
  id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
  email_confirmed_at: string | null;
  banned_until: string | null;
  role: string;
  profile: { display_name: string | null } | null;
  characters: AdminCharacter[];
}

interface CharacterEdits {
  name?: string;
  gold?: number;
  level?: number;
  gender?: 'male' | 'female';
}

interface Props {
  isValar: boolean;
}

const RARITY_COLORS: Record<string, string> = {
  common: 'text-foreground',
  uncommon: 'text-elvish',
  rare: 'text-dwarvish',
  unique: 'text-primary text-glow',
};

const STAT_FULL_NAMES: Record<string, string> = {
  str: 'Strength', dex: 'Dexterity', con: 'Constitution',
  int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma',
};

const STAT_DESCRIPTIONS: Record<string, string> = {
  str: 'Melee attack and damage rolls',
  dex: 'Ranged attack, AC bonus, initiative',
  con: 'Hit points and physical resilience',
  int: 'Arcane power and knowledge checks',
  wis: 'Perception, healing power, willpower',
  cha: 'Persuasion, bardic abilities, leadership',
};

const SLOT_LABELS: Record<string, string> = {
  main_hand: 'Main Hand', off_hand: 'Off Hand',
  head: 'Head', amulet: 'Amulet', shoulders: 'Shoulders', chest: 'Chest',
  gloves: 'Gloves', belt: 'Belt', pants: 'Pants', ring: 'Ring', trinket: 'Trinket',
  boots: 'Boots',
};

function AdminEquipSlot({ slot, item, blocked }: {
  slot: string; item: AdminInventoryItem | undefined; blocked: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={`w-[6.5rem] h-[3.25rem] p-1 border rounded text-center transition-colors ${
            blocked ? 'border-border/30 bg-background/10 opacity-50' :
            item ? 'border-primary/50 bg-primary/5' : 'border-border bg-background/30'
          }`}
        >
          <div className="text-[9px] text-muted-foreground capitalize">{SLOT_LABELS[slot]}</div>
          {blocked ? (
            <div className="text-[10px] text-muted-foreground/50">2H</div>
          ) : item ? (
            <>
              <div className={`text-[10px] font-display truncate ${RARITY_COLORS[item.item.rarity]}`}>
                {item.item.name}
              </div>
              <div className="text-[9px] text-muted-foreground">{item.current_durability}%</div>
            </>
          ) : (
            <div className="text-[10px] text-muted-foreground/50">Empty</div>
          )}
        </div>
      </TooltipTrigger>
      {item && !blocked && (
        <TooltipContent className="bg-popover border-border z-50">
          <p className={`font-display ${RARITY_COLORS[item.item.rarity]}`}>{item.item.name}</p>
          <p className="text-xs text-muted-foreground">{item.item.description}</p>
          {item.item.slot && <p className="text-[10px] text-muted-foreground capitalize">{SLOT_LABELS[item.item.slot] || item.item.slot} · {item.item.item_type}</p>}
          {!item.item.slot && <p className="text-[10px] text-muted-foreground capitalize">{item.item.item_type}</p>}
          {item.item.hands && <p className="text-xs text-muted-foreground">{item.item.hands === 2 ? 'Two-Handed' : 'One-Handed'}</p>}
          {Object.entries(item.item.stats || {}).map(([k, v]) => (
            <p key={k} className={`text-xs ${k === 'hp_regen' ? 'text-elvish' : ''}`}>
              {k === 'hp_regen' ? `+${v as number} Regen` : `+${v as number} ${k.toUpperCase()}`}
            </p>
          ))}
          <p className="text-[10px] text-muted-foreground">Durability: {item.current_durability}% | Value: {item.item.value}g</p>
        </TooltipContent>
      )}
    </Tooltip>
  );
}

function AdminCharacterSheet({ c, isEditing, charEdits, setCharEdits, onEdit, onSave, onCancel }: {
  c: AdminCharacter;
  isEditing: boolean;
  charEdits: CharacterEdits;
  setCharEdits: React.Dispatch<React.SetStateAction<CharacterEdits>>;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const inventory = c.inventory || [];
  const equipped = inventory.filter(i => i.equipped_slot);
  const unequipped = inventory.filter(i => !i.equipped_slot);
  const beltedPotions = inventory.filter(i => (i as any).belt_slot != null && (i as any).belt_slot !== undefined);
  const bagItems = unequipped.filter(i => (i as any).belt_slot === null || (i as any).belt_slot === undefined);

  const equipmentBonuses = equipped.reduce((acc, item) => {
    const stats = item.item.stats || {};
    for (const [key, val] of Object.entries(stats)) {
      acc[key] = (acc[key] || 0) + (val as number);
    }
    return acc;
  }, {} as Record<string, number>);

  const gold = isEditing ? (charEdits.gold ?? c.gold) : c.gold;
  const level = isEditing ? (charEdits.level ?? c.level) : c.level;
  const name = isEditing ? (charEdits.name ?? c.name) : c.name;

  const hpPercent = Math.round((c.hp / c.max_hp) * 100);
  const xpForNext = getXpForLevel(c.level);
  const xpPercent = Math.round((c.xp / xpForNext) * 100);
  const totalAC = c.ac + (equipmentBonuses.ac || 0);

  const getEquippedInSlot = (slot: string) => equipped.find(i => i.equipped_slot === slot);
  const mainHandItem = getEquippedInSlot('main_hand');
  const isTwoHanded = mainHandItem && mainHandItem.item.hands === 2;

  // Group bag items
  const grouped: { representative: AdminInventoryItem; all: AdminInventoryItem[] }[] = [];
  const map = new Map<string, AdminInventoryItem[]>();
  for (const inv of bagItems) {
    const key = inv.item_id;
    if (!map.has(key)) { map.set(key, []); grouped.push({ representative: inv, all: map.get(key)! }); }
    map.get(key)!.push(inv);
  }

  return (
    <div className="h-full flex flex-col space-y-3">
      {/* Name & Identity + Edit button */}
      <div className="flex items-center justify-between">
        <div className="text-center flex-1">
          {isEditing ? (
            <input type="text" className="w-full bg-background border border-border rounded px-2 py-0.5 text-sm font-display text-primary text-center"
              value={name} maxLength={50} onChange={e => setCharEdits(p => ({ ...p, name: e.target.value }))} />
          ) : (
            <h2 className="font-display text-lg text-primary text-glow">{c.name}</h2>
          )}
          {getCharacterTitle(c.level, c.gender) && (
            <p className="text-[10px] text-primary/70 font-display tracking-widest uppercase">{getCharacterTitle(c.level, c.gender)}</p>
          )}
          <p className="text-xs text-muted-foreground">
            {isEditing ? (
              <button
                onClick={() => setCharEdits(p => ({ ...p, gender: (p.gender ?? c.gender) === 'male' ? 'female' : 'male' }))}
                className="text-xs text-primary/70 hover:text-primary cursor-pointer mr-1"
                title="Toggle gender"
              >
                {(charEdits.gender ?? c.gender) === 'male' ? '♂' : '♀'}
              </button>
            ) : (
              <span className="mr-1">{c.gender === 'male' ? '♂' : '♀'}</span>
            )}
            {RACE_LABELS[c.race as keyof typeof RACE_LABELS]} {CLASS_LABELS[c.class as keyof typeof CLASS_LABELS]} — Lvl {isEditing ? (
              <input type="number" className="w-10 bg-background border border-border rounded px-1 text-xs text-foreground inline"
                value={level} onChange={e => setCharEdits(p => ({ ...p, level: parseInt(e.target.value) || 1 }))} />
            ) : level}
          </p>
        </div>
        <div className="flex gap-1">
          {isEditing ? (
            <>
              <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={onSave}>
                <Save className="w-3.5 h-3.5 text-chart-2" />
              </Button>
              <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={onCancel}>
                <X className="w-3.5 h-3.5 text-destructive" />
              </Button>
            </>
          ) : (
            <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={onEdit}>
              <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
            </Button>
          )}
        </div>
      </div>

      {/* HP Bar */}
      <div>
        <div className="flex justify-between text-xs mb-1">
          <span className="text-muted-foreground">HP</span>
          <span className="text-blood">{c.hp}/{c.max_hp}</span>
        </div>
        <div className="h-2 bg-background rounded-full overflow-hidden border border-border">
          <div
            className="h-full transition-all duration-500"
            style={{
              width: `${hpPercent}%`,
              background: hpPercent > 50 ? 'hsl(var(--elvish))' : hpPercent > 25 ? 'hsl(var(--gold))' : 'hsl(var(--blood))',
            }}
          />
        </div>
      </div>

      {/* CP Bar */}
      {(() => {
        const cp = c.cp ?? 60;
        const maxCp = c.max_cp ?? 60;
        const cpPercent = Math.round((cp / maxCp) * 100);
        const primaryStat = CLASS_PRIMARY_STAT[c.class] || 'con';
        const primaryVal = (c as any)[primaryStat] ?? 10;
        const cpRegen = getCpRegenRate(primaryVal);
        const mentalMod = Math.max(
          Math.floor((c.int - 10) / 2),
          Math.floor((c.wis - 10) / 2),
          Math.floor((c.cha - 10) / 2),
          0
        );
        const levelPart = (c.level - 1) * 3;
        const mentalPart = mentalMod * 5;
        return (
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="cursor-help">
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-muted-foreground">CP</span>
                  <span className="text-[hsl(var(--primary))]">{cp}/{maxCp}</span>
                </div>
                <div className="h-2 bg-background rounded-full overflow-hidden border border-border">
                  <div
                    className="h-full transition-all duration-500 rounded-full"
                    style={{
                      width: `${cpPercent}%`,
                      background: 'linear-gradient(90deg, hsl(var(--primary) / 0.7), hsl(var(--primary)))',
                    }}
                  />
                </div>
              </div>
            </TooltipTrigger>
            <TooltipContent className="bg-popover border-border z-50 space-y-1">
              <p className="font-display text-sm">Concentration Points</p>
              <p className="text-xs text-muted-foreground">Max: <span className="text-primary">60</span> base + <span className="text-primary">{levelPart}</span> level + <span className="text-primary">{mentalPart}</span> mental</p>
              <p className="text-xs text-muted-foreground">Base regen: <span className="text-primary">{cpRegen} CP</span> / <span className="text-foreground">6s</span></p>
              <p className="text-xs text-muted-foreground">Primary stat: {STAT_LABELS[primaryStat]}</p>
            </TooltipContent>
          </Tooltip>
        );
      })()}

      {/* XP Bar */}
      <div>
        <div className="flex justify-between text-xs mb-1">
          <span className="text-muted-foreground">XP</span>
          <span className="text-primary">{c.xp}/{xpForNext}</span>
        </div>
        <div className="h-1.5 bg-background rounded-full overflow-hidden border border-border">
          <div className="h-full bg-primary transition-all duration-500" style={{ width: `${xpPercent}%` }} />
        </div>
      </div>

      {/* Stats — 2-column layout matching player panel */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <h3 className="font-display text-xs text-muted-foreground">Attributes</h3>
          {c.unspent_stat_points > 0 && (
            <span className="text-[9px] text-primary">{c.unspent_stat_points} unspent</span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2">
          {/* Left column: Stats */}
          <div>
            <div className="grid grid-cols-[1fr_auto_auto_auto] items-center text-[9px] text-muted-foreground/70 px-1 mb-0.5 gap-x-2">
              <span>Stat</span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="cursor-help underline decoration-dotted text-right">Base</span>
                </TooltipTrigger>
                <TooltipContent className="bg-popover border-border z-50">
                  <p className="font-display text-sm">Base</p>
                  <p className="text-xs text-muted-foreground">Natural stat from race, class, and level-up points.</p>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="cursor-help underline decoration-dotted text-chart-2 text-right">Gear</span>
                </TooltipTrigger>
                <TooltipContent className="bg-popover border-border z-50">
                  <p className="font-display text-sm">Gear</p>
                  <p className="text-xs text-muted-foreground">Bonus from equipped items.</p>
                </TooltipContent>
              </Tooltip>
              <div className="w-4" />
            </div>
            <div className="space-y-0.5">
              {Object.entries(STAT_LABELS).map(([key, label]) => {
                const base = (c as any)[key] as number;
                const bonus = equipmentBonuses[key] || 0;
                return (
                  <Tooltip key={key}>
                    <TooltipTrigger asChild>
                      <div className="grid grid-cols-[1fr_auto_auto] items-center text-xs py-0.5 px-1 rounded hover:bg-accent/30 transition-colors cursor-help gap-x-2">
                        <span className="font-display text-foreground">{STAT_FULL_NAMES[key]}</span>
                        <span className="tabular-nums text-foreground text-right">{base}</span>
                        <span className="tabular-nums text-chart-2 text-right w-6">{bonus > 0 ? `+${bonus}` : ''}</span>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent className="bg-popover border-border z-50">
                      <p className="font-display text-sm">{STAT_FULL_NAMES[key]}</p>
                      <p className="text-xs text-muted-foreground">{STAT_DESCRIPTIONS[key]}</p>
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          </div>
          {/* Right column: Summary info */}
          <div className="border-l border-border pl-2">
            <div className="text-[9px] text-muted-foreground/70 mb-0.5">Summary</div>
            <div className="space-y-1 text-[10px]">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total AC</span>
                <span className="text-foreground font-display">{totalAC}{(equipmentBonuses.ac || 0) > 0 && <span className="text-chart-2"> (+{equipmentBonuses.ac})</span>}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Gold</span>
                {isEditing ? (
                  <input type="number" className="w-14 bg-background border border-border rounded px-1 text-[10px] text-primary text-right"
                    value={gold} onChange={e => setCharEdits(p => ({ ...p, gold: parseInt(e.target.value) || 0 }))} />
                ) : (
                  <span className="text-primary font-display">{gold}</span>
                )}
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Items</span>
                <span className="text-foreground">{inventory.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Equipped</span>
                <span className="text-foreground">{equipped.length}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Equipment — Paper Doll Layout */}
      <div>
        <h3 className="font-display text-xs text-muted-foreground mb-1.5">Equipment</h3>
        <div className="relative flex flex-col items-center gap-1">
          <div className="grid grid-cols-3 gap-1 w-full justify-items-center relative z-10">
            <AdminEquipSlot slot="trinket" item={getEquippedInSlot('trinket')} blocked={false} />
            <AdminEquipSlot slot="head" item={getEquippedInSlot('head')} blocked={false} />
            <div />
            <div />
            <AdminEquipSlot slot="amulet" item={getEquippedInSlot('amulet')} blocked={false} />
            <div />
            <AdminEquipSlot slot="shoulders" item={getEquippedInSlot('shoulders')} blocked={false} />
            <AdminEquipSlot slot="chest" item={getEquippedInSlot('chest')} blocked={false} />
            <AdminEquipSlot slot="gloves" item={getEquippedInSlot('gloves')} blocked={false} />
            <AdminEquipSlot slot="main_hand" item={getEquippedInSlot('main_hand')} blocked={false} />
            <AdminEquipSlot slot="belt" item={getEquippedInSlot('belt')} blocked={false} />
            <AdminEquipSlot slot="off_hand" item={getEquippedInSlot('off_hand')} blocked={!!isTwoHanded} />
            <AdminEquipSlot slot="ring" item={getEquippedInSlot('ring')} blocked={false} />
            <AdminEquipSlot slot="pants" item={getEquippedInSlot('pants')} blocked={false} />
            <div />
            <div />
            <AdminEquipSlot slot="boots" item={getEquippedInSlot('boots')} blocked={false} />
            <div />
          </div>
        </div>
      </div>

      {/* Inventory — grouped like player panel */}
      <div className="flex-1 min-h-0 flex flex-col">
        <h3 className="font-display text-xs text-muted-foreground mb-1.5">
          Inventory ({bagItems.length})
        </h3>
        <div className="space-y-1 flex-1 min-h-0 overflow-y-auto">
          {bagItems.length === 0 ? (
            <p className="text-[10px] text-muted-foreground/50 italic">Empty</p>
          ) : grouped.map(({ representative: inv, all }) => {
            const isBroken = inv.current_durability <= 0;
            return (
              <div key={inv.item_id} className={`flex items-center justify-between p-1.5 rounded border border-border bg-background/30 text-xs ${isBroken ? 'opacity-50' : ''}`}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className={`font-display truncate flex-1 cursor-help ${RARITY_COLORS[inv.item.rarity]}`}>
                      {isBroken && <span className="text-destructive mr-1">⚒</span>}
                      {inv.item.name}
                      {all.length > 1 && <span className="text-[9px] text-muted-foreground ml-1">×{all.length}</span>}
                      {inv.item.hands && <span className="text-[9px] text-muted-foreground ml-1">({inv.item.hands}H)</span>}
                      {isBroken && <span className="text-[9px] text-destructive ml-1">(Broken)</span>}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="bg-popover border-border z-50">
                    <p className={`font-display ${RARITY_COLORS[inv.item.rarity]}`}>{inv.item.name}</p>
                    {isBroken && <p className="text-xs text-destructive font-display">Broken — needs repair</p>}
                    <p className="text-xs text-muted-foreground">{inv.item.description}</p>
                    {inv.item.slot && <p className="text-[10px] text-muted-foreground capitalize">{SLOT_LABELS[inv.item.slot] || inv.item.slot} · {inv.item.item_type}</p>}
                    {!inv.item.slot && <p className="text-[10px] text-muted-foreground capitalize">{inv.item.item_type}</p>}
                    {Object.entries(inv.item.stats || {}).map(([k, v]) => (
                      <p key={k} className={`text-xs ${k === 'hp_regen' ? 'text-elvish' : ''}`}>
                        {k === 'hp_regen' ? `+${v as number} Regen` : `+${v as number} ${k.toUpperCase()}`}
                      </p>
                    ))}
                    <p className="text-[10px] text-muted-foreground">Durability: {inv.current_durability}% | Value: {inv.item.value}g</p>
                    {all.length > 1 && <p className="text-[10px] text-muted-foreground">Qty: {all.length}</p>}
                  </TooltipContent>
                </Tooltip>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const EVENT_TYPE_ICONS: Record<string, string> = {
  login: '🔑', combat_kill: '⚔️', combat_death: '💀', level_up: '🎉',
  item_found: '🔍', item_loot: '💰', move: '🚶', search: '🔎',
  party: '👥', vendor: '🛒', blacksmith: '🔨', revive: '💫',
  admin: '🛡️', general: '📝',
};

const EVENT_TYPE_COLORS: Record<string, string> = {
  combat_kill: 'text-chart-2', combat_death: 'text-destructive', level_up: 'text-primary',
  item_found: 'text-dwarvish', item_loot: 'text-primary', admin: 'text-chart-2',
};

function PlayerLogsColumn({ userId }: { userId: string | null }) {
  const { logs, loading } = useActivityLog(userId, 100);
  const [filter, setFilter] = useState('');

  const filteredLogs = useMemo(() => {
    if (!filter) return logs;
    return logs.filter(l =>
      l.message.toLowerCase().includes(filter.toLowerCase()) ||
      l.event_type.toLowerCase().includes(filter.toLowerCase())
    );
  }, [logs, filter]);

  return (
    <div className="flex-1 flex flex-col border-l border-border">
      <div className="px-3 py-2 border-b border-border">
        <div className="flex items-center gap-1.5">
          <ScrollText className="w-3.5 h-3.5 text-muted-foreground" />
          <h3 className="font-display text-xs text-muted-foreground">Player Logs</h3>
          {logs.length > 0 && (
            <span className="text-[9px] text-muted-foreground/60 ml-auto">{logs.length}</span>
          )}
        </div>
        {userId && (
          <div className="mt-1.5 relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
            <Input
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder="Filter logs..."
              className="pl-7 h-6 text-[10px]"
            />
          </div>
        )}
      </div>

      <ScrollArea className="flex-1">
        {!userId ? (
          <div className="flex items-center justify-center h-32 text-[10px] text-muted-foreground">
            Select a user
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center h-32 text-[10px] text-muted-foreground animate-pulse">
            Loading logs...
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-[10px] text-muted-foreground italic">
            No activity yet
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filteredLogs.map(log => {
              const icon = EVENT_TYPE_ICONS[log.event_type] || EVENT_TYPE_ICONS.general;
              const colorClass = EVENT_TYPE_COLORS[log.event_type] || 'text-foreground';
              const time = new Date(log.created_at);
              const timeStr = time.toLocaleString('en-US', {
                month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
              });
              return (
                <div key={log.id} className="px-3 py-1.5 hover:bg-accent/10 transition-colors">
                  <div className="flex items-start gap-1.5">
                    <span className="text-xs leading-none mt-0.5">{icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className={`text-[10px] leading-tight ${colorClass}`}>{log.message}</p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-[9px] text-muted-foreground/60">{timeStr}</span>
                        <Badge variant="outline" className="text-[8px] px-1 py-0 h-3.5 border-border/50">
                          {log.event_type}
                        </Badge>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

export default function UserManager({ isValar }: Props) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [selectedCharId, setSelectedCharId] = useState<string | null>(null);
  const [editingChar, setEditingChar] = useState<string | null>(null);
  const [charEdits, setCharEdits] = useState<CharacterEdits>({});
  const [allItems, setAllItems] = useState<{ id: string; name: string; rarity: string }[]>([]);
  const [giveItemId, setGiveItemId] = useState<string>('');
  const [givingItem, setGivingItem] = useState(false);
  const [allNodes, setAllNodes] = useState<{ id: string; name: string; region_name: string }[]>([]);
  const [teleportNodeId, setTeleportNodeId] = useState<string>('');
  const [grantXpAmount, setGrantXpAmount] = useState<number>(100);
  const [removeItemId, setRemoveItemId] = useState<string>('');

  const callAdmin = useCallback(async (action: string, method: string, body?: any) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Not authenticated');
    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-users?action=${action}`;
    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }, []);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const data = await callAdmin(`list&page=${page}`, 'GET');
      setUsers(data.users);
      setTotal(data.total);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, callAdmin]);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  useEffect(() => {
    Promise.all([
      supabase.from('items').select('id, name, rarity').order('name'),
      supabase.from('nodes').select('id, name, region_id').order('name'),
      supabase.from('regions').select('id, name'),
    ]).then(([itemsRes, nodesRes, regionsRes]) => {
      if (itemsRes.data) {
        setAllItems(itemsRes.data);
        if (itemsRes.data.length > 0 && !giveItemId) setGiveItemId(itemsRes.data[0].id);
      }
      if (nodesRes.data && regionsRes.data) {
        const regionMap = Object.fromEntries((regionsRes.data || []).map(r => [r.id, r.name]));
        setAllNodes(nodesRes.data.map(n => ({ id: n.id, name: n.name, region_name: regionMap[n.region_id] || 'Unknown' })));
        if (nodesRes.data.length > 0) setTeleportNodeId(nodesRes.data[0].id);
      }
    });
  }, []);

  // Auto-select first character when user changes
  useEffect(() => {
    const user = users.find(u => u.id === selectedUserId);
    if (user?.characters?.length) {
      setSelectedCharId(user.characters[0].id);
    } else {
      setSelectedCharId(null);
    }
    setRemoveItemId('');
    setEditingChar(null);
    setCharEdits({});
  }, [selectedUserId, users]);

  const handleResetPassword = async (email: string) => {
    try {
      await callAdmin('reset-password', 'POST', { email });
      toast.success(`Password reset link generated for ${email}`);
    } catch (err: any) { toast.error(err.message); }
  };

  const handleSetRole = async (userId: string, role: string) => {
    try {
      await callAdmin('set-role', 'POST', { user_id: userId, role });
      toast.success('Role updated');
      loadUsers();
    } catch (err: any) { toast.error(err.message); }
  };

  const handleBan = async (userId: string, ban: boolean) => {
    try {
      await callAdmin('ban', 'POST', { user_id: userId, ban_duration: ban ? '876000h' : 'none' });
      toast.success(ban ? 'User banned' : 'User unbanned');
      loadUsers();
    } catch (err: any) { toast.error(err.message); }
  };

  const handleSaveCharacter = async (charId: string) => {
    try {
      // If level changed, use dedicated set-level action that recalculates stats/HP
      if (charEdits.level !== undefined) {
        await callAdmin('set-level', 'POST', { character_id: charId, new_level: charEdits.level });
        // Remove level from remaining edits
        const { level, ...remainingEdits } = charEdits;
        if (Object.keys(remainingEdits).length > 0) {
          await callAdmin('update-character', 'POST', { character_id: charId, updates: remainingEdits });
        }
      } else {
        await callAdmin('update-character', 'POST', { character_id: charId, updates: charEdits });
      }
      toast.success('Character updated');
      setEditingChar(null);
      setCharEdits({});
      loadUsers();
    } catch (err: any) { toast.error(err.message); }
  };

  const handleGiveItem = async (characterId: string) => {
    if (!giveItemId) return;
    setGivingItem(true);
    try {
      await callAdmin('give-item', 'POST', { character_id: characterId, item_id: giveItemId });
      const itemName = allItems.find(i => i.id === giveItemId)?.name || 'Item';
      toast.success(`Gave ${itemName} to character`);
      loadUsers();
    } catch (err: any) { toast.error(err.message); }
    finally { setGivingItem(false); }
  };

  const handleTeleport = async (characterId: string) => {
    if (!teleportNodeId) return;
    try {
      await callAdmin('teleport', 'POST', { character_id: characterId, node_id: teleportNodeId });
      const nodeName = allNodes.find(n => n.id === teleportNodeId)?.name || 'node';
      toast.success(`Teleported to ${nodeName}`);
      loadUsers();
    } catch (err: any) { toast.error(err.message); }
  };

  const handleGrantXp = async (characterId: string) => {
    if (!grantXpAmount || grantXpAmount <= 0) return;
    try {
      const data = await callAdmin('grant-xp', 'POST', { character_id: characterId, amount: grantXpAmount });
      toast.success(`Granted ${grantXpAmount} XP${data.levels_gained > 0 ? ` (+${data.levels_gained} levels!)` : ''}`);
      loadUsers();
    } catch (err: any) { toast.error(err.message); }
  };

  const handleRevive = async (characterId: string) => {
    try {
      await callAdmin('revive', 'POST', { character_id: characterId });
      toast.success('Character revived');
      loadUsers();
    } catch (err: any) { toast.error(err.message); }
  };

  const handleRemoveItem = async () => {
    if (!removeItemId) return;
    try {
      await callAdmin('remove-item', 'POST', { inventory_id: removeItemId });
      toast.success('Item removed');
      setRemoveItemId('');
      loadUsers();
    } catch (err: any) { toast.error(err.message); }
  };

  const handleResetStats = async (characterId: string) => {
    try {
      const data = await callAdmin('reset-stats', 'POST', { character_id: characterId });
      toast.success(`Stats reset — ${data.refunded_points} points refunded`);
      loadUsers();
    } catch (err: any) { toast.error(err.message); }
  };

  const filteredUsers = search
    ? users.filter(u =>
        u.email.toLowerCase().includes(search.toLowerCase()) ||
        u.profile?.display_name?.toLowerCase().includes(search.toLowerCase()) ||
        u.characters.some(c => c.name.toLowerCase().includes(search.toLowerCase()))
      )
    : users;

  const selectedUser = users.find(u => u.id === selectedUserId) || null;
  const selectedChar = selectedUser?.characters.find(c => c.id === selectedCharId) || null;

  const roleBadge = (role: string) => {
    const colors: Record<string, string> = {
      overlord: 'bg-primary/20 text-primary border-primary/40',
      steward: 'bg-chart-2/20 text-chart-2 border-chart-2/40',
      player: 'bg-muted text-muted-foreground border-border',
    };
    return <Badge variant="outline" className={`text-[10px] ${colors[role] || colors.player}`}>{role}</Badge>;
  };

  const formatDate = (d: string | null) => {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const rarityColor = (rarity: string) => {
    if (rarity === 'unique') return 'text-primary';
    if (rarity === 'rare') return 'text-dwarvish';
    if (rarity === 'uncommon') return 'text-elvish';
    return 'text-foreground';
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex h-full">
        {/* COL 1 — User List */}
        <div className="w-56 shrink-0 border-r border-border flex flex-col">
          <div className="p-2 border-b border-border">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search users..."
                className="pl-8 h-7 text-xs"
              />
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">{total} users</p>
          </div>

          <ScrollArea className="flex-1">
            {loading ? (
              <p className="text-xs text-muted-foreground text-center py-8">Loading...</p>
            ) : filteredUsers.map(u => {
              const isBanned = u.banned_until && new Date(u.banned_until) > new Date();
              const isSelected = selectedUserId === u.id;
              return (
                <div
                  key={u.id}
                  className={`px-3 py-2 cursor-pointer border-b border-border transition-colors hover:bg-accent/10 ${isSelected ? 'bg-accent/20' : ''}`}
                  onClick={() => setSelectedUserId(u.id)}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-display text-foreground truncate flex-1">
                      {u.profile?.display_name || u.email.split('@')[0]}
                    </span>
                    {roleBadge(u.role)}
                  </div>
                  <div className="flex items-center justify-between mt-0.5">
                    <span className="text-[10px] text-muted-foreground truncate">{u.email}</span>
                    <span className="text-[10px] text-muted-foreground shrink-0 ml-1">
                      {u.characters.length}ch
                    </span>
                  </div>
                  {isBanned && <Badge variant="destructive" className="text-[9px] mt-0.5">Banned</Badge>}
                </div>
              );
            })}
          </ScrollArea>

          {total > 50 && (
            <div className="flex items-center justify-center gap-2 p-2 border-t border-border">
              <Button size="sm" variant="outline" className="h-6 text-[10px]"
                disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Prev</Button>
              <span className="text-[10px] text-muted-foreground">P{page}</span>
              <Button size="sm" variant="outline" className="h-6 text-[10px]"
                disabled={users.length < 50} onClick={() => setPage(p => p + 1)}>Next</Button>
            </div>
          )}
        </div>

        {/* COL 2 — Character Cards */}
        <div className="w-60 shrink-0 border-r border-border flex flex-col">
          {!selectedUser ? (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-[10px] text-muted-foreground">Select a user</p>
            </div>
          ) : (
            <>
              {/* User info header */}
              <div className="p-3 border-b border-border">
                <div className="flex items-center gap-2 mb-1">
                  <h4 className="font-display text-sm text-foreground truncate">
                    {selectedUser.profile?.display_name || selectedUser.email.split('@')[0]}
                  </h4>
                  {roleBadge(selectedUser.role)}
                </div>
                <p className="text-[10px] text-muted-foreground truncate">{selectedUser.email}</p>
                <div className="flex gap-3 mt-1 text-[10px] text-muted-foreground">
                  <span>Joined {formatDate(selectedUser.created_at)}</span>
                  <span>Last {formatDate(selectedUser.last_sign_in_at)}</span>
                </div>
                {/* Account action buttons */}
                <div className="flex flex-wrap gap-1 mt-2">
                  <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1"
                    onClick={() => handleResetPassword(selectedUser.email)}>
                    <KeyRound className="w-3 h-3" /> Reset PW
                  </Button>
                  {isValar && (
                    <>
                      {selectedUser.banned_until && new Date(selectedUser.banned_until) > new Date() ? (
                        <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1"
                          onClick={() => handleBan(selectedUser.id, false)}>
                          <UserCheck className="w-3 h-3" /> Unban
                        </Button>
                      ) : (
                        <Button size="sm" variant="destructive" className="h-6 text-[10px] gap-1"
                          onClick={() => handleBan(selectedUser.id, true)}>
                          <Ban className="w-3 h-3" /> Ban
                        </Button>
                      )}
                      <Select value={selectedUser.role} onValueChange={(v) => handleSetRole(selectedUser.id, v)}>
                        <SelectTrigger className="h-6 w-24 text-[10px]">
                          <Shield className="w-3 h-3 mr-1" /><SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-popover border-border z-50">
                          <SelectItem value="player" className="text-xs">Player</SelectItem>
                          <SelectItem value="steward" className="text-xs">Steward</SelectItem>
                          <SelectItem value="overlord" className="text-xs">Overlord</SelectItem>
                        </SelectContent>
                      </Select>
                    </>
                  )}
                </div>
              </div>

              {/* Character Cards */}
              <ScrollArea className="flex-1">
                <div className="p-3 space-y-2">
                  <h4 className="font-display text-[10px] text-muted-foreground">Characters ({selectedUser.characters.length})</h4>
                  {selectedUser.characters.length === 0 ? (
                    <p className="text-[10px] text-muted-foreground/50 italic">No characters</p>
                  ) : (
                    selectedUser.characters.map(char => {
                      const isActive = selectedCharId === char.id;
                      return (
                        <div
                          key={char.id}
                          className={`ornate-border rounded-lg p-2.5 cursor-pointer transition-all hover:border-primary/60 hover:shadow-lg hover:shadow-primary/10 ${
                            isActive ? 'border-primary bg-primary/5 shadow-md shadow-primary/10' : 'bg-card/90'
                          }`}
                          onClick={() => setSelectedCharId(char.id)}
                        >
                          <div className="flex items-start justify-between">
                            <div>
                              <h3 className={`font-display text-sm ${isActive ? 'text-primary text-glow' : 'text-foreground'}`}>
                                {char.name}
                              </h3>
                              <p className="text-[10px] text-muted-foreground">
                                {char.gender === 'male' ? '♂' : '♀'} {RACE_LABELS[char.race as keyof typeof RACE_LABELS]} {CLASS_LABELS[char.class as keyof typeof CLASS_LABELS]}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-3 text-[11px] mt-1.5">
                            <span className="font-display text-foreground">Lvl {char.level}</span>
                            <span className="text-blood">HP {char.hp}/{char.max_hp}</span>
                            <span className="text-primary">Gold {char.gold}</span>
                          </div>
                          <div className="h-1 bg-background rounded-full overflow-hidden border border-border/50 mt-1.5">
                            <div
                              className="h-full transition-all duration-500"
                              style={{
                                width: `${Math.round((char.hp / char.max_hp) * 100)}%`,
                                background: char.hp / char.max_hp > 0.5 ? 'hsl(var(--elvish))' : char.hp / char.max_hp > 0.25 ? 'hsl(var(--gold))' : 'hsl(var(--blood))',
                              }}
                            />
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </ScrollArea>
            </>
          )}
        </div>

        {/* COL 3 — Actions */}
        <div className="w-56 shrink-0 border-r border-border flex flex-col overflow-y-auto">
          {!selectedChar ? (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-[10px] text-muted-foreground italic">
                {!selectedUser ? 'Select a user' : 'Select a character'}
              </p>
            </div>
          ) : (
            <ScrollArea className="flex-1">
              <div className="p-3 space-y-3">
                <h4 className="font-display text-[10px] text-muted-foreground flex items-center gap-1.5">
                  <Shield className="w-3 h-3" /> Actions — {selectedChar.name}
                </h4>

                {/* Give Item */}
                <div className="space-y-1">
                  <div className="flex gap-1">
                    <Select value={giveItemId} onValueChange={setGiveItemId}>
                      <SelectTrigger className="h-7 flex-1 text-[10px]">
                        <SelectValue placeholder="Item..." />
                      </SelectTrigger>
                      <SelectContent className="bg-popover border-border z-50 max-h-60">
                        {allItems.map(item => (
                          <SelectItem key={item.id} value={item.id} className="text-xs">
                            <span className={rarityColor(item.rarity)}>{item.name}</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1 shrink-0"
                      disabled={!giveItemId || givingItem} onClick={() => handleGiveItem(selectedChar.id)}>
                      <Gift className="w-3 h-3" /> Give
                    </Button>
                  </div>
                </div>

                {/* Teleport */}
                <div className="space-y-1">
                  <div className="flex gap-1">
                    <Select value={teleportNodeId} onValueChange={setTeleportNodeId}>
                      <SelectTrigger className="h-7 flex-1 text-[10px]">
                        <SelectValue placeholder="Node..." />
                      </SelectTrigger>
                      <SelectContent className="bg-popover border-border z-50 max-h-60">
                        {allNodes.map(node => (
                          <SelectItem key={node.id} value={node.id} className="text-xs">
                            {node.name} <span className="text-muted-foreground">({node.region_name})</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1 shrink-0"
                      disabled={!teleportNodeId} onClick={() => handleTeleport(selectedChar.id)}>
                      <MapPin className="w-3 h-3" /> Tp
                    </Button>
                  </div>
                </div>

                {/* Grant XP */}
                <div className="flex gap-1">
                  <Input type="number" min={1} value={grantXpAmount}
                    onChange={e => setGrantXpAmount(parseInt(e.target.value) || 0)}
                    className="h-7 text-[10px] w-20" placeholder="XP" />
                  <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1 flex-1"
                    disabled={grantXpAmount <= 0} onClick={() => handleGrantXp(selectedChar.id)}>
                    <Sparkles className="w-3 h-3" /> Grant XP
                  </Button>
                </div>

                {/* Quick actions */}
                <div className="flex flex-wrap gap-1">
                  <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1"
                    disabled={selectedChar.hp >= selectedChar.max_hp} onClick={() => handleRevive(selectedChar.id)}>
                    <Heart className="w-3 h-3" /> Revive
                    {selectedChar.hp < selectedChar.max_hp && <span className="text-blood">({selectedChar.hp}/{selectedChar.max_hp})</span>}
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1"
                    onClick={() => handleResetStats(selectedChar.id)}>
                    <RotateCcw className="w-3 h-3" /> Reset Stats
                  </Button>
                </div>

                {/* Remove Item */}
                {selectedChar.inventory.length > 0 && (
                  <div className="flex gap-1">
                    <Select value={removeItemId} onValueChange={setRemoveItemId}>
                      <SelectTrigger className="h-7 flex-1 text-[10px]">
                        <SelectValue placeholder="Remove item..." />
                      </SelectTrigger>
                      <SelectContent className="bg-popover border-border z-50 max-h-60">
                        {selectedChar.inventory.map(inv => (
                          <SelectItem key={inv.id} value={inv.id} className="text-xs">
                            <span className={rarityColor(inv.item.rarity)}>{inv.item.name}</span>
                            {inv.equipped_slot && <span className="text-muted-foreground ml-1">(eq)</span>}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button size="sm" variant="destructive" className="h-7 text-[10px] gap-1 shrink-0"
                      disabled={!removeItemId} onClick={handleRemoveItem}>
                      <Trash2 className="w-3 h-3" /> Rm
                    </Button>
                  </div>
                )}
              </div>
            </ScrollArea>
          )}
        </div>

        {/* COL 3 — Character Panel (400px, same as game UI) */}
        <div className="w-[400px] shrink-0 overflow-y-auto min-h-0 border-r border-border">
          {!selectedChar ? (
            <div className="flex items-center justify-center h-full text-xs text-muted-foreground italic">
              {!selectedUser ? 'Select a user' : selectedUser.characters.length === 0 ? 'No characters' : 'Select a character'}
            </div>
          ) : (
            <div className="p-3 space-y-3">
              <h4 className="font-display text-[10px] text-muted-foreground">Character Sheet</h4>
              <AdminCharacterSheet
                c={selectedChar}
                isEditing={editingChar === selectedChar.id}
                charEdits={charEdits}
                setCharEdits={setCharEdits}
                onEdit={() => { setEditingChar(selectedChar.id); setCharEdits({ name: selectedChar.name, gold: selectedChar.gold, level: selectedChar.level }); }}
                onSave={() => handleSaveCharacter(selectedChar.id)}
                onCancel={() => { setEditingChar(null); setCharEdits({}); }}
              />
            </div>
          )}
        </div>

        {/* COL 4 — Player Logs (flex) */}
        <PlayerLogsColumn userId={selectedUser?.id ?? null} />
      </div>
    </TooltipProvider>
  );
}
