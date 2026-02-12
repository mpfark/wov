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
    </div>
  );
}
