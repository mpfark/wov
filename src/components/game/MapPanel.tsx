import { Region, GameNode } from '@/hooks/useNodes';
import { PartyMember } from '@/hooks/useParty';
import PlayerGraphView from './PlayerGraphView';

interface Props {
  regions: Region[];
  nodes: GameNode[];
  currentNodeId: string | null;
  currentRegionId: string | null;
  characterLevel: number;
  onNodeClick: (nodeId: string) => void;
  partyMembers?: PartyMember[];
  myCharacterId?: string;
}

export default function MapPanel({
  regions, nodes, currentNodeId, currentRegionId, characterLevel, onNodeClick, partyMembers, myCharacterId,
}: Props) {
  const currentRegion = currentRegionId ? regions.find(r => r.id === currentRegionId) : null;

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
      <div className="flex-1 min-h-0">
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

      {/* Map Legend */}
      <div className="shrink-0 border-t border-border pt-2">
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
        </div>
      </div>
    </div>
  );
}
