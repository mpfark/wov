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
  direction?: string | null;
  sort_order?: number;
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

const HEARTHLANDS_ID = '00000000-0000-0000-0000-000000000001';

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

// ---- Convex Hull (Graham Scan) ----
function convexHull(points: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> {
  if (points.length <= 1) return [...points];
  if (points.length === 2) return [...points];

  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);

  const cross = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const lower: Array<{ x: number; y: number }> = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Array<{ x: number; y: number }> = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function expandHull(hull: Array<{ x: number; y: number }>, padding: number): Array<{ x: number; y: number }> {
  if (hull.length < 3) {
    // For 1-2 points, create a circle-like polygon
    const cx = hull.reduce((s, p) => s + p.x, 0) / hull.length;
    const cy = hull.reduce((s, p) => s + p.y, 0) / hull.length;
    const steps = 12;
    return Array.from({ length: steps }, (_, i) => {
      const angle = (2 * Math.PI * i) / steps;
      return { x: cx + Math.cos(angle) * padding, y: cy + Math.sin(angle) * padding };
    });
  }

  // Offset each edge outward by `padding` along its outward normal, then intersect adjacent offset edges
  const n = hull.length;
  const offsetEdges: Array<{ ax: number; ay: number; bx: number; by: number }> = [];

  for (let i = 0; i < n; i++) {
    const p1 = hull[i];
    const p2 = hull[(i + 1) % n];
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    // Outward normal (for CCW hull, outward is to the right of the edge direction)
    const nx = dy / len;
    const ny = -dx / len;
    offsetEdges.push({
      ax: p1.x + nx * padding,
      ay: p1.y + ny * padding,
      bx: p2.x + nx * padding,
      by: p2.y + ny * padding,
    });
  }

  // Intersect consecutive offset edges to get new vertices
  const result: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < n; i++) {
    const e1 = offsetEdges[i];
    const e2 = offsetEdges[(i + 1) % n];
    const pt = lineIntersection(e1.ax, e1.ay, e1.bx, e1.by, e2.ax, e2.ay, e2.bx, e2.by);
    if (pt) {
      result.push(pt);
    } else {
      // Parallel edges, just use the endpoint
      result.push({ x: e1.bx, y: e1.by });
    }
  }
  return result;
}

function lineIntersection(
  x1: number, y1: number, x2: number, y2: number,
  x3: number, y3: number, x4: number, y4: number
): { x: number; y: number } | null {
  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(denom) < 1e-10) return null;
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
  return { x: x1 + t * (x2 - x1), y: y1 + t * (y2 - y1) };
}

function hullToPath(hull: Array<{ x: number; y: number }>): string {
  if (hull.length === 0) return '';
  // Smooth path using cubic bezier through hull points
  if (hull.length < 3) {
    return `M ${hull.map(p => `${p.x},${p.y}`).join(' L ')} Z`;
  }
  // Create smooth closed path
  let d = `M ${hull[0].x},${hull[0].y}`;
  for (let i = 0; i < hull.length; i++) {
    const p0 = hull[(i - 1 + hull.length) % hull.length];
    const p1 = hull[i];
    const p2 = hull[(i + 1) % hull.length];
    const p3 = hull[(i + 2) % hull.length];

    const tension = 0.3;
    const cp1x = p1.x + (p2.x - p0.x) * tension;
    const cp1y = p1.y + (p2.y - p0.y) * tension;
    const cp2x = p2.x - (p3.x - p1.x) * tension;
    const cp2y = p2.y - (p3.y - p1.y) * tension;

    d += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`;
  }
  d += ' Z';
  return d;
}

function hullBBox(hull: Array<{ x: number; y: number }>) {
  const xs = hull.map(p => p.x);
  const ys = hull.map(p => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return { minX, minY, maxX, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, w: maxX - minX, h: maxY - minY };
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

  const zoomAroundPoint = useCallback((centerX: number, centerY: number, newZoom: number) => {
    setZoom(prevZoom => {
      const clampedZoom = Math.min(Math.max(newZoom, 0.2), 3);
      setPan(prevPan => ({
        x: centerX - ((centerX - prevPan.x) / prevZoom) * clampedZoom,
        y: centerY - ((centerY - prevPan.y) / prevZoom) * clampedZoom,
      }));
      return clampedZoom;
    });
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    zoomAroundPoint(cx, cy, zoom * delta);
  }, [zoom, zoomAroundPoint]);

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

  // ---- Connection-driven layout + convex hull ----
  const { regionHulls, allNodePositions, canvasW, canvasH } = useMemo(() => {
    const MIN_NODE_GAP = 90;
    const HULL_PAD = 35;

    // 1. Layout nodes within each region (local coords)
    const regionLocalLayouts = new Map<string, {
      positions: Map<string, { x: number; y: number }>;
      bbox: { minX: number; minY: number; maxX: number; maxY: number; w: number; h: number };
    }>();

    for (const region of regions) {
      const rNodes = nodesByRegion.get(region.id) || [];
      if (rNodes.length === 0) {
        regionLocalLayouts.set(region.id, {
          positions: new Map(),
          bbox: { minX: 0, minY: 0, maxX: 0, maxY: 0, w: 0, h: 0 },
        });
        continue;
      }
      const gridPos = layoutNodes(rNodes);
      const pixPos = new Map<string, { x: number; y: number }>();
      gridPos.forEach((pos, id) => {
        pixPos.set(id, { x: pos.x * MIN_NODE_GAP, y: pos.y * MIN_NODE_GAP });
      });
      const vals = [...pixPos.values()];
      const minX = Math.min(...vals.map(p => p.x));
      const minY = Math.min(...vals.map(p => p.y));
      const maxX = Math.max(...vals.map(p => p.x));
      const maxY = Math.max(...vals.map(p => p.y));
      regionLocalLayouts.set(region.id, {
        positions: pixPos,
        bbox: { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY },
      });
    }

    // 2. Build region adjacency from cross-region edges
    // adjacency[regionA][regionB] = { fromNodes: nodeIds in A, toNodes: nodeIds in B }
    const adjacency = new Map<string, Map<string, { from: string[]; to: string[] }>>();
    const nodeRegionMap = new Map<string, string>();
    for (const n of nodes) nodeRegionMap.set(n.id, n.region_id);

    for (const node of nodes) {
      for (const conn of node.connections) {
        const toRegion = nodeRegionMap.get(conn.node_id);
        if (!toRegion || toRegion === node.region_id) continue;
        // Add edge A->B
        if (!adjacency.has(node.region_id)) adjacency.set(node.region_id, new Map());
        const aMap = adjacency.get(node.region_id)!;
        if (!aMap.has(toRegion)) aMap.set(toRegion, { from: [], to: [] });
        const entry = aMap.get(toRegion)!;
        if (!entry.from.includes(node.id)) entry.from.push(node.id);
        if (!entry.to.includes(conn.node_id)) entry.to.push(conn.node_id);
      }
    }

    // 3. BFS from Hearthlands to place regions
    const regionCenters = new Map<string, { x: number; y: number }>();
    const regionSizes = new Map<string, number>(); // "radius" approximation

    for (const region of regions) {
      const layout = regionLocalLayouts.get(region.id);
      const size = layout ? Math.max(160, Math.max(layout.bbox.w, layout.bbox.h) / 2 + HULL_PAD) : 160;
      regionSizes.set(region.id, size);
    }

    const BUFFER = 20;
    const placed = new Set<string>();

    // Place Hearthlands at center
    const hearthExists = regions.some(r => r.id === HEARTHLANDS_ID);
    if (hearthExists) {
      regionCenters.set(HEARTHLANDS_ID, { x: CANVAS_W / 2, y: CANVAS_H / 2 });
      placed.add(HEARTHLANDS_ID);
    }

    // BFS queue
    const bfsQueue: string[] = hearthExists ? [HEARTHLANDS_ID] : [];

    // If no Hearthlands, start from first region
    if (!hearthExists && regions.length > 0) {
      regionCenters.set(regions[0].id, { x: CANVAS_W / 2, y: CANVAS_H / 2 });
      placed.add(regions[0].id);
      bfsQueue.push(regions[0].id);
    }

    while (bfsQueue.length > 0) {
      const currentRegionId = bfsQueue.shift()!;
      const neighbors = adjacency.get(currentRegionId);
      if (!neighbors) continue;

      const currentCenter = regionCenters.get(currentRegionId)!;
      const currentLayout = regionLocalLayouts.get(currentRegionId);
      const currentSize = regionSizes.get(currentRegionId) || 160;

      for (const [neighborId, gateway] of neighbors) {
        if (placed.has(neighborId)) continue;

        // Compute direction vector from gateway nodes
        let dirX = 0, dirY = 0;
        if (currentLayout && currentLayout.positions.size > 0) {
          // Average position of gateway "from" nodes (in current region's local coords)
          const centerOfLayout = {
            x: (currentLayout.bbox.minX + currentLayout.bbox.maxX) / 2,
            y: (currentLayout.bbox.minY + currentLayout.bbox.maxY) / 2,
          };
          for (const fromNodeId of gateway.from) {
            const pos = currentLayout.positions.get(fromNodeId);
            if (pos) {
              dirX += pos.x - centerOfLayout.x;
              dirY += pos.y - centerOfLayout.y;
            }
          }
        }

        // Normalize direction, fallback to a spread pattern
        const len = Math.sqrt(dirX * dirX + dirY * dirY);
        if (len > 0.01) {
          dirX /= len;
          dirY /= len;
        } else {
          // Fallback: spread based on index among unplaced neighbors
          const idx = [...neighbors.keys()].indexOf(neighborId);
          const angle = (idx / neighbors.size) * 2 * Math.PI - Math.PI / 2;
          dirX = Math.cos(angle);
          dirY = Math.sin(angle);
        }

        const neighborSize = regionSizes.get(neighborId) || 160;
        const dist = currentSize + neighborSize + BUFFER;

        regionCenters.set(neighborId, {
          x: currentCenter.x + dirX * dist,
          y: currentCenter.y + dirY * dist,
        });
        placed.add(neighborId);
        bfsQueue.push(neighborId);
      }
    }

    // Place any unconnected regions in a row below
    let unplacedIdx = 0;
    for (const region of regions) {
      if (!placed.has(region.id)) {
        const col = unplacedIdx % 5;
        const row = Math.floor(unplacedIdx / 5);
        regionCenters.set(region.id, {
          x: 300 + col * 400,
          y: (regionCenters.size > 0 ? Math.max(...[...regionCenters.values()].map(c => c.y)) + 400 : CANVAS_H / 2) + row * 300,
        });
        placed.add(region.id);
        unplacedIdx++;
      }
    }

    // 4. No collision resolution — regions may overlap based on connections

    // 5. Normalize so nothing is negative
    const MARGIN = 40;
    let shiftX = 0, shiftY = 0;
    for (const [rId, center] of regionCenters) {
      const size = regionSizes.get(rId) || 160;
      shiftX = Math.max(shiftX, MARGIN + size - center.x);
      shiftY = Math.max(shiftY, MARGIN + size - center.y);
    }
    if (shiftX > 0 || shiftY > 0) {
      for (const center of regionCenters.values()) {
        center.x += shiftX;
        center.y += shiftY;
      }
    }

    // 6. Compute final node positions and hulls
    const nodePos = new Map<string, { px: number; py: number }>();
    const hulls = new Map<string, { hull: Array<{ x: number; y: number }>; path: string; bbox: ReturnType<typeof hullBBox>; region: Region }>();

    for (const region of regions) {
      const center = regionCenters.get(region.id);
      if (!center) continue;
      const layout = regionLocalLayouts.get(region.id);
      if (!layout) continue;

      const layoutCenter = {
        x: (layout.bbox.minX + layout.bbox.maxX) / 2,
        y: (layout.bbox.minY + layout.bbox.maxY) / 2,
      };

      const hullPoints: Array<{ x: number; y: number }> = [];

      if (layout.positions.size > 0) {
        layout.positions.forEach((pos, id) => {
          const px = center.x + (pos.x - layoutCenter.x);
          const py = center.y + (pos.y - layoutCenter.y);
          nodePos.set(id, { px, py });
          hullPoints.push({ x: px, y: py });
        });
      } else {
        // Empty region - just use center
        hullPoints.push({ x: center.x, y: center.y });
      }

      const hull = convexHull(hullPoints);
      const expanded = expandHull(hull, HULL_PAD);
      const path = hullToPath(expanded);
      const bbox = hullBBox(expanded);
      hulls.set(region.id, { hull: expanded, path, bbox, region });
    }

    // Canvas size
    let maxRight = 0, maxBottom = 0;
    for (const h of hulls.values()) {
      maxRight = Math.max(maxRight, h.bbox.maxX + MARGIN);
      maxBottom = Math.max(maxBottom, h.bbox.maxY + MARGIN);
    }

    return {
      regionHulls: hulls,
      allNodePositions: nodePos,
      canvasW: Math.max(maxRight, CANVAS_W),
      canvasH: Math.max(maxBottom, CANVAS_H),
    };
  }, [regions, nodes, nodesByRegion]);

  // Zoom to a specific region
  const zoomToRegion = useCallback((regionId: string) => {
    const hullData = regionHulls.get(regionId);
    if (!hullData || !containerRef.current) return;

    const container = containerRef.current;
    const cw = container.clientWidth;
    const ch = container.clientHeight;

    const svgScale = Math.min(cw / canvasW, ch / canvasH);
    const svgOffsetX = (cw - canvasW * svgScale) / 2;
    const svgOffsetY = (ch - canvasH * svgScale) / 2;

    const { cx, cy, w, h } = hullData.bbox;
    const screenX = svgOffsetX + cx * svgScale;
    const screenY = svgOffsetY + cy * svgScale;

    const regionScreenSize = Math.max(w, h) * svgScale;
    const targetZoom = Math.min(cw, ch) * 0.6 / Math.max(regionScreenSize, 1);
    const clampedZoom = Math.min(Math.max(targetZoom, 0.3), 3);

    const targetPanX = cw / 2 - screenX * clampedZoom;
    const targetPanY = ch / 2 - screenY * clampedZoom;

    setIsAnimating(true);
    setZoom(clampedZoom);
    setPan({ x: targetPanX, y: targetPanY });
    setSelectedRegionId(regionId);
    setTimeout(() => setIsAnimating(false), 450);
  }, [regionHulls, canvasW, canvasH]);

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
  const sortedRegions = useMemo(() => [...regions].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)), [regions]);

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
        {/* Region sidebar */}
        <div className="w-48 border-r border-border bg-card/50 flex flex-col">
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
            <button onClick={() => {
              if (!containerRef.current) return;
              const rect = containerRef.current.getBoundingClientRect();
              zoomAroundPoint(rect.width / 2, rect.height / 2, zoom * 1.2);
            }}
              className="w-7 h-7 rounded bg-card border border-border text-xs font-bold hover:bg-accent transition-colors">+</button>
            <button onClick={() => {
              if (!containerRef.current) return;
              const rect = containerRef.current.getBoundingClientRect();
              zoomAroundPoint(rect.width / 2, rect.height / 2, zoom * 0.8);
            }}
              className="w-7 h-7 rounded bg-card border border-border text-xs font-bold hover:bg-accent transition-colors">−</button>
            <button onClick={resetView}
              className="h-7 px-2 rounded bg-card border border-border text-[10px] hover:bg-accent transition-colors">Reset</button>
          </div>
          <svg
            width="100%"
            height="100%"
            viewBox={`0 0 ${canvasW} ${canvasH}`}
            className="block w-full h-full"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: '0 0',
              transition: isAnimating ? 'transform 0.4s ease' : 'none',
            }}
          >
            {/* Region hulls */}
            {[...regionHulls.entries()].map(([regionId, hullData]) => {
              const isSelected = selectedRegionId === regionId;
              const { bbox } = hullData;
              const rNodes = nodesByRegion.get(regionId) || [];
              return (
                <g key={regionId}>
                  <path
                    d={hullData.path}
                    fill={isSelected ? 'hsl(35 20% 25% / 0.2)' : 'hsl(35 20% 25% / 0.12)'}
                    stroke={isSelected ? 'hsl(35 40% 55% / 0.7)' : 'hsl(35 20% 40% / 0.4)'}
                    strokeWidth={isSelected ? 2.5 : 1.5}
                    strokeDasharray="8 4"
                  />
                  <text
                    x={bbox.cx} y={bbox.minY - 8}
                    textAnchor="middle"
                    className="fill-primary font-display text-xs"
                  >
                    {hullData.region.name}
                  </text>
                  <text
                    x={bbox.cx} y={bbox.minY + 6}
                    textAnchor="middle"
                    className="fill-muted-foreground text-[9px]"
                  >
                    Lvl {hullData.region.min_level}–{hullData.region.max_level} · {rNodes.length} nodes
                  </text>

                  {rNodes.length === 0 && (
                    <g className="cursor-pointer" onClick={() => onAddNodeAdjacent('')}>
                      <circle cx={bbox.cx} cy={bbox.cy} r={14}
                        className="fill-background stroke-primary/50 hover:stroke-primary hover:fill-primary/10 transition-colors"
                        strokeWidth={1.5}
                      />
                      <text x={bbox.cx} y={bbox.cy + 4} textAnchor="middle"
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
      </div>
    </TooltipProvider>
  );
}
