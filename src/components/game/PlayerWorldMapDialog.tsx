import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ZoomIn, ZoomOut, Locate } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { GameNode, Region, Area, getNodeDisplayName } from '@/hooks/useNodes';
import { useAreaTypes } from '@/hooks/useAreaTypes';
import { getAreaFillColor, getAreaStrokeColor, getAreaHeaderColor } from '@/lib/area-colors';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  characterId: string;
  currentNodeId: string | null;
  nodes: GameNode[];
  regions: Region[];
  areas?: Area[];
}

// ── Layout ──────────────────────────────────────────────────────

const SPACING = 90;
const NODE_R = 22;
const OUTLINE_PAD = 18;
const AREA_PAD = 10;

// ── Union-of-circles outline ──────────────────────────────────

interface Circle { cx: number; cy: number; r: number; }

function normalizeAngle(a: number): number {
  a = a % (2 * Math.PI);
  if (a < 0) a += 2 * Math.PI;
  return a;
}

function ptOnCircle(c: Circle, angle: number) {
  return { x: c.cx + c.r * Math.cos(angle), y: c.cy + c.r * Math.sin(angle) };
}

function ptDist(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function computeOutline(circles: Circle[]): string[] {
  if (circles.length === 0) return [];
  if (circles.length === 1) {
    const c = circles[0];
    return [`M ${c.cx + c.r},${c.cy} A ${c.r},${c.r} 0 1,1 ${c.cx - c.r},${c.cy} A ${c.r},${c.r} 0 1,1 ${c.cx + c.r},${c.cy} Z`];
  }

  interface ExposedArc { circleIdx: number; startAngle: number; endAngle: number; startPt: { x: number; y: number }; endPt: { x: number; y: number }; }
  const arcs: ExposedArc[] = [];

  for (let i = 0; i < circles.length; i++) {
    const ci = circles[i];
    let skip = false;
    for (let j = 0; j < circles.length; j++) {
      if (i === j) continue;
      if (ptDist({ x: ci.cx, y: ci.cy }, { x: circles[j].cx, y: circles[j].cy }) + ci.r <= circles[j].r + 1e-6) { skip = true; break; }
    }
    if (skip) continue;

    const angles: number[] = [];
    for (let j = 0; j < circles.length; j++) {
      if (i === j) continue;
      const cj = circles[j];
      const dx = cj.cx - ci.cx, dy = cj.cy - ci.cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d >= ci.r + cj.r - 1e-9 || d + cj.r <= ci.r + 1e-9) continue;
      const a = Math.atan2(dy, dx);
      const cosH = (d * d + ci.r * ci.r - cj.r * cj.r) / (2 * d * ci.r);
      const h = Math.acos(Math.max(-1, Math.min(1, cosH)));
      angles.push(normalizeAngle(a - h));
      angles.push(normalizeAngle(a + h));
    }

    if (angles.length === 0) {
      arcs.push({ circleIdx: i, startAngle: 0, endAngle: 2 * Math.PI, startPt: ptOnCircle(ci, 0), endPt: ptOnCircle(ci, 0) });
      continue;
    }

    angles.sort((a, b) => a - b);
    const uniq: number[] = [angles[0]];
    for (let k = 1; k < angles.length; k++) {
      if (angles[k] - uniq[uniq.length - 1] > 1e-9) uniq.push(angles[k]);
    }

    for (let k = 0; k < uniq.length; k++) {
      const start = uniq[k];
      const end = uniq[(k + 1) % uniq.length];
      const span = k + 1 < uniq.length ? end - start : (end + 2 * Math.PI - start);
      if (span < 1e-9) continue;
      const mid = start + span / 2;
      const mx = ci.cx + ci.r * Math.cos(mid), my = ci.cy + ci.r * Math.sin(mid);
      let inside = false;
      for (let j = 0; j < circles.length; j++) {
        if (i === j) continue;
        if ((mx - circles[j].cx) ** 2 + (my - circles[j].cy) ** 2 < circles[j].r ** 2 - 1e-6) { inside = true; break; }
      }
      if (!inside) {
        arcs.push({ circleIdx: i, startAngle: start, endAngle: end, startPt: ptOnCircle(ci, start), endPt: ptOnCircle(ci, end) });
      }
    }
  }

  if (arcs.length === 0) return [];

  const used = new Array(arcs.length).fill(false);
  const paths: string[] = [];

  for (let si = 0; si < arcs.length; si++) {
    if (used[si]) continue;
    const first = arcs[si];
    if (Math.abs(first.endAngle - first.startAngle - 2 * Math.PI) < 1e-6) {
      used[si] = true;
      const c = circles[first.circleIdx];
      paths.push(`M ${c.cx + c.r},${c.cy} A ${c.r},${c.r} 0 1,1 ${c.cx - c.r},${c.cy} A ${c.r},${c.r} 0 1,1 ${c.cx + c.r},${c.cy} Z`);
      continue;
    }
    used[si] = true;
    const chain = [first];
    let cur = first;
    for (let iter = 0; iter < arcs.length; iter++) {
      let bestIdx = -1, bestDist = Infinity;
      for (let j = 0; j < arcs.length; j++) {
        if (used[j]) continue;
        const d = ptDist(cur.endPt, arcs[j].startPt);
        if (d < bestDist) { bestDist = d; bestIdx = j; }
      }
      if (bestIdx === -1 || bestDist > 3) break;
      used[bestIdx] = true;
      chain.push(arcs[bestIdx]);
      cur = arcs[bestIdx];
      if (ptDist(cur.endPt, first.startPt) < 3) break;
    }
    let d = `M ${chain[0].startPt.x.toFixed(2)},${chain[0].startPt.y.toFixed(2)}`;
    for (const arc of chain) {
      const ci = circles[arc.circleIdx];
      let span = arc.endAngle - arc.startAngle;
      if (span < 0) span += 2 * Math.PI;
      d += ` A ${ci.r.toFixed(2)},${ci.r.toFixed(2)} 0 ${span > Math.PI ? 1 : 0},1 ${arc.endPt.x.toFixed(2)},${arc.endPt.y.toFixed(2)}`;
    }
    d += ' Z';
    paths.push(d);
  }
  return paths;
}

// ── Component ───────────────────────────────────────────────────

export default function PlayerWorldMapDialog({ open, onOpenChange, characterId, currentNodeId, nodes, regions, areas }: Props) {
  const [visitedIds, setVisitedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const svgRef = useRef<SVGSVGElement>(null);
  const { emojiMap } = useAreaTypes();

  // Fetch visited nodes on open
  useEffect(() => {
    if (!open || !characterId) return;
    setLoading(true);
    supabase.from('character_visited_nodes').select('node_id').eq('character_id', characterId)
      .then(({ data }) => {
        if (data) setVisitedIds(new Set(data.map(r => r.node_id)));
        setLoading(false);
      });
  }, [open, characterId]);

  // Filter nodes to visited only, keeping connections only to other visited nodes
  const visibleNodes = useMemo(() => {
    return nodes.filter(n => visitedIds.has(n.id)).map(n => ({
      ...n,
      connections: n.connections.filter(c => visitedIds.has(c.node_id) && !c.hidden),
    }));
  }, [nodes, visitedIds]);

  // Ghost nodes: unvisited neighbors of visited nodes (fog-of-war hints)
  const ghostNodes = useMemo(() => {
    const ghosts = new Map<string, { parentId: string; direction: string }>();
    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    for (const node of nodes) {
      if (!visitedIds.has(node.id)) continue;
      for (const conn of node.connections) {
        if (conn.hidden || visitedIds.has(conn.node_id) || ghosts.has(conn.node_id)) continue;
        if (!nodeMap.has(conn.node_id)) continue;
        ghosts.set(conn.node_id, { parentId: node.id, direction: conn.direction });
      }
    }
    return ghosts;
  }, [nodes, visitedIds]);

  // Use stored coordinates directly for all nodes
  const positions = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    for (const n of nodes) map.set(n.id, { x: n.x, y: n.y });
    return map;
  }, [nodes]);

  // Pixel positions (visited + ghosts) — ghosts use stored coords too
  const nodePositions = useMemo(() => {
    const map = new Map<string, { px: number; py: number }>();
    positions.forEach((pos, id) => {
      map.set(id, { px: pos.x * SPACING, py: pos.y * SPACING });
    });
    return map;
  }, [positions]);

  // Edges (visited-to-visited only)
  const edges = useMemo(() => {
    const edgeSet = new Set<string>();
    const result: Array<{ from: string; to: string }> = [];
    for (const node of visibleNodes) {
      for (const conn of node.connections) {
        const key = [node.id, conn.node_id].sort().join('-');
        if (!edgeSet.has(key) && nodePositions.has(conn.node_id)) {
          edgeSet.add(key);
          result.push({ from: node.id, to: conn.node_id });
        }
      }
    }
    return result;
  }, [visibleNodes, nodePositions]);

  // Ghost edges (visited-to-ghost)
  const ghostEdges = useMemo(() => {
    const result: Array<{ from: string; to: string }> = [];
    ghostNodes.forEach(({ parentId }, ghostId) => {
      if (nodePositions.has(parentId) && nodePositions.has(ghostId)) {
        result.push({ from: parentId, to: ghostId });
      }
    });
    return result;
  }, [ghostNodes, nodePositions]);

  // Region outlines
  const regionOutlines = useMemo(() => {
    const regionMap = new Map<string, string[]>();
    for (const node of visibleNodes) {
      const list = regionMap.get(node.region_id) || [];
      list.push(node.id);
      regionMap.set(node.region_id, list);
    }
    const outlines: Array<{ regionId: string; paths: string[]; cx: number; cy: number }> = [];
    regionMap.forEach((nodeIds, regionId) => {
      const circles: Circle[] = nodeIds.map(id => {
        const p = nodePositions.get(id)!;
        return { cx: p.px, cy: p.py, r: NODE_R + OUTLINE_PAD };
      });
      const paths = computeOutline(circles);
      const cx = circles.reduce((s, c) => s + c.cx, 0) / circles.length;
      const cy = circles.reduce((s, c) => s + c.cy, 0) / circles.length;
      outlines.push({ regionId, paths, cx, cy });
    });
    return outlines;
  }, [visibleNodes, nodePositions]);

  // Area outlines
  const areaOutlines = useMemo(() => {
    const areaMap = new Map<string, string[]>();
    for (const node of visibleNodes) {
      if (!node.area_id) continue;
      const list = areaMap.get(node.area_id) || [];
      list.push(node.id);
      areaMap.set(node.area_id, list);
    }
    const outlines: Array<{ areaId: string; paths: string[]; cx: number; cy: number }> = [];
    areaMap.forEach((nodeIds, areaId) => {
      if (nodeIds.length < 2) return; // Don't outline single-node areas
      const circles: Circle[] = nodeIds.map(id => {
        const p = nodePositions.get(id)!;
        return { cx: p.px, cy: p.py, r: NODE_R + AREA_PAD };
      });
      const paths = computeOutline(circles);
      const cx = circles.reduce((s, c) => s + c.cx, 0) / circles.length;
      const cy = circles.reduce((s, c) => s + c.cy, 0) / circles.length;
      outlines.push({ areaId, paths, cx, cy });
    });
    return outlines;
  }, [visibleNodes, nodePositions]);

  // Lookups
  const regionById = useMemo(() => new Map(regions.map(r => [r.id, r])), [regions]);
  const areaById = useMemo(() => new Map((areas || []).map(a => [a.id, a])), [areas]);
  useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes]);

  // Pan/zoom handlers
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(0.2, Math.min(5, zoom * delta));
    // Zoom around cursor
    const rect = svgRef.current?.getBoundingClientRect();
    if (rect) {
      const cx = e.clientX - rect.left - rect.width / 2;
      const cy = e.clientY - rect.top - rect.height / 2;
      setPan(p => ({
        x: cx - (cx - p.x) * (newZoom / zoom),
        y: cy - (cy - p.y) * (newZoom / zoom),
      }));
    }
    setZoom(newZoom);
  }, [zoom]);

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

  // Center on current node
  const centerOnCurrent = useCallback(() => {
    if (!currentNodeId) return;
    const p = nodePositions.get(currentNodeId);
    if (!p) return;
    setPan({ x: -p.px * zoom, y: -p.py * zoom });
  }, [currentNodeId, nodePositions, zoom]);

  // Center on open
  useEffect(() => {
    if (open && !loading && nodePositions.size > 0) {
      // Small delay for dialog animation
      setTimeout(() => centerOnCurrent(), 100);
    }
  }, [open, loading, nodePositions.size]);

  // Service icons for a node
  const getServiceIcons = (node: GameNode) => {
    const icons: string[] = [];
    if (node.is_vendor) icons.push('🪙');
    if (node.is_inn) icons.push('🏨');
    if (node.is_blacksmith) icons.push('🔨');
    if (node.is_teleport) icons.push('🌀');
    if (node.is_trainer) icons.push('🏋️');
    return icons;
  };

  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] max-h-[90vh] w-[95vw] h-[85vh] p-0 overflow-hidden bg-card border-border">
        <DialogTitle className="sr-only">World Map</DialogTitle>
        <div className="relative w-full h-full">
          {/* Zoom controls */}
          <div className="absolute top-3 right-3 z-20 flex flex-col gap-1">
            <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setZoom(z => Math.min(5, z * 1.2))}>
              <ZoomIn className="h-3.5 w-3.5" />
            </Button>
            <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setZoom(z => Math.max(0.2, z * 0.8))}>
              <ZoomOut className="h-3.5 w-3.5" />
            </Button>
            <Button variant="outline" size="icon" className="h-7 w-7" onClick={centerOnCurrent}>
              <Locate className="h-3.5 w-3.5" />
            </Button>
          </div>

          {/* Title */}
          <div className="absolute top-3 left-3 z-20">
            <h2 className="font-display text-sm text-foreground">World Map</h2>
            <p className="text-[10px] text-muted-foreground">{visitedIds.size} locations explored</p>
          </div>

          {loading ? (
            <div className="flex items-center justify-center h-full">
              <p className="font-display text-sm text-muted-foreground animate-pulse">Loading map...</p>
            </div>
          ) : (
            <svg
              ref={svgRef}
              className="w-full h-full cursor-grab active:cursor-grabbing"
              onWheel={handleWheel}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
            >
              <g transform={`translate(${pan.x + (svgRef.current?.clientWidth || 800) / 2}, ${pan.y + (svgRef.current?.clientHeight || 600) / 2}) scale(${zoom})`}>
                {/* Region outlines */}
                {regionOutlines.map(({ regionId, paths, cx, cy }) => {
                  const region = regionById.get(regionId);
                  // Get emoji for coloring from area types of nodes in this region
                  const regionNodes = visibleNodes.filter(n => n.region_id === regionId);
                  const firstArea = regionNodes.find(n => n.area_id)?.area_id;
                  const area = firstArea ? areaById.get(firstArea) : null;
                  const emoji = area ? (emojiMap[area.area_type] || '📍') : '📍';
                  return (
                    <g key={regionId}>
                      {paths.map((d, i) => (
                        <path
                          key={i}
                          d={d}
                          fill={getAreaFillColor(emoji)}
                          stroke={getAreaStrokeColor(emoji)}
                          strokeWidth={1.5}
                          opacity={0.6}
                        />
                      ))}
                      {region && (
                        <text
                          x={cx}
                          y={cy - (NODE_R + OUTLINE_PAD + 8)}
                          textAnchor="middle"
                          className="font-display"
                          fill={getAreaHeaderColor(emoji)}
                          fontSize={11}
                          opacity={0.8}
                        >
                          {region.name} ({region.min_level}–{region.max_level})
                        </text>
                      )}
                    </g>
                  );
                })}

                {/* Area outlines */}
                {areaOutlines.map(({ areaId, paths, cx, cy }) => {
                  const area = areaById.get(areaId);
                  const emoji = area ? (emojiMap[area.area_type] || '📍') : '📍';
                  return (
                    <g key={areaId}>
                      {paths.map((d, i) => (
                        <path
                          key={i}
                          d={d}
                          fill="none"
                          stroke={getAreaStrokeColor(emoji)}
                          strokeWidth={1}
                          strokeDasharray="4 3"
                          opacity={0.4}
                        />
                      ))}
                      {area && (
                        <text
                          x={cx}
                          y={cy + NODE_R + AREA_PAD + 14}
                          textAnchor="middle"
                          className="font-body"
                          fill={getAreaHeaderColor(emoji)}
                          fontSize={8}
                          opacity={0.5}
                        >
                          {area.name}
                        </text>
                      )}
                    </g>
                  );
                })}

                {/* Edges */}
                {edges.map(({ from, to }) => {
                  const a = nodePositions.get(from);
                  const b = nodePositions.get(to);
                  if (!a || !b) return null;
                  return (
                    <line
                      key={`${from}-${to}`}
                      x1={a.px} y1={a.py} x2={b.px} y2={b.py}
                      stroke="hsl(var(--border))"
                      strokeWidth={1.2}
                      opacity={0.5}
                    />
                  );
                })}

                {/* Ghost edges (dashed, dim) */}
                {ghostEdges.map(({ from, to }) => {
                  const a = nodePositions.get(from);
                  const b = nodePositions.get(to);
                  if (!a || !b) return null;
                  return (
                    <line
                      key={`ghost-${from}-${to}`}
                      x1={a.px} y1={a.py} x2={b.px} y2={b.py}
                      stroke="hsl(var(--muted-foreground))"
                      strokeWidth={1}
                      strokeDasharray="3 4"
                      opacity={0.2}
                    />
                  );
                })}

                {/* Ghost nodes (unvisited neighbors) */}
                {[...ghostNodes.keys()].map(ghostId => {
                  const p = nodePositions.get(ghostId);
                  if (!p) return null;
                  return (
                    <g key={`ghost-${ghostId}`}>
                      <circle
                        cx={p.px}
                        cy={p.py}
                        r={NODE_R * 0.75}
                        fill="hsl(var(--muted) / 0.3)"
                        stroke="hsl(var(--muted-foreground) / 0.25)"
                        strokeWidth={1}
                        strokeDasharray="3 3"
                      />
                      <text
                        x={p.px}
                        y={p.py + 1}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        fill="hsl(var(--muted-foreground))"
                        fontSize={13}
                        fontWeight={700}
                        opacity={0.35}
                      >
                        ?
                      </text>
                    </g>
                  );
                })}

                {/* Nodes */}
                {visibleNodes.map(node => {
                  const p = nodePositions.get(node.id);
                  if (!p) return null;
                  const isCurrent = node.id === currentNodeId;
                  const isHovered = hoveredNode === node.id;
                  const area = node.area_id ? areaById.get(node.area_id) : null;
                  const emoji = area ? (emojiMap[area.area_type] || '📍') : '📍';
                  const displayName = getNodeDisplayName(node, area);
                  const services = getServiceIcons(node);

                  return (
                    <g
                      key={node.id}
                      onMouseEnter={() => setHoveredNode(node.id)}
                      onMouseLeave={() => setHoveredNode(null)}
                    >
                      {/* Node circle — colored by area type */}
                      <circle
                        cx={p.px}
                        cy={p.py}
                        r={NODE_R}
                        fill={isCurrent ? 'hsl(var(--primary) / 0.25)' : getAreaFillColor(emoji)}
                        stroke={isCurrent ? 'hsl(var(--primary))' : isHovered ? 'hsl(var(--foreground) / 0.6)' : getAreaStrokeColor(emoji)}
                        strokeWidth={isCurrent ? 2.5 : 1.5}
                        opacity={isCurrent ? 1 : 0.85}
                        className="transition-colors"
                      />

                      {/* Current node pulse */}
                      {isCurrent && (
                        <>
                          <circle
                            cx={p.px}
                            cy={p.py}
                            r={NODE_R + 4}
                            fill="none"
                            stroke="hsl(var(--primary))"
                            strokeWidth={1.5}
                            opacity={0.4}
                          >
                            <animate attributeName="r" values={`${NODE_R + 2};${NODE_R + 8};${NODE_R + 2}`} dur="2s" repeatCount="indefinite" />
                            <animate attributeName="opacity" values="0.5;0.1;0.5" dur="2s" repeatCount="indefinite" />
                          </circle>
                          <text
                            x={p.px}
                            y={p.py + 1}
                            textAnchor="middle"
                            dominantBaseline="middle"
                            fill="hsl(var(--primary))"
                            fontSize={10}
                            className="font-display"
                          >
                            ◆
                          </text>
                        </>
                      )}

                      {/* Area type emoji */}
                      {!isCurrent && (
                        <text
                          x={p.px}
                          y={p.py + 1}
                          textAnchor="middle"
                          dominantBaseline="middle"
                          fontSize={12}
                        >
                          {emoji}
                        </text>
                      )}

                      {/* Node name */}
                      <text
                        x={p.px}
                        y={p.py - NODE_R - 4}
                        textAnchor="middle"
                        className="font-body"
                        fill={isCurrent ? 'hsl(var(--primary))' : 'hsl(var(--foreground) / 0.7)'}
                        fontSize={isHovered ? 8 : 7}
                        fontWeight={isCurrent ? 600 : 400}
                      >
                        {displayName}
                      </text>

                      {/* Service icons below node */}
                      {services.length > 0 && (
                        <text
                          x={p.px}
                          y={p.py + NODE_R + 10}
                          textAnchor="middle"
                          fontSize={8}
                          letterSpacing={2}
                        >
                          {services.join(' ')}
                        </text>
                      )}
                    </g>
                  );
                })}
              </g>
            </svg>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
