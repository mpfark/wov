import { GameNode, Region, Area, getNodeDisplayName, getNodeDisplayDescription } from '@/features/world';
import { PlayerPresence } from '@/features/world';
import { Creature } from '@/features/creatures';
import { NPC } from '@/features/creatures';
import { Character } from '@/features/character';
import { GroundLootItem } from '@/features/inventory';
import { getCharacterTitle } from '@/lib/game-data';
import { CLASS_COMBAT, ClassAbility } from '@/features/combat';
import { getKeyLabel, type ActionBindings } from '@/features/world';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';
import StatusBarsStrip, { StatusBarsStripProps } from '@/features/character/components/StatusBarsStrip';
import HeartbeatIndicator from '@/components/game/HeartbeatIndicator';
import { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import InspectPlayerDialog from '@/components/game/InspectPlayerDialog';
import { useAreaTypes } from '@/features/world';
import { getAreaHeaderColor } from '@/features/world';
import LocationBackground from './LocationBackground';


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
  sunderDebuff?: Record<string, { acReduction: number; expiresAt: number; creatureId: string; creatureName: string }>;
  bleedStacks?: Record<string, { damagePerTick: number; expiresAt: number }>;
  groundLoot?: GroundLootItem[];
  onPickUpLoot?: (groundLootId: string) => void;
  partyMemberIds?: Set<string>;
  partyMemberHp?: Map<string, { hp: number; max_hp: number }>;
  creaturesLoading?: boolean;
  // Status bars props
  statusBarsProps?: Omit<StatusBarsStripProps, 'character'>;
}

export default function NodeView({
  node, region, area, players, creatures, npcs = [], character, eventLog: _eventLog, onAttack, onTalkToNPC,
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
  creaturesLoading,
  statusBarsProps,
}: Props) {
  const otherPlayers = players.filter(p => p.id !== character.id);
  const [areaOpen, setAreaOpen] = useState(true);
  const [inspectPlayer, setInspectPlayer] = useState<{ id: string; name: string; level: number; race?: string; class?: string; gender?: string } | null>(null);

  // ── Combat start flash ──
  const prevInCombatRef = useRef(false);
  const [combatFlash, setCombatFlash] = useState(false);
  useEffect(() => {
    if (inCombat && !prevInCombatRef.current) {
      setCombatFlash(true);
      const t = setTimeout(() => setCombatFlash(false), 400);
      return () => clearTimeout(t);
    }
    prevInCombatRef.current = !!inCombat;
  }, [inCombat]);
  const { emojiMap } = useAreaTypes();

  // ── Polish: aggro flash tracking (fire once per creature per node visit) ──
  const flashedRef = useRef<Set<string>>(new Set());
  const [flashingIds, setFlashingIds] = useState<Set<string>>(new Set());
  const prevNodeIdRef = useRef(node.id);

  // Reset flash tracking on node change
  useEffect(() => {
    if (node.id !== prevNodeIdRef.current) {
      flashedRef.current.clear();
      setFlashingIds(new Set());
      prevNodeIdRef.current = node.id;
    }
  }, [node.id]);

  // Trigger aggro flash for newly engaged creatures
  useEffect(() => {
    const newFlash = new Set<string>();
    for (const cId of engagedCreatureIds) {
      if (!flashedRef.current.has(cId)) {
        flashedRef.current.add(cId);
        newFlash.add(cId);
      }
    }
    if (newFlash.size > 0) {
      setFlashingIds(prev => new Set([...prev, ...newFlash]));
      // Auto-clear after animation
      if (import.meta.env.DEV) {
        newFlash.forEach(cId => console.debug('[aggro] flash shown', { creatureId: cId, ts: performance.now().toFixed(0) }));
      }
      setTimeout(() => {
        setFlashingIds(prev => {
          const next = new Set(prev);
          newFlash.forEach(id => next.delete(id));
          return next;
        });
      }, 600);
    }
  }, [engagedCreatureIds]);

  // ── Dev-only: creature render timing ──
  const creaturesVisibleRef = useRef(false);
  useEffect(() => {
    if (!creaturesLoading && creatures.length > 0 && !creaturesVisibleRef.current) {
      creaturesVisibleRef.current = true;
      if (import.meta.env.DEV) {
        console.debug('[polish] creatures visible', performance.now().toFixed(0));
      }
    }
    if (creaturesLoading) creaturesVisibleRef.current = false;
  }, [creaturesLoading, creatures.length]);

  const hasAreaContent = creatures.length > 0 || npcs.length > 0 || otherPlayers.length > 0;

  return (
    <TooltipProvider delayDuration={300}>
       <div className={`h-full flex flex-col p-3 relative z-10${combatFlash ? ' combat-start-flash' : ''}`}>
        <LocationBackground node={node} area={area} region={region} />
        {/* Scrollable content - only header & description */}
        <div className="flex-1 min-h-0 overflow-y-auto space-y-2 relative z-10">
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
              {(() => {
                const hasVendorNpc = npcs.some(n => n.service_role === 'vendor');
                const hasBlacksmithNpc = npcs.some(n => n.service_role === 'blacksmith');
                const hasTrainerNpc = npcs.some(n => n.service_role === 'trainer');
                return (
                  <>
                    {node.is_inn && <span className="text-[10px]" title="Inn">🏨</span>}
                    {node.is_blacksmith && (
                      <span
                        className={`text-[10px] ${hasBlacksmithNpc ? 'text-glow' : 'opacity-70'}`}
                        title={hasBlacksmithNpc ? 'Blacksmith — staffed' : 'Blacksmith (no smith on duty)'}
                      >
                        🔨
                      </span>
                    )}
                    {(node as any).is_soulforge && (
                      <span className="text-[10px] text-soulforged text-glow-soulforged" title="Soulforge-capable forge">⚒️</span>
                    )}
                    {node.is_vendor && (
                      <span
                        className={`text-[10px] ${hasVendorNpc ? 'text-glow' : 'opacity-70'}`}
                        title={hasVendorNpc ? 'Vendor — shopkeeper present' : 'Vendor (no shopkeeper)'}
                      >
                        🪙
                      </span>
                    )}
                    {node.is_teleport && <span className="text-[10px]" title="Teleport">🌀</span>}
                    {node.is_trainer && (
                      <span
                        className={`text-[10px] ${hasTrainerNpc ? 'text-glow' : 'opacity-70'}`}
                        title={hasTrainerNpc ? 'Renown Trainer — staffed' : 'Renown Trainer (no trainer on duty)'}
                      >
                        🏛️
                      </span>
                    )}
                  </>
                );
              })()}
            </div>
          </div>

          {/* Description */}
          <p className="text-sm text-foreground/90 leading-relaxed italic">
            {getNodeDisplayDescription(node, area) || 'A quiet corner of the world...'}
          </p>
        </div>

        <div className="relative z-10">
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
                     const creatureSunder = sunderDebuff?.[c.id];
                     const isSundered = creatureSunder && Date.now() < creatureSunder.expiresAt;
                    const creatureBleed = bleedStacks[c.id];
                    const isBleeding = creatureBleed && Date.now() < creatureBleed.expiresAt;
                    const isFlashing = flashingIds.has(c.id);
                    return (
                      <div key={c.id} className={`p-1.5 bg-background/50 rounded border animate-polish-fade-in ${isFlashing ? 'animate-aggro-flash' : ''} ${isActiveTarget ? 'border-destructive/60 ring-1 ring-destructive/30' : isEngaged ? 'border-dwarvish/50 ring-1 ring-dwarvish/20' : isSelected ? 'border-primary/50 ring-1 ring-primary/20' : 'border-border'}`}>
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
                                <span className="text-[10px] text-dwarvish font-display animate-flicker">
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
                                <span className="text-[10px] text-dot-bleed font-display animate-drip">
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
                                <span className="text-[10px] text-dwarvish font-display">
                                  🔨
                                </span>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="text-xs">
                                Sundered: AC reduced by {creatureSunder!.acReduction}
                              </TooltipContent>
                            </Tooltip>
                          )}
                          {/* Right: combat icon, HP bar, HP numbers, attack button */}
                          <div className="ml-auto flex items-center gap-1 shrink-0">
                            {(isActiveTarget || isEngaged) && (
                              <span className={`text-[10px] ${isActiveTarget ? 'text-destructive' : 'text-dwarvish'}`}>⚔️</span>
                            )}
                            {isSelected && !isActiveTarget && !isEngaged && (
                              <span className="text-[10px] text-primary">🎯</span>
                            )}
                            <div className="w-[120px] h-2 bg-background rounded-full overflow-hidden border border-border">
                              <div
                                className="h-full rounded-full transition-[width] duration-300 transition-colors duration-700"
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
                  {npcs.map(npc => {
                    const roleIcon = npc.service_role === 'vendor' ? '🪙'
                      : npc.service_role === 'blacksmith' ? '🔨'
                      : npc.service_role === 'trainer' ? '🏛️'
                      : '💬';
                    const buttonLabel = npc.service_role === 'vendor' ? 'Trade'
                      : npc.service_role === 'blacksmith' ? 'Forge'
                      : npc.service_role === 'trainer' ? 'Train'
                      : 'Talk';
                    return (
                      <div key={npc.id} className="flex items-center justify-between p-1.5 bg-background/50 rounded border border-elvish/30">
                        <span className="text-xs font-display text-elvish min-w-0 truncate">{roleIcon} {npc.name}</span>
                        <Button size="sm" variant="outline" onClick={() => onTalkToNPC?.(npc)} className="font-display text-[10px] h-5 px-1.5 border-elvish/50 text-elvish ml-1 shrink-0">
                          {buttonLabel}
                        </Button>
                      </div>
                    );
                  })}
                  {otherPlayers.map(p => {
                    const isPartyMate = partyMemberIds?.has(p.id);
                    const hpData = partyMemberHp?.get(p.id);
                    return (
                      <div key={p.id} className={`p-1.5 bg-background/50 rounded border ${isPartyMate ? 'border-elvish/40' : 'border-primary/30'}`}>
                        <div className="flex items-center gap-1.5">
                          <button
                            className="text-xs font-display text-primary truncate text-left hover:underline cursor-pointer"
                            onClick={() => setInspectPlayer({ id: p.id, name: p.name, level: p.level, race: p.race, class: p.class, gender: p.gender })}
                          >
                            {getCharacterTitle(p.level, p.gender) && <span className="text-primary/60 text-[9px] mr-0.5">{getCharacterTitle(p.level, p.gender)}</span>}
                            {p.name}
                          </button>
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
        <InspectPlayerDialog
          player={inspectPlayer}
          open={!!inspectPlayer}
          onOpenChange={(open) => { if (!open) setInspectPlayer(null); }}
        />
      </div>
    </TooltipProvider>
  );
}
