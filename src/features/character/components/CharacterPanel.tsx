import { useState, useEffect } from 'react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Character } from '@/features/character';
import { InventoryItem } from '@/features/inventory';
import { RACE_LABELS, CLASS_LABELS, getStatModifier, getCharacterTitle, getCarryCapacity, getBagWeight, getStatRegen, getCpRegen, getMpRegenRate, getIntHitBonus, getDexCritBonus, getWisDodgeChance, getChaSellMultiplier, getChaBuyDiscount, getStrDamageFloor, CLASS_LEVEL_BONUSES, calculateStats, CLASS_WEAPON_AFFINITY, WEAPON_TAG_LABELS, getEffectiveMaxHp, getEffectiveMaxCp, getEffectiveMaxMp, getEffectiveAC } from '@/lib/game-data';
import { SHIELD_AC_BONUS, SHIELD_ANTI_CRIT_BONUS, OFFHAND_DAMAGE_MULT, isShield, isOffhandWeapon, getCreatureAttackBonus, getShieldBlockChance, getShieldBlockAmount } from '@/features/combat';
import { getWeaponDie, ARCANE_SURGE_DAMAGE_MULT, ARCANE_SURGE_DAMAGE_BONUS_PCT } from '@/shared/formulas/combat';
import { getClassCritRange } from '@/shared/formulas/classes';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Shield, Trash2, Heart, ArrowUpFromLine, ArrowDownToLine, ArrowUpDown, Pin, PinOff } from 'lucide-react';
import _vitruvianMan from '@/assets/vitruvian-man.png';
import StatPlannerDialog from '@/features/character/components/StatPlannerDialog';
import ItemIllustration from '@/components/items/ItemIllustration';
import { STAT_CONTRIBUTIONS, type StatKey } from '@/features/character/utils/statContributions';

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
  onTogglePin?: (inventoryId: string) => void;
  
  // Regen info
  isAtInn?: boolean;
  regenTick?: boolean;
  baseRegen?: number;
  itemHpRegen?: number;
  foodBuff?: { flatRegen: number; expiresAt: number };
  critBuff?: { bonus: number; expiresAt: number };
  battleCryBuff?: { damageReduction: number; critReduction: number; expiresAt: number } | null;
  poisonBuff?: { expiresAt: number } | null;
  damageBuff?: { expiresAt: number } | null;
  evasionBuff?: { dodgeChance: number; expiresAt: number; source?: 'cloak' | 'disengage' } | null;
  igniteBuff?: { expiresAt: number } | null;
  absorbBuff?: { shieldHp: number; expiresAt: number } | null;
  partyRegenBuff?: { healPerTick: number; expiresAt: number } | null;
  inspireBuff?: { hpPerTick: number; cpPerTick: number; expiresAt: number; durationMs: number; casterId: string } | null;
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
  soulforged: 'text-soulforged text-glow-soulforged',
};

const getItemColor = (item: { rarity: string; is_soulbound?: boolean }) =>
  item.is_soulbound ? 'text-soulforged text-glow-soulforged' : (RARITY_COLORS[item.rarity] || '');

const STAT_FULL_NAMES: Record<string, string> = {
  str: STAT_CONTRIBUTIONS.str.full, dex: STAT_CONTRIBUTIONS.dex.full, con: STAT_CONTRIBUTIONS.con.full,
  int: STAT_CONTRIBUTIONS.int.full, wis: STAT_CONTRIBUTIONS.wis.full, cha: STAT_CONTRIBUTIONS.cha.full,
};

const STAT_DESCRIPTIONS: Record<string, string> = {
  str: STAT_CONTRIBUTIONS.str.short, dex: STAT_CONTRIBUTIONS.dex.short, con: STAT_CONTRIBUTIONS.con.short,
  int: STAT_CONTRIBUTIONS.int.short, wis: STAT_CONTRIBUTIONS.wis.short, cha: STAT_CONTRIBUTIONS.cha.short,
};

const SLOT_LABELS: Record<string, string> = {
  main_hand: 'Main Hand', off_hand: 'Off Hand',
  head: 'Head', amulet: 'Amulet', shoulders: 'Shoulders', chest: 'Chest',
  gloves: 'Gloves', belt: 'Belt', pants: 'Pants', ring: 'Ring', trinket: 'Trinket',
  boots: 'Boots',
};

function EquipSlot({ slot, item, blocked, onUnequip, locked }: {
  slot: string; item: InventoryItem | undefined; blocked: boolean; onUnequip: (id: string) => void; locked?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={`w-[6.5rem] h-[3.25rem] p-1 border rounded text-center transition-colors ${
            locked ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
          } ${
            blocked ? 'border-border/30 bg-background/10 opacity-50' :
            item ? 'border-primary/50 bg-primary/5' : 'border-border bg-background/30'
          }`}
          onClick={() => item && !blocked && !locked && onUnequip(item.id)}
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
        <TooltipContent className="bg-popover border-border z-50 max-w-xs">
          <ItemIllustration url={item.item.illustration_url} alt={item.item.name} />
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

export function ActiveBuffs({ isAtInn, foodBuff, critBuff, battleCryBuff, poisonBuff, damageBuff, evasionBuff, igniteBuff, absorbBuff, partyRegenBuff, inspireBuff }: { isAtInn?: boolean; foodBuff?: { flatRegen: number; expiresAt: number }; critBuff?: { bonus: number; expiresAt: number }; battleCryBuff?: { damageReduction: number; critReduction: number; expiresAt: number } | null; poisonBuff?: { expiresAt: number } | null; damageBuff?: { expiresAt: number } | null; evasionBuff?: { dodgeChance: number; expiresAt: number; source?: 'cloak' | 'disengage' } | null; igniteBuff?: { expiresAt: number } | null; absorbBuff?: { shieldHp: number; expiresAt: number } | null; partyRegenBuff?: { healPerTick: number; expiresAt: number } | null; inspireBuff?: { hpPerTick: number; cpPerTick: number; expiresAt: number; durationMs: number; casterId: string } | null }) {
  const [now, setNow] = useState(Date.now());
  const foodActive = foodBuff && now < foodBuff.expiresAt;
  const critActive = critBuff && now < critBuff.expiresAt;
  const acActive = battleCryBuff && now < battleCryBuff.expiresAt;
  const poisonActive = poisonBuff && now < poisonBuff.expiresAt;
  const dmgBuffActive = damageBuff && now < damageBuff.expiresAt;
  const evasionActive = evasionBuff && now < evasionBuff.expiresAt;
  const igniteActive = igniteBuff && now < igniteBuff.expiresAt;
  const absorbActive = absorbBuff && now < absorbBuff.expiresAt;
  const partyRegenActive = partyRegenBuff && now < partyRegenBuff.expiresAt;
  const inspireActive = inspireBuff && now < inspireBuff.expiresAt;

  useEffect(() => {
    if (!foodActive && !isAtInn && !critActive && !acActive && !poisonActive && !dmgBuffActive && !evasionActive && !igniteActive && !absorbActive && !partyRegenActive && !inspireActive) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [foodActive, isAtInn, critActive, acActive, poisonActive, dmgBuffActive, evasionActive, igniteActive, absorbActive, partyRegenActive, inspireActive]);

  const buffs: { emoji: string; label: string; detail: string; color: string; bgColor: string; pct: number }[] = [];

  if (isAtInn) {
    buffs.push({ emoji: '🏨', label: 'Inn Rest', detail: '+10 regen', color: 'text-elvish', bgColor: 'bg-elvish/15', pct: 100 });
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
    const pct = Math.max(0, Math.min(100, ((battleCryBuff!.expiresAt - now) / dur) * 100));
    buffs.push({
      emoji: '📯',
      label: 'Battle Cry',
      detail: `DR ${Math.round(battleCryBuff!.damageReduction * 100)}%`,
      color: 'text-dwarvish',
      bgColor: 'bg-dwarvish/15',
      pct,
    });
  }

  if (poisonActive) {
    const dur = BUFF_DURATIONS['Envenom'] || 30_000;
    const pct = Math.max(0, Math.min(100, ((poisonBuff!.expiresAt - now) / dur) * 100));
    buffs.push({
      emoji: '🐍',
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
      detail: `${ARCANE_SURGE_DAMAGE_MULT}× dmg (+${ARCANE_SURGE_DAMAGE_BONUS_PCT}%)`,
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

  if (inspireActive) {
    const dur = inspireBuff!.durationMs || 90_000;
    const pct = Math.max(0, Math.min(100, ((inspireBuff!.expiresAt - now) / dur) * 100));
    buffs.push({
      emoji: '🎶',
      label: 'Inspire',
      detail: `+${inspireBuff!.hpPerTick} HP & +${inspireBuff!.cpPerTick} CP regen`,
      color: 'text-elvish',
      bgColor: 'bg-elvish/15',
      pct,
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
  character, equipped, unequipped, equipmentBonuses, onEquip, onUnequip, onDrop, onDestroy, onUseConsumable, onTogglePin,
  isAtInn, regenTick: _regenTick, baseRegen: _baseRegen = 1, itemHpRegen = 0, foodBuff, critBuff, battleCryBuff,
  poisonBuff, damageBuff, evasionBuff, igniteBuff, absorbBuff, partyRegenBuff, inspireBuff,
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
            <TabsTrigger value="equipment" className="font-display text-[10px] h-6 flex-1">Equipment</TabsTrigger>
            <TabsTrigger value="inventory" className="font-display text-[10px] h-6 flex-1">
              Inventory
            </TabsTrigger>
            <TabsTrigger value="attributes" className="font-display text-[10px] h-6 flex-1 relative">
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
                  <EquipSlot slot="trinket" item={getEquippedInSlot('trinket')} blocked={false} onUnequip={onUnequip} locked={inCombat} />
                  <EquipSlot slot="head" item={getEquippedInSlot('head')} blocked={false} onUnequip={onUnequip} locked={inCombat} />
                  <div />
                  <div />
                  <EquipSlot slot="amulet" item={getEquippedInSlot('amulet')} blocked={false} onUnequip={onUnequip} locked={inCombat} />
                  <div />
                  <EquipSlot slot="shoulders" item={getEquippedInSlot('shoulders')} blocked={false} onUnequip={onUnequip} locked={inCombat} />
                  <EquipSlot slot="chest" item={getEquippedInSlot('chest')} blocked={false} onUnequip={onUnequip} locked={inCombat} />
                  <EquipSlot slot="gloves" item={getEquippedInSlot('gloves')} blocked={false} onUnequip={onUnequip} locked={inCombat} />
                  <div className="relative">
                    <EquipSlot slot="main_hand" item={getEquippedInSlot('main_hand')} blocked={false} onUnequip={onUnequip} locked={inCombat} />
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
                  <EquipSlot slot="belt" item={getEquippedInSlot('belt')} blocked={false} onUnequip={onUnequip} locked={inCombat} />
                  <div className="relative">
                    <EquipSlot slot="off_hand" item={getEquippedInSlot('off_hand')} blocked={!!isTwoHanded} onUnequip={onUnequip} locked={inCombat} />
                    {offHandIsShield && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 text-[8px] font-display bg-accent/20 text-accent-foreground border border-accent/30 rounded px-1 whitespace-nowrap cursor-help">
                            🛡️ Shield
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="text-xs">+1 AC, +5% Crit Resistance, Block chance</TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                  <EquipSlot slot="ring" item={getEquippedInSlot('ring')} blocked={false} onUnequip={onUnequip} locked={inCombat} />
                  <EquipSlot slot="pants" item={getEquippedInSlot('pants')} blocked={false} onUnequip={onUnequip} locked={inCombat} />
                  <div />
                  <div />
                  <EquipSlot slot="boots" item={getEquippedInSlot('boots')} blocked={false} onUnequip={onUnequip} locked={inCombat} />
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
                                <TooltipContent className="bg-popover border-border z-50 max-w-xs">
                                  <ItemIllustration url={potion.item.illustration_url} alt={potion.item.name} />
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

              {/* Consumables & Quest Items */}
              {(() => {
                const bagItems = unequipped.filter(i => i.belt_slot === null || i.belt_slot === undefined);
                const consumableAndQuestItems = bagItems.filter(i => i.item.item_type === 'consumable' || i.item.item_type === 'quest');
                if (consumableAndQuestItems.length === 0) return null;
                const grouped: { representative: InventoryItem; all: InventoryItem[] }[] = [];
                const map = new Map<string, InventoryItem[]>();
                for (const inv of consumableAndQuestItems) {
                  const key = inv.item_id;
                  if (!map.has(key)) { map.set(key, []); grouped.push({ representative: inv, all: map.get(key)! }); }
                  map.get(key)!.push(inv);
                }
                return (
                  <div className="mt-3 flex flex-col">
                    <h3 className="font-display text-xs text-muted-foreground mb-1.5">
                      Consumables ({consumableAndQuestItems.length})
                    </h3>
                    <div className="space-y-1">
                      {grouped.map(({ representative: inv, all }) => {
                        const isBroken = inv.current_durability <= 0;
                        return (
                          <div key={inv.item_id} className={`flex items-center justify-between p-1.5 rounded border border-border bg-background/30 text-xs ${isBroken ? 'opacity-50' : ''}`}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className={`font-display truncate flex-1 cursor-help ${getItemColor(inv.item)}`}>
                                  {inv.is_pinned && <span className="text-primary mr-0.5">📌</span>}
                                  {inv.item.name}
                                  {all.length > 1 && <span className="text-[9px] text-muted-foreground ml-1">×{all.length}</span>}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent className="bg-popover border-border z-50 max-w-xs">
                                <ItemIllustration url={inv.item.illustration_url} alt={inv.item.name} />
                                <p className={`font-display ${getItemColor(inv.item)}`}>{inv.item.name}</p>
                                <p className="text-xs text-muted-foreground">{inv.item.description}</p>
                                <p className="text-[10px] text-muted-foreground capitalize">{inv.item.item_type}</p>
                                {Object.entries(inv.item.stats || {}).map(([k, v]) => (
                                  <p key={k} className={`text-xs ${k === 'hp_regen' ? 'text-elvish' : k === 'hp' ? 'text-blood' : ''}`}>
                                    {k === 'hp_regen' ? `+${v as number} Regen` : k === 'hp' ? `+${v as number} HP` : `+${v as number} ${k.toUpperCase()}`}
                                  </p>
                                ))}
                                <p className="text-[10px] text-muted-foreground mt-1">Value: {inv.item.value}g</p>
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
                              {!inv.item.is_soulbound && onTogglePin && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button size="sm" variant="ghost" className="h-5 w-5 p-0"
                                      onClick={() => onTogglePin(all[0].id)}>
                                      {inv.is_pinned ? <PinOff className="w-3 h-3 text-primary" /> : <Pin className="w-3 h-3 text-muted-foreground" />}
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent side="top" className="text-xs">{inv.is_pinned ? 'Unpin (allow selling)' : 'Pin (prevent selling)'}</TooltipContent>
                                </Tooltip>
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
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </TabsContent>

            {/* Inventory Tab */}
            <TabsContent value="inventory" className="mt-0">
              <div className="flex flex-col">
                <div className="flex items-center justify-between mb-1.5">
                  {(() => {
                    const bagItems = unequipped.filter(i => i.belt_slot === null || i.belt_slot === undefined);
                    const inventoryItems = bagItems.filter(i => i.item.item_type !== 'consumable' && i.item.item_type !== 'quest');
                    const bagWeight = getBagWeight(bagItems);
                    const effectiveStr = character.str + (equipmentBonuses.str || 0);
                    const capacity = getCarryCapacity(effectiveStr);
                    const isOver = bagWeight > capacity;
                    return (
                      <h3 className="font-display text-xs text-muted-foreground">
                        Items ({inventoryItems.length}) — <span className={isOver ? 'text-destructive' : ''}>{bagWeight}/{capacity}{isOver ? ' ⚠️' : ''}</span>
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
                  {(() => {
                    const bagItems = unequipped.filter(i => i.belt_slot === null || i.belt_slot === undefined);
                    const inventoryItems = bagItems.filter(i => i.item.item_type !== 'consumable' && i.item.item_type !== 'quest');
                    if (inventoryItems.length === 0) return <p className="text-[10px] text-muted-foreground/50 italic">Empty</p>;
                    const grouped: { representative: InventoryItem; all: InventoryItem[] }[] = [];
                    const map = new Map<string, InventoryItem[]>();
                    for (const inv of inventoryItems) {
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
                              {inv.is_pinned && <span className="text-primary mr-0.5">📌</span>}
                              {isBroken && <span className="text-destructive mr-1">⚒</span>}
                              {inv.item.name}
                              {all.length > 1 && <span className="text-[9px] text-muted-foreground ml-1">×{all.length}</span>}
                              {inv.item.hands && <span className="text-[9px] text-muted-foreground ml-1">({inv.item.hands}H)</span>}
                              {isBroken && <span className="text-[9px] text-destructive ml-1">(Broken)</span>}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent className="bg-popover border-border z-50 max-w-xs">
                            <ItemIllustration url={inv.item.illustration_url} alt={inv.item.name} />
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
                              const isTwoHandedItem = inv.item.hands === 2;
                              const currentlyEquipped = equipped.find(e => e.equipped_slot === inv.item.slot);
                              const newStats = inv.item.stats || {};
                              const oldStats: Record<string, number> = {};
                              
                              if (isTwoHandedItem) {
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
                          {!isBroken && !inCombat && inv.item.slot && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button size="sm" variant="ghost" className="h-5 w-5 p-0"
                                  onClick={() => onEquip(all[0].id, inv.item.slot!)}>
                                  <Shield className="w-3 h-3 text-primary" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="text-xs">
                                {inv.item.slot === 'main_hand' ? 'Equip Main Hand' : `Equip ${SLOT_LABELS[inv.item.slot] || inv.item.slot}`}
                              </TooltipContent>
                            </Tooltip>
                          )}
                          {!isBroken && !inCombat && inv.item.slot === 'main_hand' && inv.item.hands === 1 && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button size="sm" variant="ghost" className="h-5 w-5 p-0"
                                  onClick={() => onEquip(all[0].id, 'off_hand')}>
                                  <Shield className="w-3 h-3 text-accent-foreground" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="text-xs">Equip Off Hand</TooltipContent>
                            </Tooltip>
                          )}
                          {!inv.item.is_soulbound && onTogglePin && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button size="sm" variant="ghost" className="h-5 w-5 p-0"
                                  onClick={() => onTogglePin(all[0].id)}>
                                  {inv.is_pinned ? <PinOff className="w-3 h-3 text-primary" /> : <Pin className="w-3 h-3 text-muted-foreground" />}
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="text-xs">{inv.is_pinned ? 'Unpin (allow selling)' : 'Pin (prevent selling)'}</TooltipContent>
                            </Tooltip>
                          )}
                          {!inv.item.is_soulbound && !inCombat && (
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
                    
                    // Derive contributions live from formula functions (single source of truth)
                    const contributions = STAT_CONTRIBUTIONS[stat as StatKey]?.effects ?? [];
                    const derivedLines = contributions.map(eff => `${eff.label}: ${eff.value(effective, character.level)}`);
                    
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
                          {derivedLines.length > 0 && (
                            <div className="mt-0.5 border-t border-border/50 pt-0.5 space-y-0">
                              {derivedLines.map((line, i) => (
                                <p key={i} className="text-[10px] text-chart-2">{line}</p>
                              ))}
                            </div>
                          )}
                          {manualPoints > 0 && <p className="text-[10px] text-chart-5 mt-0.5">{manualPoints} manually allocated</p>}
                          {((character.bhp_trained || {}) as Record<string, number>)[stat] > 0 && (
                            <p className="text-[10px] text-elvish mt-0.5">🏛️ +{((character.bhp_trained || {}) as Record<string, number>)[stat]} Renown trained</p>
                          )}
                        </TooltipContent>
                      </Tooltip>
                    );
                  })}
                </div>

                {/* Renown Balance + Lifetime */}
                {(character.bhp > 0 || (character.rp_total_earned || 0) > 0 || character.level >= 30) && (
                  <div className="space-y-0.5">
                    <div className="flex items-center justify-between text-xs px-1 py-0.5 bg-elvish/10 rounded border border-elvish/20">
                      <span className="font-display text-elvish">🏛️ Available Renown</span>
                      <span className="font-display text-elvish tabular-nums">{character.bhp || 0}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs px-1 py-0.5 bg-elvish/5 rounded border border-elvish/10">
                      <span className="font-display text-elvish/80">Lifetime Renown</span>
                      <span className="font-display text-elvish/80 tabular-nums">{character.rp_total_earned || 0}</span>
                    </div>
                  </div>
                )}

                {/* Derived Stats */}
                {(() => {
                  const now = Date.now();
                  const battleCryActive = battleCryBuff && now < battleCryBuff.expiresAt;
                  const critBuffActive = critBuff && now < critBuff.expiresAt;
                  const evasionActive = evasionBuff && now < evasionBuff.expiresAt;
                  const dmgBuffActive = damageBuff && now < damageBuff.expiresAt;
                  const absorbActive = absorbBuff && now < absorbBuff.expiresAt;
                  
                  const poisonActive = poisonBuff && now < poisonBuff.expiresAt;
                  const igniteActive = igniteBuff && now < igniteBuff.expiresAt;

                  const eCon = character.con + (equipmentBonuses.con || 0);
                  const eDex = character.dex + (equipmentBonuses.dex || 0);
                  const eInt = character.int + (equipmentBonuses.int || 0);
                  const eWis = character.wis + (equipmentBonuses.wis || 0);
                  const eCha = character.cha + (equipmentBonuses.cha || 0);
                  const hpRegen = getStatRegen(eCon) + (itemHpRegen || 0);
                  const maxCp = getEffectiveMaxCp(character.level, character.wis, equipmentBonuses);
                  const maxMp = getEffectiveMaxMp(character.level, character.dex, equipmentBonuses);
                  const baseCpRegen = getCpRegen(eInt);
                  const mpRegen = getMpRegenRate(eDex);

                  // Regen — additive only, no multipliers
                  const foodBuffActive = foodBuff && now < foodBuff.expiresAt;
                  const partyRegenActive = partyRegenBuff && now < partyRegenBuff.expiresAt;
                  const inspireActive = inspireBuff && now < inspireBuff.expiresAt;
                  const innFlat = isAtInn ? 10 : 0;
                  const milestoneHpFlat = (() => { if (character.level >= 40) return 10; if (character.level >= 35) return 8; if (character.level >= 30) return 6; if (character.level >= 25) return 4; if (character.level >= 20) return 2; return 0; })();
                  const effectiveHpRegen = Math.max(Math.floor(hpRegen + milestoneHpFlat + (foodBuffActive ? foodBuff!.flatRegen : 0) + innFlat + (partyRegenActive ? partyRegenBuff!.healPerTick : 0) + (inspireActive ? inspireBuff!.hpPerTick : 0)), 1);
                  const hpRegenBuffed = foodBuffActive || partyRegenActive || milestoneHpFlat > 0 || isAtInn;

                  // Autoattack: to-hit uses DEX, damage uses STR.
                  // (Class identity lives in T0 abilities, not in basic-attack stats.)
                  const weaponDie = getWeaponDie(mainHandTag ?? null, isTwoHanded ? 2 : 1);
                  const dmgMod = getStatModifier(character.str + (equipmentBonuses.str || 0));   // STR — damage
                  const hitMod = getStatModifier(character.dex + (equipmentBonuses.dex || 0));   // DEX — to-hit
                  const intHit = getIntHitBonus(eInt);
                  const dexCrit = getDexCritBonus(eDex);
                  const baseCritRange = getClassCritRange(character.class) - dexCrit;
                  const effectiveCrit = critBuffActive ? baseCritRange - critBuff!.bonus : baseCritRange;
                  const wisAntiCritChance = getWisDodgeChance(eWis) + (offHandIsShield ? SHIELD_ANTI_CRIT_BONUS : 0);
                  const strFloor = getStrDamageFloor(character.str + (equipmentBonuses.str || 0));
                  const sellMult = getChaSellMultiplier(eCha);
                  const buyDisc = getChaBuyDiscount(eCha);

                  const totalAC = getEffectiveAC(character.class, character.dex, equipmentBonuses, offHandIsShield);

                   const affinityHit = isProficient ? 1 : 0;
                   const totalHitBonus = hitMod + intHit + affinityHit;
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
                   const creatureAtkMod = Math.floor((creatureBaseStat - 10) / 2) + getCreatureAttackBonus(character.level);
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
                  if (dmgBuffActive) dmgMultParts.push(`${ARCANE_SURGE_DAMAGE_MULT}× Arcane Surge (+${ARCANE_SURGE_DAMAGE_BONUS_PCT}%)`);

                  type DerivedRow = { label: string; value: string; tip: string; buffed?: boolean; buffColor?: string };

                  const poolRows: DerivedRow[] = [
                    (() => { const effMaxHp = getEffectiveMaxHp(character.class, character.con, character.level, equipmentBonuses); return { label: 'Max HP', value: `${effMaxHp}${absorbActive ? ` (+${absorbBuff!.shieldHp})` : ''}`, tip: `Base ${character.max_hp} + gear bonuses${absorbActive ? ` + ${absorbBuff!.shieldHp} Force Shield` : ''}`, buffed: !!absorbActive, buffColor: 'text-primary' }; })(),
                    { label: 'HP Regen', value: `${effectiveHpRegen}/tick`, tip: `Base ${hpRegen}${foodBuffActive ? ` + ${foodBuff!.flatRegen} food` : ''}${isAtInn ? ' + 10 inn' : ''}${milestoneHpFlat > 0 ? ` + ${milestoneHpFlat} milestone` : ''}${partyRegenActive ? ` + ${partyRegenBuff!.healPerTick} Crescendo` : ''}${inspireActive ? ` + ${inspireBuff!.hpPerTick} Inspire` : ''} (every 4s)`, buffed: hpRegenBuffed || inspireActive, buffColor: 'text-elvish' },
                     { label: 'Max CP', value: `${maxCp}`, tip: `30 + (level-1)×3 + WIS_mod×6` },
                     (() => {
                       const foodCpBonus = foodBuffActive ? foodBuff!.flatRegen : 0;
                       const milestoneCpFlat = (() => { const l = character.level; if (l >= 40) return 5; if (l >= 35) return 4; if (l >= 30) return 3; if (l >= 25) return 2; if (l >= 20) return 1; return 0; })();
                       const inspireCpBonus = inspireActive ? inspireBuff!.cpPerTick : 0;
                       const effectiveCpRegen = Math.max(Math.floor(baseCpRegen + foodCpBonus + innFlat + milestoneCpFlat + inspireCpBonus), 1);
                       const cpRegenBuffed = foodBuffActive || isAtInn || inspireActive;
                       return { label: 'CP Regen', value: `${effectiveCpRegen}/tick`, tip: `Base ${baseCpRegen}${foodBuffActive ? ` + ${foodCpBonus} food` : ''}${isAtInn ? ' + 10 inn' : ''}${milestoneCpFlat > 0 ? ` + ${milestoneCpFlat} milestone` : ''}${inspireActive ? ` + ${inspireCpBonus} Inspire` : ''} (every 4s)`, buffed: cpRegenBuffed, buffColor: 'text-elvish' } as DerivedRow;
                     })(),
                    { label: 'Max Stamina', value: `${maxMp}`, tip: `100 + DEX mod×10 + (level-1)×2` },
                    { label: 'Stamina Regen', value: `${mpRegen}/tick`, tip: `5 + DEX modifier (every 4s)` },
                  ];

                  const offenseRows: DerivedRow[] = [
                    { label: 'Attack', value: `1d${weaponDie} ${dmgMod >= 0 ? '+' : ''}${dmgMod}${isProficient ? ' ⚔' : ''}${dmgMultParts.length > 0 ? ' ✦' : ''}`, tip: `Autoattack damage: 1d${weaponDie} weapon die + STR modifier${isTwoHanded ? ' (two-handed)' : ''}${mainHandTag ? '' : ' (unarmed)'}\nTo-hit uses DEX (separate from damage).${isProficient ? '\n⚔ Proficient: +1 Hit, ×1.10 Damage' : ''}${dmgMultParts.length > 0 ? '\n' + dmgMultParts.join(', ') : ''}`, buffed: dmgMultParts.length > 0, buffColor: 'text-elvish' },
                    { label: 'Atk Speed', value: `${atkSpeed}s`, tip: `Fixed 2.0s heartbeat` },
                    { label: 'Hit Chance', value: `${hitChance}%`, tip: `d20 + ${hitMod} DEX + ${intHit} INT${affinityHit ? ' + 1 Affinity' : ''} → ${hitChance}% vs same-level creature (AC ${sameLevelAC})\n(Damage scales from STR; accuracy from DEX.)` },
                    { label: 'Crit Range', value: effectiveCrit === 20 ? '20' : `${effectiveCrit}–20`, tip: `${dexCrit > 0 ? `+${dexCrit} DEX bonus` : 'DEX bonus at 14+'}${critBuffActive ? `, +${critBuff!.bonus} Eagle Eye` : ''}`, buffed: !!critBuffActive, buffColor: 'text-primary' },
                    { label: 'Min Damage', value: strFloor > 0 ? `+${strFloor}` : '–', tip: strFloor > 0 ? 'STR bonus: minimum damage floor on all attacks' : 'STR 14+ for minimum damage floor on all attacks' },
                  ];

                  // Off-hand info row
                  if (offHandIsWeapon) {
                    offenseRows.push({ label: 'Off-Hand', value: `${Math.round(OFFHAND_DAMAGE_MULT * 100)}% dmg`, tip: `Bonus attack each tick at ${Math.round(OFFHAND_DAMAGE_MULT * 100)}% of main-hand base damage (separate hit roll, can crit)` });
                  } else if (offHandIsShield) {
                    offenseRows.push({ label: 'Off-Hand', value: '🛡️ Shield', tip: `+${SHIELD_AC_BONUS} AC, +${Math.round(SHIELD_ANTI_CRIT_BONUS * 100)}% Crit Resistance, Block chance (no bonus attack)` });
                  }

                  // Procs line
                  if (poisonActive || igniteActive) {
                    const procs: string[] = [];
                    if (poisonActive) procs.push('40% Poison');
                    if (igniteActive) procs.push('40% Ignite');
                    offenseRows.push({ label: 'Procs', value: procs.join(' / '), tip: procs.join(', ') + ' on hit', buffed: true, buffColor: 'text-elvish' });
                  }

                  // Shield block stats
                  const blockChance = offHandIsShield ? getShieldBlockChance(eDex) : 0;
                  const blockAmount = offHandIsShield ? getShieldBlockAmount(character.str + (equipmentBonuses.str || 0)) : 0;

                  const defenseRows: DerivedRow[] = [
                    { label: 'AC', value: `${totalAC}`, tip: `Base ${totalAC}${offHandIsShield ? ' (incl. +1 Shield)' : ''} vs regular creature atk +${creatureAtkMod}` },
                    ...(battleCryActive ? [{ label: 'Dmg Reduction', value: `${Math.round(battleCryBuff!.damageReduction * 100)}%`, tip: `Battle Cry reduces incoming damage by ${Math.round(battleCryBuff!.damageReduction * 100)}%. Crits reduced by additional ${Math.round(battleCryBuff!.critReduction * 100)}%.`, buffed: true, buffColor: 'text-dwarvish' }] : []),
                    { label: 'Dodge', value: `${effectiveDodge}%${evasionActive ? ' ✦' : ''}`, tip: `Chance a same-level creature misses you (AC ${totalAC})${evasionActive ? `\n+${Math.round(evasionBuff!.dodgeChance * 100)}% ${evasionBuff!.source === 'disengage' ? 'Disengage' : 'Cloak of Shadows'}` : ''}`, buffed: !!evasionActive, buffColor: 'text-primary' },
                    { label: 'Crit Resistance', value: wisAntiCritChance > 0 ? `${Math.round(wisAntiCritChance * 100)}%` : '–', tip: wisAntiCritChance > 0 ? `WIS bonus: chance to downgrade incoming crits${offHandIsShield ? ' (incl. +5% Shield)' : ''}` : 'WIS 12+ for crit resistance' },
                    ...(offHandIsShield ? [{ label: 'Block', value: `${Math.round(blockChance * 100)}% / ${blockAmount}`, tip: `${Math.round(blockChance * 100)}% chance to block, reducing damage by ${blockAmount} (DEX → chance, STR → amount)` }] : []),
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
