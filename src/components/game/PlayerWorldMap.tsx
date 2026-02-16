import { useState, useMemo, useRef, useCallback } from 'react';
import { GameNode, Region } from '@/hooks/useNodes';
import { PartyMember } from '@/hooks/useParty';

interface Props {
  regions: Region[];
  nodes: GameNode[];
  currentNodeId: string | null;
  currentRegionId: string | null;
  partyMembers?: PartyMember[];
  myCharacterId?: string;
}

const DIRECTION_OFFSETS: Record<string, [number, number]> = {
  N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0],
  NE: [1, -1], NW: [-1, -1], SE: [1, 1], SW: [-1, 1],
};

function layoutNodes(nodes: GameNode[]) {
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
      if (conn.hidden) continue;
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
            ? [{ x: nx, y: ny + attempt }, { x: nx, y: ny - attempt }, { x: nx + (offset[0] >= 0 ? attempt : -attempt), y: ny }]
            : [{ x: nx + attempt, y: ny }, { x: nx - attempt, y: ny }, { x: nx, y: ny + (offset[1] >= 0 ? attempt : -attempt) }];
          for (const c of candidates) {
            if (![...positions.values()].some(p => p.x === c.x && p.y === c.y)) {
              nx = c.x; ny = c.y; placed = true; break;
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

export default function PlayerWorldMap({ regions, nodes, currentNodeId, currentRegionId, partyMembers, myCharacterId }: Props) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const panStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setZoom(z => Math.min(Math.max(z * (e.deltaY > 0 ? 0.9 : 1.1), 0.3), 3));
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
    setTimeout(() => setIsAnimating(false), 450);
  }, []);

  // Group nodes by region
  const nodesByRegion = useMemo(() => {
    const map = new Map<string, GameNode[]>();
    for (const r of regions) map.set(r.id, []);
    for (const n of nodes) {
      const list = map.get(n.region_id);
      if (list) list.push(n);
    }
    return map;
  }, [regions, nodes]);

  // Party member positions (which node each member is on)
  const partyNodeIds = useMemo(() => {
    if (!partyMembers || !myCharacterId) return new Set<string>();
    // We don't have node info on partyMembers directly, so skip for now
    return new Set<string>();
  }, [partyMembers, myCharacterId]);

  // Compute layout
  const { regionBubbles, allNodePositions, canvasW, canvasH } = useMemo(() => {
    const MIN_NODE_GAP = 90;
    const BUBBLE_PAD = 60;

    const bubbleData: Array<{
      region: Region; cx: number; cy: number; radius: number; nodeCount: number;
      nodeLayout: Map<string, { x: number; y: number }> | null;
      centerX: number; centerY: number;
    }> = [];

    regions.forEach((region, idx) => {
      const col = idx % 5;
      const row = Math.floor(idx / 5);
      const coord = { x: 200 + col * 350, y: 200 + row * 350 };
      const rNodes = nodesByRegion.get(region.id) || [];

      if (rNodes.length > 0) {
        const positions = layoutNodes(rNodes);
        const pixelPositions = new Map<string, { x: number; y: number }>();
        positions.forEach((pos, id) => pixelPositions.set(id, { x: pos.x * MIN_NODE_GAP, y: pos.y * MIN_NODE_GAP }));

        const pVals = [...pixelPositions.values()];
        const minX = Math.min(...pVals.map(p => p.x));
        const minY = Math.min(...pVals.map(p => p.y));
        const maxX = Math.max(...pVals.map(p => p.x));
        const maxY = Math.max(...pVals.map(p => p.y));

        const radius = Math.max(120, Math.max(maxX - minX, maxY - minY) / 2 + BUBBLE_PAD);
        bubbleData.push({
          region, cx: coord.x, cy: coord.y, radius, nodeCount: rNodes.length,
          nodeLayout: pixelPositions, centerX: (minX + maxX) / 2, centerY: (minY + maxY) / 2,
        });
      } else {
        bubbleData.push({
          region, cx: coord.x, cy: coord.y, radius: 120, nodeCount: 0,
          nodeLayout: null, centerX: 0, centerY: 0,
        });
      }
    });

    // Collision resolution
    const PADDING = 30;
    for (let iter = 0; iter < 50; iter++) {
      let moved = false;
      for (let i = 0; i < bubbleData.length; i++) {
        for (let j = i + 1; j < bubbleData.length; j++) {
          const a = bubbleData[i], b = bubbleData[j];
          const dx = b.cx - a.cx, dy = b.cy - a.cy;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const minDist = a.radius + b.radius + PADDING;
          if (dist < minDist && dist > 0) {
            const overlap = (minDist - dist) / 2;
            const nx = dx / dist, ny = dy / dist;
            a.cx -= nx * overlap; a.cy -= ny * overlap;
            b.cx += nx * overlap; b.cy += ny * overlap;
            moved = true;
          } else if (dist === 0) {
            a.cx -= 50; b.cx += 50; moved = true;
          }
        }
      }
      if (!moved) break;
    }

    // Normalize positions
    const MARGIN = 20;
    let shiftX = 0, shiftY = 0;
    for (const bd of bubbleData) {
      shiftX = Math.max(shiftX, MARGIN + bd.radius - bd.cx);
      shiftY = Math.max(shiftY, MARGIN + bd.radius - bd.cy);
    }
    if (shiftX > 0 || shiftY > 0) {
      for (const bd of bubbleData) { bd.cx += shiftX; bd.cy += shiftY; }
    }

    let maxRight = 0, maxBottom = 0;
    for (const bd of bubbleData) {
      maxRight = Math.max(maxRight, bd.cx + bd.radius + MARGIN);
      maxBottom = Math.max(maxBottom, bd.cy + bd.radius + MARGIN);
    }

    const bubbles: Array<{ region: Region; cx: number; cy: number; radius: number; nodeCount: number }> = [];
    const nodePos = new Map<string, { px: number; py: number }>();

    for (const bd of bubbleData) {
      bubbles.push({ region: bd.region, cx: bd.cx, cy: bd.cy, radius: bd.radius, nodeCount: bd.nodeCount });
      if (bd.nodeLayout) {
        bd.nodeLayout.forEach((pos, id) => {
          nodePos.set(id, { px: bd.cx + (pos.x - bd.centerX), py: bd.cy + (pos.y - bd.centerY) });
        });
      }
    }

    return { regionBubbles: bubbles, allNodePositions: nodePos, canvasW: Math.max(maxRight, 600), canvasH: Math.max(maxBottom, 400) };
  }, [regions, nodesByRegion]);

  // Edges (exclude hidden)
  const edges = useMemo(() => {
    const edgeSet = new Set<string>();
    const result: Array<{ from: string; to: string; crossRegion: boolean }> = [];
    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    for (const node of nodes) {
      for (const conn of node.connections) {
        if (conn.hidden) continue;
        const key = [node.id, conn.node_id].sort().join('-');
        if (edgeSet.has(key)) continue;
        if (!allNodePositions.has(node.id) || !allNodePositions.has(conn.node_id)) continue;
        edgeSet.add(key);
        const target = nodeMap.get(conn.node_id);
        result.push({ from: node.id, to: conn.node_id, crossRegion: !!target && target.region_id !== node.region_id });
      }
    }
    return result;
  }, [nodes, allNodePositions]);

  // Zoom to region on click
  const zoomToRegion = useCallback((regionId: string) => {
    const bubble = regionBubbles.find(b => b.region.id === regionId);
    if (!bubble || !containerRef.current) return;
    const cw = containerRef.current.clientWidth;
    const ch = containerRef.current.clientHeight;
    const svgScale = Math.min(cw / canvasW, ch / canvasH);
    const svgOffsetX = (cw - canvasW * svgScale) / 2;
    const svgOffsetY = (ch - canvasH * svgScale) / 2;
    const bx = svgOffsetX + bubble.cx * svgScale;
    const by = svgOffsetY + bubble.cy * svgScale;
    const regionScreenSize = bubble.radius * 2 * svgScale;
    const targetZoom = Math.min(Math.max(Math.min(cw, ch) * 0.6 / regionScreenSize, 0.5), 3);
    setIsAnimating(true);
    setZoom(targetZoom);
    setPan({ x: cw / 2 - bx * targetZoom, y: ch / 2 - by * targetZoom });
    setTimeout(() => setIsAnimating(false), 450);
  }, [regionBubbles, canvasW, canvasH]);

  if (regions.length === 0) {
    return <p className="text-xs text-muted-foreground italic p-2">No world data available...</p>;
  }

  return (
    <div
      ref={containerRef}
      className="relative overflow-hidden cursor-grab active:cursor-grabbing rounded border border-border bg-card/30"
      style={{ height: '320px' }}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* Zoom controls */}
      <div className="absolute top-1.5 right-1.5 z-10 flex gap-0.5">
        <button onClick={() => setZoom(z => Math.min(z * 1.2, 3))}
          className="w-5 h-5 rounded bg-card border border-border text-[10px] font-bold hover:bg-accent transition-colors">+</button>
        <button onClick={() => setZoom(z => Math.max(z * 0.8, 0.3))}
          className="w-5 h-5 rounded bg-card border border-border text-[10px] font-bold hover:bg-accent transition-colors">−</button>
        <button onClick={resetView}
          className="h-5 px-1.5 rounded bg-card border border-border text-[8px] hover:bg-accent transition-colors">Reset</button>
      </div>

      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${canvasW} ${canvasH}`}
        preserveAspectRatio="xMidYMid meet"
        className="block w-full h-full"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: '0 0',
          transition: isAnimating ? 'transform 0.4s ease' : 'none',
        }}
      >
        {/* Region bubbles */}
        {regionBubbles.map(b => {
          const isCurrent = currentRegionId === b.region.id;
          return (
            <g key={b.region.id} className="cursor-pointer" onClick={() => zoomToRegion(b.region.id)}>
              <circle
                cx={b.cx} cy={b.cy} r={b.radius}
                fill={isCurrent ? 'hsl(35 20% 25% / 0.25)' : 'hsl(35 20% 25% / 0.12)'}
                stroke={isCurrent ? 'hsl(35 40% 55% / 0.8)' : 'hsl(35 20% 40% / 0.4)'}
                strokeWidth={isCurrent ? 2.5 : 1.5}
                strokeDasharray="8 4"
              />
              <text x={b.cx} y={b.cy - b.radius - 6} textAnchor="middle"
                className={`font-display text-[10px] ${isCurrent ? 'fill-primary' : 'fill-muted-foreground'}`}>
                {b.region.name}
              </text>
              <text x={b.cx} y={b.cy - b.radius + 6} textAnchor="middle"
                className="fill-muted-foreground text-[8px]">
                Lvl {b.region.min_level}–{b.region.max_level}
              </text>
            </g>
          );
        })}

        {/* Edges */}
        {edges.map(edge => {
          const from = allNodePositions.get(edge.from);
          const to = allNodePositions.get(edge.to);
          if (!from || !to) return null;
          return (
            <line key={`${edge.from}-${edge.to}`}
              x1={from.px} y1={from.py} x2={to.px} y2={to.py}
              stroke={edge.crossRegion ? 'hsl(200 50% 50% / 0.5)' : 'hsl(35 20% 35% / 0.4)'}
              strokeWidth={edge.crossRegion ? 2 : 1}
              strokeDasharray={edge.crossRegion ? '8 4' : '4 3'}
            />
          );
        })}

        {/* Node dots */}
        {nodes.map(node => {
          const pos = allNodePositions.get(node.id);
          if (!pos) return null;
          const isCurrent = node.id === currentNodeId;
          return (
            <g key={node.id}>
              {isCurrent && (
                <circle cx={pos.px} cy={pos.py} r={12}
                  fill="none" stroke="hsl(35 80% 55% / 0.4)" strokeWidth={2}>
                  <animate attributeName="r" values="10;14;10" dur="2s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="1;0.4;1" dur="2s" repeatCount="indefinite" />
                </circle>
              )}
              <circle
                cx={pos.px} cy={pos.py} r={isCurrent ? 6 : 4}
                fill={isCurrent ? 'hsl(35 80% 55%)' : 'hsl(35 20% 50% / 0.6)'}
                className="stroke-background" strokeWidth={1}
              />
              {isCurrent && (
                <text x={pos.px} y={pos.py - 10} textAnchor="middle"
                  className="fill-primary font-display text-[8px] select-none pointer-events-none">
                  ◆ You
                </text>
              )}
              {node.is_vendor && (
                <text x={pos.px + 8} y={pos.py - 4} className="text-[7px] select-none pointer-events-none">🪙</text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
