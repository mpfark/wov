import { GameNode, Region, Area, getNodeDisplayName, getNodeDisplayDescription } from '@/hooks/useNodes';
import { PlayerPresence } from '@/hooks/usePresence';
import { Creature } from '@/hooks/useCreatures';
import { NPC } from '@/hooks/useNPCs';
import { Character } from '@/hooks/useCharacter';
import { GroundLootItem } from '@/hooks/useGroundLoot';
import { RACE_LABELS, CLASS_LABELS, getCharacterTitle } from '@/lib/game-data';
import { CLASS_COMBAT, ClassAbility } from '@/lib/class-abilities';
import { getKeyLabel, type ActionBindings } from '@/hooks/useKeyboardMovement';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';
import StatusBarsStrip, { StatusBarsStripProps } from '@/components/game/StatusBarsStrip';
import HeartbeatIndicator from '@/components/game/HeartbeatIndicator';
import { useState, useEffect, useRef } from 'react';
import { ChevronDown } from 'lucide-react';
import { useAreaTypes } from '@/hooks/useAreaTypes';
import { getAreaHeaderColor } from '@/lib/area-colors';


interface Props {
  node: GameNode;
  region: Region | undefined;
  area?: Area | null;
  players: PlayerPresence[];
  creatures: Creature[];
  npcs?: NPC[];
  character: Character;
  eventLog: string[];
  onAttack: (creatureId: string) => void;
  onTalkToNPC?: (npc: NPC) => void;
  inCombat?: boolean;
  lastTickTime?: number | null;
  activeCombatCreatureId?: string | null;
  selectedTargetId?: string | null;
  engagedCreatureIds?: string[];
  creatureHpOverrides?: Record<string, number>;
  classAbilities?: ClassAbility[];
  onUseAbility?: (abilityIndex: number, targetId?: string) => void;
  abilityTargetId?: string | null;
  actionBindings?: ActionBindings;
  poisonStacks?: Record<string, { stacks: number; damagePerTick: number; expiresAt: number }>;
  igniteStacks?: Record<string, { stacks: number; damagePerTick: number; expiresAt: number }>;
  sunderDebuff?: { acReduction: number; expiresAt: number; creatureId: string; creatureName: string } | null;
  bleedStacks?: Record<string, { damagePerTick: number; expiresAt: number }>;
  groundLoot?: GroundLootItem[];
  onPickUpLoot?: (groundLootId: string) => void;
  partyMemberIds?: Set<string>;
  partyMemberHp?: Map<string, { hp: number; max_hp: number }>;
  // Status bars props
  statusBarsProps?: Omit<StatusBarsStripProps, 'character'>;
}

export default function NodeView({
  node, region, area, players, creatures, npcs = [], character, eventLog, onAttack, onTalkToNPC,
  inCombat, lastTickTime, activeCombatCreatureId, selectedTargetId, engagedCreatureIds = [], creatureHpOverrides = {}, classAbilities = [], onUseAbility, abilityTargetId,
  actionBindings,
  poisonStacks = {},
  igniteStacks = {},
  sunderDebuff,
  bleedStacks = {},
  groundLoot = [],
  onPickUpLoot,
  partyMemberIds,
  partyMemberHp,
  statusBarsProps,
}: Props) {
  const otherPlayers = players.filter(p => p.id !== character.id);
  const [areaOpen, setAreaOpen] = useState(true);
  const { emojiMap } = useAreaTypes();

  // hasTargetedAbility check no longer needed — targeting is handled in PartyPanel

  // No longer need cooldown tracking — CP system handles availability

  const hasAreaContent = creatures.length > 0 || npcs.length > 0 || otherPlayers.length > 0;

  return (
    <TooltipProvider delayDuration={300}>
      <div className="h-full flex flex-col p-3 relative">
        {/* Scrollable content - only header & description */}
        <div className="flex-1 min-h-0 overflow-y-auto space-y-2">
          {/* Location Header */}
           <div className="text-center border-b border-border pb-2">
            <h2
              className="font-display text-xl text-glow"
              style={{ color: area ? getAreaHeaderColor(emojiMap[area.area_type] || '📍') : undefined }}
            >
              {getNodeDisplayName(node, area)}
            </h2>
            {region && (
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {region.name} — Levels {region.min_level}–{region.max_level}
              </p>
            )}
            <div className="flex items-center justify-center gap-1.5 mt-0.5 flex-wrap">
              {node.is_inn && <span className="text-[10px]" title="Inn">🏨</span>}
              {node.is_blacksmith && <span className="text-[10px]" title="Blacksmith">🔨</span>}
              {node.is_vendor && <span className="text-[10px]" title="Vendor">🪙</span>}
              {node.is_teleport && <span className="text-[10px]" title="Teleport">🌀</span>}
              {node.is_trainer && <span className="text-[10px]" title="Boss Trainer">🏋️</span>}
            </div>
          </div>

          {/* Description */}
          <p className="text-sm text-foreground/90 leading-relaxed italic">
            {getNodeDisplayDescription(node, area) || 'A quiet corner of the world...'}
          </p>
        </div>

        {/* Floating heartbeat indicator — visible during combat or DoT drain */}
        {lastTickTime && (Date.now() - lastTickTime < 4000 || inCombat) && (
          <div className="flex justify-center py-0.5">
            <HeartbeatIndicator lastTickTime={lastTickTime} />
          </div>
        )}

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
                  const isSelected = !isActiveTarget && !isEngaged && selectedTargetId === c.id;
                  const displayHp = creatureHpOverrides[c.id] !== undefined ? creatureHpOverrides[c.id] : c.hp;
                  const hpPct = Math.max((displayHp / c.max_hp) * 100, 0);
                  const creaturePoisonStacks = poisonStacks[c.id];
                  const hasPoisonStacks = creaturePoisonStacks && Date.now() < creaturePoisonStacks.expiresAt && creaturePoisonStacks.stacks > 0;
                  const creatureIgniteStacks = igniteStacks[c.id];
                  const hasIgniteStacks = creatureIgniteStacks && Date.now() < creatureIgniteStacks.expiresAt && creatureIgniteStacks.stacks > 0;
                  const isSundered = sunderDebuff && sunderDebuff.creatureId === c.id && Date.now() < sunderDebuff.expiresAt;
                  const creatureBleed = bleedStacks[c.id];
                  const isBleeding = creatureBleed && Date.now() < creatureBleed.expiresAt;
                  return (
                    <div key={c.id} className={`p-1.5 bg-background/50 rounded border ${isActiveTarget ? 'border-destructive/60 ring-1 ring-destructive/30' : isEngaged ? 'border-dwarvish/50 ring-1 ring-dwarvish/20' : isSelected ? 'border-primary/50 ring-1 ring-primary/20' : 'border-border'}`}>
                      <div className="flex items-center gap-1.5">
                        {/* Left: Name, level, debuffs */}
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
                        {isBleeding && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="text-[10px] text-dot-bleed font-display animate-pulse">
                                🩸
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="text-xs">
                              Rend: {creatureBleed!.damagePerTick} dmg/tick
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
                        {/* Right: combat icon, HP bar, HP numbers, attack button */}
                        <div className="ml-auto flex items-center gap-1 shrink-0">
                          {(isActiveTarget || isEngaged) && (
                            <span className={`text-[10px] ${isActiveTarget ? 'text-destructive' : 'text-dwarvish'} animate-pulse`}>⚔️</span>
                          )}
                          {isSelected && !isActiveTarget && !isEngaged && (
                            <span className="text-[10px] text-primary">🎯</span>
                          )}
                          <div className="w-[120px] h-2 bg-background rounded-full overflow-hidden border border-border">
                            <div
                              className="h-full rounded-full transition-all duration-200"
                              style={{
                                width: `${hpPct}%`,
                                backgroundColor: isBleeding
                                  ? 'hsl(var(--dot-bleed))'
                                  : hasIgniteStacks
                                  ? 'hsl(var(--dwarvish))'
                                  : hasPoisonStacks
                                  ? 'hsl(var(--elvish))'
                                  : hpPct > 50 ? 'hsl(var(--elvish))' : hpPct > 25 ? 'hsl(var(--dwarvish))' : 'hsl(var(--destructive))',
                              }}
                            />
                          </div>
                          <span className="text-[9px] text-muted-foreground tabular-nums whitespace-nowrap">{displayHp}/{c.max_hp}</span>
                          {!isActiveTarget && !isEngaged && !isSelected && (
                            <Button size="sm" variant="destructive" onClick={() => onAttack(c.id)} className="font-display text-[10px] h-5 px-1.5">
                              {CLASS_COMBAT[character.class]?.label || 'Atk'}
                            </Button>
                          )}
                        </div>
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
                        <span className="text-xs font-display text-primary truncate">
                          {getCharacterTitle(p.level, p.gender) && <span className="text-primary/60 text-[9px] mr-0.5">{getCharacterTitle(p.level, p.gender)}</span>}
                          {p.name}
                        </span>
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
                    g.item.rarity === 'uncommon' ? 'text-elvish' : 'text-foreground';
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

        {/* Status Bars — above action bar */}
        {statusBarsProps && (
          <div className="pt-1.5 border-t border-border mt-1">
            <StatusBarsStrip character={character} {...statusBarsProps} />
          </div>
        )}

        {/* Compact Action Bar - pinned to bottom */}
        <div className="pt-1.5 border-t border-border mt-1 space-y-1.5 flex flex-col items-center">
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
