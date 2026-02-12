import { Character } from '@/hooks/useCharacter';
import { InventoryItem } from '@/hooks/useInventory';
import { Party, PartyMember } from '@/hooks/useParty';
import { PlayerPresence } from '@/hooks/usePresence';
import { RACE_LABELS, CLASS_LABELS, STAT_LABELS, getStatModifier } from '@/lib/game-data';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Shield, Trash2, Heart } from 'lucide-react';
import PartyPanel from './PartyPanel';

interface Props {
  character: Character;
  equipped: InventoryItem[];
  unequipped: InventoryItem[];
  equipmentBonuses: Record<string, number>;
  onEquip: (inventoryId: string, slot: string) => void;
  onUnequip: (inventoryId: string) => void;
  onDrop: (inventoryId: string) => void;
  onUseConsumable?: (inventoryId: string) => void;
  // Party props
  party: Party | null;
  partyMembers: PartyMember[];
  pendingInvites: { party_id: string; id: string; leader_name: string }[];
  isLeader: boolean;
  isTank: boolean;
  myMembership: PartyMember | undefined;
  playersHere: PlayerPresence[];
  onCreateParty: () => void;
  onInvite: (charId: string) => void;
  onAcceptInvite: (membershipId: string) => void;
  onDeclineInvite: (membershipId: string) => void;
  onLeaveParty: () => void;
  onKick: (charId: string) => void;
  onSetTank: (charId: string | null) => void;
  onToggleFollow: (following: boolean) => void;
}

const RARITY_COLORS: Record<string, string> = {
  common: 'text-foreground',
  uncommon: 'text-chart-2',
  rare: 'text-dwarvish',
  unique: 'text-primary text-glow',
};

const SLOT_LABELS: Record<string, string> = {
  main_hand: 'Main Hand', off_hand: 'Off Hand',
  head: 'Head', amulet: 'Amulet', shoulders: 'Shoulders', chest: 'Chest',
  gloves: 'Gloves', belt: 'Belt', pants: 'Pants', ring: 'Ring', trinket: 'Trinket',
};

function EquipSlot({ slot, item, blocked, onUnequip }: {
  slot: string; item: InventoryItem | undefined; blocked: boolean; onUnequip: (id: string) => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={`w-[6.5rem] p-1 border rounded text-center cursor-pointer transition-colors ${
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
          {item.item.hands && <p className="text-xs text-muted-foreground">{item.item.hands === 2 ? 'Two-Handed' : 'One-Handed'}</p>}
          {Object.entries(item.item.stats || {}).map(([k, v]) => (
            <p key={k} className="text-xs">+{v as number} {k.toUpperCase()}</p>
          ))}
          <p className="text-[10px] text-muted-foreground mt-1">Click to unequip</p>
        </TooltipContent>
      )}
    </Tooltip>
  );
}


export default function CharacterPanel({
  character, equipped, unequipped, equipmentBonuses, onEquip, onUnequip, onDrop, onUseConsumable,
  party, partyMembers, pendingInvites, isLeader, isTank, myMembership, playersHere,
  onCreateParty, onInvite, onAcceptInvite, onDeclineInvite, onLeaveParty, onKick, onSetTank, onToggleFollow,
}: Props) {
  const hpPercent = Math.round((character.hp / character.max_hp) * 100);
  const xpForNext = character.level * 100;
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
        <div>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-muted-foreground">HP</span>
            <span className="text-blood">{character.hp}/{character.max_hp}</span>
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

        {/* Stats + AC + Gold — compact inline chips */}
        <div className="flex flex-wrap gap-x-3 gap-y-1 justify-center text-xs">
          {Object.entries(STAT_LABELS).map(([key, label]) => {
            const base = (character as any)[key] as number;
            const bonus = equipmentBonuses[key] || 0;
            const total = base + bonus;
            const mod = getStatModifier(total);
            return (
              <span key={key} className="text-foreground font-display">
                {label} {total}
                {bonus > 0 && <span className="text-chart-2">+{bonus}</span>}
                <span className="text-primary text-[10px]">({mod >= 0 ? `+${mod}` : mod})</span>
              </span>
            );
          })}
          <span className="text-foreground font-display">
            AC {totalAC}
            {(equipmentBonuses.ac || 0) > 0 && <span className="text-chart-2">+{equipmentBonuses.ac}</span>}
          </span>
          <span className="font-display text-primary">Gold {character.gold}</span>
        </div>

        {/* Equipment — Paper Doll Layout */}
        <div>
          <h3 className="font-display text-xs text-muted-foreground mb-1.5">Equipment</h3>
          <div className="relative flex flex-col items-center gap-1">
            {/* Body silhouette SVG behind slots */}
            <svg
              className="absolute inset-0 w-full h-full pointer-events-none"
              viewBox="0 0 200 320"
              preserveAspectRatio="xMidYMid meet"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <defs>
                <filter id="silhouetteGlow">
                  <feGaussianBlur stdDeviation="3" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>
              <g filter="url(#silhouetteGlow)">
                {/* Head circle */}
                <circle cx="100" cy="22" r="14" stroke="hsl(var(--primary))" strokeWidth="0.8" opacity="0.35" />
                {/* Neck */}
                <line x1="100" y1="36" x2="100" y2="50" stroke="hsl(var(--primary))" strokeWidth="0.8" opacity="0.25" />
                {/* Torso */}
                <path d="M 70 50 Q 65 55 60 80 L 60 160 Q 60 170 70 175 L 130 175 Q 140 170 140 160 L 140 80 Q 135 55 130 50 Z"
                  stroke="hsl(var(--primary))" strokeWidth="0.8" opacity="0.25" />
                {/* Arms — left */}
                <path d="M 60 70 Q 35 80 20 130 Q 18 140 22 145"
                  stroke="hsl(var(--primary))" strokeWidth="0.8" opacity="0.2" />
                {/* Arms — right */}
                <path d="M 140 70 Q 165 80 180 130 Q 182 140 178 145"
                  stroke="hsl(var(--primary))" strokeWidth="0.8" opacity="0.2" />
                {/* Legs */}
                <path d="M 80 175 L 75 260 Q 74 270 80 275"
                  stroke="hsl(var(--primary))" strokeWidth="0.8" opacity="0.2" />
                <path d="M 120 175 L 125 260 Q 126 270 120 275"
                  stroke="hsl(var(--primary))" strokeWidth="0.8" opacity="0.2" />
              </g>
            </svg>

            {/* Slots layered on top */}
            <EquipSlot slot="head" item={getEquippedInSlot('head')} blocked={false} onUnequip={onUnequip} />
            <EquipSlot slot="amulet" item={getEquippedInSlot('amulet')} blocked={false} onUnequip={onUnequip} />
            <EquipSlot slot="shoulders" item={getEquippedInSlot('shoulders')} blocked={false} onUnequip={onUnequip} />
            <EquipSlot slot="chest" item={getEquippedInSlot('chest')} blocked={false} onUnequip={onUnequip} />
            <div className="flex gap-8 w-full justify-center">
              <EquipSlot slot="main_hand" item={getEquippedInSlot('main_hand')} blocked={false} onUnequip={onUnequip} />
              <EquipSlot slot="off_hand" item={getEquippedInSlot('off_hand')} blocked={!!isTwoHanded} onUnequip={onUnequip} />
            </div>
            <EquipSlot slot="gloves" item={getEquippedInSlot('gloves')} blocked={false} onUnequip={onUnequip} />
            <EquipSlot slot="belt" item={getEquippedInSlot('belt')} blocked={false} onUnequip={onUnequip} />
            <div className="flex gap-8 w-full justify-center">
              <EquipSlot slot="ring" item={getEquippedInSlot('ring')} blocked={false} onUnequip={onUnequip} />
              <EquipSlot slot="trinket" item={getEquippedInSlot('trinket')} blocked={false} onUnequip={onUnequip} />
            </div>
            <EquipSlot slot="pants" item={getEquippedInSlot('pants')} blocked={false} onUnequip={onUnequip} />
          </div>
        </div>

        {/* Inventory */}
        <div>
          <h3 className="font-display text-xs text-muted-foreground mb-1.5">
            Inventory ({unequipped.length})
          </h3>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {unequipped.length === 0 ? (
              <p className="text-[10px] text-muted-foreground/50 italic">Empty</p>
            ) : unequipped.map(inv => (
              <div key={inv.id} className="flex items-center justify-between p-1.5 rounded border border-border bg-background/30 text-xs">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className={`font-display truncate flex-1 cursor-help ${RARITY_COLORS[inv.item.rarity]}`}>
                      {inv.item.name}
                      {inv.item.hands && <span className="text-[9px] text-muted-foreground ml-1">({inv.item.hands}H)</span>}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="bg-popover border-border z-50">
                    <p className={`font-display ${RARITY_COLORS[inv.item.rarity]}`}>{inv.item.name}</p>
                    <p className="text-xs text-muted-foreground">{inv.item.description}</p>
                    {Object.entries(inv.item.stats || {}).map(([k, v]) => (
                      <p key={k} className="text-xs">+{v as number} {k.toUpperCase()}</p>
                    ))}
                    <p className="text-[10px] text-muted-foreground">Durability: {inv.current_durability}% | Value: {inv.item.value}g</p>
                  </TooltipContent>
                </Tooltip>
                <div className="flex gap-0.5 shrink-0 ml-1">
                  {inv.item.item_type === 'consumable' && (inv.item.stats?.hp as number) > 0 && onUseConsumable && (
                    <Button size="sm" variant="ghost" className="h-5 w-5 p-0"
                      onClick={() => onUseConsumable(inv.id)}>
                      <Heart className="w-3 h-3 text-blood" />
                    </Button>
                  )}
                  {inv.item.slot && (
                    <Button size="sm" variant="ghost" className="h-5 w-5 p-0"
                      onClick={() => onEquip(inv.id, inv.item.slot!)}>
                      <Shield className="w-3 h-3 text-primary" />
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" className="h-5 w-5 p-0"
                    onClick={() => onDrop(inv.id)}>
                    <Trash2 className="w-3 h-3 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Party Section */}
        <PartyPanel
          character={character}
          party={party}
          members={partyMembers}
          pendingInvites={pendingInvites}
          isLeader={isLeader}
          isTank={isTank}
          myMembership={myMembership}
          playersHere={playersHere}
          onCreateParty={onCreateParty}
          onInvite={onInvite}
          onAcceptInvite={onAcceptInvite}
          onDeclineInvite={onDeclineInvite}
          onLeave={onLeaveParty}
          onKick={onKick}
          onSetTank={onSetTank}
          onToggleFollow={onToggleFollow}
        />
      </div>
    </TooltipProvider>
  );
}
