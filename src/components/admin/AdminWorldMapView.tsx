import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MapPin, Pencil, Trash2, Layers } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useAreaTypes } from '@/hooks/useAreaTypes';
import { getAreaFillColor, getAreaStrokeColor } from '@/lib/area-colors';

interface GraphNode {
  id: string;
  name: string;
  region_id: string;
  area_id?: string | null;
  is_vendor: boolean;
  is_inn: boolean;
  is_blacksmith: boolean;
  connections: Array<{ node_id: string; direction: string; label?: string; hidden?: boolean }>;
  x: number;
  y: number;
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
  onAddNodeAdjacent: (fromId: string, direction?: string) => void;
  onEditRegion?: (region: Region) => void;
  onDeleteRegion?: (regionId: string) => void;
  onEditArea?: (area: Area) => void;
  onDeleteArea?: (areaId: string) => void;
  populateMode?: boolean;
  populateSelectedIds?: Set<string>;
  onPopulateToggleNode?: (nodeId: string) => void;
  onPositionsComputed?: (positions: Map<string, { px: number; py: number }>) => void;
  onConnectionCreated?: () => void;
  panelOpen?: boolean;
  multiSelectMode?: boolean;
  multiSelectedIds?: Set<string>;
  onMultiSelectToggleNode?: (nodeId: string) => void;
}

const CENTER_NODE_ID = '00000000-0000-0000-0001-000000000002'; // Hearthvale Square

const DIRECTION_OFFSETS: Record<string, [number, number]> = {
  N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0],
  NE: [1, -1], NW: [-1, -1], SE: [1, 1], SW: [-1, 1],
};

// ---- Union-of-Circles Region Outline ----
const NODE_DRAW_RADIUS = 28;
const BORDER_PAD = 20;
const OUTLINE_RADIUS = NODE_DRAW_RADIUS + BORDER_PAD;
const AREA_PAD = 10;
const AREA_OUTLINE_RADIUS = NODE_DRAW_RADIUS + AREA_PAD;

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

export default function AdminWorldMapView({ regions, nodes, areas = [], creatureCounts, npcCounts, onNodeClick, onAddNodeAdjacent, onEditRegion, onDeleteRegion, onEditArea, onDeleteArea, populateMode, populateSelectedIds, onPopulateToggleNode, onPositionsComputed, onConnectionCreated, panelOpen, multiSelectMode, multiSelectedIds, onMultiSelectToggleNode }: Props) {
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  const panStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const allNodeMap = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes]);
  const { emojiMap } = useAreaTypes();

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

  // ---- Use stored x/y coordinates for node layout ----
  const { regionHulls, areaHulls, allNodePositions, canvasW, canvasH } = useMemo(() => {
    const MIN_NODE_GAP = 90;
    const MARGIN = 60;

    if (nodes.length === 0) {
      return { regionHulls: new Map(), areaHulls: new Map(), allNodePositions: new Map(), canvasW: CANVAS_W, canvasH: CANVAS_H };
    }

    // Read stored coordinates directly
    const nodePos = new Map<string, { px: number; py: number }>();
    const xs = nodes.map(n => n.x);
    const ys = nodes.map(n => n.y);
    const minGX = Math.min(...xs);
    const minGY = Math.min(...ys);

    for (const n of nodes) {
      nodePos.set(n.id, {
        px: (n.x - minGX) * MIN_NODE_GAP + MARGIN,
        py: (n.y - minGY) * MIN_NODE_GAP + MARGIN,
      });
    }

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

  // Expose positions to parent
  useEffect(() => {
    if (onPositionsComputed && allNodePositions.size > 0) {
      onPositionsComputed(allNodePositions);
    }
  }, [allNodePositions, onPositionsComputed]);

  // Center on a specific node with smooth animation
  const centerOnNode = useCallback((nodeId: string) => {
    const pos = allNodePositions.get(nodeId);
    if (!pos || !containerRef.current) return;

    const container = containerRef.current;
    const cw = container.clientWidth;
    const ch = container.clientHeight;

    const svgScale = Math.min(cw / canvasW, ch / canvasH);
    const svgOffsetX = (cw - canvasW * svgScale) / 2;
    const svgOffsetY = (ch - canvasH * svgScale) / 2;

    const screenX = svgOffsetX + pos.px * svgScale;
    const screenY = svgOffsetY + pos.py * svgScale;

    // Use current zoom or a reasonable default
    const targetZoom = Math.max(zoom, 1.2);

    const targetPanX = cw / 2 - screenX * targetZoom;
    const targetPanY = ch / 2 - screenY * targetZoom;

    setIsAnimating(true);
    setZoom(targetZoom);
    setPan({ x: targetPanX, y: targetPanY });
    setTimeout(() => setIsAnimating(false), 450);
  }, [allNodePositions, canvasW, canvasH, zoom]);

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
        <div className="w-60 border-r border-border bg-card/50 flex flex-col">
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
                    <div className="flex items-center gap-1 min-w-0">
                      <MapPin className="w-3 h-3 shrink-0 text-muted-foreground" />
                      <span className="font-display truncate max-w-[160px]" title={region.name}>{region.name}</span>
                      <div className="hidden group-hover:flex items-center gap-0.5 shrink-0 ml-auto">
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

        {/* Areas sidebar */}
        <div className="w-60 border-r border-border bg-card/50 flex flex-col">
          <div className="px-3 py-2 border-b border-border">
            <h3 className="font-display text-xs text-primary">Areas</h3>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-1">
              {(() => {
                const filteredAreas = selectedRegionId
                  ? areas.filter(a => a.region_id === selectedRegionId)
                  : areas;
                if (filteredAreas.length === 0) {
                  return (
                    <p className="text-[10px] text-muted-foreground italic text-center py-4 px-2">
                      {selectedRegionId ? 'No areas in this region.' : 'No areas yet.'}
                    </p>
                  );
                }
                return filteredAreas.map(area => {
                  const areaNodeCount = nodes.filter(n => n.area_id === area.id).length;
                  const regionName = regions.find(r => r.id === area.region_id)?.name;
                  return (
                    <div
                      key={area.id}
                      className="group w-full text-left px-2.5 py-2 rounded text-xs transition-colors hover:bg-accent text-foreground cursor-pointer"
                    >
                      <div className="flex items-center gap-1 min-w-0">
                        <span className="text-sm shrink-0">{emojiMap[area.area_type] || '📍'}</span>
                        <span className="font-display truncate max-w-[160px]" title={area.name}>{area.name}</span>
                        <div className="hidden group-hover:flex items-center gap-0.5 shrink-0 ml-auto">
                          {onEditArea && (
                            <button
                              onClick={e => { e.stopPropagation(); onEditArea(area); }}
                              className="p-0.5 rounded hover:bg-primary/20 text-muted-foreground hover:text-primary transition-colors"
                            >
                              <Pencil className="w-3 h-3" />
                            </button>
                          )}
                          {onDeleteArea && (
                            <button
                              onClick={e => { e.stopPropagation(); onDeleteArea(area.id); }}
                              className="p-0.5 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-0.5 pl-[22px]">
                        {!selectedRegionId && regionName ? `${regionName} · ` : ''}{areaNodeCount} nodes
                      </div>
                    </div>
                  );
                });
              })()}
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
              const emoji = emojiMap[area.area_type] || '📍';
              const colors = { fill: getAreaFillColor(emoji), stroke: getAreaStrokeColor(emoji) };
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

            {/* Suggested connections (dotted lines on hover or selected) */}
            {(() => {
              const activeNode = selectedNode || hoveredNode;
              if (!activeNode || populateMode) return null;
              const hPos = allNodePositions.get(activeNode);
              if (!hPos) return null;
              const hNode = allNodeMap.get(activeNode);
              if (!hNode) return null;
              const connectedIds = new Set(hNode.connections.map(c => c.node_id));
              const PROXIMITY = 140; // includes diagonal grid steps (~127px)
              const suggestions: Array<{ id: string; px: number; py: number }> = [];
              allNodePositions.forEach((pos, id) => {
                if (id === activeNode || connectedIds.has(id)) return;
                const dx = pos.px - hPos.px;
                const dy = pos.py - hPos.py;
                if (Math.sqrt(dx * dx + dy * dy) <= PROXIMITY) {
                  suggestions.push({ id, ...pos });
                }
              });

              const handleSuggestionClick = async (targetId: string, targetPos: { px: number; py: number }) => {
                if (!hNode || !hPos) return;
                const dx = targetPos.px - hPos.px;
                const dy = targetPos.py - hPos.py;
                const angle = Math.atan2(-dy, dx) * (180 / Math.PI);
                let dir: string;
                if (angle >= -22.5 && angle < 22.5) dir = 'E';
                else if (angle >= 22.5 && angle < 67.5) dir = 'NE';
                else if (angle >= 67.5 && angle < 112.5) dir = 'N';
                else if (angle >= 112.5 && angle < 157.5) dir = 'NW';
                else if (angle >= 157.5 || angle < -157.5) dir = 'W';
                else if (angle >= -157.5 && angle < -112.5) dir = 'SW';
                else if (angle >= -112.5 && angle < -67.5) dir = 'S';
                else dir = 'SE';

                const OPPOSITE: Record<string, string> = { N: 'S', S: 'N', E: 'W', W: 'E', NE: 'SW', SW: 'NE', NW: 'SE', SE: 'NW' };
                const reverseDir = OPPOSITE[dir] || 'N';

                const targetNode = allNodeMap.get(targetId);
                if (!targetNode) return;

                // Update source node connections
                const srcConns = [...(hNode.connections || []), { node_id: targetId, direction: dir }];
                const { error: e1 } = await supabase.from('nodes').update({ connections: srcConns as any }).eq('id', hNode.id);
                if (e1) { toast.error(e1.message); return; }

                // Update target node connections
                const tgtConns = [...(targetNode.connections || []), { node_id: hNode.id, direction: reverseDir }];
                const { error: e2 } = await supabase.from('nodes').update({ connections: tgtConns as any }).eq('id', targetId);
                if (e2) { toast.error(e2.message); return; }

                toast.success(`Connected ${dir} → ${targetNode.name}`);
                onConnectionCreated?.();
              };

              return suggestions.map(s => (
                <g key={`suggest-${activeNode}-${s.id}`}
                  className="cursor-pointer"
                  onClick={(e) => { e.stopPropagation(); handleSuggestionClick(s.id, s); }}
                >
                  <line
                    x1={hPos.px} y1={hPos.py} x2={s.px} y2={s.py}
                    stroke="hsl(140 50% 50% / 0.35)"
                    strokeWidth={1.5}
                    strokeDasharray="3 5"
                  />
                  {/* Invisible wider hit area for easier clicking */}
                  <line
                    x1={hPos.px} y1={hPos.py} x2={s.px} y2={s.py}
                    stroke="transparent"
                    strokeWidth={12}
                  />
                  {/* Small + icon at midpoint */}
                  <circle
                    cx={(hPos.px + s.px) / 2} cy={(hPos.py + s.py) / 2} r={8}
                    fill="hsl(140 50% 30% / 0.7)" stroke="hsl(140 50% 50% / 0.8)" strokeWidth={1}
                  />
                  <text
                    x={(hPos.px + s.px) / 2} y={(hPos.py + s.py) / 2 + 3.5}
                    textAnchor="middle"
                    className="fill-white text-[9px] font-bold pointer-events-none select-none"
                  >+</text>
                </g>
              ));
            })()}
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
                </g>
              );
            })}

            {/* Nodes */}
            {nodes.map(node => {
              const pos = allNodePositions.get(node.id);
              if (!pos) return null;
              const isHovered = hoveredNode === node.id;
              const isSelected = selectedNode === node.id;
              const isActive = isHovered || isSelected;

              return (
                <g key={node.id}
                  onMouseEnter={() => setHoveredNode(node.id)}
                  onMouseLeave={() => setHoveredNode(null)}
                >
                  <circle
                    cx={pos.px} cy={pos.py} r={28}
                    className={`cursor-pointer transition-all duration-200 ${
                      populateMode && populateSelectedIds?.has(node.id)
                        ? 'fill-primary/25 stroke-primary'
                        : isActive ? 'fill-primary/20 stroke-primary' : 'fill-card stroke-border'
                    }`}
                    strokeWidth={populateMode && populateSelectedIds?.has(node.id) ? 3 : isActive ? 2.5 : 1.5}
                    onClick={(e) => {
                      if (populateMode && onPopulateToggleNode) {
                        onPopulateToggleNode(node.id);
                      } else if ((multiSelectMode || e.shiftKey) && onMultiSelectToggleNode) {
                        onMultiSelectToggleNode(node.id);
                      } else {
                        const newSelected = selectedNode === node.id ? null : node.id;
                        setSelectedNode(newSelected);
                        if (newSelected) centerOnNode(newSelected);
                        onNodeClick(node.id);
                      }
                    }}
                  />
                  {populateMode && populateSelectedIds?.has(node.id) && (
                    <text x={pos.px + 20} y={pos.py - 20} textAnchor="middle"
                      className="fill-primary text-[10px] font-bold pointer-events-none select-none">✓</text>
                  )}
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
                      isActive ? 'fill-primary' : 'fill-foreground'
                    }`}
                  >
                    {(() => {
                      const label = node.name?.trim() || `#${node.id.slice(0, 6)}`;
                      return label.length > 12 ? label.slice(0, 11) + '…' : label;
                    })()}
                  </text>

                  {isActive && !populateMode && (() => {
                    const usedDirs = new Set(node.connections.map(c => c.direction));
                    // Also block directions where a suggested connection exists
                    const connectedIds = new Set(node.connections.map(c => c.node_id));
                    const nodePos = allNodePositions.get(node.id);
                    if (nodePos) {
                      allNodePositions.forEach((p, id) => {
                        if (id === node.id || connectedIds.has(id)) return;
                        const dx = p.px - nodePos.px;
                        const dy = p.py - nodePos.py;
                        if (Math.sqrt(dx * dx + dy * dy) > 140) return;
                        const angle = Math.atan2(-dy, dx) * (180 / Math.PI);
                        let dir: string;
                        if (angle >= -22.5 && angle < 22.5) dir = 'E';
                        else if (angle >= 22.5 && angle < 67.5) dir = 'NE';
                        else if (angle >= 67.5 && angle < 112.5) dir = 'N';
                        else if (angle >= 112.5 && angle < 157.5) dir = 'NW';
                        else if (angle >= 157.5 || angle < -157.5) dir = 'W';
                        else if (angle >= -157.5 && angle < -112.5) dir = 'SW';
                        else if (angle >= -112.5 && angle < -67.5) dir = 'S';
                        else dir = 'SE';
                        usedDirs.add(dir);
                      });
                    }
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
      </div>
    </TooltipProvider>
  );
}
