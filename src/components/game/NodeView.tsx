import { GameNode, Region, Area, getNodeDisplayName, getNodeDisplayDescription } from '@/hooks/useNodes';
import { PlayerPresence } from '@/hooks/usePresence';
import { Creature } from '@/hooks/useCreatures';
import { NPC } from '@/hooks/useNPCs';
import { Character } from '@/hooks/useCharacter';
import { PartyMember } from '@/hooks/useParty';
import { InventoryItem } from '@/hooks/useInventory';
import { GroundLootItem } from '@/hooks/useGroundLoot';
import { RACE_LABELS, CLASS_LABELS, getCharacterTitle } from '@/lib/game-data';
import { CLASS_COMBAT, ClassAbility } from '@/lib/class-abilities';
import { getKeyLabel, type ActionBindings } from '@/hooks/useKeyboardMovement';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';
import { useState, useEffect } from 'react';
import { ChevronDown, Search, ShoppingCart, Hammer } from 'lucide-react';

const AREA_TYPE_HEADER_COLORS: Record<string, string> = {
  forest: 'hsl(120 40% 55%)',
  town: 'hsl(35 55% 60%)',
  cave: 'hsl(260 35% 60%)',
  ruins: 'hsl(20 35% 55%)',
  plains: 'hsl(60 45% 55%)',
  mountain: 'hsl(210 20% 60%)',
  swamp: 'hsl(90 30% 45%)',
  desert: 'hsl(40 55% 60%)',
  coast: 'hsl(195 55% 55%)',
  dungeon: 'hsl(0 35% 50%)',
  other: 'hsl(var(--primary))',
};

interface Props {
  node: GameNode;
  region: Region | undefined;
  area?: Area | null;
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
  onOpenTeleport?: () => void;
  inCombat?: boolean;
  activeCombatCreatureId?: string | null;
  engagedCreatureIds?: string[];
  creatureHpOverrides?: Record<string, number>;
  classAbilities?: ClassAbility[];
  onUseAbility?: (abilityIndex: number, targetId?: string) => void;
  abilityTargetId?: string | null;
  beltedPotions?: InventoryItem[];
  onUseBeltPotion?: (inventoryId: string) => void;
  actionBindings?: ActionBindings;
  poisonStacks?: Record<string, { stacks: number; damagePerTick: number; expiresAt: number }>;
  igniteStacks?: Record<string, { stacks: number; damagePerTick: number; expiresAt: number }>;
  sunderDebuff?: { acReduction: number; expiresAt: number; creatureId: string } | null;
  groundLoot?: GroundLootItem[];
  onPickUpLoot?: (groundLootId: string) => void;
  partyMemberIds?: Set<string>;
  partyMemberHp?: Map<string, { hp: number; max_hp: number }>;
}

export default function NodeView({
  node, region, area, players, creatures, npcs = [], character, eventLog, onSearch, onAttack, onTalkToNPC, onOpenVendor, onOpenBlacksmith, onOpenTeleport,
  inCombat, activeCombatCreatureId, engagedCreatureIds = [], creatureHpOverrides = {}, classAbilities = [], onUseAbility, abilityTargetId,
  beltedPotions = [], onUseBeltPotion, actionBindings,
  poisonStacks = {},
  igniteStacks = {},
  sunderDebuff,
  groundLoot = [],
  onPickUpLoot,
  partyMemberIds,
  partyMemberHp,
}: Props) {
  const otherPlayers = players.filter(p => p.id !== character.id);
  const [areaOpen, setAreaOpen] = useState(true);

  // hasTargetedAbility check no longer needed — targeting is handled in PartyPanel

  // No longer need cooldown tracking — CP system handles availability

  const hasAreaContent = creatures.length > 0 || npcs.length > 0 || otherPlayers.length > 0;

  return (
    <TooltipProvider delayDuration={300}>
      <div className="h-full flex flex-col p-3">
        {/* Scrollable content - only header & description */}
        <div className="flex-1 min-h-0 overflow-y-auto space-y-2">
          {/* Location Header */}
           <div className="text-center border-b border-border pb-2">
            <h2
              className="font-display text-xl text-glow"
              style={{ color: area ? (AREA_TYPE_HEADER_COLORS[area.area_type] || AREA_TYPE_HEADER_COLORS.other) : undefined }}
            >
              {getNodeDisplayName(node, area)}
            </h2>
            <div className="flex items-center justify-center gap-1.5 mt-0.5 flex-wrap">
              {node.is_inn && <span className="text-[10px]" title="Inn">🏨</span>}
              {node.is_blacksmith && <span className="text-[10px]" title="Blacksmith">🔨</span>}
              {node.is_vendor && <span className="text-[10px]" title="Vendor">🪙</span>}
              {node.is_teleport && <span className="text-[10px]" title="Teleport">🌀</span>}
            </div>
          </div>

          {/* Description */}
          <p className="text-sm text-foreground/90 leading-relaxed italic">
            {getNodeDisplayDescription(node, area) || 'A quiet corner of the world...'}
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
                  const isEngaged = inCombat && engagedCreatureIds.includes(c.id);
                  const displayHp = creatureHpOverrides[c.id] !== undefined ? creatureHpOverrides[c.id] : c.hp;
                  const hpPct = Math.max((displayHp / c.max_hp) * 100, 0);
                  const creaturePoisonStacks = poisonStacks[c.id];
                  const hasPoisonStacks = creaturePoisonStacks && Date.now() < creaturePoisonStacks.expiresAt && creaturePoisonStacks.stacks > 0;
                  const creatureIgniteStacks = igniteStacks[c.id];
                  const hasIgniteStacks = creatureIgniteStacks && Date.now() < creatureIgniteStacks.expiresAt && creatureIgniteStacks.stacks > 0;
                  const isSundered = sunderDebuff && sunderDebuff.creatureId === c.id && Date.now() < sunderDebuff.expiresAt;
                  return (
                    <div key={c.id} className={`p-1.5 bg-background/50 rounded border ${isActiveTarget ? 'border-destructive/60 ring-1 ring-destructive/30' : isEngaged ? 'border-dwarvish/50 ring-1 ring-dwarvish/20' : 'border-border'}`}>
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
                        <div className="ml-auto flex items-center gap-1 shrink-0">
                          <div className="w-[120px] h-2 bg-background rounded-full overflow-hidden border border-border">
                            <div
                              className={`h-full rounded-full transition-all duration-200`}
                              style={{
                                width: `${hpPct}%`,
                                backgroundColor: hasIgniteStacks
                                  ? 'hsl(var(--dwarvish))'
                                  : hasPoisonStacks
                                  ? 'hsl(var(--elvish))'
                                  : hpPct > 50 ? 'hsl(var(--elvish))' : hpPct > 25 ? 'hsl(var(--dwarvish))' : 'hsl(var(--destructive))',
                              }}
                            />
                          </div>
                          <span className="text-[9px] text-muted-foreground tabular-nums whitespace-nowrap">{displayHp}/{c.max_hp}</span>
                        </div>
                        {isActiveTarget ? (
                          <span className="text-[10px] font-display text-destructive animate-pulse">⚔️</span>
                        ) : isEngaged ? (
                          <span className="text-[10px] font-display text-dwarvish animate-pulse">⚔️</span>
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
                {otherPlayers.map(p => {
                  const isPartyMate = partyMemberIds?.has(p.id);
                  const hpData = partyMemberHp?.get(p.id);
                  return (
                    <div key={p.id} className={`p-1.5 bg-background/50 rounded border ${isPartyMate ? 'border-elvish/40' : 'border-primary/30'}`}>
                    <div className="flex items-center gap-1.5">
                        <span className="text-xs font-display text-primary truncate">{p.name}</span>
                        {getCharacterTitle(p.level) && (
                          <span className="text-primary/60 font-display text-[9px]">{getCharacterTitle(p.level)}</span>
                        )}
                        <span className="text-[10px] text-muted-foreground">L{p.level}</span>
                        {isPartyMate && hpData && (
                          <div className="ml-auto flex items-center gap-1 shrink-0">
                            <div className="w-[120px] h-2 bg-background rounded-full overflow-hidden border border-border">
                              <div
                                className="h-full rounded-full transition-all duration-200"
                                style={{
                                  width: `${Math.max((hpData.hp / hpData.max_hp) * 100, 0)}%`,
                                  backgroundColor: (hpData.hp / hpData.max_hp) > 0.5 ? 'hsl(var(--elvish))' : (hpData.hp / hpData.max_hp) > 0.25 ? 'hsl(var(--dwarvish))' : 'hsl(var(--destructive))',
                                }}
                              />
                            </div>
                            <span className="text-[9px] text-muted-foreground tabular-nums whitespace-nowrap">{hpData.hp}/{hpData.max_hp}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* Ground Loot */}
        {groundLoot.length > 0 && (
          <Collapsible defaultOpen>
            <CollapsibleTrigger className="flex items-center justify-between w-full py-1">
              <h3 className="font-display text-xs text-muted-foreground">On the Ground ({groundLoot.length})</h3>
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {groundLoot.map(g => {
                  const rarityColor = g.item.rarity === 'unique' ? 'text-primary text-glow' :
                    g.item.rarity === 'rare' ? 'text-dwarvish' :
                    g.item.rarity === 'uncommon' ? 'text-chart-2' : 'text-foreground';
                  const statEntries = Object.entries(g.item.stats || {}).filter(([, v]) => v !== 0);
                  return (
                    <div key={g.id} className="flex items-center justify-between p-1.5 bg-background/50 rounded border border-border">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="min-w-0 flex-1 cursor-default">
                            <span className={`text-xs font-display truncate ${rarityColor}`}>{g.item.name}</span>
                            {g.creature_name && (
                              <span className="text-[9px] text-muted-foreground ml-1">from {g.creature_name}</span>
                            )}
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="left" className="text-xs max-w-[200px] space-y-0.5">
                          <p className={`font-display ${rarityColor}`}>{g.item.name}</p>
                          <p className="text-[10px] text-muted-foreground capitalize">
                            {g.item.slot ? `${g.item.slot.replace('_', ' ')} · ` : ''}{g.item.item_type} · {g.item.rarity}
                          </p>
                          {g.item.description && <p className="text-[10px] italic text-foreground/70">{g.item.description}</p>}
                          {statEntries.length > 0 && (
                            <div className="text-[10px]">
                              {statEntries.map(([k, v]) => (
                                <span key={k} className="mr-1.5 text-elvish">{k.toUpperCase()} {v > 0 ? '+' : ''}{v}</span>
                              ))}
                            </div>
                          )}
                          <p className="text-[10px] text-dwarvish">{g.item.value}g</p>
                        </TooltipContent>
                      </Tooltip>
                      <Button size="sm" variant="outline" onClick={() => onPickUpLoot?.(g.id)} className="font-display text-[10px] h-5 px-1.5 ml-1 shrink-0">
                        Pick Up
                      </Button>
                    </div>
                  );
                })}
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
                <Button variant="secondary" size="sm" onClick={onSearch} disabled={character.cp < 5} className={`font-display text-[10px] h-6 px-2 ${hasDiscoverable ? 'ring-1 ring-primary/40 text-primary animate-pulse' : ''}`}>
                  <Search className="h-3 w-3 mr-0.5" /> Search <span className="ml-0.5 text-muted-foreground">(5)</span>
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
            {onOpenTeleport && (
              <Button variant="outline" size="sm" onClick={onOpenTeleport} className="font-display text-[10px] h-6 px-2 text-primary">
                🌀 {character.level >= 25 && !node.is_teleport ? 'Recall' : 'Teleport'}
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
              {classAbilities.map((ability, idx) => {
                const levelLocked = character.level < ability.levelRequired;
                const notEnoughCp = (character.cp ?? 0) < ability.cpCost;
                const needsTarget = ability.type === 'hp_transfer';
                const selfFallback = ability.type === 'ally_absorb' ? character.id : undefined;
                const resolvedTarget = (abilityTargetId ?? selfFallback) || undefined;
                const disableNoTarget = needsTarget && !resolvedTarget;
                return (
                  <Tooltip key={idx}>
                    <TooltipTrigger asChild>
                      <span>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => onUseAbility(idx, resolvedTarget)}
                          disabled={levelLocked || notEnoughCp || character.hp <= 0 || disableNoTarget}
                          className="font-display text-[10px] h-6 px-2 text-elvish border-elvish/50"
                        >
                          {ability.emoji} {ability.label}
                          {!levelLocked && <span className="ml-0.5 text-muted-foreground">({ability.cpCost})</span>}
                          {actionBindings?.[`ability${idx + 1}` as keyof ActionBindings]?.[0] && !levelLocked && !notEnoughCp && (
                            <span className="ml-0.5 text-[8px] text-muted-foreground">[{getKeyLabel(actionBindings[`ability${idx + 1}` as keyof ActionBindings][0])}]</span>
                          )}
                        </Button>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-xs max-w-[200px]">
                      {levelLocked
                        ? `Unlocks at level ${ability.levelRequired}`
                        : `${ability.description} · ${ability.cpCost} CP${disableNoTarget ? ' — select a target in party panel' : ''}`
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
