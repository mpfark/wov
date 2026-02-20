import { useState, useEffect } from 'react';
import { Character } from '@/hooks/useCharacter';
import { InventoryItem } from '@/hooks/useInventory';
import { RACE_LABELS, CLASS_LABELS, STAT_LABELS, getStatModifier, getXpForLevel, CLASS_PRIMARY_STAT, getCpRegenRate } from '@/lib/game-data';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Shield, Trash2, Heart, ArrowUpFromLine, ArrowDownToLine } from 'lucide-react';
import vitruvianMan from '@/assets/vitruvian-man.png';

interface Props {
  character: Character;
  equipped: InventoryItem[];
  unequipped: InventoryItem[];
  equipmentBonuses: Record<string, number>;
  onEquip: (inventoryId: string, slot: string) => void;
  onUnequip: (inventoryId: string) => void;
  onDrop: (inventoryId: string) => void;
  onDestroy?: (inventoryId: string) => void;
  onUseConsumable?: (inventoryId: string) => void;
  
  // Regen info
  isAtInn?: boolean;
  regenBuff?: { multiplier: number; expiresAt: number };
  regenTick?: boolean;
  baseRegen?: number;
  itemHpRegen?: number;
  foodBuff?: { flatRegen: number; expiresAt: number };
  critBuff?: { bonus: number; expiresAt: number };
  acBuff?: { bonus: number; expiresAt: number } | null;
  poisonBuff?: { expiresAt: number } | null;
  evasionBuff?: { dodgeChance: number; expiresAt: number; source?: 'cloak' | 'disengage' } | null;
  igniteBuff?: { expiresAt: number } | null;
  absorbBuff?: { shieldHp: number; expiresAt: number } | null;
  partyRegenBuff?: { healPerTick: number; expiresAt: number } | null;
  // Belt potion system
  beltedPotions?: InventoryItem[];
  beltCapacity?: number;
  onBeltPotion?: (inventoryId: string) => void;
  onUnbeltPotion?: (inventoryId: string) => void;
  inCombat?: boolean;
}

const RARITY_COLORS: Record<string, string> = {
  common: 'text-foreground',
  uncommon: 'text-chart-2',
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

function EquipSlot({ slot, item, blocked, onUnequip }: {
  slot: string; item: InventoryItem | undefined; blocked: boolean; onUnequip: (id: string) => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={`w-[6.5rem] h-[3.25rem] p-1 border rounded text-center cursor-pointer transition-colors ${
            blocked ? 'border-border/30 bg-background/10 opacity-50' :
            item ? 'border-primary/50 bg-primary/5' : 'border-border bg-background/30'
          }`}
          onClick={() => item && !blocked && onUnequip(item.id)}
        >
          <div className="text-[9px] text-muted-foreground capitalize">{SLOT_LABELS[slot]}</div>
          {blocked ? (
            <div className="text-[10px] text-muted-foreground/50">2H</div>
          ) : item ? (
            <>
              <div className={`text-[10px] font-display truncate ${RARITY_COLORS[item.item.rarity]}`}>
                {item.item.name}
              </div>
              <div className="text-[9px] text-muted-foreground">{item.current_durability}</div>
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
          {item.item.hands && <p className="text-xs text-muted-foreground">{item.item.hands === 2 ? 'Two-Handed' : 'One-Handed'}</p>}
          {Object.entries(item.item.stats || {}).map(([k, v]) => (
            <p key={k} className={`text-xs ${k === 'hp_regen' ? 'text-elvish' : ''}`}>
              {k === 'hp_regen' ? `+${v as number} Regen` : `+${v as number} ${k.toUpperCase()}`}
            </p>
          ))}
          <p className="text-[10px] text-muted-foreground mt-1">Click to unequip</p>
        </TooltipContent>
      )}
    </Tooltip>
  );
}


// Duration constants for buff background calculation (in ms)
const BUFF_DURATIONS: Record<string, number> = {
  Potion: 120_000, Inspire: 90_000, Food: 300_000, 'Eagle Eye': 30_000, 'Battle Cry': 30_000, Envenom: 30_000, 'Cloak of Shadows': 15_000, Ignite: 30_000, 'Force Shield': 20_000, Crescendo: 25_000,
};

function ActiveBuffs({ isAtInn, regenBuff, foodBuff, critBuff, acBuff, poisonBuff, evasionBuff, igniteBuff, absorbBuff, partyRegenBuff }: { isAtInn?: boolean; regenBuff?: { multiplier: number; expiresAt: number }; foodBuff?: { flatRegen: number; expiresAt: number }; critBuff?: { bonus: number; expiresAt: number }; acBuff?: { bonus: number; expiresAt: number } | null; poisonBuff?: { expiresAt: number } | null; evasionBuff?: { dodgeChance: number; expiresAt: number; source?: 'cloak' | 'disengage' } | null; igniteBuff?: { expiresAt: number } | null; absorbBuff?: { shieldHp: number; expiresAt: number } | null; partyRegenBuff?: { healPerTick: number; expiresAt: number } | null }) {
  const [now, setNow] = useState(Date.now());
  const buffActive = regenBuff && now < regenBuff.expiresAt;
  const foodActive = foodBuff && now < foodBuff.expiresAt;
  const critActive = critBuff && now < critBuff.expiresAt;
  const acActive = acBuff && now < acBuff.expiresAt;
  const poisonActive = poisonBuff && now < poisonBuff.expiresAt;
  const evasionActive = evasionBuff && now < evasionBuff.expiresAt;
  const igniteActive = igniteBuff && now < igniteBuff.expiresAt;
  const absorbActive = absorbBuff && now < absorbBuff.expiresAt;
  const partyRegenActive = partyRegenBuff && now < partyRegenBuff.expiresAt;

  useEffect(() => {
    if (!buffActive && !foodActive && !isAtInn && !critActive && !acActive && !poisonActive && !evasionActive && !igniteActive && !absorbActive && !partyRegenActive) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [buffActive, foodActive, isAtInn, critActive, acActive, poisonActive, evasionActive, igniteActive, absorbActive, partyRegenActive]);

  const buffs: { emoji: string; label: string; detail: string; color: string; bgColor: string; pct: number }[] = [];

  if (isAtInn) {
    buffs.push({ emoji: '🏨', label: 'Inn Rest', detail: '3× regen', color: 'text-elvish', bgColor: 'bg-elvish/15', pct: 100 });
  }

  if (buffActive) {
    const isInspire = regenBuff!.multiplier === 2;
    const lbl = isInspire ? 'Inspire' : 'Potion';
    const dur = BUFF_DURATIONS[lbl] || 120_000;
    const pct = Math.max(0, Math.min(100, ((regenBuff!.expiresAt - now) / dur) * 100));
    buffs.push({
      emoji: isInspire ? '🎶' : '🧪',
      label: lbl,
      detail: `${regenBuff!.multiplier}× regen`,
      color: isInspire ? 'text-elvish' : 'text-primary',
      bgColor: isInspire ? 'bg-elvish/15' : 'bg-primary/15',
      pct,
    });
  }

  if (foodActive) {
    const dur = BUFF_DURATIONS['Food'] || 120_000;
    const pct = Math.max(0, Math.min(100, ((foodBuff!.expiresAt - now) / dur) * 100));
    buffs.push({
      emoji: '🍞',
      label: 'Food',
      detail: `+${foodBuff!.flatRegen} regen`,
      color: 'text-elvish',
      bgColor: 'bg-elvish/15',
      pct,
    });
  }

  if (critActive) {
    const dur = BUFF_DURATIONS['Eagle Eye'] || 30_000;
    const pct = Math.max(0, Math.min(100, ((critBuff!.expiresAt - now) / dur) * 100));
    buffs.push({
      emoji: '🦅',
      label: 'Eagle Eye',
      detail: `Crit ${20 - critBuff!.bonus}-20`,
      color: 'text-primary',
      bgColor: 'bg-primary/15',
      pct,
    });
  }

  if (acActive) {
    const dur = BUFF_DURATIONS['Battle Cry'] || 30_000;
    const pct = Math.max(0, Math.min(100, ((acBuff!.expiresAt - now) / dur) * 100));
    buffs.push({
      emoji: '📯',
      label: 'Battle Cry',
      detail: `AC +${acBuff!.bonus}`,
      color: 'text-dwarvish',
      bgColor: 'bg-dwarvish/15',
      pct,
    });
  }

  if (poisonActive) {
    const dur = BUFF_DURATIONS['Envenom'] || 30_000;
    const pct = Math.max(0, Math.min(100, ((poisonBuff!.expiresAt - now) / dur) * 100));
    buffs.push({
      emoji: '🧪',
      label: 'Envenom',
      detail: '40% poison proc',
      color: 'text-elvish',
      bgColor: 'bg-elvish/15',
      pct,
    });
  }

  if (evasionActive) {
    const isDisengage = evasionBuff!.source === 'disengage';
    const dur = isDisengage ? 8_000 : (BUFF_DURATIONS['Cloak of Shadows'] || 15_000);
    const pct = Math.max(0, Math.min(100, ((evasionBuff!.expiresAt - now) / dur) * 100));
    buffs.push({
      emoji: isDisengage ? '🦘' : '🌫️',
      label: isDisengage ? 'Disengage' : 'Cloak of Shadows',
      detail: isDisengage ? '100% dodge + next hit bonus' : '50% dodge',
      color: isDisengage ? 'text-accent' : 'text-primary',
      bgColor: isDisengage ? 'bg-accent/15' : 'bg-primary/15',
      pct,
    });
  }

  if (igniteActive) {
    const dur = BUFF_DURATIONS['Ignite'] || 30_000;
    const pct = Math.max(0, Math.min(100, ((igniteBuff!.expiresAt - now) / dur) * 100));
    buffs.push({
      emoji: '🔥🔥',
      label: 'Ignite',
      detail: '40% burn proc',
      color: 'text-dwarvish',
      bgColor: 'bg-dwarvish/15',
      pct,
    });
  }

  if (absorbActive) {
    const dur = BUFF_DURATIONS['Force Shield'] || 20_000;
    const pct = Math.max(0, Math.min(100, ((absorbBuff!.expiresAt - now) / dur) * 100));
    buffs.push({
      emoji: '🛡️✨',
      label: 'Force Shield',
      detail: `${absorbBuff!.shieldHp} HP`,
      color: 'text-primary',
      bgColor: 'bg-primary/15',
      pct,
    });
  }

  if (partyRegenActive) {
    const dur = BUFF_DURATIONS['Crescendo'] || 25_000;
    const pct = Math.max(0, Math.min(100, ((partyRegenBuff!.expiresAt - now) / dur) * 100));
    buffs.push({
      emoji: '🎶✨',
      label: 'Crescendo',
      detail: `+${partyRegenBuff!.healPerTick} HP/3s`,
      color: 'text-elvish',
      bgColor: 'bg-elvish/15',
      pct,
    });
  }

  if (buffs.length === 0) return (
    <div className="text-[9px] text-muted-foreground/40 italic">No buffs</div>
  );

  return (
    <div className="flex flex-col gap-1">
      {buffs.map(b => (
        <span
          key={b.label}
          className={`relative inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-border overflow-hidden text-[10px] font-display ${b.color}`}
        >
          <span className={`absolute inset-0 ${b.bgColor} origin-left transition-transform duration-1000 ease-linear`} style={{ transform: `scaleX(${b.pct / 100})` }} />
          <span className="relative z-10">{b.emoji}</span>
          <span className="relative z-10">{b.label}</span>
          <span className="relative z-10 text-muted-foreground">{b.detail}</span>
        </span>
      ))}
    </div>
  );
}

export default function CharacterPanel({
  character, equipped, unequipped, equipmentBonuses, onEquip, onUnequip, onDrop, onDestroy, onUseConsumable,
  isAtInn, regenBuff, regenTick, baseRegen = 1, itemHpRegen = 0, foodBuff, critBuff, acBuff,
  poisonBuff, evasionBuff, igniteBuff, absorbBuff, partyRegenBuff,
  beltedPotions = [], beltCapacity = 0, onBeltPotion, onUnbeltPotion, inCombat = false,
}: Props) {
  const hpPercent = Math.round((character.hp / character.max_hp) * 100);
  const xpForNext = getXpForLevel(character.level);
  const xpPercent = Math.round((character.xp / xpForNext) * 100);
  const totalAC = character.ac + (equipmentBonuses.ac || 0);

  const getEquippedInSlot = (slot: string) => equipped.find(i => i.equipped_slot === slot);
  const mainHandItem = getEquippedInSlot('main_hand');
  const isTwoHanded = mainHandItem && mainHandItem.item.hands === 2;

  return (
    <TooltipProvider delayDuration={200}>
      <div className="h-full flex flex-col p-3 space-y-3 overflow-y-auto">
        {/* Name & Identity */}
        <div className="text-center">
          <h2 className="font-display text-lg text-primary text-glow">{character.name}</h2>
          <p className="text-xs text-muted-foreground">
            {RACE_LABELS[character.race]} {CLASS_LABELS[character.class]} — Lvl {character.level}
          </p>
        </div>

        {/* HP Bar */}
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="cursor-help">
              <div className="flex justify-between text-xs mb-1">
                <span className="text-muted-foreground">HP</span>
                <span className="flex items-center gap-1">
                  {regenTick && (
                    <span className="text-[10px] text-elvish animate-fade-in font-display">+regen</span>
                  )}
                  <span className="text-blood">{character.hp}/{character.max_hp}</span>
                </span>
              </div>
              <div className={`h-2 bg-background rounded-full overflow-hidden border transition-all duration-300 ${regenTick ? 'border-elvish shadow-[0_0_8px_hsl(var(--elvish)/0.6)]' : 'border-border'}`}>
                <div
                  className="h-full transition-all duration-500"
                  style={{
                    width: `${hpPercent}%`,
                    background: hpPercent > 50 ? 'hsl(var(--elvish))' : hpPercent > 25 ? 'hsl(var(--gold))' : 'hsl(var(--blood))',
                  }}
                />
              </div>
            </div>
          </TooltipTrigger>
          <TooltipContent className="bg-popover border-border z-50 space-y-1">
            <p className="font-display text-sm">Regeneration</p>
            <p className="text-xs text-muted-foreground">Base (CON): <span className="text-elvish">{baseRegen} HP</span> every <span className="text-foreground">15s</span></p>
            {itemHpRegen > 0 && (
              <p className="text-xs text-elvish">⚙️ Gear: <span className="text-foreground">+{itemHpRegen} HP</span></p>
            )}
            {isAtInn && (
              <p className="text-xs text-elvish">🏨 Inn Rest: <span className="text-foreground">3× multiplier</span></p>
            )}
            {regenBuff && Date.now() < regenBuff.expiresAt && (
              <p className="text-xs text-primary">🧪 Potion: <span className="text-foreground">{regenBuff.multiplier}× multiplier</span> <span className="text-muted-foreground">({Math.ceil((regenBuff.expiresAt - Date.now()) / 1000)}s left)</span></p>
            )}
            {foodBuff && Date.now() < foodBuff.expiresAt && (
              <p className="text-xs text-elvish">🍞 Food: <span className="text-foreground">+{foodBuff.flatRegen} HP</span> <span className="text-muted-foreground">({Math.ceil((foodBuff.expiresAt - Date.now()) / 1000)}s left)</span></p>
            )}
            {(() => {
              const potionMult = regenBuff && Date.now() < regenBuff.expiresAt ? regenBuff.multiplier : 1;
              const innMult = isAtInn ? 3 : 1;
              const foodRegen = foodBuff && Date.now() < foodBuff.expiresAt ? foodBuff.flatRegen : 0;
              const total = Math.max(Math.floor((baseRegen + itemHpRegen + foodRegen) * potionMult * innMult), 1);
              return <p className="text-xs font-display text-elvish border-t border-border pt-1">Total: {total} HP every 15s</p>;
            })()}
          </TooltipContent>
        </Tooltip>

        {/* CP Bar */}
        {(() => {
          const cp = character.cp ?? 100;
          const maxCp = character.max_cp ?? 100;
          const cpPercent = Math.round((cp / maxCp) * 100);
          const primaryStat = CLASS_PRIMARY_STAT[character.class] || 'con';
          const primaryVal = (character as any)[primaryStat] ?? 10;
          const cpRegen = getCpRegenRate(primaryVal);
          const hasInspire = regenBuff && Date.now() < regenBuff.expiresAt;
          const inspireMult = hasInspire ? regenBuff.multiplier : 1;
          const hasFood = foodBuff && Date.now() < foodBuff.expiresAt;
          const foodCpRegen = hasFood ? foodBuff.flatRegen * 0.5 : 0;
          const innMult = isAtInn ? 3 : 1;
          const effectiveRegen = (cpRegen + foodCpRegen) * innMult * inspireMult;
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
                <p className="text-xs text-muted-foreground">Base regen: <span className="text-primary">{cpRegen} CP</span> / <span className="text-foreground">6s</span></p>
                {(hasInspire || hasFood || isAtInn) && (
                  <p className="text-xs text-muted-foreground">Effective: <span className="text-primary">{effectiveRegen.toFixed(1)} CP</span> / <span className="text-foreground">6s</span></p>
                )}
                <p className="text-xs text-muted-foreground">Abilities cost CP to use.</p>
                {isAtInn && <p className="text-xs text-elvish">🏨 Inn: 3× CP regen</p>}
                {hasInspire && <p className="text-xs text-elvish">🎶 Inspire: 2× CP regen</p>}
                {hasFood && <p className="text-xs text-elvish">🍞 Food: +{(foodCpRegen).toFixed(1)} CP/6s</p>}
              </TooltipContent>
            </Tooltip>
          );
        })()}

        {/* XP Bar */}
        <div>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-muted-foreground">XP</span>
            <span className="text-primary">{character.xp}/{xpForNext}</span>
          </div>
          <div className="h-1.5 bg-background rounded-full overflow-hidden border border-border">
            <div className="h-full bg-primary transition-all duration-500" style={{ width: `${xpPercent}%` }} />
          </div>
        </div>

        {/* Stats — vertical breakdown */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <h3 className="font-display text-xs text-muted-foreground">Attributes</h3>
            
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
                    <p className="text-xs text-muted-foreground">Your natural stat from race, class, and level-up points.</p>
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
                  const base = (character as any)[key] as number;
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
            {/* Right column: Active Buffs */}
            <div className="border-l border-border pl-2">
              <div className="text-[9px] text-muted-foreground/70 mb-0.5">Buffs</div>
              <ActiveBuffs isAtInn={isAtInn} regenBuff={regenBuff} foodBuff={foodBuff} critBuff={critBuff} acBuff={acBuff} poisonBuff={poisonBuff} evasionBuff={evasionBuff} igniteBuff={igniteBuff} absorbBuff={absorbBuff} partyRegenBuff={partyRegenBuff} />
            </div>
          </div>
          <div className="flex gap-3 justify-center text-xs mt-1.5">
            <span className="font-display text-foreground">
              AC {totalAC}
              {(equipmentBonuses.ac || 0) > 0 && <span className="text-chart-2">+{equipmentBonuses.ac}</span>}
            </span>
            <span className="font-display text-primary">Gold {character.gold}</span>
          </div>
        </div>

        {/* Equipment — Paper Doll Layout */}
        <div>
          <h3 className="font-display text-xs text-muted-foreground mb-1.5">Equipment</h3>
          <div className="relative flex flex-col items-center gap-1">

            {/* Equipment slots — 3-column grid */}
            <div className="grid grid-cols-3 gap-1 w-full justify-items-center relative z-10">
              {/* Row 1: Trinket - Head - (empty) */}
              <EquipSlot slot="trinket" item={getEquippedInSlot('trinket')} blocked={false} onUnequip={onUnequip} />
              <EquipSlot slot="head" item={getEquippedInSlot('head')} blocked={false} onUnequip={onUnequip} />
              <div />
              {/* Row 2: (empty) - Amulet - (empty) */}
              <div />
              <EquipSlot slot="amulet" item={getEquippedInSlot('amulet')} blocked={false} onUnequip={onUnequip} />
              <div />
              {/* Row 3: Shoulders - Chest - Gloves */}
              <EquipSlot slot="shoulders" item={getEquippedInSlot('shoulders')} blocked={false} onUnequip={onUnequip} />
              <EquipSlot slot="chest" item={getEquippedInSlot('chest')} blocked={false} onUnequip={onUnequip} />
              <EquipSlot slot="gloves" item={getEquippedInSlot('gloves')} blocked={false} onUnequip={onUnequip} />
              {/* Row 4: Main Hand - Belt - Off Hand */}
              <EquipSlot slot="main_hand" item={getEquippedInSlot('main_hand')} blocked={false} onUnequip={onUnequip} />
              <EquipSlot slot="belt" item={getEquippedInSlot('belt')} blocked={false} onUnequip={onUnequip} />
              <EquipSlot slot="off_hand" item={getEquippedInSlot('off_hand')} blocked={!!isTwoHanded} onUnequip={onUnequip} />
              {/* Row 5: Ring - Pants - (empty) */}
              <EquipSlot slot="ring" item={getEquippedInSlot('ring')} blocked={false} onUnequip={onUnequip} />
              <EquipSlot slot="pants" item={getEquippedInSlot('pants')} blocked={false} onUnequip={onUnequip} />
              <div />
              {/* Row 6: (empty) - Boots - (empty) */}
              <div />
              <EquipSlot slot="boots" item={getEquippedInSlot('boots')} blocked={false} onUnequip={onUnequip} />
              <div />
          </div>
        </div>

        {/* Belt Potions */}
        {beltCapacity > 0 && (
          <div>
            <h3 className="font-display text-xs text-muted-foreground mb-1.5">
              Belt Potions ({beltedPotions.length}/{beltCapacity})
            </h3>
            <div className="space-y-1">
              {Array.from({ length: beltCapacity }, (_, i) => {
                const slot = i + 1;
                const potion = beltedPotions.find(p => p.belt_slot === slot);
                return (
                  <div key={slot} className="flex items-center justify-between p-1.5 rounded border border-border bg-background/30 text-xs">
                    <span className="text-muted-foreground text-[9px] w-4">{slot}.</span>
                    {potion ? (
                      <>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className={`font-display truncate flex-1 cursor-help ${RARITY_COLORS[potion.item.rarity]}`}>
                              {potion.item.name}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent className="bg-popover border-border z-50">
                            <p className={`font-display ${RARITY_COLORS[potion.item.rarity]}`}>{potion.item.name}</p>
                            <p className="text-xs text-muted-foreground">{potion.item.description}</p>
                            {Object.entries(potion.item.stats || {}).map(([k, v]) => (
                              <p key={k} className={`text-xs ${k === 'hp_regen' ? 'text-elvish' : k === 'hp' ? 'text-blood' : ''}`}>
                                {k === 'hp_regen' ? `+${v as number} Regen` : k === 'hp' ? `+${v as number} HP` : `+${v as number} ${k.toUpperCase()}`}
                              </p>
                            ))}
                            <p className="text-[10px] text-muted-foreground mt-1">Value: {potion.item.value}g</p>
                          </TooltipContent>
                        </Tooltip>
                        <div className="flex gap-0.5 shrink-0 ml-1">
                          {onUseConsumable && (
                            <Button size="sm" variant="ghost" className="h-5 w-5 p-0"
                              onClick={() => onUseConsumable(potion.id)}>
                              <Heart className="w-3 h-3 text-blood" />
                            </Button>
                          )}
                          {!inCombat && onUnbeltPotion && (
                            <Button size="sm" variant="ghost" className="h-5 w-5 p-0"
                              onClick={() => onUnbeltPotion(potion.id)}>
                              <ArrowDownToLine className="w-3 h-3 text-muted-foreground" />
                            </Button>
                          )}
                        </div>
                      </>
                    ) : (
                      <span className="text-[10px] text-muted-foreground/50 flex-1">Empty</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
        </div>

        {/* Inventory */}
        <div>
          <h3 className="font-display text-xs text-muted-foreground mb-1.5">
            Inventory ({unequipped.filter(i => i.belt_slot === null || i.belt_slot === undefined).length})
          </h3>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {unequipped.length === 0 ? (
              <p className="text-[10px] text-muted-foreground/50 italic">Empty</p>
            ) : (() => {
              // Filter out belted items — they show in the belt section
              const bagItems = unequipped.filter(i => i.belt_slot === null || i.belt_slot === undefined);
              if (bagItems.length === 0) return <p className="text-[10px] text-muted-foreground/50 italic">Empty</p>;
              // Group bag items by item_id
              const grouped: { representative: InventoryItem; all: InventoryItem[] }[] = [];
              const map = new Map<string, InventoryItem[]>();
              for (const inv of bagItems) {
                const key = inv.item_id;
                if (!map.has(key)) { map.set(key, []); grouped.push({ representative: inv, all: map.get(key)! }); }
                map.get(key)!.push(inv);
              }
              return grouped.map(({ representative: inv, all }) => {
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
                      {Object.entries(inv.item.stats || {}).map(([k, v]) => (
                        <p key={k} className={`text-xs ${k === 'hp_regen' ? 'text-elvish' : ''}`}>
                          {k === 'hp_regen' ? `+${v as number} Regen` : `+${v as number} ${k.toUpperCase()}`}
                        </p>
                      ))}
                      <p className="text-[10px] text-muted-foreground">Durability: {inv.current_durability}/{inv.item.max_durability} | Value: {inv.item.value}g</p>
                      {all.length > 1 && <p className="text-[10px] text-muted-foreground">Qty: {all.length}</p>}
                    </TooltipContent>
                  </Tooltip>
                  <div className="flex gap-0.5 shrink-0 ml-1">
                    {!isBroken && inv.item.item_type === 'consumable' && ((inv.item.stats?.hp as number) > 0 || (inv.item.stats?.hp_regen as number) > 0) && onUseConsumable && !inCombat && (
                      <Button size="sm" variant="ghost" className="h-5 w-5 p-0"
                        onClick={() => onUseConsumable(all[0].id)}>
                        <Heart className="w-3 h-3 text-blood" />
                      </Button>
                    )}
                    {!isBroken && inv.item.item_type === 'consumable' && !inCombat && onBeltPotion && beltCapacity > 0 && beltedPotions.length < beltCapacity && (
                      <Button size="sm" variant="ghost" className="h-5 w-5 p-0"
                        onClick={() => onBeltPotion(all[0].id)}>
                        <ArrowUpFromLine className="w-3 h-3 text-primary" />
                      </Button>
                    )}
                    {!isBroken && inv.item.slot && (
                      <Button size="sm" variant="ghost" className="h-5 w-5 p-0"
                        onClick={() => onEquip(all[0].id, inv.item.slot!)}>
                        <Shield className="w-3 h-3 text-primary" />
                      </Button>
                    )}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button size="sm" variant="ghost" className="h-5 w-5 p-0"
                          onClick={() => onDrop(all[0].id)}>
                          <ArrowDownToLine className="w-3 h-3 text-muted-foreground" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="text-xs">Drop on ground</TooltipContent>
                    </Tooltip>
                    {onDestroy && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button size="sm" variant="ghost" className="h-5 w-5 p-0"
                            onClick={() => onDestroy(all[0].id)}>
                            <Trash2 className="w-3 h-3 text-destructive" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="text-xs">Destroy permanently</TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                </div>
                );
              });
            })()}
          </div>
        </div>

      </div>
    </TooltipProvider>
  );
}
