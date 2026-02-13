import { useState, useMemo, useRef, useCallback } from 'react';
import { Plus } from 'lucide-react';
import { TooltipProvider } from '@/components/ui/tooltip';

interface GraphNode {
  id: string;
  name: string;
  region_id: string;
  is_vendor: boolean;
  is_inn: boolean;
  is_blacksmith: boolean;
  connections: Array<{ node_id: string; direction: string; label?: string }>;
}

interface Region {
  id: string;
  name: string;
  min_level: number;
  max_level: number;
}

interface Props {
  regions: Region[];
  nodes: GraphNode[];
  creatureCounts?: Map<string, { total: number; aggressive: number }>;
  onNodeClick: (nodeId: string) => void;
  onAddNodeBetween: (fromId: string, toId: string) => void;
  onAddNodeAdjacent: (fromId: string) => void;
}

const DIRECTION_OFFSETS: Record<string, [number, number]> = {
  N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0],
  NE: [1, -1], NW: [-1, -1], SE: [1, 1], SW: [-1, 1],
};

function layoutNodes(nodes: GraphNode[]) {
  if (nodes.length === 0) return new Map<string, { x: number; y: number }>();
  const positions = new Map<string, { x: number; y: number }>();
  const visited = new Set<string>();
  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  const queue: Array<{ id: string; x: number; y: number }> = [{ id: nodes[0].id, x: 0, y: 0 }];
  visited.add(nodes[0].id);
  positions.set(nodes[0].id, { x: 0, y: 0 });

  while (queue.length > 0) {
    const current = queue.shift()!;
    const node = nodeMap.get(current.id);
    if (!node) continue;
    for (const conn of node.connections) {
      if (visited.has(conn.node_id) || !nodeMap.has(conn.node_id)) continue;
      visited.add(conn.node_id);
      const offset = DIRECTION_OFFSETS[conn.direction] || [1, 0];
      let nx = current.x + offset[0];
      let ny = current.y + offset[1];
      // Avoid collisions: try shifting along the primary direction axis first,
      // then spiral outward if needed
      if ([...positions.values()].some(p => p.x === nx && p.y === ny)) {
        const primaryAxis = Math.abs(offset[0]) >= Math.abs(offset[1]) ? 'x' : 'y';
        let attempt = 1;
        let placed = false;
        while (!placed && attempt < 20) {
          // Try shifting perpendicular first, then along direction
          const candidates = primaryAxis === 'x'
            ? [
                { x: nx, y: ny + attempt },
                { x: nx, y: ny - attempt },
                { x: nx + (offset[0] >= 0 ? attempt : -attempt), y: ny },
              ]
            : [
                { x: nx + attempt, y: ny },
                { x: nx - attempt, y: ny },
                { x: nx, y: ny + (offset[1] >= 0 ? attempt : -attempt) },
              ];
          for (const c of candidates) {
            if (![...positions.values()].some(p => p.x === c.x && p.y === c.y)) {
              nx = c.x;
              ny = c.y;
              placed = true;
              break;
            }
          }
          attempt++;
        }
      }
      positions.set(conn.node_id, { x: nx, y: ny });
      queue.push({ id: conn.node_id, x: nx, y: ny });
    }
  }

  let row = 0;
  for (const node of nodes) {
    if (!positions.has(node.id)) {
      const maxX = Math.max(0, ...[...positions.values()].map(p => p.x));
      positions.set(node.id, { x: maxX + 2, y: row++ });
    }
  }
  return positions;
}

export default function AdminWorldMapView({ regions, nodes, creatureCounts, onNodeClick, onAddNodeBetween, onAddNodeAdjacent }: Props) {
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const allNodeMap = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom(z => Math.min(Math.max(z * delta, 0.2), 3));
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setIsPanning(true);
    panStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
  }, [pan]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning) return;
    setPan({
      x: panStart.current.panX + (e.clientX - panStart.current.x),
      y: panStart.current.panY + (e.clientY - panStart.current.y),
    });
  }, [isPanning]);

  const handleMouseUp = useCallback(() => setIsPanning(false), []);

  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  // Sort regions by min_level
  const sortedRegions = useMemo(() => [...regions].sort((a, b) => a.min_level - b.min_level), [regions]);

  // Group nodes by region
  const nodesByRegion = useMemo(() => {
    const map = new Map<string, GraphNode[]>();
    for (const r of regions) map.set(r.id, []);
    for (const n of nodes) {
      const list = map.get(n.region_id);
      if (list) list.push(n);
    }
    return map;
  }, [regions, nodes]);

  // Compute region bubble positions and internal node positions
  const { regionBubbles, allNodePositions, svgWidth, svgHeight } = useMemo(() => {
    const MIN_NODE_GAP = 90;
    const BUBBLE_PAD = 60;
    const REGION_GAP = 140;

    const bubbles: Array<{
      region: Region;
      cx: number;
      cy: number;
      radius: number;
      nodeCount: number;
    }> = [];

    const nodePos = new Map<string, { px: number; py: number }>();
    let cursorX = 0;

    for (let i = 0; i < sortedRegions.length; i++) {
      const region = sortedRegions[i];
      const rNodes = nodesByRegion.get(region.id) || [];

      // Layout nodes first at fixed spacing
      if (rNodes.length > 0) {
        const positions = layoutNodes(rNodes);
        const vals = [...positions.values()];
        // Convert grid positions to pixel positions with fixed gap
        const pixelPositions = new Map<string, { x: number; y: number }>();
        positions.forEach((pos, id) => {
          pixelPositions.set(id, { x: pos.x * MIN_NODE_GAP, y: pos.y * MIN_NODE_GAP });
        });

        const pVals = [...pixelPositions.values()];
        const minX = Math.min(...pVals.map(p => p.x));
        const minY = Math.min(...pVals.map(p => p.y));
        const maxX = Math.max(...pVals.map(p => p.x));
        const maxY = Math.max(...pVals.map(p => p.y));
        const bboxW = maxX - minX;
        const bboxH = maxY - minY;
        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;

        // Size bubble to fit nodes
        const radius = Math.max(160, Math.max(bboxW, bboxH) / 2 + BUBBLE_PAD);
        const cx = cursorX + radius;
        const cy = radius + 60 + (i % 2 === 1 ? 40 : 0);

        bubbles.push({ region, cx, cy, radius, nodeCount: rNodes.length });

        // Position nodes centered in bubble
        pixelPositions.forEach((pos, id) => {
          nodePos.set(id, {
            px: cx + (pos.x - centerX),
            py: cy + (pos.y - centerY),
          });
        });

        cursorX += radius * 2 + REGION_GAP;
      } else {
        const radius = 160;
        const cx = cursorX + radius;
        const cy = radius + 60 + (i % 2 === 1 ? 40 : 0);
        bubbles.push({ region, cx, cy, radius, nodeCount: 0 });
        cursorX += radius * 2 + REGION_GAP;
      }
    }

    const totalW = cursorX > 0 ? cursorX - REGION_GAP + 40 : 400;
    const maxBottom = bubbles.length > 0
      ? Math.max(...bubbles.map(b => b.cy + b.radius + 40))
      : 300;

    return {
      regionBubbles: bubbles,
      allNodePositions: nodePos,
      svgWidth: Math.max(totalW, 400),
      svgHeight: Math.max(maxBottom, 300),
    };
  }, [sortedRegions, nodesByRegion]);

  // Collect all edges (deduplicated), tagged as intra or cross-region
  const edges = useMemo(() => {
    const edgeSet = new Set<string>();
    const result: Array<{ from: string; to: string; label?: string; crossRegion: boolean }> = [];
    for (const node of nodes) {
      for (const conn of node.connections) {
        const key = [node.id, conn.node_id].sort().join('-');
        if (edgeSet.has(key)) continue;
        if (!allNodePositions.has(node.id) || !allNodePositions.has(conn.node_id)) continue;
        edgeSet.add(key);
        const targetNode = allNodeMap.get(conn.node_id);
        const crossRegion = !!targetNode && targetNode.region_id !== node.region_id;
        result.push({ from: node.id, to: conn.node_id, label: conn.label, crossRegion });
      }
    }
    return result;
  }, [nodes, allNodePositions, allNodeMap]);

  if (regions.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground font-display text-sm">
        No regions yet. Create one to get started.
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={200}>
      <div
        ref={containerRef}
        className="overflow-hidden relative cursor-grab active:cursor-grabbing w-full h-full"
        style={{ minHeight: '300px' }}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {/* Zoom controls */}
        <div className="absolute top-2 right-2 z-10 flex gap-1">
          <button onClick={() => setZoom(z => Math.min(z * 1.2, 3))}
            className="w-7 h-7 rounded bg-card border border-border text-xs font-bold hover:bg-accent transition-colors">+</button>
          <button onClick={() => setZoom(z => Math.max(z * 0.8, 0.2))}
            className="w-7 h-7 rounded bg-card border border-border text-xs font-bold hover:bg-accent transition-colors">−</button>
          <button onClick={resetView}
            className="h-7 px-2 rounded bg-card border border-border text-[10px] hover:bg-accent transition-colors">Reset</button>
        </div>
        <svg
          width="100%"
          height="100%"
          viewBox={`0 0 ${Math.max(svgWidth, 400)} ${Math.max(svgHeight, 300)}`}
          className="block w-full h-full"
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: 'center center' }}
        >
          {/* Region bubbles */}
          {regionBubbles.map(b => (
            <g key={b.region.id}>
              <circle
                cx={b.cx} cy={b.cy} r={b.radius}
                fill="hsl(35 20% 25% / 0.12)"
                stroke="hsl(35 20% 40% / 0.4)"
                strokeWidth={1.5}
                strokeDasharray="8 4"
              />
              {/* Region label */}
              <text
                x={b.cx} y={b.cy - b.radius - 8}
                textAnchor="middle"
                className="fill-primary font-display text-xs"
              >
                {b.region.name}
              </text>
              <text
                x={b.cx} y={b.cy - b.radius + 6}
                textAnchor="middle"
                className="fill-muted-foreground text-[9px]"
              >
                Lvl {b.region.min_level}–{b.region.max_level} · {b.nodeCount} nodes
              </text>

              {/* Empty region: add node button */}
              {b.nodeCount === 0 && (
                <g
                  className="cursor-pointer"
                  onClick={() => onAddNodeAdjacent('')}
                >
                  <circle cx={b.cx} cy={b.cy} r={14}
                    className="fill-background stroke-primary/50 hover:stroke-primary hover:fill-primary/10 transition-colors"
                    strokeWidth={1.5}
                  />
                  <text x={b.cx} y={b.cy + 4} textAnchor="middle"
                    className="fill-primary text-xs font-bold pointer-events-none select-none">+</text>
                </g>
              )}
            </g>
          ))}

          {/* Edges */}
          {edges.map(edge => {
            const from = allNodePositions.get(edge.from);
            const to = allNodePositions.get(edge.to);
            if (!from || !to) return null;
            const midX = (from.px + to.px) / 2;
            const midY = (from.py + to.py) / 2;

            return (
              <g key={`${edge.from}-${edge.to}`}>
                <line
                  x1={from.px} y1={from.py} x2={to.px} y2={to.py}
                  stroke={edge.crossRegion ? 'hsl(200 50% 50% / 0.6)' : 'hsl(35 20% 35%)'}
                  strokeWidth={edge.crossRegion ? 2.5 : 1.5}
                  strokeDasharray={edge.crossRegion ? '10 5' : '6 3'}
                />
                {edge.label && (
                  <text x={midX} y={midY - 10} textAnchor="middle"
                    className="fill-muted-foreground text-[8px]">
                    {edge.label}
                  </text>
                )}
                {/* Plus button on edge midpoint */}
                <g
                  className="cursor-pointer"
                  onClick={e => { e.stopPropagation(); onAddNodeBetween(edge.from, edge.to); }}
                >
                  <circle cx={midX} cy={midY} r={8}
                    className="fill-background stroke-primary/50 hover:stroke-primary hover:fill-primary/10 transition-colors"
                    strokeWidth={1}
                  />
                  <text x={midX} y={midY + 3} textAnchor="middle"
                    className="fill-primary text-[9px] font-bold pointer-events-none select-none">+</text>
                </g>
              </g>
            );
          })}

          {/* Nodes */}
          {nodes.map(node => {
            const pos = allNodePositions.get(node.id);
            if (!pos) return null;
            const isHovered = hoveredNode === node.id;

            return (
              <g key={node.id}
                onMouseEnter={() => setHoveredNode(node.id)}
                onMouseLeave={() => setHoveredNode(null)}
              >
                <circle
                  cx={pos.px} cy={pos.py} r={28}
                  className={`cursor-pointer transition-all duration-200 ${
                    isHovered ? 'fill-primary/20 stroke-primary' : 'fill-card stroke-border'
                  }`}
                  strokeWidth={isHovered ? 2.5 : 1.5}
                  onClick={() => onNodeClick(node.id)}
                />
                {/* Icon markers row above node */}
                {(node.is_vendor || node.is_inn || node.is_blacksmith) && (
                  <text x={pos.px} y={pos.py - 12} textAnchor="middle" className="text-[8px] select-none pointer-events-none">
                    {node.is_vendor ? '🛒' : ''}{node.is_inn ? '🏨' : ''}{node.is_blacksmith ? '🔨' : ''}
                  </text>
                )}
                {/* Creature dots below node */}
                {(() => {
                  const cc = creatureCounts?.get(node.id);
                  if (!cc || cc.total === 0) return null;
                  return (
                    <g>
                      {cc.aggressive > 0 && (
                        <circle cx={pos.px - 6} cy={pos.py + 18} r={4}
                          fill="hsl(0 70% 50%)" className="stroke-background" strokeWidth={1} />
                      )}
                      {cc.total - cc.aggressive > 0 && (
                        <circle cx={pos.px + (cc.aggressive > 0 ? 6 : 0)} cy={pos.py + 18} r={4}
                          fill="hsl(35 60% 50%)" className="stroke-background" strokeWidth={1} />
                      )}
                      <text x={pos.px} y={pos.py + 30} textAnchor="middle"
                        className="fill-muted-foreground text-[7px] select-none pointer-events-none">
                        {cc.total}
                      </text>
                    </g>
                  );
                })()}
                <text
                  x={pos.px} y={pos.py + 3}
                  textAnchor="middle"
                  className={`font-display text-[10px] pointer-events-none select-none ${
                    isHovered ? 'fill-primary' : 'fill-foreground'
                  }`}
                >
                  {node.name.length > 12 ? node.name.slice(0, 11) + '…' : node.name}
                </text>

                {/* Add adjacent node button on hover */}
                {isHovered && (
                  <g
                    className="cursor-pointer"
                    onClick={e => { e.stopPropagation(); onAddNodeAdjacent(node.id); }}
                  >
                    <circle cx={pos.px + 32} cy={pos.py - 22} r={9}
                      className="fill-background stroke-elvish hover:fill-elvish/10 transition-colors"
                      strokeWidth={1.5}
                    />
                    <text x={pos.px + 32} y={pos.py - 18} textAnchor="middle"
                      className="fill-elvish text-[10px] font-bold pointer-events-none select-none">+</text>
                  </g>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </TooltipProvider>
  );
}
