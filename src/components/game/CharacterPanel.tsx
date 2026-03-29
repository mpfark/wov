import React, { useState, useEffect } from 'react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Character } from '@/hooks/useCharacter';
import { InventoryItem } from '@/hooks/useInventory';
import { RACE_LABELS, CLASS_LABELS, STAT_LABELS, getStatModifier, getCharacterTitle, getCarryCapacity, getBagWeight, getBaseRegen, getMaxCp, getMaxMp, getMpRegenRate, getCpRegenRate, CLASS_PRIMARY_STAT, getIntHitBonus, getDexCritBonus, getWisDodgeChance, getChaSellMultiplier, getChaBuyDiscount, getStrDamageFloor, RACE_STATS, CLASS_STATS, CLASS_LEVEL_BONUSES, calculateStats, calculateAC, CLASS_WEAPON_AFFINITY, WEAPON_TAG_LABELS } from '@/lib/game-data';
import { CLASS_COMBAT } from '@/lib/class-abilities';
import { SHIELD_AC_BONUS, SHIELD_AWARENESS_BONUS, OFFHAND_DAMAGE_MULT, isShield, isOffhandWeapon } from '@/lib/combat-math';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Shield, Trash2, Heart, ArrowUpFromLine, ArrowDownToLine, ArrowUpDown } from 'lucide-react';
import vitruvianMan from '@/assets/vitruvian-man.png';
import StatPlannerDialog from '@/components/game/StatPlannerDialog';

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
  onAllocateStat?: (stat: string) => void;
  onFullRespec?: () => void;
  onBatchAllocateStats?: (allocations: Record<string, number>) => void;
}

const RARITY_COLORS: Record<string, string> = {
  common: 'text-foreground',
  uncommon: 'text-elvish',
  unique: 'text-primary text-glow',
};

const getItemColor = (item: { rarity: string; is_soulbound?: boolean }) =>
  item.is_soulbound ? 'text-soulforged text-glow-soulforged' : (RARITY_COLORS[item.rarity] || '');

const STAT_FULL_NAMES: Record<string, string> = {
  str: 'Strength', dex: 'Dexterity', con: 'Constitution',
  int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma',
};

const STAT_DESCRIPTIONS: Record<string, string> = {
  str: 'Melee attack, carry capacity, +min damage floor on all attacks',
  dex: 'Ranged attack, AC bonus, max Stamina, crit chance',
  con: 'Hit points and physical resilience',
  int: 'Arcane power, CP pool, improves hit chance',
  wis: 'Perception, healing, chance to reduce incoming damage by 25%',
  cha: 'Persuasion, bardic abilities, better vendor prices & humanoid gold',
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
              <div className={`text-[10px] font-display truncate ${getItemColor(item.item)}`}>
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
          <p className={`font-display ${getItemColor(item.item)}`}>{item.item.name}</p>
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
  actionBindings, onAllocateStat, onFullRespec, onBatchAllocateStats,
}: Props) {
  const [inventorySort, setInventorySort] = useState<'default' | 'name' | 'rarity' | 'type'>('default');
  const [pendingStat, setPendingStat] = useState<string | null>(null);
  const [showRespecConfirm, setShowRespecConfirm] = useState(false);
  const [statPlannerOpen, setStatPlannerOpen] = useState(false);
  const getEquippedInSlot = (slot: string) => equipped.find(i => i.equipped_slot === slot);
  const mainHandItem = getEquippedInSlot('main_hand');
  const isTwoHanded = mainHandItem && mainHandItem.item.hands === 2;
  const mainHandTag = mainHandItem?.item?.weapon_tag as string | undefined;
  const isProficient = !!(mainHandTag && CLASS_WEAPON_AFFINITY[character.class]?.includes(mainHandTag));
  const offHandItem = getEquippedInSlot('off_hand');
  const offHandTag = offHandItem?.item?.weapon_tag as string | undefined;
  const offHandIsShield = isShield(offHandTag);
  const offHandIsWeapon = isOffhandWeapon(offHandTag);

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

        {/* Tabs: Equipment & Attributes */}
        <Tabs defaultValue="equipment" className="space-y-1.5">
          <TabsList className="h-7 w-full bg-muted/50 p-0.5">
            <TabsTrigger value="equipment" className="font-display text-xs h-6 flex-1">Equipment</TabsTrigger>
            <TabsTrigger value="attributes" className="font-display text-xs h-6 flex-1 relative">
              Attributes
              {character.unspent_stat_points > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-primary animate-pulse" />
              )}
            </TabsTrigger>
          </TabsList>

          {/* Gold — always visible */}
          <div className="flex justify-center text-xs">
            <span className="font-display text-primary">Gold {character.gold}</span>
          </div>

          {/* Tab content */}
          <div>
            {/* Equipment */}
            <TabsContent value="equipment" className="mt-0">
              <div className="relative flex flex-col items-center gap-1">
                <div className="grid grid-cols-3 gap-1 w-full justify-items-center relative z-10">
                  <EquipSlot slot="trinket" item={getEquippedInSlot('trinket')} blocked={false} onUnequip={onUnequip} />
                  <EquipSlot slot="head" item={getEquippedInSlot('head')} blocked={false} onUnequip={onUnequip} />
                  <div />
                  <div />
                  <EquipSlot slot="amulet" item={getEquippedInSlot('amulet')} blocked={false} onUnequip={onUnequip} />
                  <div />
                  <EquipSlot slot="shoulders" item={getEquippedInSlot('shoulders')} blocked={false} onUnequip={onUnequip} />
                  <EquipSlot slot="chest" item={getEquippedInSlot('chest')} blocked={false} onUnequip={onUnequip} />
                  <EquipSlot slot="gloves" item={getEquippedInSlot('gloves')} blocked={false} onUnequip={onUnequip} />
                  <div className="relative">
                    <EquipSlot slot="main_hand" item={getEquippedInSlot('main_hand')} blocked={false} onUnequip={onUnequip} />
                    {isProficient && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 text-[8px] font-display bg-primary/20 text-primary border border-primary/30 rounded px-1 whitespace-nowrap cursor-help">
                            Proficient
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="text-xs">+1 Hit, +10% Damage ({WEAPON_TAG_LABELS[mainHandTag!] || mainHandTag})</TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                  <EquipSlot slot="belt" item={getEquippedInSlot('belt')} blocked={false} onUnequip={onUnequip} />
                  <div className="relative">
                    <EquipSlot slot="off_hand" item={getEquippedInSlot('off_hand')} blocked={!!isTwoHanded} onUnequip={onUnequip} />
                    {offHandIsShield && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 text-[8px] font-display bg-accent/20 text-accent-foreground border border-accent/30 rounded px-1 whitespace-nowrap cursor-help">
                            🛡️ Shield
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="text-xs">+1 AC, +5% Awareness</TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                  <EquipSlot slot="ring" item={getEquippedInSlot('ring')} blocked={false} onUnequip={onUnequip} />
                  <EquipSlot slot="pants" item={getEquippedInSlot('pants')} blocked={false} onUnequip={onUnequip} />
                  <div />
                  <div />
                  <EquipSlot slot="boots" item={getEquippedInSlot('boots')} blocked={false} onUnequip={onUnequip} />
                  <div />
                </div>
              </div>

              {/* Belt Potions */}
              {beltCapacity > 0 && (
                <div className="mt-2">
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
                                  <span className={`font-display truncate flex-1 cursor-help ${getItemColor(potion.item)}`}>
                                    {potion.item.name}
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent className="bg-popover border-border z-50">
                                  <p className={`font-display ${getItemColor(potion.item)}`}>{potion.item.name}</p>
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

              {/* Inventory */}
              <div className="mt-3 flex flex-col">
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
                <div className="space-y-1">
                  {unequipped.length === 0 ? (
                    <p className="text-[10px] text-muted-foreground/50 italic">Empty</p>
                  ) : (() => {
                    const bagItems = unequipped.filter(i => i.belt_slot === null || i.belt_slot === undefined);
                    if (bagItems.length === 0) return <p className="text-[10px] text-muted-foreground/50 italic">Empty</p>;
                    const grouped: { representative: InventoryItem; all: InventoryItem[] }[] = [];
                    const map = new Map<string, InventoryItem[]>();
                    for (const inv of bagItems) {
                      const key = inv.item_id;
                      if (!map.has(key)) { map.set(key, []); grouped.push({ representative: inv, all: map.get(key)! }); }
                      map.get(key)!.push(inv);
                    }
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
                            <span className={`font-display truncate flex-1 cursor-help ${getItemColor(inv.item)}`}>
                              {isBroken && <span className="text-destructive mr-1">⚒</span>}
                              {inv.item.name}
                              {all.length > 1 && <span className="text-[9px] text-muted-foreground ml-1">×{all.length}</span>}
                              {inv.item.hands && <span className="text-[9px] text-muted-foreground ml-1">({inv.item.hands}H)</span>}
                              {isBroken && <span className="text-[9px] text-destructive ml-1">(Broken)</span>}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent className="bg-popover border-border z-50 max-w-xs">
                            <p className={`font-display ${getItemColor(inv.item)}`}>{inv.item.name}</p>
                            {isBroken && <p className="text-xs text-destructive font-display">Broken — needs repair</p>}
                            <p className="text-xs text-muted-foreground">{inv.item.description}</p>
                            {inv.item.slot && <p className="text-[10px] text-muted-foreground capitalize">{SLOT_LABELS[inv.item.slot] || inv.item.slot} · {inv.item.item_type}{inv.item.hands === 2 ? ' · Two-Handed' : inv.item.hands === 1 ? ' · One-Handed' : ''}</p>}
                            {!inv.item.slot && <p className="text-[10px] text-muted-foreground capitalize">{inv.item.item_type}</p>}
                            {Object.entries(inv.item.stats || {}).map(([k, v]) => (
                              <p key={k} className={`text-xs ${k === 'hp_regen' ? 'text-elvish' : ''}`}>
                                {k === 'hp_regen' ? `+${v as number} Regen` : `+${v as number} ${k.toUpperCase()}`}
                              </p>
                            ))}
                            <p className="text-[10px] text-muted-foreground">Durability: {inv.current_durability}% | Value: {inv.item.value}g</p>
                            {all.length > 1 && <p className="text-[10px] text-muted-foreground">Qty: {all.length}</p>}
                            {/* Gear comparison */}
                            {inv.item.slot && (() => {
                              // For 2H weapons, compare against both main_hand and off_hand combined
                              const isTwoHandedItem = inv.item.hands === 2;
                              const currentlyEquipped = equipped.find(e => e.equipped_slot === inv.item.slot);
                              const newStats = inv.item.stats || {};
                              const oldStats: Record<string, number> = {};
                              
                              if (isTwoHandedItem) {
                                // Combine stats from both main_hand and off_hand
                                const mainHand = equipped.find(e => e.equipped_slot === 'main_hand');
                                const offHand = equipped.find(e => e.equipped_slot === 'off_hand');
                                for (const item of [mainHand, offHand]) {
                                  if (item) {
                                    for (const [k, v] of Object.entries(item.item.stats || {})) {
                                      oldStats[k] = (oldStats[k] || 0) + (v as number);
                                    }
                                  }
                                }
                              } else {
                                // Check if currently equipped main_hand is 2H — compare against full 2H stats
                                const mainHand = equipped.find(e => e.equipped_slot === 'main_hand');
                                const mainIs2H = mainHand && mainHand.item.hands === 2;
                                if (mainIs2H && (inv.item.slot === 'main_hand' || inv.item.slot === 'off_hand')) {
                                  for (const [k, v] of Object.entries(mainHand.item.stats || {})) {
                                    oldStats[k] = (v as number) || 0;
                                  }
                                } else if (currentlyEquipped) {
                                  for (const [k, v] of Object.entries(currentlyEquipped.item.stats || {})) {
                                    oldStats[k] = (v as number) || 0;
                                  }
                                }
                              }
                              
                              const allKeys = new Set([...Object.keys(newStats), ...Object.keys(oldStats)]);
                              if (allKeys.size === 0) return null;
                              const diffs: { key: string; diff: number }[] = [];
                              for (const k of allKeys) {
                                const nv = (newStats[k] as number) || 0;
                                const ov = oldStats[k] || 0;
                                if (nv - ov !== 0) diffs.push({ key: k, diff: nv - ov });
                              }
                              if (diffs.length === 0) return null;
                              return (
                                <div className="mt-1.5 pt-1.5 border-t border-border">
                                  <p className="text-[9px] text-muted-foreground mb-0.5">
                                    vs {isTwoHandedItem
                                      ? (equipped.find(e => e.equipped_slot === 'main_hand') || equipped.find(e => e.equipped_slot === 'off_hand')
                                        ? 'main + off hand'
                                        : 'empty slots')
                                      : (currentlyEquipped ? currentlyEquipped.item.name : 'empty slot')}
                                  </p>
                                  {diffs.map(({ key, diff }) => (
                                    <p key={key} className={`text-[10px] font-display ${diff > 0 ? 'text-elvish' : 'text-destructive'}`}>
                                      {diff > 0 ? '+' : ''}{diff} {key === 'hp_regen' ? 'Regen' : key.toUpperCase()}
                                    </p>
                                  ))}
                                </div>
                              );
                            })()}
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
                          {!inv.item.is_soulbound && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button size="sm" variant="ghost" className="h-5 w-5 p-0"
                                  onClick={() => onDrop(all[0].id)}>
                                  <ArrowDownToLine className="w-3 h-3 text-muted-foreground" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="text-xs">Drop on ground</TooltipContent>
                            </Tooltip>
                          )}
                          {onDestroy && !inv.item.is_soulbound && (
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
            </TabsContent>

            <TabsContent value="attributes" className="mt-0">
              <div className="space-y-2.5">
                {/* Base stats — single column: STR, DEX, CON, INT, WIS, CHA */}
                {(character.unspent_stat_points > 0 || (character.respec_points || 0) > 0) && (
                  <div className="text-[10px] font-display text-center py-0.5 bg-primary/10 rounded border border-primary/20 flex justify-center gap-3 items-center">
                    {character.unspent_stat_points > 0 && (
                      <span className="text-primary">{character.unspent_stat_points} stat point{character.unspent_stat_points > 1 ? 's' : ''}</span>
                    )}
                    {character.unspent_stat_points > 1 && onBatchAllocateStats && (
                      <button
                        onClick={() => setStatPlannerOpen(true)}
                        className="text-chart-2 hover:text-chart-2/80 underline underline-offset-2 transition-colors"
                      >
                        Plan Stats
                      </button>
                    )}
                    {(character.respec_points || 0) > 0 && onFullRespec && (
                      <button
                        onClick={() => setShowRespecConfirm(true)}
                        className="text-chart-5 hover:text-chart-5/80 underline underline-offset-2 transition-colors"
                      >
                        Full Respec ({character.respec_points})
                      </button>
                    )}
                  </div>
                )}
                <div className="space-y-0">
                  {['str', 'dex', 'con', 'int', 'wis', 'cha'].map(stat => {
                    const base = (character as any)[stat] as number;
                    const bonus = equipmentBonuses[stat] || 0;
                    const effective = base + bonus;
                    const mod = getStatModifier(effective);
                    const hasPoints = character.unspent_stat_points > 0;
                    // Calculate non-manual base: creation stats + class level bonuses
                    const creationStats = calculateStats(character.race, character.class);
                    const levelBonuses = CLASS_LEVEL_BONUSES[character.class] || {};
                    const levelBonusTotal = Math.floor((character.level - 1) / 3) * (levelBonuses[stat] || 0);
                    const nonManualBase = (creationStats[stat] || 8) + levelBonusTotal;
                    const manualPoints = base - nonManualBase;
                    
                    // Calculate derived bonuses for each stat
                    let derivedBonus = '';
                    if (stat === 'str') {
                      const dmgFloor = getStrDamageFloor(effective);
                      derivedBonus = dmgFloor > 0 
                        ? `+${dmgFloor} Min Damage (cap: +5)` 
                        : 'Min Damage at 14+ (cap: +5)';
                    } else if (stat === 'dex') {
                      const critBonus = getDexCritBonus(effective);
                      derivedBonus = critBonus > 0 
                        ? `+${critBonus} Crit Range (cap: +5)` 
                        : 'Crit Range at 14+ (cap: +5)';
                    } else if (stat === 'int') {
                      const hitBonus = getIntHitBonus(effective);
                      derivedBonus = hitBonus > 0 
                        ? `+${hitBonus} Hit Chance (cap: +5)` 
                        : 'Hit Chance at 12+ (cap: +5)';
                    } else if (stat === 'wis') {
                      const dodgeChance = getWisDodgeChance(effective);
                      derivedBonus = dodgeChance > 0 
                        ? `${Math.round(dodgeChance * 100)}% Awareness (cap: 20%)` 
                        : 'Awareness at 12+ (cap: 20%)';
                    } else if (stat === 'cha') {
                      const buyDiscount = getChaBuyDiscount(effective);
                      const sellMult = getChaSellMultiplier(effective);
                      const goldMult = Math.round(((sellMult - 1) / 0.05) * 5); // Convert back to percentage
                      derivedBonus = buyDiscount > 0 
                        ? `−${Math.round(buyDiscount * 100)}% buy / +${goldMult}% gold (cap: 10% / +35%)` 
                        : 'Vendor bonus at 12+ (cap: 10% / +35%)';
                    }
                    
                    return (
                      <Tooltip key={stat}>
                        <TooltipTrigger asChild>
                          <div className="flex items-center justify-between text-xs py-0.5 px-1 rounded hover:bg-accent/30 cursor-help">
                            <span className="flex items-center gap-1">
                              {hasPoints && onAllocateStat && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); setPendingStat(stat); }}
                                  className="w-4 h-4 flex items-center justify-center rounded bg-primary/20 hover:bg-primary/40 text-primary text-[10px] font-bold transition-colors"
                                  title={`Add 1 to ${STAT_FULL_NAMES[stat]}`}
                                >
                                  +
                                </button>
                              )}
                              <span className="font-display text-foreground">{STAT_FULL_NAMES[stat]}</span>
                            </span>
                            <span className="flex gap-1.5 tabular-nums">
                              <span className="text-foreground">{base}</span>
                              <span className="text-chart-2 w-5 text-right">{bonus > 0 ? `+${bonus}` : ''}</span>
                              <span className="text-muted-foreground w-6 text-right text-[10px]">({mod >= 0 ? '+' : ''}{mod})</span>
                            </span>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent className="bg-popover border-border z-50">
                          <p className="font-display text-sm">{STAT_FULL_NAMES[stat]}</p>
                          <p className="text-xs text-muted-foreground">{STAT_DESCRIPTIONS[stat]}</p>
                          <p className="text-[10px] text-muted-foreground">Modifier: {mod >= 0 ? '+' : ''}{mod}</p>
                          {derivedBonus && (
                            <p className="text-[10px] text-chart-2 mt-0.5 border-t border-border/50 pt-0.5">
                              {derivedBonus}
                            </p>
                          )}
                          {manualPoints > 0 && <p className="text-[10px] text-chart-5 mt-0.5">{manualPoints} manually allocated</p>}
                          {((character.bhp_trained || {}) as Record<string, number>)[stat] > 0 && (
                            <p className="text-[10px] text-elvish mt-0.5">🏋️ +{((character.bhp_trained || {}) as Record<string, number>)[stat]} BHP trained</p>
                          )}
                        </TooltipContent>
                      </Tooltip>
                    );
                  })}
                </div>

                {/* BHP Balance */}
                {character.level >= 30 && (
                  <div className="flex items-center justify-between text-xs px-1 py-0.5 bg-elvish/10 rounded border border-elvish/20">
                    <span className="font-display text-elvish">🏋️ Boss Hunter Points</span>
                    <span className="font-display text-elvish tabular-nums">{character.bhp || 0}</span>
                  </div>
                )}

                {/* Derived Stats */}
                {(() => {
                  const now = Date.now();
                  const acBuffActive = acBuff && now < acBuff.expiresAt;
                  const critBuffActive = critBuff && now < critBuff.expiresAt;
                  const evasionActive = evasionBuff && now < evasionBuff.expiresAt;
                  const dmgBuffActive = damageBuff && now < damageBuff.expiresAt;
                  const absorbActive = absorbBuff && now < absorbBuff.expiresAt;
                  const focusActive = !!focusStrikeBuff;
                  const poisonActive = poisonBuff && now < poisonBuff.expiresAt;
                  const igniteActive = igniteBuff && now < igniteBuff.expiresAt;

                  const eCon = character.con + (equipmentBonuses.con || 0);
                  const eDex = character.dex + (equipmentBonuses.dex || 0);
                  const eInt = character.int + (equipmentBonuses.int || 0);
                  const eWis = character.wis + (equipmentBonuses.wis || 0);
                  const eCha = character.cha + (equipmentBonuses.cha || 0);
                  const hpRegen = getBaseRegen(eCon) + (itemHpRegen || 0);
                  const maxCp = getMaxCp(character.level, eInt, eWis, eCha);
                  const maxMp = getMaxMp(character.level, eDex);
                  const primaryStat = CLASS_PRIMARY_STAT[character.class] || 'con';
                  const baseCpRegen = getCpRegenRate((character as any)[primaryStat] + (equipmentBonuses[primaryStat] || 0));
                  const mpRegen = getMpRegenRate(eDex);

                  // Regen multiplier from buffs
                  const regenBuffActive = regenBuff && now < regenBuff.expiresAt;
                  const foodBuffActive = foodBuff && now < foodBuff.expiresAt;
                  const partyRegenActive = partyRegenBuff && now < partyRegenBuff.expiresAt;
                  let effectiveHpRegen = hpRegen;
                  const potionBonus = regenBuffActive ? 0.5 : 0;
                  const innBonus = isAtInn ? 1 : 0;
                  const milestoneBonus = character.level >= 35 ? 0.5 : 0;
                  const regenMultiplier = 1 + potionBonus + milestoneBonus + innBonus;
                  effectiveHpRegen = Math.max(Math.floor((hpRegen + (foodBuffActive ? foodBuff!.flatRegen : 0)) * regenMultiplier + (partyRegenActive ? partyRegenBuff!.healPerTick : 0)), 1);
                  const hpRegenBuffed = regenMultiplier > 1 || foodBuffActive || partyRegenActive;

                  const combat = CLASS_COMBAT[character.class];
                  const atkStat = combat?.stat || 'str';
                  const atkMod = getStatModifier((character as any)[atkStat] + (equipmentBonuses[atkStat] || 0));
                  const intHit = getIntHitBonus(eInt);
                  const milestoneCrit = character.level >= 28 ? 1 : 0;
                  const dexCrit = getDexCritBonus(eDex);
                  const baseCritRange = (combat?.critRange || 20) - milestoneCrit - dexCrit;
                  const effectiveCrit = critBuffActive ? baseCritRange - critBuff!.bonus : baseCritRange;
                  const wisHalveChance = getWisDodgeChance(eWis) + (offHandIsShield ? SHIELD_AWARENESS_BONUS : 0);
                  const strFloor = getStrDamageFloor(character.str + (equipmentBonuses.str || 0));
                  const sellMult = getChaSellMultiplier(eCha);
                  const buyDisc = getChaBuyDiscount(eCha);

                  const baseAC = calculateAC(character.class, eDex) + (equipmentBonuses.ac || 0) + (offHandIsShield ? SHIELD_AC_BONUS : 0);
                  const totalAC = acBuffActive ? baseAC + acBuff!.bonus : baseAC;

                   const affinityHit = isProficient ? 1 : 0;
                   const totalHitBonus = atkMod + intHit + affinityHit;
                   const sameLevelAC = Math.round(10 + character.level * 0.575 + 2);
                   // Player hit chance vs same-level regular creature
                   const playerCritThreshold = 20 - dexCrit;
                   const playerCritHits = 20 - playerCritThreshold + 1;
                   const playerRollNeeded = sameLevelAC - totalHitBonus;
                   const playerNormalFloor = Math.max(2, playerRollNeeded);
                   const playerNormalCeiling = playerCritThreshold - 1;
                   const playerNormalHits = playerNormalCeiling >= playerNormalFloor ? playerNormalCeiling - playerNormalFloor + 1 : 0;
                   const totalHits = Math.min(19, playerCritHits + playerNormalHits);
                   const hitChance = Math.round((totalHits / 20) * 100);

                   // Creature hit chance vs player AC (same-level regular creature)
                   const creatureBaseStat = Math.round(10 + character.level * 0.7);
                   const creatureAtkMod = Math.floor((creatureBaseStat - 10) / 2);
                   const creatureDexStat = Math.round(10 + character.level * 0.7 - 1);
                   const creatureCritBonus = getDexCritBonus(creatureDexStat);
                   const creatureCritThreshold = 20 - creatureCritBonus;
                   const crCritHits = 20 - creatureCritThreshold + 1;
                   const crRollNeeded = totalAC - creatureAtkMod;
                   const crNormalFloor = Math.max(2, crRollNeeded);
                   const crNormalCeiling = creatureCritThreshold - 1;
                   const crNormalHits = crNormalCeiling >= crNormalFloor ? crNormalCeiling - crNormalFloor + 1 : 0;
                   const creatureTotalHits = Math.min(19, crCritHits + crNormalHits);
                   const getHitChance = Math.round((creatureTotalHits / 20) * 100);

                   // Evasion buff dodge bonus
                   const baseDodge = 100 - getHitChance;
                   const effectiveDodge = evasionActive ? Math.min(100, baseDodge + Math.round(evasionBuff!.dodgeChance * 100)) : baseDodge;

                   const atkSpeed = '2.0';

                  // Damage multiplier text
                  const dmgMultParts: string[] = [];
                  if (dmgBuffActive) dmgMultParts.push('1.5× Arcane Surge');
                  if (focusActive) dmgMultParts.push(`+${focusStrikeBuff!.bonusDmg} Focus Strike`);

                  type DerivedRow = { label: string; value: string; tip: string; buffed?: boolean; buffColor?: string };

                  const poolRows: DerivedRow[] = [
                    { label: 'Max HP', value: `${character.max_hp + (equipmentBonuses.hp || 0) + Math.floor((equipmentBonuses.con || 0) / 2)}${absorbActive ? ` (+${absorbBuff!.shieldHp})` : ''}`, tip: `Base ${character.max_hp} + ${equipmentBonuses.hp || 0} HP gear + ${Math.floor((equipmentBonuses.con || 0) / 2)} from CON gear${absorbActive ? ` + ${absorbBuff!.shieldHp} Force Shield` : ''}`, buffed: !!absorbActive, buffColor: 'text-primary' },
                    { label: 'HP Regen', value: `${effectiveHpRegen}/tick`, tip: `Base ${hpRegen} × ${regenMultiplier}${foodBuffActive ? ` + ${foodBuff!.flatRegen} food` : ''}${partyRegenActive ? ` + ${partyRegenBuff!.healPerTick} Crescendo` : ''} (every 6s, ×0.4 scaling)`, buffed: hpRegenBuffed, buffColor: 'text-elvish' },
                     { label: 'Max CP', value: `${maxCp}`, tip: `30 + (level-1)×3 + (INT_mod + WIS_mod)×3` },
                     (() => {
                       const cpMultiplier = 1 + (regenBuffActive ? 0.5 : 0) + (character.level >= 35 ? 0.5 : 0) + (isAtInn ? 1 : 0);
                       const foodCpBonus = foodBuffActive ? foodBuff!.flatRegen * 0.5 : 0;
                       const effectiveCpRegen = Math.max(+(baseCpRegen * cpMultiplier + foodCpBonus).toFixed(1), 0.1);
                       const cpRegenBuffed = cpMultiplier > 1 || foodBuffActive;
                       return { label: 'CP Regen', value: `${effectiveCpRegen}/tick`, tip: `Base ${baseCpRegen} × ${cpMultiplier}${foodBuffActive ? ` + ${foodCpBonus} food` : ''} (every 6s)`, buffed: cpRegenBuffed, buffColor: 'text-elvish' } as DerivedRow;
                     })(),
                    { label: 'Max Stamina', value: `${maxMp}`, tip: `100 + DEX mod×10 + (level-1)×2` },
                    { label: 'Stamina Regen', value: `${mpRegen}/tick`, tip: `5 + DEX modifier (every 6s)` },
                  ];

                  const offenseRows: DerivedRow[] = [
                    { label: `${combat?.label || 'Attack'}`, value: `${combat?.diceMin || 1}d${combat?.diceMax || 6} ${atkMod >= 0 ? '+' : ''}${atkMod}${dmgMultParts.length > 0 ? ' ✦' : ''}`, tip: `${atkStat.toUpperCase()} modifier applied to hit & damage${dmgMultParts.length > 0 ? '\n' + dmgMultParts.join(', ') : ''}`, buffed: dmgMultParts.length > 0, buffColor: 'text-elvish' },
                    { label: 'Atk Speed', value: `${atkSpeed}s`, tip: `Fixed 2.0s heartbeat` },
                    { label: 'Hit Chance', value: `${hitChance}%`, tip: `d20 + ${atkMod} ${atkStat.toUpperCase()} + ${intHit} INT${affinityHit ? ' + 1 Affinity' : ''} → ${hitChance}% vs same-level creature (AC ${sameLevelAC})` },
                    { label: 'Crit Range', value: effectiveCrit === 20 ? '20' : `${effectiveCrit}–20`, tip: `${milestoneCrit ? '+1 milestone, ' : ''}${dexCrit > 0 ? `+${dexCrit} DEX bonus` : 'DEX bonus at 14+'}${critBuffActive ? `, +${critBuff!.bonus} Eagle Eye` : ''}`, buffed: !!critBuffActive, buffColor: 'text-primary' },
                    { label: 'Min Damage', value: strFloor > 0 ? `+${strFloor}` : '–', tip: strFloor > 0 ? 'STR bonus: minimum damage floor on all attacks' : 'STR 14+ for minimum damage floor on all attacks' },
                  ];

                  // Procs line
                  if (poisonActive || igniteActive) {
                    const procs: string[] = [];
                    if (poisonActive) procs.push('40% Poison');
                    if (igniteActive) procs.push('40% Ignite');
                    offenseRows.push({ label: 'Procs', value: procs.join(' / '), tip: procs.join(', ') + ' on hit', buffed: true, buffColor: 'text-elvish' });
                  }

                  // AC overflow: damage reduction when creature crits but roll < AC
                  const creatureMaxCritRoll = 20 + creatureAtkMod;
                  const acOverflow = totalAC > creatureMaxCritRoll ? totalAC - creatureMaxCritRoll : 0;
                  const acOverflowPct = acOverflow > 0 ? Math.min(Math.round((acOverflow / totalAC) * 100), 50) : 0;

                  const defenseRows: DerivedRow[] = [
                    { label: 'AC', value: `${totalAC}${acBuffActive ? ` (+${acBuff!.bonus})` : ''}`, tip: `Base ${baseAC}${offHandIsShield ? ' (incl. +1 Shield)' : ''}${acBuffActive ? ` + ${acBuff!.bonus} Battle Cry` : ''} vs regular creature atk +${creatureAtkMod}`, buffed: !!acBuffActive, buffColor: 'text-dwarvish' },
                    { label: 'Dodge', value: `${effectiveDodge}%${evasionActive ? ' ✦' : ''}`, tip: `Chance a same-level creature misses you (AC ${totalAC})${evasionActive ? `\n+${Math.round(evasionBuff!.dodgeChance * 100)}% ${evasionBuff!.source === 'disengage' ? 'Disengage' : 'Cloak of Shadows'}` : ''}`, buffed: !!evasionActive, buffColor: 'text-primary' },
                    { label: 'AC Overflow', value: acOverflowPct > 0 ? `−${acOverflowPct}%` : '–', tip: acOverflowPct > 0 ? `When a same-level creature crits (max roll ${creatureMaxCritRoll}) vs your AC ${totalAC}, excess AC reduces crit damage by ${acOverflowPct}% (cap 50%)` : `AC must exceed creature max crit roll (${creatureMaxCritRoll}) to reduce crit damage` },
                    { label: 'Awareness', value: wisHalveChance > 0 ? `${Math.round(wisHalveChance * 100)}%` : '–', tip: wisHalveChance > 0 ? `WIS bonus: chance to reduce incoming damage by 25%${offHandIsShield ? ' (incl. +5% Shield)' : ''}` : 'WIS 12+ for chance to reduce incoming damage by 25%' },
                    { label: 'Vendor Bonus', value: buyDisc > 0 ? `-${Math.round(buyDisc * 100)}% / +${Math.round(sellMult * 100)}%` : '–', tip: buyDisc > 0 ? 'CHA bonus: better buy/sell prices' : 'CHA 12+ for better buy/sell prices' },
                  ];

                  const renderSection = (title: string, rows: DerivedRow[], cols: boolean = false) => (
                    <div className="border-t border-border pt-1.5">
                      <h4 className="font-display text-[10px] text-muted-foreground/60 uppercase tracking-wider mb-1">{title}</h4>
                      <div className={cols ? 'grid grid-cols-2 gap-x-3' : 'space-y-0'}>
                        {rows.map(r => (
                          <Tooltip key={r.label}>
                            <TooltipTrigger asChild>
                              <div className="flex items-center justify-between text-xs py-0.5 px-1 rounded hover:bg-accent/30 cursor-help">
                                <span className="text-muted-foreground">{r.label}</span>
                                <span className={`font-display tabular-nums ${r.buffed ? `${r.buffColor || 'text-elvish'} font-semibold` : 'text-foreground'}`}>{r.value}</span>
                              </div>
                            </TooltipTrigger>
                            <TooltipContent className="bg-popover border-border z-50">
                              <p className="font-display text-sm">{r.label}</p>
                              <p className="text-xs text-muted-foreground whitespace-pre-line">{r.tip}</p>
                            </TooltipContent>
                          </Tooltip>
                        ))}
                      </div>
                    </div>
                  );

                  return (
                    <>
                      {renderSection('Pools', poolRows, true)}
                      {renderSection('Offense', offenseRows)}
                      {renderSection('Defense', defenseRows)}
                    </>
                  );
                })()}
              </div>
            </TabsContent>
          </div>
        </Tabs>


      </div>

      {/* Stat allocation confirmation dialog */}
      <AlertDialog open={!!pendingStat} onOpenChange={(open) => { if (!open) setPendingStat(null); }}>
        <AlertDialogContent className="bg-card border-border max-w-xs">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-primary text-sm">Allocate Stat Point</AlertDialogTitle>
            <AlertDialogDescription className="text-xs">
              Add +1 to <strong className="text-foreground">{pendingStat ? STAT_FULL_NAMES[pendingStat] : ''}</strong>?
              {pendingStat && (
                <span className="block mt-1 text-muted-foreground">
                  {(character as any)[pendingStat]} → {(character as any)[pendingStat] + 1}
                </span>
              )}
              <span className="block mt-1 text-muted-foreground/70">You can undo this with a respec point.</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="text-xs h-7">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="text-xs h-7"
              onClick={() => {
                if (pendingStat && onAllocateStat) {
                  onAllocateStat(pendingStat);
                }
                setPendingStat(null);
              }}
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Full Respec confirmation dialog */}
      <AlertDialog open={showRespecConfirm} onOpenChange={setShowRespecConfirm}>
        <AlertDialogContent className="bg-card border-border max-w-xs">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-chart-5 text-sm">Full Respec</AlertDialogTitle>
            <AlertDialogDescription className="text-xs">
              Reset <strong className="text-foreground">all</strong> manually allocated stat points? They will be returned as unspent points for you to reallocate.
              <span className="block mt-1 text-muted-foreground/70">Uses 1 respec point ({character.respec_points} remaining).</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="text-xs h-7">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="text-xs h-7"
              onClick={() => {
                if (onFullRespec) onFullRespec();
                setShowRespecConfirm(false);
              }}
            >
              Confirm Respec
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {onBatchAllocateStats && (
        <StatPlannerDialog
          open={statPlannerOpen}
          onOpenChange={setStatPlannerOpen}
          character={character}
          equipmentBonuses={equipmentBonuses}
          onCommit={onBatchAllocateStats}
        />
      )}
    </TooltipProvider>
  );
}
