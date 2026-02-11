import { Region, GameNode } from '@/hooks/useNodes';

interface Props {
  regions: Region[];
  nodes: GameNode[];
  currentNodeId: string | null;
  currentRegionId: string | null;
  characterLevel: number;
  onNodeClick: (nodeId: string) => void;
}

export default function MapPanel({
  regions, nodes, currentNodeId, currentRegionId, characterLevel, onNodeClick,
}: Props) {
  const regionNodes = currentRegionId ? nodes.filter(n => n.region_id === currentRegionId) : [];

  return (
    <div className="h-full flex flex-col p-3 space-y-3 overflow-y-auto">
      {/* World Map (Layer 1) */}
      <div>
        <h3 className="font-display text-xs text-muted-foreground mb-1.5">World Map</h3>
        <div className="space-y-1">
          {regions.map(r => {
            const isAccessible = characterLevel >= r.min_level;
            const isCurrent = currentRegionId === r.id;
            return (
              <div
                key={r.id}
                className={`p-2 rounded border text-xs ${
                  isCurrent
                    ? 'border-primary bg-primary/10 text-primary'
                    : isAccessible
                    ? 'border-border bg-background/30 text-foreground/80'
                    : 'border-border/50 bg-background/10 text-muted-foreground/50'
                }`}
              >
                <div className="font-display">
                  {r.name}
                  {isCurrent && <span className="ml-1 text-[10px]">◆</span>}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  Lvl {r.min_level}–{r.max_level}
                  {!isAccessible && ' (Locked)'}
                </div>
              </div>
            );
          })}
          {regions.length === 0 && (
            <p className="text-xs text-muted-foreground italic">No regions discovered...</p>
          )}
        </div>
      </div>

      {/* Local Map (Layer 2) */}
      <div>
        <h3 className="font-display text-xs text-muted-foreground mb-1.5">Local Area</h3>
        <div className="space-y-1">
          {regionNodes.map(n => {
            const isCurrent = n.id === currentNodeId;
            // Check if this node is directly connected to the current node
            const currentNode = nodes.find(nd => nd.id === currentNodeId);
            const isConnected = currentNode?.connections?.some((c: any) => c.node_id === n.id);
            return (
              <button
                key={n.id}
                onClick={() => isConnected ? onNodeClick(n.id) : undefined}
                disabled={!isConnected && !isCurrent}
                className={`w-full text-left p-2 rounded border text-xs transition-colors ${
                  isCurrent
                    ? 'border-primary bg-primary/10 text-primary'
                    : isConnected
                    ? 'border-border bg-background/30 text-foreground/80 hover:border-primary/50 cursor-pointer'
                    : 'border-border/30 bg-background/10 text-muted-foreground/40'
                }`}
              >
                <div className="font-display">
                  {n.name}
                  {isCurrent && <span className="ml-1">◆</span>}
                  {n.is_vendor && <span className="ml-1 text-primary">🪙</span>}
                </div>
              </button>
            );
          })}
          {regionNodes.length === 0 && (
            <p className="text-xs text-muted-foreground italic">No locations mapped...</p>
          )}
        </div>
      </div>
    </div>
  );
}
