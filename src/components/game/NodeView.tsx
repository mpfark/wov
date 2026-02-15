import { GameNode, Region } from '@/hooks/useNodes';
import { PlayerPresence } from '@/hooks/usePresence';
import { Creature } from '@/hooks/useCreatures';
import { NPC } from '@/hooks/useNPCs';
import { Character } from '@/hooks/useCharacter';
import { PartyMember } from '@/hooks/useParty';
import { InventoryItem } from '@/hooks/useInventory';
import { RACE_LABELS, CLASS_LABELS } from '@/lib/game-data';
import { CLASS_COMBAT, ClassAbility } from '@/lib/class-abilities';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useState, useEffect } from 'react';

interface Props {
  node: GameNode;
  region: Region | undefined;
  players: PlayerPresence[];
  creatures: Creature[];
  npcs?: NPC[];
  character: Character;
  eventLog: string[];
  onSearch: () => void;
  onAttack: (creatureId: string) => void;
  onTalkToNPC?: (npc: NPC) => void;
  onOpenVendor?: () => void;
  onOpenBlacksmith?: () => void;
  inCombat?: boolean;
  activeCombatCreatureId?: string | null;
  creatureHpOverrides?: Record<string, number>;
  classAbility?: ClassAbility | null;
  abilityCooldownEnd?: number;
  onUseAbility?: (targetId?: string) => void;
  healTargets?: { id: string; name: string; hp: number; max_hp: number }[];
  beltedPotions?: InventoryItem[];
  onUseBeltPotion?: (inventoryId: string) => void;
}

export default function NodeView({
  node, region, players, creatures, npcs = [], character, eventLog, onSearch, onAttack, onTalkToNPC, onOpenVendor, onOpenBlacksmith,
  inCombat, activeCombatCreatureId, creatureHpOverrides = {}, classAbility, abilityCooldownEnd = 0, onUseAbility, healTargets = [],
  beltedPotions = [], onUseBeltPotion,
}: Props) {
  const otherPlayers = players.filter(p => p.id !== character.id);
  const [healTarget, setHealTarget] = useState<string>('self');

  // Show target picker for healers with party members
  const isHealerWithTargets = classAbility?.type === 'heal' && healTargets.length > 0;

  // Cooldown countdown
  const [cooldownLeft, setCooldownLeft] = useState(0);
  useEffect(() => {
    if (!abilityCooldownEnd || abilityCooldownEnd <= Date.now()) {
      setCooldownLeft(0);
      return;
    }
    setCooldownLeft(Math.ceil((abilityCooldownEnd - Date.now()) / 1000));
    const interval = setInterval(() => {
      const remaining = Math.ceil((abilityCooldownEnd - Date.now()) / 1000);
      if (remaining <= 0) {
        setCooldownLeft(0);
        clearInterval(interval);
      } else {
        setCooldownLeft(remaining);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [abilityCooldownEnd]);

  return (
    <div className="h-full flex flex-col p-3">
      {/* Scrollable content */}
      <div className="flex-1 min-h-0 overflow-y-auto space-y-3">
        {/* Location Header */}
        <div className="text-center border-b border-border pb-2">
          <h2 className="font-display text-xl text-primary text-glow">{node.name}</h2>
          {region && (
            <p className="text-xs text-muted-foreground">
              {region.name} — Levels {region.min_level}–{region.max_level}
            </p>
          )}
          {node.is_inn && (
            <p className="text-xs text-elvish mt-0.5">🏨 Inn — Resting here boosts HP regeneration</p>
          )}
        {node.is_blacksmith && (
            <p className="text-xs text-dwarvish mt-0.5">🔨 Blacksmith — Repair your equipment here</p>
          )}
          {node.searchable_items && node.searchable_items.length > 0 && (
            <p className="text-xs text-primary/80 mt-0.5">🔎 This area looks like it could be worth searching...</p>
          )}
        </div>

        {/* Description */}
        <p className="text-sm text-foreground/90 leading-relaxed italic">
          {node.description || 'A quiet corner of the world...'}
        </p>

      </div>

      {/* In the Area - pinned above actions */}
      {(creatures.length > 0 || npcs.length > 0 || otherPlayers.length > 0) && (
        <div className="pt-2">
          <h3 className="font-display text-xs text-muted-foreground mb-1">In the Area</h3>
          <div className="space-y-1">
            {creatures.map(c => {
              const isActiveTarget = inCombat && activeCombatCreatureId === c.id;
              const displayHp = creatureHpOverrides[c.id] !== undefined ? creatureHpOverrides[c.id] : c.hp;
              return (
                <div key={c.id} className={`p-2 bg-background/50 rounded border space-y-1 ${isActiveTarget ? 'border-destructive/60 ring-1 ring-destructive/30' : 'border-border'}`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <span className={`text-sm font-display ${
                        c.rarity === 'boss' ? 'text-primary text-glow' :
                        c.rarity === 'rare' ? 'text-dwarvish' : 'text-foreground'
                      }`}>{c.name}</span>
                      {c.is_aggressive && <span className="text-[10px] text-destructive ml-1" title="Aggressive">⚠️</span>}
                      <span className="text-xs text-muted-foreground ml-2">Lvl {c.level}</span>
                    </div>
                    {isActiveTarget ? (
                      <span className="text-xs font-display text-destructive animate-pulse flex items-center gap-1">
                        <span className="inline-block w-2 h-2 rounded-full bg-destructive animate-pulse" />
                        In Combat...
                      </span>
                    ) : (
                      <Button size="sm" variant="destructive" onClick={() => onAttack(c.id)} className="font-display text-xs h-7">
                        {CLASS_COMBAT[character.class]?.label || 'Attack'}
                      </Button>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-2 bg-background rounded-full overflow-hidden border border-border">
                      <div
                        className="h-full rounded-full transition-all duration-300"
                        style={{
                          width: `${Math.max((displayHp / c.max_hp) * 100, 0)}%`,
                          backgroundColor: displayHp / c.max_hp > 0.5 ? 'hsl(var(--chart-2))' : displayHp / c.max_hp > 0.25 ? 'hsl(var(--chart-4))' : 'hsl(var(--destructive))',
                        }}
                      />
                    </div>
                    <span className="text-[10px] text-muted-foreground whitespace-nowrap">{displayHp}/{c.max_hp}</span>
                  </div>
                </div>
              );
            })}
            {npcs.map(npc => (
              <div key={npc.id} className="flex items-center justify-between p-2 bg-background/50 rounded border border-elvish/30">
                <div>
                  <span className="text-sm font-display text-elvish">💬 {npc.name}</span>
                  {npc.description && <span className="text-[10px] text-muted-foreground ml-2">{npc.description}</span>}
                </div>
                <Button size="sm" variant="outline" onClick={() => onTalkToNPC?.(npc)} className="font-display text-xs h-7 border-elvish/50 text-elvish">
                  Talk
                </Button>
              </div>
            ))}
            {otherPlayers.map(p => (
              <div key={p.id} className="text-xs text-foreground/80 p-1.5 bg-background/30 rounded border border-border">
                <span className="text-elvish">{p.name}</span>
                <span className="text-muted-foreground ml-1">
                  — {RACE_LABELS[p.race]} {CLASS_LABELS[p.class]} Lvl {p.level}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Action Buttons - pinned to bottom */}
      <div className="pt-3 border-t border-border mt-3">
        <h3 className="font-display text-xs text-muted-foreground mb-1">Actions</h3>
        <Button variant="secondary" size="sm" onClick={onSearch} className="w-full font-display text-xs">
          Search Area
        </Button>
        {classAbility && onUseAbility && (
          <div className="mt-1.5 space-y-1">
            {isHealerWithTargets && (
              <Select value={healTarget} onValueChange={setHealTarget}>
                <SelectTrigger className="h-7 text-xs font-display">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="self" className="text-xs">
                    Self ({character.hp}/{character.max_hp} HP)
                  </SelectItem>
                  {healTargets.map(t => (
                    <SelectItem key={t.id} value={t.id} className="text-xs">
                      {t.name} ({t.hp}/{t.max_hp} HP)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => onUseAbility(isHealerWithTargets && healTarget !== 'self' ? healTarget : undefined)}
              disabled={cooldownLeft > 0 || character.hp <= 0}
              className="w-full font-display text-xs text-elvish border-elvish/50"
            >
              {classAbility.emoji} {classAbility.label}
              {isHealerWithTargets && healTarget !== 'self' && (
                <span className="ml-1 text-muted-foreground">→ {healTargets.find(t => t.id === healTarget)?.name}</span>
              )}
              {cooldownLeft > 0 && <span className="ml-1 text-muted-foreground">({cooldownLeft}s)</span>}
            </Button>
          </div>
        )}
        {onOpenVendor && (
          <Button variant="outline" size="sm" onClick={onOpenVendor} className="w-full mt-1.5 font-display text-xs text-primary">
            🛒 Open Shop
          </Button>
        )}
        {onOpenBlacksmith && (
          <Button variant="outline" size="sm" onClick={onOpenBlacksmith} className="w-full mt-1.5 font-display text-xs text-dwarvish">
            🔨 Open Blacksmith
          </Button>
        )}
        {beltedPotions.length > 0 && onUseBeltPotion && (
          <div className="mt-1.5 space-y-1">
            <h4 className="font-display text-[10px] text-muted-foreground">Belt Potions</h4>
            {beltedPotions.map(p => (
              <Button
                key={p.id}
                variant="outline"
                size="sm"
                onClick={() => onUseBeltPotion(p.id)}
                className="w-full font-display text-xs text-blood border-blood/30"
              >
                🧪 Use {p.item.name}
              </Button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
