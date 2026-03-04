import React, { useState, useEffect } from 'react';
import { Character } from '@/hooks/useCharacter';
import { InventoryItem } from '@/hooks/useInventory';
import { RACE_LABELS, CLASS_LABELS, STAT_LABELS, getStatModifier, getCharacterTitle, getCarryCapacity, getBagWeight } from '@/lib/game-data';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { Shield, Trash2, Heart, ArrowUpFromLine, ArrowDownToLine, ChevronDown, ArrowUpDown } from 'lucide-react';
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
  damageBuff?: { expiresAt: number } | null;
  evasionBuff?: { dodgeChance: number; expiresAt: number; source?: 'cloak' | 'disengage' } | null;
  igniteBuff?: { expiresAt: number } | null;
  absorbBuff?: { shieldHp: number; expiresAt: number } | null;
  partyRegenBuff?: { healPerTick: number; expiresAt: number } | null;
  focusStrikeBuff?: { bonusDmg: number } | null;
  // Belt potion system
  beltedPotions?: InventoryItem[];
  beltCapacity?: number;
  onBeltPotion?: (inventoryId: string) => void;
  onUnbeltPotion?: (inventoryId: string) => void;
  inCombat?: boolean;
  actionBindings?: Record<string, string[]>;
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
  Potion: 120_000, Inspire: 90_000, Food: 300_000, 'Eagle Eye': 30_000, 'Battle Cry': 30_000, Envenom: 30_000, 'Arcane Surge': 25_000, 'Cloak of Shadows': 15_000, Ignite: 30_000, 'Force Shield': 20_000, Crescendo: 25_000,
};

function ActiveBuffs({ isAtInn, regenBuff, foodBuff, critBuff, acBuff, poisonBuff, damageBuff, evasionBuff, igniteBuff, absorbBuff, partyRegenBuff, focusStrikeBuff }: { isAtInn?: boolean; regenBuff?: { multiplier: number; expiresAt: number }; foodBuff?: { flatRegen: number; expiresAt: number }; critBuff?: { bonus: number; expiresAt: number }; acBuff?: { bonus: number; expiresAt: number } | null; poisonBuff?: { expiresAt: number } | null; damageBuff?: { expiresAt: number } | null; evasionBuff?: { dodgeChance: number; expiresAt: number; source?: 'cloak' | 'disengage' } | null; igniteBuff?: { expiresAt: number } | null; absorbBuff?: { shieldHp: number; expiresAt: number } | null; partyRegenBuff?: { healPerTick: number; expiresAt: number } | null; focusStrikeBuff?: { bonusDmg: number } | null }) {
  const [now, setNow] = useState(Date.now());
  const buffActive = regenBuff && now < regenBuff.expiresAt;
  const foodActive = foodBuff && now < foodBuff.expiresAt;
  const critActive = critBuff && now < critBuff.expiresAt;
  const acActive = acBuff && now < acBuff.expiresAt;
  const poisonActive = poisonBuff && now < poisonBuff.expiresAt;
  const dmgBuffActive = damageBuff && now < damageBuff.expiresAt;
  const evasionActive = evasionBuff && now < evasionBuff.expiresAt;
  const igniteActive = igniteBuff && now < igniteBuff.expiresAt;
  const absorbActive = absorbBuff && now < absorbBuff.expiresAt;
  const partyRegenActive = partyRegenBuff && now < partyRegenBuff.expiresAt;

  useEffect(() => {
    if (!buffActive && !foodActive && !isAtInn && !critActive && !acActive && !poisonActive && !dmgBuffActive && !evasionActive && !igniteActive && !absorbActive && !partyRegenActive) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [buffActive, foodActive, isAtInn, critActive, acActive, poisonActive, dmgBuffActive, evasionActive, igniteActive, absorbActive, partyRegenActive]);

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

  if (dmgBuffActive) {
    const dur = BUFF_DURATIONS['Arcane Surge'] || 25_000;
    const pct = Math.max(0, Math.min(100, ((damageBuff!.expiresAt - now) / dur) * 100));
    buffs.push({
      emoji: '✨',
      label: 'Arcane Surge',
      detail: '1.5× spell dmg',
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

  if (focusStrikeBuff) {
    buffs.push({
      emoji: '🎯',
      label: 'Focus Strike',
      detail: `+${focusStrikeBuff.bonusDmg} dmg`,
      color: 'text-primary',
      bgColor: 'bg-primary/15',
      pct: 100,
    });
  }

  if (buffs.length === 0) return (
    <div className="text-[9px] text-muted-foreground/40 italic">No buffs</div>
  );

  return (
    <div className="flex flex-wrap gap-1">
      {buffs.map(b => (
        <Tooltip key={b.label}>
          <TooltipTrigger asChild>
            <span
              className={`relative inline-flex items-center gap-0.5 px-1.5 py-1 rounded border border-border overflow-hidden text-sm font-display ${b.color} cursor-default`}
            >
              <span className={`absolute inset-0 ${b.bgColor} origin-left transition-transform duration-1000 ease-linear`} style={{ transform: `scaleX(${b.pct / 100})` }} />
              <span className="relative z-10">{b.emoji}</span>
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            <span className="font-display">{b.label}</span> — {b.detail}
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}

export default function CharacterPanel({
  character, equipped, unequipped, equipmentBonuses, onEquip, onUnequip, onDrop, onDestroy, onUseConsumable,
  isAtInn, regenBuff, regenTick, baseRegen = 1, itemHpRegen = 0, foodBuff, critBuff, acBuff,
  poisonBuff, damageBuff, evasionBuff, igniteBuff, absorbBuff, partyRegenBuff, focusStrikeBuff,
  beltedPotions = [], beltCapacity = 0, onBeltPotion, onUnbeltPotion, inCombat = false,
  actionBindings,
}: Props) {
  const [attrsOpen, setAttrsOpen] = useState(true);
  const [equipOpen, setEquipOpen] = useState(true);
  const [inventorySort, setInventorySort] = useState<'default' | 'name' | 'rarity' | 'type'>('default');

  const getEquippedInSlot = (slot: string) => equipped.find(i => i.equipped_slot === slot);
  const mainHandItem = getEquippedInSlot('main_hand');
  const isTwoHanded = mainHandItem && mainHandItem.item.hands === 2;

  return (
    <TooltipProvider delayDuration={200}>
      <div className="h-full flex flex-col p-3 space-y-3 overflow-y-auto">
        {/* Name & Identity */}
        <div className="text-center">
          <h2 className="font-display text-lg text-primary text-glow">{character.name}</h2>
          {getCharacterTitle(character.level, character.gender) && (
            <p className="text-[10px] text-primary/70 font-display tracking-widest uppercase">{getCharacterTitle(character.level, character.gender)}</p>
          )}
          <p className="text-xs text-muted-foreground">
            {RACE_LABELS[character.race]} {CLASS_LABELS[character.class]} — Lvl {character.level}
          </p>
        </div>

        {/* Stats — vertical breakdown */}
        <Collapsible open={attrsOpen} onOpenChange={setAttrsOpen}>
          <CollapsibleTrigger className="flex items-center justify-between w-full py-1">
            <h3 className="font-display text-xs text-muted-foreground">Attributes</h3>
            <ChevronDown className={`h-3 w-3 text-muted-foreground transition-transform ${attrsOpen ? '' : '-rotate-90'}`} />
          </CollapsibleTrigger>
          <CollapsibleContent>
          <div className="space-y-1.5">
            {/* Two-column stat layout: Physical | Mental */}
            <div className="grid grid-cols-2 gap-x-3">
              {[['str', 'int'], ['dex', 'wis'], ['con', 'cha']].map(([left, right]) => {
                const lBase = (character as any)[left] as number;
                const lBonus = equipmentBonuses[left] || 0;
                const rBase = (character as any)[right] as number;
                const rBonus = equipmentBonuses[right] || 0;
                return (
                  <React.Fragment key={`${left}-${right}`}>
                    {/* Left stat */}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="flex items-center justify-between text-xs py-0.5 px-1 rounded hover:bg-accent/30 cursor-help">
                          <span className="font-display text-foreground">{STAT_FULL_NAMES[left]}</span>
                          <span className="flex gap-1.5 tabular-nums">
                            <span className="text-foreground">{lBase}</span>
                            <span className="text-chart-2 w-5 text-right">{lBonus > 0 ? `+${lBonus}` : ''}</span>
                          </span>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent className="bg-popover border-border z-50">
                        <p className="font-display text-sm">{STAT_FULL_NAMES[left]}</p>
                        <p className="text-xs text-muted-foreground">{STAT_DESCRIPTIONS[left]}</p>
                      </TooltipContent>
                    </Tooltip>
                    {/* Right stat */}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="flex items-center justify-between text-xs py-0.5 px-1 rounded hover:bg-accent/30 cursor-help">
                          <span className="font-display text-foreground">{STAT_FULL_NAMES[right]}</span>
                          <span className="flex gap-1.5 tabular-nums">
                            <span className="text-foreground">{rBase}</span>
                            <span className="text-chart-2 w-5 text-right">{rBonus > 0 ? `+${rBonus}` : ''}</span>
                          </span>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent className="bg-popover border-border z-50">
                        <p className="font-display text-sm">{STAT_FULL_NAMES[right]}</p>
                        <p className="text-xs text-muted-foreground">{STAT_DESCRIPTIONS[right]}</p>
                      </TooltipContent>
                    </Tooltip>
                  </React.Fragment>
                );
              })}
            </div>
            {/* AC & Gold row */}
            <div className="flex justify-center gap-4 text-xs border-t border-border pt-1">
              <span className="font-display text-foreground">
                AC {character.ac + (equipmentBonuses.ac || 0)}
                {(equipmentBonuses.ac || 0) > 0 && <span className="text-chart-2 ml-0.5">+{equipmentBonuses.ac}</span>}
              </span>
              <span className="font-display text-primary">Gold {character.gold}</span>
            </div>
          </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Equipment — Paper Doll Layout */}
        <Collapsible open={equipOpen} onOpenChange={setEquipOpen}>
          <CollapsibleTrigger className="flex items-center justify-between w-full py-1">
            <h3 className="font-display text-xs text-muted-foreground">Equipment</h3>
            <ChevronDown className={`h-3 w-3 text-muted-foreground transition-transform ${equipOpen ? '' : '-rotate-90'}`} />
          </CollapsibleTrigger>
          <CollapsibleContent>
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
                    <span className="text-muted-foreground text-[9px] w-4">
                      {actionBindings?.[`potion${slot}`]?.[0]
                        ? `[${actionBindings[`potion${slot}`][0]}]`
                        : `${slot}.`}
                    </span>
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
                            <p className="text-[10px] text-muted-foreground capitalize">{potion.item.item_type}</p>
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
        </CollapsibleContent>
        </Collapsible>

        {/* Inventory */}
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="flex items-center justify-between mb-1.5">
            {(() => {
              const bagItems = unequipped.filter(i => i.belt_slot === null || i.belt_slot === undefined);
              const bagWeight = getBagWeight(bagItems);
              const effectiveStr = character.str + (equipmentBonuses.str || 0);
              const capacity = getCarryCapacity(effectiveStr);
              const isOver = bagWeight > capacity;
              return (
                <h3 className="font-display text-xs text-muted-foreground">
                  Inventory ({bagItems.length}) — <span className={isOver ? 'text-destructive' : ''}>{bagWeight}/{capacity}{isOver ? ' ⚠️' : ''}</span>
                </h3>
              );
            })()}
            <button
              onClick={() => setInventorySort(prev => prev === 'default' ? 'name' : prev === 'name' ? 'rarity' : prev === 'rarity' ? 'type' : 'default')}
              className="flex items-center gap-0.5 text-[9px] text-muted-foreground hover:text-foreground transition-colors"
              title="Sort inventory"
            >
              <ArrowUpDown className="w-3 h-3" />
              <span className="capitalize">{inventorySort === 'default' ? '' : inventorySort}</span>
            </button>
          </div>
          <div className="space-y-1 flex-1 min-h-0 overflow-y-auto">
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
              // Sort groups
              const RARITY_ORDER: Record<string, number> = { common: 0, uncommon: 1, rare: 2, unique: 3 };
              if (inventorySort === 'name') {
                grouped.sort((a, b) => a.representative.item.name.localeCompare(b.representative.item.name));
              } else if (inventorySort === 'rarity') {
                grouped.sort((a, b) => (RARITY_ORDER[b.representative.item.rarity] ?? 0) - (RARITY_ORDER[a.representative.item.rarity] ?? 0));
              } else if (inventorySort === 'type') {
                grouped.sort((a, b) => a.representative.item.item_type.localeCompare(b.representative.item.item_type));
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
