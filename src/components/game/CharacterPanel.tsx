import { Character } from '@/hooks/useCharacter';
import { InventoryItem } from '@/hooks/useInventory';
import { RACE_LABELS, CLASS_LABELS, STAT_LABELS, getStatModifier } from '@/lib/game-data';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Shield, Trash2 } from 'lucide-react';

interface Props {
  character: Character;
  equipped: InventoryItem[];
  unequipped: InventoryItem[];
  equipmentBonuses: Record<string, number>;
  onEquip: (inventoryId: string, slot: string) => void;
  onUnequip: (inventoryId: string) => void;
  onDrop: (inventoryId: string) => void;
}

const RARITY_COLORS: Record<string, string> = {
  common: 'text-foreground',
  uncommon: 'text-chart-2',
  rare: 'text-dwarvish',
  unique: 'text-primary text-glow',
};

const SLOT_LABELS: Record<string, string> = {
  head: 'Head', amulet: 'Amulet', shoulders: 'Shoulders', chest: 'Chest',
  gloves: 'Gloves', belt: 'Belt', pants: 'Pants', ring: 'Ring', trinket: 'Trinket',
};

const SLOTS = ['head', 'amulet', 'shoulders', 'chest', 'gloves', 'belt', 'pants', 'ring', 'trinket'];

export default function CharacterPanel({ character, equipped, unequipped, equipmentBonuses, onEquip, onUnequip, onDrop }: Props) {
  const hpPercent = Math.round((character.hp / character.max_hp) * 100);
  const xpForNext = character.level * 100;
  const xpPercent = Math.round((character.xp / xpForNext) * 100);
  const totalAC = character.ac + (equipmentBonuses.ac || 0);

  const getEquippedInSlot = (slot: string) => equipped.find(i => i.equipped_slot === slot);

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

        {/* Stats */}
        <div className="grid grid-cols-3 gap-1.5">
          {Object.entries(STAT_LABELS).map(([key, label]) => {
            const base = (character as any)[key] as number;
            const bonus = equipmentBonuses[key] || 0;
            const total = base + bonus;
            const mod = getStatModifier(total);
            return (
              <div key={key} className="text-center p-1.5 bg-background/50 rounded border border-border">
                <div className="text-[10px] text-muted-foreground">{label}</div>
                <div className="text-sm font-display text-foreground">
                  {total}{bonus > 0 && <span className="text-chart-2 text-[10px]">+{bonus}</span>}
                </div>
                <div className="text-[10px] text-primary">{mod >= 0 ? `+${mod}` : mod}</div>
              </div>
            );
          })}
        </div>

        {/* AC & Gold */}
        <div className="flex justify-around text-center">
          <div>
            <div className="text-[10px] text-muted-foreground">AC</div>
            <div className="font-display text-foreground">
              {totalAC}
              {(equipmentBonuses.ac || 0) > 0 && <span className="text-chart-2 text-[10px] ml-0.5">+{equipmentBonuses.ac}</span>}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-muted-foreground">Gold</div>
            <div className="font-display text-primary">{character.gold}</div>
          </div>
        </div>

        {/* Equipment Slots */}
        <div>
          <h3 className="font-display text-xs text-muted-foreground mb-1.5">Equipment</h3>
          <div className="grid grid-cols-3 gap-1">
            {SLOTS.map(slot => {
              const item = getEquippedInSlot(slot);
              return (
                <Tooltip key={slot}>
                  <TooltipTrigger asChild>
                    <div
                      className={`p-1.5 border rounded text-center cursor-pointer transition-colors ${
                        item ? 'border-primary/50 bg-primary/5' : 'border-border bg-background/30'
                      }`}
                      onClick={() => item && onUnequip(item.id)}
                    >
                      <div className="text-[9px] text-muted-foreground capitalize">{SLOT_LABELS[slot]}</div>
                      {item ? (
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
                  {item && (
                    <TooltipContent className="bg-popover border-border z-50">
                      <p className={`font-display ${RARITY_COLORS[item.item.rarity]}`}>{item.item.name}</p>
                      <p className="text-xs text-muted-foreground">{item.item.description}</p>
                      {Object.entries(item.item.stats || {}).map(([k, v]) => (
                        <p key={k} className="text-xs">+{v as number} {k.toUpperCase()}</p>
                      ))}
                      <p className="text-[10px] text-muted-foreground mt-1">Click to unequip</p>
                    </TooltipContent>
                  )}
                </Tooltip>
              );
            })}
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
      </div>
    </TooltipProvider>
  );
}
