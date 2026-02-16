import { useState } from 'react';
import { Region, GameNode } from '@/hooks/useNodes';
import { Party, PartyMember } from '@/hooks/useParty';
import { PlayerPresence } from '@/hooks/usePresence';
import { Character } from '@/hooks/useCharacter';
import PlayerGraphView from './PlayerGraphView';
import PlayerWorldMap from './PlayerWorldMap';
import PartyPanel from './PartyPanel';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

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
}

export default function MapPanel({
  regions, nodes, currentNodeId, currentRegionId, characterLevel, onNodeClick, partyMembers, myCharacterId,
  character, party, pendingInvites, isLeader, isTank, myMembership, playersHere,
  onCreateParty, onInvite, onAcceptInvite, onDeclineInvite, onLeaveParty, onKick, onSetTank, onToggleFollow,
}: Props) {
  const [tab, setTab] = useState<string>('local');
  const currentRegion = currentRegionId ? regions.find(r => r.id === currentRegionId) : null;

  return (
    <div className="h-full flex flex-col p-3 space-y-3 overflow-y-auto">
      {/* Tab Toggle */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="w-full h-8">
          <TabsTrigger value="local" className="flex-1 text-[11px] h-6">Local Area</TabsTrigger>
          <TabsTrigger value="world" className="flex-1 text-[11px] h-6">World Map</TabsTrigger>
        </TabsList>

        <TabsContent value="local" className="mt-2 space-y-3">
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

          {/* Local Map */}
          <div>
            <h3 className="font-display text-xs text-muted-foreground mb-1.5">Local Area</h3>
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
        </TabsContent>

        <TabsContent value="world" className="mt-2">
          <PlayerWorldMap
            regions={regions}
            nodes={nodes}
            currentNodeId={currentNodeId}
            currentRegionId={currentRegionId}
            partyMembers={partyMembers}
            myCharacterId={myCharacterId}
          />
        </TabsContent>
      </Tabs>

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
