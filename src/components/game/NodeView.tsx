import { GameNode, Region } from '@/hooks/useNodes';
import { PlayerPresence } from '@/hooks/usePresence';
import { Creature } from '@/hooks/useCreatures';
import { NPC } from '@/hooks/useNPCs';
import { Character } from '@/hooks/useCharacter';
import { PartyMember } from '@/hooks/useParty';
import { InventoryItem } from '@/hooks/useInventory';
import { RACE_LABELS, CLASS_LABELS } from '@/lib/game-data';
import { CLASS_COMBAT, ClassAbility } from '@/lib/class-abilities';
import { getKeyLabel, type ActionBindings } from '@/hooks/useKeyboardMovement';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';
import { useState, useEffect } from 'react';
import { ChevronDown, Search, ShoppingCart, Hammer } from 'lucide-react';

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
  classAbilities?: ClassAbility[];
  abilityCooldownEnds?: Record<number, number>;
  onUseAbility?: (abilityIndex: number, targetId?: string) => void;
  healTargets?: { id: string; name: string; hp: number; max_hp: number }[];
  beltedPotions?: InventoryItem[];
  onUseBeltPotion?: (inventoryId: string) => void;
  actionBindings?: ActionBindings;
  poisonStacks?: Record<string, { stacks: number; damagePerTick: number; expiresAt: number }>;
  igniteStacks?: Record<string, { stacks: number; damagePerTick: number; expiresAt: number }>;
  sunderDebuff?: { acReduction: number; expiresAt: number; creatureId: string } | null;
}

export default function NodeView({
  node, region, players, creatures, npcs = [], character, eventLog, onSearch, onAttack, onTalkToNPC, onOpenVendor, onOpenBlacksmith,
  inCombat, activeCombatCreatureId, creatureHpOverrides = {}, classAbilities = [], abilityCooldownEnds = {}, onUseAbility, healTargets = [],
  beltedPotions = [], onUseBeltPotion, actionBindings,
  poisonStacks = {},
  igniteStacks = {},
  sunderDebuff,
}: Props) {
  const otherPlayers = players.filter(p => p.id !== character.id);
  const [healTarget, setHealTarget] = useState<string>('');
  const [areaOpen, setAreaOpen] = useState(true);

  // Only hp_transfer needs a target selector (heal is self-only)
  const hasTargetedAbility = classAbilities.some(a => a.type === 'hp_transfer' || a.type === 'ally_absorb');

  // Per-ability cooldown countdowns
  const [cooldownLefts, setCooldownLefts] = useState<Record<number, number>>({});
  useEffect(() => {
    const update = () => {
      const now = Date.now();
      const newLefts: Record<number, number> = {};
      for (const [idx, end] of Object.entries(abilityCooldownEnds)) {
        const remaining = Math.ceil((end - now) / 1000);
        if (remaining > 0) newLefts[Number(idx)] = remaining;
      }
      setCooldownLefts(newLefts);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [abilityCooldownEnds]);

  const hasAreaContent = creatures.length > 0 || npcs.length > 0 || otherPlayers.length > 0;

  return (
    <TooltipProvider delayDuration={300}>
      <div className="h-full flex flex-col p-3">
        {/* Scrollable content - only header & description */}
        <div className="flex-1 min-h-0 overflow-y-auto space-y-2">
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
          </div>

          {/* Description */}
          <p className="text-sm text-foreground/90 leading-relaxed italic">
            {node.description || 'A quiet corner of the world...'}
          </p>
        </div>

        {/* In the Area - sticks above action bar, outside scrollable area */}
        {hasAreaContent && (
          <Collapsible open={areaOpen} onOpenChange={setAreaOpen}>
            <CollapsibleTrigger className="flex items-center justify-between w-full py-1">
              <h3 className="font-display text-xs text-muted-foreground">In the Area</h3>
              <ChevronDown className={`h-3 w-3 text-muted-foreground transition-transform ${areaOpen ? '' : '-rotate-90'}`} />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="space-y-1">
                {creatures.map(c => {
                  const isActiveTarget = inCombat && activeCombatCreatureId === c.id;
                  const displayHp = creatureHpOverrides[c.id] !== undefined ? creatureHpOverrides[c.id] : c.hp;
                  const hpPct = Math.max((displayHp / c.max_hp) * 100, 0);
                  const creaturePoisonStacks = poisonStacks[c.id];
                  const hasPoisonStacks = creaturePoisonStacks && Date.now() < creaturePoisonStacks.expiresAt && creaturePoisonStacks.stacks > 0;
                  const creatureIgniteStacks = igniteStacks[c.id];
                  const hasIgniteStacks = creatureIgniteStacks && Date.now() < creatureIgniteStacks.expiresAt && creatureIgniteStacks.stacks > 0;
                  const isSundered = sunderDebuff && sunderDebuff.creatureId === c.id && Date.now() < sunderDebuff.expiresAt;
                  return (
                    <div key={c.id} className={`p-1.5 bg-background/50 rounded border ${isActiveTarget ? 'border-destructive/60 ring-1 ring-destructive/30' : 'border-border'}`}>
                      <div className="flex items-center gap-1.5">
                        <span className={`text-xs font-display truncate ${
                          c.rarity === 'boss' ? 'text-primary text-glow' :
                          c.rarity === 'rare' ? 'text-dwarvish' : 'text-foreground'
                        }`}>{c.name}</span>
                        {c.is_aggressive && <span className="text-[10px] text-destructive" title="Aggressive">⚠️</span>}
                        <span className="text-[10px] text-muted-foreground">L{c.level}</span>
                        {hasPoisonStacks && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="text-[10px] text-elvish font-display animate-pulse">
                                🧪×{creaturePoisonStacks!.stacks}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="text-xs">
                              Poison: {creaturePoisonStacks!.stacks} stack{creaturePoisonStacks!.stacks > 1 ? 's' : ''} — {creaturePoisonStacks!.stacks * creaturePoisonStacks!.damagePerTick} dmg/tick
                            </TooltipContent>
                          </Tooltip>
                        )}
                        {hasIgniteStacks && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="text-[10px] text-dwarvish font-display animate-pulse">
                                🔥×{creatureIgniteStacks!.stacks}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="text-xs">
                              Burn: {creatureIgniteStacks!.stacks} stack{creatureIgniteStacks!.stacks > 1 ? 's' : ''} — {creatureIgniteStacks!.stacks * creatureIgniteStacks!.damagePerTick} dmg/tick
                            </TooltipContent>
                          </Tooltip>
                        )}
                        {isSundered && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="text-[10px] text-dwarvish font-display animate-pulse">
                                🔨
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="text-xs">
                              Sundered: AC reduced by {sunderDebuff!.acReduction}
                            </TooltipContent>
                          </Tooltip>
                        )}
                        <div className="flex-1 h-1.5 bg-background rounded-full overflow-hidden border border-border">
                          <div
                            className={`h-full rounded-full transition-all duration-300`}
                            style={{
                              width: `${hpPct}%`,
                              backgroundColor: hasIgniteStacks
                                ? 'hsl(var(--dwarvish))'
                                : hasPoisonStacks
                                ? 'hsl(var(--elvish))'
                                : hpPct > 50 ? 'hsl(var(--chart-2))' : hpPct > 25 ? 'hsl(var(--chart-4))' : 'hsl(var(--destructive))',
                            }}
                          />
                        </div>
                        <span className="text-[9px] text-muted-foreground whitespace-nowrap">{displayHp}/{c.max_hp}</span>
                        {isActiveTarget ? (
                          <span className="text-[10px] font-display text-destructive animate-pulse">⚔️</span>
                        ) : (
                          <Button size="sm" variant="destructive" onClick={() => onAttack(c.id)} className="font-display text-[10px] h-5 px-1.5">
                            {CLASS_COMBAT[character.class]?.label || 'Atk'}
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
                {npcs.map(npc => (
                  <div key={npc.id} className="flex items-center justify-between p-1.5 bg-background/50 rounded border border-elvish/30">
                    <div className="min-w-0">
                      <span className="text-xs font-display text-elvish">💬 {npc.name}</span>
                      {npc.description && <span className="text-[10px] text-muted-foreground ml-1 truncate">{npc.description}</span>}
                    </div>
                    <Button size="sm" variant="outline" onClick={() => onTalkToNPC?.(npc)} className="font-display text-[10px] h-5 px-1.5 border-elvish/50 text-elvish ml-1 shrink-0">
                      Talk
                    </Button>
                  </div>
                ))}
                {otherPlayers.map(p => (
                  <div key={p.id} className="text-[10px] text-foreground/80 p-1 bg-background/30 rounded border border-border">
                    <span className="text-elvish">{p.name}</span>
                    <span className="text-muted-foreground ml-1">
                      — {RACE_LABELS[p.race]} {CLASS_LABELS[p.class]} Lvl {p.level}
                    </span>
                  </div>
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* Compact Action Bar - pinned to bottom */}
        <div className="pt-2 border-t border-border mt-2 space-y-1.5 flex flex-col items-center">
          {/* Row 1: Core actions */}
          <div className="flex gap-1 justify-center">
            {(() => {
              const hasHidden = node.connections?.some((c: any) => c.hidden);
              const hasLoot = node.searchable_items && node.searchable_items.length > 0;
              const hasDiscoverable = hasHidden || hasLoot;
              return (
                <Button variant="secondary" size="sm" onClick={onSearch} className={`font-display text-[10px] h-6 px-2 ${hasDiscoverable ? 'ring-1 ring-primary/40 text-primary animate-pulse' : ''}`}>
                  <Search className="h-3 w-3 mr-0.5" /> Search
                  {actionBindings?.search?.[0] && (
                    <span className="ml-1 text-[8px] text-muted-foreground">[{getKeyLabel(actionBindings.search[0])}]</span>
                  )}
                </Button>
              );
            })()}
            {onOpenVendor && (
              <Button variant="outline" size="sm" onClick={onOpenVendor} className="font-display text-[10px] h-6 px-2 text-primary">
                <ShoppingCart className="h-3 w-3 mr-0.5" /> Shop
              </Button>
            )}
            {onOpenBlacksmith && (
              <Button variant="outline" size="sm" onClick={onOpenBlacksmith} className="font-display text-[10px] h-6 px-2 text-dwarvish">
                <Hammer className="h-3 w-3 mr-0.5" /> Smithy
              </Button>
            )}
          </div>

          {/* Row 2: Belt Potions */}
          {beltedPotions.length > 0 && onUseBeltPotion && (
            <div className="flex flex-wrap gap-1 justify-center">
              {beltedPotions.map((p, idx) => (
                <Tooltip key={p.id}>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onUseBeltPotion(p.id)}
                      className="font-display text-[10px] text-blood border-blood/30 h-5 px-1.5"
                    >
                      🧪 {p.item.name.length > 6 ? p.item.name.slice(0, 6) + '…' : p.item.name}
                      {actionBindings?.[`potion${idx + 1}` as keyof ActionBindings]?.[0] && (
                        <span className="ml-0.5 text-[8px] text-muted-foreground">[{getKeyLabel(actionBindings[`potion${idx + 1}` as keyof ActionBindings][0])}]</span>
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs">
                    {p.item.name}
                  </TooltipContent>
                </Tooltip>
              ))}
            </div>
          )}

          {/* Row 3: Abilities */}
          {classAbilities.length > 0 && onUseAbility && (
            <div className="flex flex-wrap items-center gap-1 justify-center">
              {/* Target selector — shown if any targeted ability exists and targets available */}
              {hasTargetedAbility && healTargets.length > 0 && (
                <Select value={healTarget} onValueChange={setHealTarget}>
                  <SelectTrigger className="h-6 text-[10px] font-display w-auto min-w-[80px] max-w-[120px]">
                    <SelectValue placeholder="Select ally" />
                  </SelectTrigger>
                  <SelectContent>
                    {healTargets.map(t => (
                      <SelectItem key={t.id} value={t.id} className="text-[10px]">
                        {t.name} ({t.hp}/{t.max_hp})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {classAbilities.map((ability, idx) => {
                const levelLocked = character.level < ability.levelRequired;
                const cooldownLeft = cooldownLefts[idx] || 0;
                const needsTarget = ability.type === 'hp_transfer' || ability.type === 'ally_absorb';
                const resolvedTarget = needsTarget && healTarget !== 'self' ? healTarget : undefined;
                const disableNoTarget = ability.type === 'hp_transfer' && (!resolvedTarget || healTargets.length === 0);
                return (
                  <Tooltip key={idx}>
                    <TooltipTrigger asChild>
                      <span>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => onUseAbility(idx, resolvedTarget)}
                          disabled={levelLocked || cooldownLeft > 0 || character.hp <= 0 || disableNoTarget}
                          className="font-display text-[10px] h-6 px-2 text-elvish border-elvish/50"
                        >
                          {ability.emoji} {ability.label}
                          {!levelLocked && cooldownLeft > 0 && <span className="ml-0.5 text-muted-foreground">({cooldownLeft}s)</span>}
                          {actionBindings?.[`ability${idx + 1}` as keyof ActionBindings]?.[0] && cooldownLeft <= 0 && !levelLocked && (
                            <span className="ml-0.5 text-[8px] text-muted-foreground">[{getKeyLabel(actionBindings[`ability${idx + 1}` as keyof ActionBindings][0])}]</span>
                          )}
                        </Button>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-xs max-w-[200px]">
                      {levelLocked
                        ? `Unlocks at level ${ability.levelRequired}`
                        : `${ability.description} · ${ability.cooldownMs / 1000}s cooldown`
                      }
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}
