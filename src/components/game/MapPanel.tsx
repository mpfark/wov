import { useState, useCallback } from 'react';
import { Region, GameNode } from '@/hooks/useNodes';
import { Party, PartyMember } from '@/hooks/useParty';
import { PlayerPresence } from '@/hooks/usePresence';
import { Character } from '@/hooks/useCharacter';
import PlayerGraphView from './PlayerGraphView';
import PartyPanel from './PartyPanel';
import { Keyboard, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { type Direction, type KeyBindings, getKeyLabel, DEFAULT_BINDINGS } from '@/hooks/useKeyboardMovement';

interface Props {
  regions: Region[];
  nodes: GameNode[];
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
  // Keyboard bindings
  keyboardBindings?: {
    bindings: KeyBindings;
    setBindings: (b: KeyBindings) => void;
    resetBindings: () => void;
    DIRECTIONS: readonly Direction[];
    DIRECTION_LABELS: Record<Direction, string>;
  };
}

const DIRECTION_ORDER: Direction[] = ['NW', 'N', 'NE', 'W', 'E', 'SW', 'S', 'SE'] as const;

export default function MapPanel({
  regions, nodes, currentNodeId, currentRegionId, characterLevel, onNodeClick, partyMembers, myCharacterId,
  character, party, pendingInvites, isLeader, isTank, myMembership, playersHere,
  onCreateParty, onInvite, onAcceptInvite, onDeclineInvite, onLeaveParty, onKick, onSetTank, onToggleFollow,
  keyboardBindings,
}: Props) {
  const currentRegion = currentRegionId ? regions.find(r => r.id === currentRegionId) : null;
  const [rebindingDir, setRebindingDir] = useState<Direction | null>(null);

  const handleKeyCapture = useCallback((e: React.KeyboardEvent) => {
    if (!rebindingDir || !keyboardBindings) return;
    e.preventDefault();
    e.stopPropagation();
    const key = e.key;
    if (key === 'Escape') {
      setRebindingDir(null);
      return;
    }
    // Remove this key from any other direction first
    const newBindings = { ...keyboardBindings.bindings };
    for (const dir of keyboardBindings.DIRECTIONS) {
      newBindings[dir] = newBindings[dir].filter(k => k !== key);
    }
    // Add to the target direction (max 2 keys per direction)
    if (!newBindings[rebindingDir].includes(key)) {
      newBindings[rebindingDir] = [...newBindings[rebindingDir].slice(-1), key];
    }
    keyboardBindings.setBindings(newBindings);
    setRebindingDir(null);
  }, [rebindingDir, keyboardBindings]);

  return (
    <div className="h-full flex flex-col p-3 space-y-3 overflow-y-auto">
      {/* Current Region */}
      <div>
        <h3 className="font-display text-xs text-muted-foreground mb-1.5">Region</h3>
        {currentRegion ? (
          <div className="p-2 rounded border border-primary bg-primary/10 text-xs">
            <div className="font-display text-primary">{currentRegion.name}</div>
            <div className="text-[10px] text-muted-foreground">
              Lvl {currentRegion.min_level}–{currentRegion.max_level}
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground italic">Unknown region...</p>
        )}
      </div>

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
              <PopoverContent className="w-56 p-3" align="end">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-display text-xs">Movement Keys</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5"
                      onClick={() => keyboardBindings.resetBindings()}
                    >
                      <RotateCcw className="h-3 w-3" />
                    </Button>
                  </div>
                  {/* 3x3 compass grid (center empty) */}
                  <div
                    className="grid grid-cols-3 gap-1"
                    onKeyDown={handleKeyCapture}
                  >
                    {DIRECTION_ORDER.map((dir, i) => {
                      // Insert empty center cell after W (index 3) — E is index 4
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
                          onClick={() => setRebindingDir(dir)}
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
                  <p className="text-[9px] text-muted-foreground text-center">Click a direction, then press a key to bind</p>
                </div>
              </PopoverContent>
            </Popover>
          )}
        </div>
        {currentNodeId ? (
          <PlayerGraphView
            currentNodeId={currentNodeId}
            nodes={nodes}
            onNodeClick={onNodeClick}
            partyMembers={partyMembers}
            myCharacterId={myCharacterId}
          />
        ) : (
          <p className="text-xs text-muted-foreground italic">No locations mapped...</p>
        )}
      </div>

      {/* Map Legend */}
      <div className="border-t border-border pt-2">
        <h3 className="font-display text-[10px] text-muted-foreground mb-1">Legend</h3>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px]">
          <div className="flex items-center gap-1.5">
            <span className="text-primary text-[8px]">◆</span>
            <span className="text-muted-foreground">You are here</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[8px]">🪙</span>
            <span className="text-muted-foreground">Vendor</span>
          </div>
          <div className="flex items-center gap-1.5">
            <svg width="10" height="10"><circle cx="5" cy="5" r="4" className="fill-chart-2 stroke-background" strokeWidth={1} /></svg>
            <span className="text-muted-foreground">Party member</span>
          </div>
          <div className="flex items-center gap-1.5">
            <svg width="16" height="8"><line x1="0" y1="4" x2="16" y2="4" stroke="hsl(35 20% 35% / 0.4)" strokeWidth={1.5} strokeDasharray="4 3" /></svg>
            <span className="text-muted-foreground">Exit path</span>
          </div>
          <div className="flex items-center gap-1.5">
            <svg width="10" height="10"><circle cx="5" cy="5" r="4" fill="hsl(0 70% 50%)" className="stroke-background" strokeWidth={1} /></svg>
            <span className="text-muted-foreground">Aggressive</span>
          </div>
          <div className="flex items-center gap-1.5">
            <svg width="10" height="10"><circle cx="5" cy="5" r="4" fill="hsl(35 60% 50%)" className="stroke-background" strokeWidth={1} /></svg>
            <span className="text-muted-foreground">Creature</span>
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
        />
      </div>
    </div>
  );
}
