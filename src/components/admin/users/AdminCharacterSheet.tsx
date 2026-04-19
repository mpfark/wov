import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Pencil, Save, X } from 'lucide-react';
import { CLASS_LABELS, RACE_LABELS, STAT_LABELS, getXpForLevel, getStatRegen, getCharacterTitle } from '@/lib/game-data';
import AdminEquipSlot from './AdminEquipSlot';
import ItemIllustration from '@/components/items/ItemIllustration';
import { RARITY_COLORS, STAT_FULL_NAMES, STAT_DESCRIPTIONS, SLOT_LABELS } from './constants';
import type { AdminCharacter, AdminInventoryItem, CharacterEdits } from './constants';

interface Props {
  c: AdminCharacter;
  isEditing: boolean;
  charEdits: CharacterEdits;
  setCharEdits: React.Dispatch<React.SetStateAction<CharacterEdits>>;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
}

export default function AdminCharacterSheet({ c, isEditing, charEdits, setCharEdits, onEdit, onSave, onCancel }: Props) {
  const inventory = c.inventory || [];
  const equipped = inventory.filter(i => i.equipped_slot);
  const unequipped = inventory.filter(i => !i.equipped_slot);
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
        const cp = c.cp ?? 30;
        const maxCp = c.max_cp ?? 30;
        const cpPercent = Math.round((cp / maxCp) * 100);
        const cpRegen = getStatRegen(c.int ?? 10);
        const intMod = Math.max(Math.floor((c.int - 10) / 2), 0);
        const wisMod = Math.max(Math.floor((c.wis - 10) / 2), 0);
        const levelPart = (c.level - 1) * 3;
        const mentalPart = (intMod + wisMod) * 3;
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
              <p className="text-xs text-muted-foreground">Max: <span className="text-primary">30</span> base + <span className="text-primary">{levelPart}</span> level + <span className="text-primary">{mentalPart}</span> (INT+WIS)</p>
              <p className="text-xs text-muted-foreground">Base regen: <span className="text-primary">{cpRegen} CP</span> / <span className="text-foreground">4s</span></p>
              <p className="text-xs text-muted-foreground">Regen stat: INT</p>
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

      {/* Stats — 2-column layout */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <h3 className="font-display text-xs text-muted-foreground">Attributes</h3>
          {c.unspent_stat_points > 0 && (
            <span className="text-[9px] text-primary">{c.unspent_stat_points} unspent</span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2">
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
              {Object.entries(STAT_LABELS).map(([key]) => {
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

      {/* Inventory — grouped */}
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
                    <ItemIllustration url={inv.item.illustration_url} alt={inv.item.name} />
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
