import { useState, useMemo, useCallback } from 'react';
import { Plus } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';

interface GraphNode {
  id: string;
  name: string;
  is_vendor: boolean;
  connections: Array<{ node_id: string; direction: string; label?: string; hidden?: boolean }>;
  x: number;
  y: number;
}

interface Props {
  nodes: GraphNode[];
  onNodeClick: (nodeId: string) => void;
  onAddNodeAdjacent: (fromId: string, direction?: string) => void;
}

const DIRECTION_OFFSETS: Record<string, [number, number]> = {
  N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0],
  NE: [1, -1], NW: [-1, -1], SE: [1, 1], SW: [-1, 1],
};

export default function RegionGraphView({ nodes, onNodeClick, onAddNodeAdjacent }: Props) {
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

  const positions = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    for (const node of nodes) map.set(node.id, { x: node.x, y: node.y });
    return map;
  }, [nodes]);

  // Normalize positions to pixel space
  const { nodePositions, svgWidth, svgHeight } = useMemo(() => {
    if (positions.size === 0) return { nodePositions: new Map<string, { px: number; py: number }>(), svgWidth: 400, svgHeight: 300 };

    const SPACING = 160;
    const PADDING = 80;
    const vals = [...positions.values()];
    const minX = Math.min(...vals.map(p => p.x));
    const minY = Math.min(...vals.map(p => p.y));
    const maxX = Math.max(...vals.map(p => p.x));
    const maxY = Math.max(...vals.map(p => p.y));

    const np = new Map<string, { px: number; py: number }>();
    positions.forEach((pos, id) => {
      np.set(id, {
        px: (pos.x - minX) * SPACING + PADDING,
        py: (pos.y - minY) * SPACING + PADDING,
      });
    });

    return {
      nodePositions: np,
      svgWidth: (maxX - minX) * SPACING + PADDING * 2,
      svgHeight: (maxY - minY) * SPACING + PADDING * 2,
    };
  }, [positions]);

  // Collect edges (deduplicated)
  const edges = useMemo(() => {
    const edgeSet = new Set<string>();
    const result: Array<{ from: string; to: string; label?: string; hidden: boolean }> = [];
    for (const node of nodes) {
      for (const conn of node.connections) {
        const key = [node.id, conn.node_id].sort().join('-');
        if (!edgeSet.has(key) && nodePositions.has(conn.node_id)) {
          edgeSet.add(key);
          result.push({ from: node.id, to: conn.node_id, label: conn.label, hidden: !!conn.hidden });
        }
      }
    }
    return result;
  }, [nodes, nodePositions]);

  if (nodes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground gap-3">
        <p className="font-display text-sm">No nodes in this region</p>
        <button
          onClick={() => onAddNodeAdjacent('')}
          className="flex items-center gap-1 px-3 py-1.5 rounded border border-dashed border-primary/40 text-primary text-xs font-display hover:bg-primary/10 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" /> Create First Node
        </button>
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={200}>
      <div className="overflow-auto" style={{ maxHeight: 'calc(100vh - 160px)' }}>
        <svg
          width={Math.max(svgWidth, 400)}
          height={Math.max(svgHeight, 300)}
          className="block mx-auto"
        >
          {/* Edges */}
          {edges.map(edge => {
            const from = nodePositions.get(edge.from);
            const to = nodePositions.get(edge.to);
            if (!from || !to) return null;
            const midX = (from.px + to.px) / 2;
            const midY = (from.py + to.py) / 2;

            return (
              <g key={`${edge.from}-${edge.to}`}>
                <line
                  x1={from.px} y1={from.py} x2={to.px} y2={to.py}
                  stroke={edge.hidden ? 'hsl(280 50% 50% / 0.4)' : 'hsl(35 20% 35%)'}
                  strokeWidth={edge.hidden ? 1 : 2}
                  strokeDasharray={edge.hidden ? '4 4' : '6 3'}
                />
              </g>
            );
          })}

          {/* Nodes */}
          {nodes.map(node => {
            const pos = nodePositions.get(node.id);
            if (!pos) return null;
            const isHovered = hoveredNode === node.id;

            return (
              <g key={node.id}
                onMouseEnter={() => setHoveredNode(node.id)}
                onMouseLeave={() => setHoveredNode(null)}
              >
                {/* Node circle */}
                <circle
                  cx={pos.px} cy={pos.py} r={28}
                  className={`cursor-pointer transition-all duration-200 ${
                    isHovered
                      ? 'fill-primary/20 stroke-primary'
                      : 'fill-card stroke-border'
                  }`}
                  strokeWidth={isHovered ? 2.5 : 1.5}
                  onClick={() => onNodeClick(node.id)}
                />
                {node.is_vendor && (
                  <text x={pos.px} y={pos.py - 16} textAnchor="middle" className="text-[10px] select-none pointer-events-none">
                    🛒
                  </text>
                )}
                {/* Node name */}
                <text
                  x={pos.px} y={pos.py + 4}
                  textAnchor="middle"
                  className={`font-display text-[10px] pointer-events-none select-none ${
                    isHovered ? 'fill-primary' : 'fill-foreground'
                  }`}
                >
                  {node.name.length > 12 ? node.name.slice(0, 11) + '…' : node.name}
                </text>

                {/* Add adjacent node buttons (visible on hover) */}
                {isHovered && (() => {
                  const usedDirs = new Set(node.connections.map(c => c.direction));
                  const DIR_OFFSETS: Record<string, [number, number]> = {
                    N: [0, -38], NE: [27, -27], E: [38, 0], SE: [27, 27],
                    S: [0, 38], SW: [-27, 27], W: [-38, 0], NW: [-27, -27],
                  };
                  return Object.entries(DIR_OFFSETS)
                    .filter(([dir]) => !usedDirs.has(dir))
                    .map(([dir, [ox, oy]]) => (
                      <g key={dir} className="cursor-pointer"
                        onClick={e => { e.stopPropagation(); onAddNodeAdjacent(node.id, dir); }}
                      >
                        <circle cx={pos.px + ox} cy={pos.py + oy} r={9}
                          className="fill-background stroke-elvish hover:fill-elvish/10 transition-colors"
                          strokeWidth={1.5}
                        />
                        <text x={pos.px + ox} y={pos.py + oy + 1} textAnchor="middle"
                          className="fill-elvish text-[7px] font-bold pointer-events-none select-none">{dir}</text>
                      </g>
                    ));
                })()}
              </g>
            );
          })}
        </svg>
      </div>
    </TooltipProvider>
  );
}
