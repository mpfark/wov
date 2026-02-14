import { useState, useMemo, useRef, useCallback } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MapPin } from 'lucide-react';

interface GraphNode {
  id: string;
  name: string;
  region_id: string;
  is_vendor: boolean;
  is_inn: boolean;
  is_blacksmith: boolean;
  connections: Array<{ node_id: string; direction: string; label?: string; hidden?: boolean }>;
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
  npcCounts?: Map<string, number>;
  onNodeClick: (nodeId: string) => void;
  onAddNodeBetween: (fromId: string, toId: string) => void;
  onAddNodeAdjacent: (fromId: string) => void;
}

// Geographic coordinates for known Middle-earth regions on a ~2000x1200 canvas
const REGION_COORDINATES: Record<string, { x: number; y: number }> = {
  'The Shire':       { x: 250,  y: 500 },
  'Bree-land':       { x: 550,  y: 450 },
  'The Lone-lands':  { x: 900,  y: 420 },
  'The Trollshaws':  { x: 1250, y: 380 },
  'Rivendell':       { x: 1600, y: 350 },
  // Future regions
  'Moria':           { x: 1500, y: 650 },
  'Rohan':           { x: 1200, y: 800 },
  'Gondor':          { x: 1400, y: 1000 },
  'Mordor':          { x: 1700, y: 900 },
  'Fangorn':         { x: 1050, y: 650 },
  'Isengard':        { x: 950,  y: 750 },
  'The Misty Mountains': { x: 1400, y: 500 },
};

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
      if ([...positions.values()].some(p => p.x === nx && p.y === ny)) {
        const primaryAxis = Math.abs(offset[0]) >= Math.abs(offset[1]) ? 'x' : 'y';
        let attempt = 1;
        let placed = false;
        while (!placed && attempt < 20) {
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

// Canvas dimensions
const CANVAS_W = 2000;
const CANVAS_H = 1200;

export default function AdminWorldMapView({ regions, nodes, creatureCounts, npcCounts, onNodeClick, onAddNodeBetween, onAddNodeAdjacent }: Props) {
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
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
    setIsAnimating(true);
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setSelectedRegionId(null);
    setTimeout(() => setIsAnimating(false), 450);
  }, []);

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

  // Get geographic coordinate for a region, with fallback
  const getRegionCoord = useCallback((region: Region, index: number) => {
    const known = REGION_COORDINATES[region.name];
    if (known) return known;
    // Fallback: place unknown regions in a grid at the bottom
    const col = index % 5;
    const row = Math.floor(index / 5);
    return { x: 200 + col * 350, y: 900 + row * 250 };
  }, []);

  // Compute region bubbles and node positions using geographic coordinates
  const { regionBubbles, allNodePositions } = useMemo(() => {
    const MIN_NODE_GAP = 90;
    const BUBBLE_PAD = 60;

    const bubbles: Array<{
      region: Region;
      cx: number;
      cy: number;
      radius: number;
      nodeCount: number;
    }> = [];

    const nodePos = new Map<string, { px: number; py: number }>();

    // First pass: compute bubble sizes and initial positions
    const bubbleData: Array<{
      region: Region;
      cx: number;
      cy: number;
      radius: number;
      nodeCount: number;
      nodeLayout: Map<string, { x: number; y: number }> | null;
      centerX: number;
      centerY: number;
    }> = [];

    regions.forEach((region, idx) => {
      const coord = getRegionCoord(region, idx);
      const rNodes = nodesByRegion.get(region.id) || [];

      if (rNodes.length > 0) {
        const positions = layoutNodes(rNodes);
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

        const radius = Math.max(160, Math.max(bboxW, bboxH) / 2 + BUBBLE_PAD);
        bubbleData.push({
          region, cx: coord.x, cy: coord.y, radius, nodeCount: rNodes.length,
          nodeLayout: pixelPositions,
          centerX: (minX + maxX) / 2,
          centerY: (minY + maxY) / 2,
        });
      } else {
        bubbleData.push({
          region, cx: coord.x, cy: coord.y, radius: 160, nodeCount: 0,
          nodeLayout: null, centerX: 0, centerY: 0,
        });
      }
    });

    // Collision resolution: iteratively nudge overlapping bubbles apart
    const PADDING = 30; // min gap between bubble edges
    for (let iter = 0; iter < 50; iter++) {
      let moved = false;
      for (let i = 0; i < bubbleData.length; i++) {
        for (let j = i + 1; j < bubbleData.length; j++) {
          const a = bubbleData[i];
          const b = bubbleData[j];
          const dx = b.cx - a.cx;
          const dy = b.cy - a.cy;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const minDist = a.radius + b.radius + PADDING;
          if (dist < minDist && dist > 0) {
            const overlap = (minDist - dist) / 2;
            const nx = dx / dist;
            const ny = dy / dist;
            a.cx -= nx * overlap;
            a.cy -= ny * overlap;
            b.cx += nx * overlap;
            b.cy += ny * overlap;
            moved = true;
          } else if (dist === 0) {
            // Coincident: push apart arbitrarily
            a.cx -= 50;
            b.cx += 50;
            moved = true;
          }
        }
      }
      if (!moved) break;
    }

    // Build final bubbles and node positions from resolved coordinates
    for (const bd of bubbleData) {
      bubbles.push({ region: bd.region, cx: bd.cx, cy: bd.cy, radius: bd.radius, nodeCount: bd.nodeCount });
      if (bd.nodeLayout) {
        bd.nodeLayout.forEach((pos, id) => {
          nodePos.set(id, {
            px: bd.cx + (pos.x - bd.centerX),
            py: bd.cy + (pos.y - bd.centerY),
          });
        });
      }
    }

    return { regionBubbles: bubbles, allNodePositions: nodePos };
  }, [regions, nodesByRegion, getRegionCoord]);

  // Zoom to a specific region
  const zoomToRegion = useCallback((regionId: string) => {
    const bubble = regionBubbles.find(b => b.region.id === regionId);
    if (!bubble || !containerRef.current) return;

    const container = containerRef.current;
    const cw = container.clientWidth;
    const ch = container.clientHeight;

    // Calculate zoom so region fills ~60% of viewport
    const targetZoom = Math.min(cw, ch) / (bubble.radius * 3.5);
    const clampedZoom = Math.min(Math.max(targetZoom, 0.3), 3);

    // Calculate pan to center the bubble
    const targetPanX = cw / 2 - bubble.cx * clampedZoom;
    const targetPanY = ch / 2 - bubble.cy * clampedZoom;

    setIsAnimating(true);
    setZoom(clampedZoom);
    setPan({ x: targetPanX, y: targetPanY });
    setSelectedRegionId(regionId);
    setTimeout(() => setIsAnimating(false), 450);
  }, [regionBubbles]);

  // Collect all edges
  const edges = useMemo(() => {
    const edgeSet = new Set<string>();
    const result: Array<{ from: string; to: string; label?: string; crossRegion: boolean; hidden: boolean }> = [];
    for (const node of nodes) {
      for (const conn of node.connections) {
        const key = [node.id, conn.node_id].sort().join('-');
        if (edgeSet.has(key)) continue;
        if (!allNodePositions.has(node.id) || !allNodePositions.has(conn.node_id)) continue;
        edgeSet.add(key);
        const targetNode = allNodeMap.get(conn.node_id);
        const crossRegion = !!targetNode && targetNode.region_id !== node.region_id;
        result.push({ from: node.id, to: conn.node_id, label: conn.label, crossRegion, hidden: !!conn.hidden });
      }
    }
    return result;
  }, [nodes, allNodePositions, allNodeMap]);

  // Sort regions by min_level for sidebar
  const sortedRegions = useMemo(() => [...regions].sort((a, b) => a.min_level - b.min_level), [regions]);

  if (regions.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground font-display text-sm">
        No regions yet. Create one to get started.
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex h-full w-full">
        {/* Map area */}
        <div
          ref={containerRef}
          className="overflow-hidden relative cursor-grab active:cursor-grabbing flex-1"
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
            viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
            className="block w-full h-full"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: '0 0',
              transition: isAnimating ? 'transform 0.4s ease' : 'none',
            }}
          >
            {/* Region bubbles */}
            {regionBubbles.map(b => {
              const isSelected = selectedRegionId === b.region.id;
              return (
                <g key={b.region.id}>
                  <circle
                    cx={b.cx} cy={b.cy} r={b.radius}
                    fill={isSelected ? 'hsl(35 20% 25% / 0.2)' : 'hsl(35 20% 25% / 0.12)'}
                    stroke={isSelected ? 'hsl(35 40% 55% / 0.7)' : 'hsl(35 20% 40% / 0.4)'}
                    strokeWidth={isSelected ? 2.5 : 1.5}
                    strokeDasharray="8 4"
                  />
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

                  {b.nodeCount === 0 && (
                    <g className="cursor-pointer" onClick={() => onAddNodeAdjacent('')}>
                      <circle cx={b.cx} cy={b.cy} r={14}
                        className="fill-background stroke-primary/50 hover:stroke-primary hover:fill-primary/10 transition-colors"
                        strokeWidth={1.5}
                      />
                      <text x={b.cx} y={b.cy + 4} textAnchor="middle"
                        className="fill-primary text-xs font-bold pointer-events-none select-none">+</text>
                    </g>
                  )}
                </g>
              );
            })}

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
                    stroke={edge.hidden ? 'hsl(280 50% 50% / 0.4)' : edge.crossRegion ? 'hsl(200 50% 50% / 0.6)' : 'hsl(35 20% 35%)'}
                    strokeWidth={edge.hidden ? 1 : edge.crossRegion ? 2.5 : 1.5}
                    strokeDasharray={edge.hidden ? '4 4' : edge.crossRegion ? '10 5' : '6 3'}
                  />
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
                  {(node.is_vendor || node.is_inn || node.is_blacksmith) && (
                    <text x={pos.px} y={pos.py - 12} textAnchor="middle" className="text-[8px] select-none pointer-events-none">
                      {node.is_vendor ? '🛒' : ''}{node.is_inn ? '🏨' : ''}{node.is_blacksmith ? '🔨' : ''}
                    </text>
                  )}
                  {(() => {
                    const cc = creatureCounts?.get(node.id);
                    const nc = npcCounts?.get(node.id) || 0;
                    if ((!cc || cc.total === 0) && nc === 0) return null;
                    return (
                      <g>
                        {cc && cc.aggressive > 0 && (
                          <circle cx={pos.px - 6} cy={pos.py + 18} r={4}
                            fill="hsl(0 70% 50%)" className="stroke-background" strokeWidth={1} />
                        )}
                        {cc && cc.total - cc.aggressive > 0 && (
                          <circle cx={pos.px + (cc.aggressive > 0 ? 6 : 0)} cy={pos.py + 18} r={4}
                            fill="hsl(35 60% 50%)" className="stroke-background" strokeWidth={1} />
                        )}
                        {nc > 0 && (
                          <text x={pos.px + 14} y={pos.py + 22} className="text-[8px] select-none pointer-events-none">💬</text>
                        )}
                        <text x={pos.px} y={pos.py + 34} textAnchor="middle"
                          className="fill-muted-foreground text-[7px] select-none pointer-events-none">
                          {(cc?.total || 0) > 0 ? `${cc!.total}c` : ''}{nc > 0 ? ` ${nc}n` : ''}
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

        {/* Region sidebar */}
        <div className="w-48 border-l border-border bg-card/50 flex flex-col">
          <div className="px-3 py-2 border-b border-border">
            <h3 className="font-display text-xs text-primary">Regions</h3>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-1">
              {sortedRegions.map(region => {
                const nodeCount = nodesByRegion.get(region.id)?.length || 0;
                const isSelected = selectedRegionId === region.id;
                return (
                  <button
                    key={region.id}
                    onClick={() => zoomToRegion(region.id)}
                    className={`w-full text-left px-2.5 py-2 rounded text-xs transition-colors ${
                      isSelected
                        ? 'bg-primary/15 text-primary'
                        : 'hover:bg-accent text-foreground'
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <MapPin className="w-3 h-3 shrink-0 text-muted-foreground" />
                      <span className="font-display truncate">{region.name}</span>
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5 pl-[18px]">
                      Lvl {region.min_level}–{region.max_level} · {nodeCount} nodes
                    </div>
                  </button>
                );
              })}
            </div>
          </ScrollArea>
        </div>
      </div>
    </TooltipProvider>
  );
}
