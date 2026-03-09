import { useState, useCallback } from 'react';
import { Region, GameNode, Area } from '@/hooks/useNodes';
import { Party, PartyMember } from '@/hooks/useParty';
import { PlayerPresence } from '@/hooks/usePresence';
import { Character } from '@/hooks/useCharacter';
import PlayerGraphView from './PlayerGraphView';
import PartyPanel from './PartyPanel';
import { Keyboard, RotateCcw, MapIcon, Search, ShoppingCart, Hammer } from 'lucide-react';
import { HoverCard, HoverCardTrigger, HoverCardContent } from '@/components/ui/hover-card';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { type Direction, type KeyBindings, type ActionBindings, type ActionName, getKeyLabel, DEFAULT_BINDINGS, ACTION_NAMES, ACTION_LABELS } from '@/hooks/useKeyboardMovement';

export interface ActiveBuffs {
  stealth?: boolean;
  damageBuff?: boolean;
  acBuff?: boolean;
  acBuffBonus?: number;
  poison?: boolean;
  evasion?: boolean;
  ignite?: boolean;
  absorb?: boolean;
  absorbHp?: number;
  root?: boolean;
  sunder?: boolean;
  focusStrike?: boolean;
}

interface Props {
  regions: Region[];
  nodes: GameNode[];
  areas?: Area[];
  currentNodeId: string | null;
  currentRegionId: string | null;
  characterLevel: number;
  onNodeClick: (nodeId: string) => void;
  partyMembers?: PartyMember[];
  myCharacterId?: string;
  // Party props
  character: Character;
  party: Party | null;
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
  activeBuffs?: ActiveBuffs;
  abilityTargetId?: string | null;
  onSetAbilityTarget?: (charId: string | null) => void;
  showTargetSelector?: boolean;
  // Keyboard bindings
  keyboardBindings?: {
    bindings: KeyBindings;
    setBindings: (b: KeyBindings) => void;
    actionBindings: ActionBindings;
    setActionBindings: (b: ActionBindings) => void;
    resetBindings: () => void;
    DIRECTIONS: readonly Direction[];
    DIRECTION_LABELS: Record<Direction, string>;
    ACTION_NAMES: readonly ActionName[];
    ACTION_LABELS: Record<ActionName, string>;
  };
  // Action buttons
  onSearch?: () => void;
  onOpenVendor?: () => void;
  onOpenBlacksmith?: () => void;
  onOpenTeleport?: () => void;
  searchDisabled?: boolean;
  hasDiscoverable?: boolean;
}

const DIRECTION_ORDER: Direction[] = ['NW', 'N', 'NE', 'W', 'E', 'SW', 'S', 'SE'] as const;

export default function MapPanel({
  regions, nodes, areas, currentNodeId, currentRegionId, characterLevel, onNodeClick, partyMembers, myCharacterId,
  character, party, pendingInvites, isLeader, isTank, myMembership, playersHere,
  onCreateParty, onInvite, onAcceptInvite, onDeclineInvite, onLeaveParty, onKick, onSetTank, onToggleFollow,
  keyboardBindings, activeBuffs, abilityTargetId, onSetAbilityTarget, showTargetSelector,
  onSearch, onOpenVendor, onOpenBlacksmith, onOpenTeleport, searchDisabled, hasDiscoverable,
}: Props) {
  const currentRegion = currentRegionId ? regions.find(r => r.id === currentRegionId) : null;
  const [rebindingDir, setRebindingDir] = useState<Direction | null>(null);
  const [rebindingAction, setRebindingAction] = useState<ActionName | null>(null);

  const handleKeyCapture = useCallback((e: React.KeyboardEvent) => {
    if (!keyboardBindings) return;
    e.preventDefault();
    e.stopPropagation();
    const key = e.key;
    if (key === 'Escape') {
      setRebindingDir(null);
      setRebindingAction(null);
      return;
    }

    // Remove key from all movement bindings
    const newBindings = { ...keyboardBindings.bindings };
    for (const dir of keyboardBindings.DIRECTIONS) {
      newBindings[dir] = newBindings[dir].filter(k => k !== key);
    }
    // Remove key from all action bindings
    const newActions = { ...keyboardBindings.actionBindings };
    for (const name of keyboardBindings.ACTION_NAMES) {
      newActions[name] = newActions[name].filter(k => k !== key);
    }

    if (rebindingDir) {
      if (!newBindings[rebindingDir].includes(key)) {
        newBindings[rebindingDir] = [...newBindings[rebindingDir].slice(-1), key];
      }
      keyboardBindings.setBindings(newBindings);
      keyboardBindings.setActionBindings(newActions);
      setRebindingDir(null);
    } else if (rebindingAction) {
      if (!newActions[rebindingAction].includes(key)) {
        newActions[rebindingAction] = [...newActions[rebindingAction].slice(-1), key];
      }
      keyboardBindings.setBindings(newBindings);
      keyboardBindings.setActionBindings(newActions);
      setRebindingAction(null);
    }
  }, [rebindingDir, rebindingAction, keyboardBindings]);

  const renderActionKey = (name: ActionName) => {
    if (!keyboardBindings) return null;
    const keys = keyboardBindings.actionBindings[name];
    const isBinding = rebindingAction === name;
    return (
      <button
        key={name}
        tabIndex={0}
        onClick={() => { setRebindingAction(name); setRebindingDir(null); }}
        onKeyDown={isBinding ? handleKeyCapture : undefined}
        className={`h-8 rounded border text-[10px] flex flex-col items-center justify-center transition-colors
          ${isBinding ? 'border-primary bg-primary/20 ring-1 ring-primary' : 'border-border bg-muted/30 hover:bg-muted/60'}`}
      >
        <span className="font-display text-muted-foreground leading-none">{keyboardBindings.ACTION_LABELS[name]}</span>
        {isBinding ? (
          <span className="text-primary text-[8px] animate-pulse">press key</span>
        ) : keys.length > 0 ? (
          <span className="text-foreground/70 text-[8px] leading-none">
            {keys.map(getKeyLabel).join(' / ')}
          </span>
        ) : (
          <span className="text-muted-foreground/50 text-[8px] leading-none">—</span>
        )}
      </button>
    );
  };

  return (
    <div className="h-full flex flex-col p-3 space-y-3 overflow-y-auto">

      {/* Local Map — SVG Graph */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <h3 className="font-display text-xs text-muted-foreground">Local Area</h3>
          {keyboardBindings && (
            <Popover>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <PopoverTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-5 w-5">
                        <Keyboard className="h-3 w-3" />
                      </Button>
                    </PopoverTrigger>
                  </TooltipTrigger>
                  <TooltipContent side="left"><p className="text-xs">Movement Keys</p></TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <PopoverContent className="w-64 p-3 max-h-[70vh] overflow-y-auto" align="end">
                <div className="space-y-2" onKeyDown={(rebindingDir || rebindingAction) ? handleKeyCapture : undefined}>
                  <div className="flex items-center justify-between">
                    <span className="font-display text-xs">Keybindings</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5"
                      onClick={() => keyboardBindings.resetBindings()}
                    >
                      <RotateCcw className="h-3 w-3" />
                    </Button>
                  </div>

                  {/* Movement - 3x3 compass grid */}
                  <div className="space-y-1">
                    <span className="font-display text-[10px] text-muted-foreground">Movement</span>
                    <div className="grid grid-cols-3 gap-1">
                      {DIRECTION_ORDER.map((dir, i) => {
                        const cells: React.ReactNode[] = [];
                        if (i === 4) {
                          cells.push(<div key="center" className="h-8" />);
                        }
                        const keys = keyboardBindings.bindings[dir];
                        const isBinding = rebindingDir === dir;
                        cells.push(
                          <button
                            key={dir}
                            tabIndex={0}
                            onClick={() => { setRebindingDir(dir); setRebindingAction(null); }}
                            onKeyDown={isBinding ? handleKeyCapture : undefined}
                            className={`h-8 rounded border text-[10px] flex flex-col items-center justify-center transition-colors
                              ${isBinding ? 'border-primary bg-primary/20 ring-1 ring-primary' : 'border-border bg-muted/30 hover:bg-muted/60'}`}
                          >
                            <span className="font-display text-muted-foreground leading-none">{dir}</span>
                            {isBinding ? (
                              <span className="text-primary text-[8px] animate-pulse">press key</span>
                            ) : keys.length > 0 ? (
                              <span className="text-foreground/70 text-[8px] leading-none">
                                {keys.map(getKeyLabel).join(' / ')}
                              </span>
                            ) : (
                              <span className="text-muted-foreground/50 text-[8px] leading-none">—</span>
                            )}
                          </button>
                        );
                        return cells;
                      })}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="space-y-1 border-t border-border pt-2">
                    <span className="font-display text-[10px] text-muted-foreground">Actions</span>
                    {/* Attack & Search & Pickup */}
                    <div className="grid grid-cols-3 gap-1">
                      {renderActionKey('attack')}
                      {renderActionKey('search')}
                      {renderActionKey('pickup')}
                    </div>
                    {/* Abilities */}
                    <div className="grid grid-cols-4 gap-1">
                      {(['ability1', 'ability2', 'ability3', 'ability4'] as ActionName[]).map(name => renderActionKey(name))}
                    </div>
                    {/* Potions */}
                    <div className="grid grid-cols-3 gap-1">
                      {(['potion1', 'potion2', 'potion3'] as ActionName[]).map(name => renderActionKey(name))}
                    </div>
                    <div className="grid grid-cols-3 gap-1">
                      {(['potion4', 'potion5', 'potion6'] as ActionName[]).map(name => renderActionKey(name))}
                    </div>
                  </div>

                  <p className="text-[9px] text-muted-foreground text-center">Click a slot, then press a key to bind</p>
                </div>
              </PopoverContent>
            </Popover>
          )}
        </div>
        <div className="relative">
          {currentNodeId ? (
            <PlayerGraphView
              currentNodeId={currentNodeId}
              nodes={nodes}
              onNodeClick={onNodeClick}
              partyMembers={partyMembers}
              myCharacterId={myCharacterId}
              areas={areas}
              characterId={character.id}
            />
          ) : (
            <p className="text-xs text-muted-foreground italic">No locations mapped...</p>
          )}

          {/* Bottom toolbar — action buttons + legend */}
          <div className="absolute bottom-1 left-1 right-1 z-10 flex items-center justify-between">
            <div className="flex items-center gap-1">
              <TooltipProvider delayDuration={200}>
                {onSearch && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={onSearch}
                        disabled={searchDisabled}
                        className={`h-5 w-5 flex items-center justify-center rounded border transition-colors disabled:opacity-40 ${
                          hasDiscoverable
                            ? 'bg-primary/20 border-primary/50 shadow-[0_0_6px_hsl(var(--primary)/0.4)] animate-pulse'
                            : 'bg-background/70 border-border/50 hover:bg-muted/60'
                        }`}
                      >
                        <Search className={`h-3 w-3 ${hasDiscoverable ? 'text-primary' : 'text-muted-foreground'}`} />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-xs">Search (5 CP)</TooltipContent>
                  </Tooltip>
                )}
                {onOpenVendor && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={onOpenVendor}
                        className="h-5 w-5 flex items-center justify-center rounded bg-primary/15 border border-primary/40 shadow-[0_0_6px_hsl(var(--primary)/0.3)] hover:bg-primary/25 transition-colors"
                      >
                        <ShoppingCart className="h-3 w-3 text-primary" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-xs">Shop</TooltipContent>
                  </Tooltip>
                )}
                {onOpenBlacksmith && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={onOpenBlacksmith}
                        className="h-5 w-5 flex items-center justify-center rounded bg-dwarvish/15 border border-dwarvish/40 shadow-[0_0_6px_hsl(var(--dwarvish)/0.3)] hover:bg-dwarvish/25 transition-colors"
                      >
                        <Hammer className="h-3 w-3 text-dwarvish" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-xs">Blacksmith</TooltipContent>
                  </Tooltip>
                )}
                {onOpenTeleport && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={onOpenTeleport}
                        className="h-5 w-5 flex items-center justify-center rounded bg-primary/15 border border-primary/40 shadow-[0_0_6px_hsl(var(--primary)/0.3)] hover:bg-primary/25 transition-colors"
                      >
                        <span className="text-[10px]">🌀</span>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-xs">
                      {characterLevel >= 25 ? 'Recall' : 'Teleport'}
                    </TooltipContent>
                  </Tooltip>
                )}
              </TooltipProvider>
            </div>
            <HoverCard openDelay={100} closeDelay={200}>
              <HoverCardTrigger asChild>
                <button className="h-5 w-5 flex items-center justify-center rounded bg-background/70 border border-border/50 hover:bg-muted/60 transition-colors">
                  <MapIcon className="h-3 w-3 text-muted-foreground" />
                </button>
              </HoverCardTrigger>
              <HoverCardContent side="top" align="end" className="w-56 p-2.5">
                <h4 className="font-display text-[10px] text-muted-foreground mb-1.5">Map</h4>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px]">
                  <div className="flex items-center gap-1.5">
                    <span className="text-primary text-[8px]">◆</span>
                    <span className="text-muted-foreground">You are here</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <svg width="10" height="10"><circle cx="5" cy="5" r="4" className="fill-chart-2 stroke-background" strokeWidth={1} /></svg>
                    <span className="text-muted-foreground">Party member</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <svg width="10" height="10"><circle cx="5" cy="5" r="4" fill="hsl(0 70% 50%)" className="stroke-background" strokeWidth={1} /></svg>
                    <span className="text-muted-foreground">Aggressive</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <svg width="10" height="10"><circle cx="5" cy="5" r="4" fill="hsl(35 60% 50%)" className="stroke-background" strokeWidth={1} /></svg>
                    <span className="text-muted-foreground">Creature</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <svg width="16" height="8"><line x1="0" y1="4" x2="16" y2="4" stroke="hsl(35 20% 35% / 0.4)" strokeWidth={1.5} strokeDasharray="4 3" /></svg>
                    <span className="text-muted-foreground">Exit path</span>
                  </div>
                </div>
                <h4 className="font-display text-[10px] text-muted-foreground mt-2 mb-1">Services</h4>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px]">
                  <div className="flex items-center gap-1.5"><span className="text-[8px]">🏨</span><span className="text-muted-foreground">Inn</span></div>
                  <div className="flex items-center gap-1.5"><span className="text-[8px]">🔨</span><span className="text-muted-foreground">Blacksmith</span></div>
                  <div className="flex items-center gap-1.5"><span className="text-[8px]">🪙</span><span className="text-muted-foreground">Vendor</span></div>
                  <div className="flex items-center gap-1.5"><span className="text-[8px]">🌀</span><span className="text-muted-foreground">Teleport</span></div>
                </div>
                <h4 className="font-display text-[10px] text-muted-foreground mt-2 mb-1">Area Types</h4>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px]">
                  <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: 'hsl(35 55% 60%)' }} /><span className="text-muted-foreground">Town</span></div>
                  <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: 'hsl(120 40% 55%)' }} /><span className="text-muted-foreground">Forest</span></div>
                  <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: 'hsl(30 30% 45%)' }} /><span className="text-muted-foreground">Cave</span></div>
                  <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: 'hsl(45 40% 55%)' }} /><span className="text-muted-foreground">Ruins</span></div>
                  <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: 'hsl(80 35% 55%)' }} /><span className="text-muted-foreground">Plains</span></div>
                  <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: 'hsl(210 30% 50%)' }} /><span className="text-muted-foreground">Mountain</span></div>
                  <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: 'hsl(150 35% 40%)' }} /><span className="text-muted-foreground">Swamp</span></div>
                  <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: 'hsl(40 50% 60%)' }} /><span className="text-muted-foreground">Desert</span></div>
                  <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: 'hsl(200 50% 55%)' }} /><span className="text-muted-foreground">Coast</span></div>
                  <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: 'hsl(0 40% 35%)' }} /><span className="text-muted-foreground">Dungeon</span></div>
                </div>
              </HoverCardContent>
            </HoverCard>
          </div>
        </div>
      </div>

      {/* Party Section */}
      <div className="border-t border-border pt-2">
        <PartyPanel
          character={character}
          party={party}
          members={partyMembers || []}
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
          activeBuffs={activeBuffs}
          abilityTargetId={abilityTargetId}
          onSetAbilityTarget={onSetAbilityTarget}
          showTargetSelector={showTargetSelector}
        />
      </div>
    </div>
  );
}
