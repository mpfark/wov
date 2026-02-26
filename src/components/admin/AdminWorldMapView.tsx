import { useState, useMemo, useRef, useCallback } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MapPin, Pencil, Trash2 } from 'lucide-react';

interface GraphNode {
  id: string;
  name: string;
  region_id: string;
  area_id?: string | null;
  is_vendor: boolean;
  is_inn: boolean;
  is_blacksmith: boolean;
  connections: Array<{ node_id: string; direction: string; label?: string; hidden?: boolean }>;
}

interface Area {
  id: string;
  region_id: string;
  name: string;
  description: string;
  area_type: string;
}

interface Region {
  id: string;
  name: string;
  min_level: number;
  max_level: number;
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
  areas?: Area[];
  creatureCounts?: Map<string, { total: number; aggressive: number }>;
  npcCounts?: Map<string, number>;
  onNodeClick: (nodeId: string) => void;
  onAddNodeBetween: (fromId: string, toId: string) => void;
  onAddNodeAdjacent: (fromId: string) => void;
  onEditRegion?: (region: Region) => void;
  onDeleteRegion?: (regionId: string) => void;
}

const CENTER_NODE_ID = '00000000-0000-0000-0001-000000000002'; // Hearthvale Square

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

// ---- Union-of-Circles Region Outline ----
const NODE_DRAW_RADIUS = 28;
const BORDER_PAD = 20;
const OUTLINE_RADIUS = NODE_DRAW_RADIUS + BORDER_PAD;
const AREA_PAD = 10;
const AREA_OUTLINE_RADIUS = NODE_DRAW_RADIUS + AREA_PAD;

const AREA_TYPE_COLORS: Record<string, { fill: string; stroke: string }> = {
  forest:   { fill: 'hsl(120 30% 25% / 0.15)', stroke: 'hsl(120 40% 45% / 0.6)' },
  town:     { fill: 'hsl(35 40% 30% / 0.15)',   stroke: 'hsl(35 50% 55% / 0.6)' },
  cave:     { fill: 'hsl(260 20% 25% / 0.15)',   stroke: 'hsl(260 30% 50% / 0.6)' },
  ruins:    { fill: 'hsl(30 15% 30% / 0.15)',    stroke: 'hsl(30 20% 50% / 0.6)' },
  plains:   { fill: 'hsl(50 40% 30% / 0.15)',    stroke: 'hsl(50 50% 50% / 0.6)' },
  mountain: { fill: 'hsl(210 15% 30% / 0.15)',   stroke: 'hsl(210 20% 55% / 0.6)' },
  swamp:    { fill: 'hsl(90 25% 25% / 0.15)',    stroke: 'hsl(90 30% 40% / 0.6)' },
  desert:   { fill: 'hsl(40 50% 30% / 0.15)',    stroke: 'hsl(40 60% 55% / 0.6)' },
  coast:    { fill: 'hsl(195 40% 30% / 0.15)',   stroke: 'hsl(195 50% 50% / 0.6)' },
  dungeon:  { fill: 'hsl(0 30% 25% / 0.15)',     stroke: 'hsl(0 40% 45% / 0.6)' },
  other:    { fill: 'hsl(200 10% 30% / 0.15)',    stroke: 'hsl(200 15% 50% / 0.6)' },
};
interface Circle { cx: number; cy: number; r: number; }
interface ExposedArc {
  circleIdx: number;
  startAngle: number;
  endAngle: number;
  startPt: { x: number; y: number };
  endPt: { x: number; y: number };
}

function normalizeAngle(a: number): number {
  a = a % (2 * Math.PI);
  if (a < 0) a += 2 * Math.PI;
  return a;
}

function ptOnCircle(c: Circle, angle: number): { x: number; y: number } {
  return { x: c.cx + c.r * Math.cos(angle), y: c.cy + c.r * Math.sin(angle) };
}

function ptDist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

type OutlineBBox = { minX: number; minY: number; maxX: number; maxY: number; cx: number; cy: number; w: number; h: number };

function computeRegionOutline(circles: Circle[]): { paths: string[]; bbox: OutlineBBox } {
  const emptyBBox: OutlineBBox = { minX: 0, minY: 0, maxX: 0, maxY: 0, cx: 0, cy: 0, w: 0, h: 0 };
  if (circles.length === 0) return { paths: [], bbox: emptyBBox };

  // Compute bbox from circles
  let bMinX = Infinity, bMinY = Infinity, bMaxX = -Infinity, bMaxY = -Infinity;
  for (const c of circles) {
    bMinX = Math.min(bMinX, c.cx - c.r);
    bMinY = Math.min(bMinY, c.cy - c.r);
    bMaxX = Math.max(bMaxX, c.cx + c.r);
    bMaxY = Math.max(bMaxY, c.cy + c.r);
  }
  const bbox: OutlineBBox = { minX: bMinX, minY: bMinY, maxX: bMaxX, maxY: bMaxY, cx: (bMinX + bMaxX) / 2, cy: (bMinY + bMaxY) / 2, w: bMaxX - bMinX, h: bMaxY - bMinY };

  if (circles.length === 1) {
    const c = circles[0];
    return { paths: [`M ${c.cx + c.r},${c.cy} A ${c.r},${c.r} 0 1,1 ${c.cx - c.r},${c.cy} A ${c.r},${c.r} 0 1,1 ${c.cx + c.r},${c.cy} Z`], bbox };
  }

  // Find exposed arcs for each circle
  const arcs: ExposedArc[] = [];

  for (let i = 0; i < circles.length; i++) {
    const ci = circles[i];

    // Skip if entirely inside another circle
    let skip = false;
    for (let j = 0; j < circles.length; j++) {
      if (i === j) continue;
      const d = ptDist({ x: ci.cx, y: ci.cy }, { x: circles[j].cx, y: circles[j].cy });
      if (d + ci.r <= circles[j].r + 1e-6) { skip = true; break; }
    }
    if (skip) continue;

    // Collect intersection angles with other circles
    const angles: number[] = [];
    for (let j = 0; j < circles.length; j++) {
      if (i === j) continue;
      const cj = circles[j];
      const dx = cj.cx - ci.cx;
      const dy = cj.cy - ci.cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d >= ci.r + cj.r - 1e-9) continue; // no overlap
      if (d + cj.r <= ci.r + 1e-9) continue; // cj inside ci

      const a = Math.atan2(dy, dx);
      const cosH = (d * d + ci.r * ci.r - cj.r * cj.r) / (2 * d * ci.r);
      const h = Math.acos(Math.max(-1, Math.min(1, cosH)));
      angles.push(normalizeAngle(a - h));
      angles.push(normalizeAngle(a + h));
    }

    if (angles.length === 0) {
      // Isolated circle — fully exposed
      arcs.push({ circleIdx: i, startAngle: 0, endAngle: 2 * Math.PI, startPt: ptOnCircle(ci, 0), endPt: ptOnCircle(ci, 0) });
      continue;
    }

    // Deduplicate very close angles
    angles.sort((a, b) => a - b);
    const uniqueAngles: number[] = [angles[0]];
    for (let k = 1; k < angles.length; k++) {
      if (angles[k] - uniqueAngles[uniqueAngles.length - 1] > 1e-9) uniqueAngles.push(angles[k]);
    }

    // For each arc segment between consecutive angles, check if midpoint is outside all other circles
    for (let k = 0; k < uniqueAngles.length; k++) {
      const start = uniqueAngles[k];
      const end = uniqueAngles[(k + 1) % uniqueAngles.length];
      const span = k + 1 < uniqueAngles.length ? end - start : (end + 2 * Math.PI - start);
      if (span < 1e-9) continue;
      const mid = start + span / 2;

      const mx = ci.cx + ci.r * Math.cos(mid);
      const my = ci.cy + ci.r * Math.sin(mid);

      let inside = false;
      for (let j = 0; j < circles.length; j++) {
        if (i === j) continue;
        const dd = (mx - circles[j].cx) ** 2 + (my - circles[j].cy) ** 2;
        if (dd < circles[j].r * circles[j].r - 1e-6) { inside = true; break; }
      }

      if (!inside) {
        arcs.push({
          circleIdx: i, startAngle: start, endAngle: end,
          startPt: ptOnCircle(ci, start), endPt: ptOnCircle(ci, end),
        });
      }
    }
  }

  if (arcs.length === 0) return { paths: [], bbox };

  // Chain arcs into closed paths by matching endpoints
  const used = new Array(arcs.length).fill(false);
  const paths: string[] = [];

  for (let startIdx = 0; startIdx < arcs.length; startIdx++) {
    if (used[startIdx]) continue;
    const firstArc = arcs[startIdx];

    // Full isolated circle
    if (Math.abs(firstArc.endAngle - firstArc.startAngle - 2 * Math.PI) < 1e-6 ||
        (firstArc.startAngle === 0 && Math.abs(firstArc.endAngle - 2 * Math.PI) < 1e-6)) {
      used[startIdx] = true;
      const c = circles[firstArc.circleIdx];
      paths.push(`M ${c.cx + c.r},${c.cy} A ${c.r},${c.r} 0 1,1 ${c.cx - c.r},${c.cy} A ${c.r},${c.r} 0 1,1 ${c.cx + c.r},${c.cy} Z`);
      continue;
    }

    // Chain connected arcs
    used[startIdx] = true;
    const chain: ExposedArc[] = [firstArc];
    let current = firstArc;

    for (let iter = 0; iter < arcs.length; iter++) {
      let bestIdx = -1;
      let bestDist = Infinity;
      for (let j = 0; j < arcs.length; j++) {
        if (used[j]) continue;
        const d = ptDist(current.endPt, arcs[j].startPt);
        if (d < bestDist) { bestDist = d; bestIdx = j; }
      }
      if (bestIdx === -1 || bestDist > 3) break;
      used[bestIdx] = true;
      chain.push(arcs[bestIdx]);
      current = arcs[bestIdx];
      if (ptDist(current.endPt, firstArc.startPt) < 3) break;
    }

    // Build SVG path with arc commands
    let d = `M ${chain[0].startPt.x.toFixed(2)},${chain[0].startPt.y.toFixed(2)}`;
    for (const arc of chain) {
      const ci = circles[arc.circleIdx];
      let span = arc.endAngle - arc.startAngle;
      if (span < 0) span += 2 * Math.PI;
      const largeArc = span > Math.PI ? 1 : 0;
      d += ` A ${ci.r.toFixed(2)},${ci.r.toFixed(2)} 0 ${largeArc},1 ${arc.endPt.x.toFixed(2)},${arc.endPt.y.toFixed(2)}`;
    }
    d += ' Z';
    paths.push(d);
  }

  return { paths, bbox };
}

// Canvas dimensions
const CANVAS_W = 2000;
const CANVAS_H = 1200;

export default function AdminWorldMapView({ regions, nodes, areas = [], creatureCounts, npcCounts, onNodeClick, onAddNodeBetween, onAddNodeAdjacent, onEditRegion, onDeleteRegion }: Props) {
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

  // ---- Global node layout from center + convex hull per region ----
  const { regionHulls, areaHulls, allNodePositions, canvasW, canvasH } = useMemo(() => {
    const MIN_NODE_GAP = 90;

    // 1. Global BFS layout from Hearthvale Square using connection directions
    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    const globalPositions = new Map<string, { x: number; y: number }>();
    const visited = new Set<string>();

    // Find center node
    const centerNode = nodeMap.get(CENTER_NODE_ID);
    const startId = centerNode ? CENTER_NODE_ID : (nodes.length > 0 ? nodes[0].id : null);
    if (!startId) {
      return { regionHulls: new Map(), areaHulls: new Map(), allNodePositions: new Map(), canvasW: CANVAS_W, canvasH: CANVAS_H };
    }

    // BFS from center
    const queue: Array<{ id: string; x: number; y: number }> = [{ id: startId, x: 0, y: 0 }];
    visited.add(startId);
    globalPositions.set(startId, { x: 0, y: 0 });

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

        // Collision avoidance
        if ([...globalPositions.values()].some(p => p.x === nx && p.y === ny)) {
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
              if (![...globalPositions.values()].some(p => p.x === c.x && p.y === c.y)) {
                nx = c.x;
                ny = c.y;
                placed = true;
                break;
              }
            }
            attempt++;
          }
        }

        globalPositions.set(conn.node_id, { x: nx, y: ny });
        queue.push({ id: conn.node_id, x: nx, y: ny });
      }
    }

    // Place disconnected nodes
    let disconnectedRow = 0;
    for (const node of nodes) {
      if (!globalPositions.has(node.id)) {
        const maxX = Math.max(0, ...[...globalPositions.values()].map(p => p.x));
        globalPositions.set(node.id, { x: maxX + 2, y: disconnectedRow++ });
      }
    }

    // 2. Convert grid coords to pixel coords
    const MARGIN = 60;
    const nodePos = new Map<string, { px: number; py: number }>();
    const vals = [...globalPositions.values()];
    const minGX = Math.min(...vals.map(p => p.x));
    const minGY = Math.min(...vals.map(p => p.y));

    globalPositions.forEach((pos, id) => {
      nodePos.set(id, {
        px: (pos.x - minGX) * MIN_NODE_GAP + MARGIN,
        py: (pos.y - minGY) * MIN_NODE_GAP + MARGIN,
      });
    });

    // 3. Compute union-of-circles outlines per region
    const hulls = new Map<string, { path: string; paths: string[]; bbox: OutlineBBox; region: Region }>();

    for (const region of regions) {
      const rNodes = nodesByRegion.get(region.id) || [];
      const regionCircles: Circle[] = [];
      const regionNodeIds = new Set(rNodes.map(n => n.id));

      // Add circles at each node position
      for (const n of rNodes) {
        const pos = nodePos.get(n.id);
        if (pos) regionCircles.push({ cx: pos.px, cy: pos.py, r: OUTLINE_RADIUS });
      }

      // Add circles along intra-region edges so the border wraps paths too
      const edgeSpacing = OUTLINE_RADIUS * 1.4; // keep circles overlapping
      for (const n of rNodes) {
        for (const conn of n.connections) {
          if (!regionNodeIds.has(conn.node_id)) continue; // skip cross-region
          if (conn.node_id < n.id) continue; // avoid duplicates
          const fromPos = nodePos.get(n.id);
          const toPos = nodePos.get(conn.node_id);
          if (!fromPos || !toPos) continue;
          const dx = toPos.px - fromPos.px;
          const dy = toPos.py - fromPos.py;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const steps = Math.ceil(dist / edgeSpacing);
          for (let s = 1; s < steps; s++) {
            const t = s / steps;
            regionCircles.push({ cx: fromPos.px + dx * t, cy: fromPos.py + dy * t, r: OUTLINE_RADIUS });
          }
        }
      }

      if (regionCircles.length === 0) continue;

      const { paths, bbox } = computeRegionOutline(regionCircles);
      const path = paths.join(' ');
      hulls.set(region.id, { path, paths, bbox, region });
    }

    // 4. Compute union-of-circles outlines per area (smaller radius, between region border and node)
    const aHulls = new Map<string, { path: string; area: Area }>();
    for (const area of areas) {
      const areaNodes = nodes.filter(n => n.area_id === area.id);
      if (areaNodes.length === 0) continue;
      const areaCircles: Circle[] = [];
      const areaNodeIds = new Set(areaNodes.map(n => n.id));

      for (const n of areaNodes) {
        const pos = nodePos.get(n.id);
        if (pos) areaCircles.push({ cx: pos.px, cy: pos.py, r: AREA_OUTLINE_RADIUS });
      }

      // Add circles along intra-area edges
      const edgeSpacing = AREA_OUTLINE_RADIUS * 1.4;
      for (const n of areaNodes) {
        for (const conn of n.connections) {
          if (!areaNodeIds.has(conn.node_id)) continue;
          if (conn.node_id < n.id) continue;
          const fromPos = nodePos.get(n.id);
          const toPos = nodePos.get(conn.node_id);
          if (!fromPos || !toPos) continue;
          const dx = toPos.px - fromPos.px;
          const dy = toPos.py - fromPos.py;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const steps = Math.ceil(dist / edgeSpacing);
          for (let s = 1; s < steps; s++) {
            const t = s / steps;
            areaCircles.push({ cx: fromPos.px + dx * t, cy: fromPos.py + dy * t, r: AREA_OUTLINE_RADIUS });
          }
        }
      }

      if (areaCircles.length === 0) continue;
      const { paths: areaPaths } = computeRegionOutline(areaCircles);
      aHulls.set(area.id, { path: areaPaths.join(' '), area });
    }

    // Canvas size
    let maxRight = 0, maxBottom = 0;
    for (const pos of nodePos.values()) {
      maxRight = Math.max(maxRight, pos.px + MARGIN);
      maxBottom = Math.max(maxBottom, pos.py + MARGIN);
    }
    for (const h of hulls.values()) {
      maxRight = Math.max(maxRight, h.bbox.maxX + MARGIN);
      maxBottom = Math.max(maxBottom, h.bbox.maxY + MARGIN);
    }

    return {
      regionHulls: hulls,
      areaHulls: aHulls,
      allNodePositions: nodePos,
      canvasW: Math.max(maxRight, CANVAS_W),
      canvasH: Math.max(maxBottom, CANVAS_H),
    };
  }, [regions, nodes, areas, nodesByRegion]);

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
                  <div
                    key={region.id}
                    className={`group w-full text-left px-2.5 py-2 rounded text-xs transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-primary/15 text-primary'
                        : 'hover:bg-accent text-foreground'
                    }`}
                    onClick={() => zoomToRegion(region.id)}
                  >
                    <div className="flex items-center gap-1.5">
                      <MapPin className="w-3 h-3 shrink-0 text-muted-foreground" />
                      <span className="font-display truncate flex-1">{region.name}</span>
                      <div className="hidden group-hover:flex items-center gap-0.5">
                        {onEditRegion && (
                          <button
                            onClick={e => { e.stopPropagation(); onEditRegion(region); }}
                            className="p-0.5 rounded hover:bg-primary/20 text-muted-foreground hover:text-primary transition-colors"
                          >
                            <Pencil className="w-3 h-3" />
                          </button>
                        )}
                        {onDeleteRegion && (
                          <button
                            onClick={e => { e.stopPropagation(); onDeleteRegion(region.id); }}
                            className="p-0.5 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5 pl-[18px]">
                      Lvl {region.min_level}–{region.max_level} · {nodeCount} nodes
                    </div>
                  </div>
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

              // Compute label position from actual node positions (more stable than bbox)
              const nodePositions = rNodes.map(n => allNodePositions.get(n.id)).filter(Boolean) as Array<{ px: number; py: number }>;
              const labelX = nodePositions.length > 0
                ? nodePositions.reduce((s, p) => s + p.px, 0) / nodePositions.length
                : bbox.cx;
              const labelY = nodePositions.length > 0
                ? Math.min(...nodePositions.map(p => p.py)) - OUTLINE_RADIUS - 10
                : bbox.minY - 8;

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
                    x={labelX} y={labelY}
                    textAnchor="middle"
                    className="fill-primary font-display text-xs"
                  >
                    {hullData.region.name}
                  </text>
                  <text
                    x={labelX} y={labelY + 14}
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

            {/* Area hulls — color-coded by area type */}
            {[...areaHulls.entries()].map(([areaId, { path, area }]) => {
              const colors = AREA_TYPE_COLORS[area.area_type] || AREA_TYPE_COLORS.other;
              // Compute label position from area nodes
              const areaNodes = nodes.filter(n => n.area_id === areaId);
              const areaPositions = areaNodes.map(n => allNodePositions.get(n.id)).filter(Boolean) as Array<{ px: number; py: number }>;
              const labelX = areaPositions.length > 0
                ? areaPositions.reduce((s, p) => s + p.px, 0) / areaPositions.length
                : 0;
              const labelY = areaPositions.length > 0
                ? Math.min(...areaPositions.map(p => p.py)) - AREA_OUTLINE_RADIUS - 4
                : 0;

              return (
                <g key={`area-${areaId}`}>
                  <path
                    d={path}
                    fill={colors.fill}
                    stroke={colors.stroke}
                    strokeWidth={1.5}
                    className="pointer-events-none"
                  />
                  {areaPositions.length > 0 && (
                    <text
                      x={labelX} y={labelY}
                      textAnchor="middle"
                      fill={colors.stroke.replace('/ 0.6)', '/ 0.9)')}
                      className="font-display text-[8px] pointer-events-none select-none"
                    >
                      {area.name}
                    </text>
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
                    {(() => {
                      const label = node.name?.trim() || `#${node.id.slice(0, 6)}`;
                      return label.length > 12 ? label.slice(0, 11) + '…' : label;
                    })()}
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
