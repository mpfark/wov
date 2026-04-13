import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ZoomIn, ZoomOut, Locate } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { GameNode, Region, Area, getNodeDisplayName } from '@/features/world';
import { useAreaTypes } from '@/features/world';
import { getAreaFillColor, getAreaStrokeColor } from '@/features/world';
import { computeRegionOutline, type Circle, type OutlineBBox } from '@/features/world/utils/outline-geometry';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  characterId: string;
  currentNodeId: string | null;
  nodes: GameNode[];
  regions: Region[];
  areas?: Area[];
}

const SPACING = 90;
const NODE_R = 22;
const OUTLINE_RADIUS = NODE_R + 20;
const AREA_OUTLINE_RADIUS = NODE_R + 10;

export default function PlayerWorldMapDialog({ open, onOpenChange, characterId, currentNodeId, nodes, regions, areas }: Props) {
  const [visitedIds, setVisitedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const svgRef = useRef<SVGSVGElement>(null);
  const { emojiMap } = useAreaTypes();
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

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

  // Filter nodes to visited only
  const visibleNodes = useMemo(() => {
    return nodes.filter(n => visitedIds.has(n.id)).map(n => ({
      ...n,
      connections: n.connections.filter(c => visitedIds.has(c.node_id) && !c.hidden),
    }));
  }, [nodes, visitedIds]);

  // Ghost nodes: unvisited neighbors of visited nodes
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

  // Pixel positions for all nodes
  const nodePositions = useMemo(() => {
    const map = new Map<string, { px: number; py: number }>();
    for (const n of nodes) {
      map.set(n.id, { px: n.x * SPACING, py: n.y * SPACING });
    }
    return map;
  }, [nodes]);

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

  // Ghost edges
  const ghostEdges = useMemo(() => {
    const result: Array<{ from: string; to: string }> = [];
    ghostNodes.forEach(({ parentId }, ghostId) => {
      if (nodePositions.has(parentId) && nodePositions.has(ghostId)) {
        result.push({ from: parentId, to: ghostId });
      }
    });
    return result;
  }, [ghostNodes, nodePositions]);

  // Region outlines — admin style with edge interpolation
  const regionOutlines = useMemo(() => {
    const regionMap = new Map<string, GameNode[]>();
    for (const node of visibleNodes) {
      const list = regionMap.get(node.region_id) || [];
      list.push(node);
      regionMap.set(node.region_id, list);
    }
    const outlines: Array<{ regionId: string; paths: string[]; bbox: OutlineBBox }> = [];
    regionMap.forEach((rNodes, regionId) => {
      const regionNodeIds = new Set(rNodes.map(n => n.id));
      const circles: Circle[] = [];

      for (const n of rNodes) {
        const pos = nodePositions.get(n.id);
        if (pos) circles.push({ cx: pos.px, cy: pos.py, r: OUTLINE_RADIUS });
      }

      // Edge interpolation for smoother outlines
      const edgeSpacing = OUTLINE_RADIUS * 1.4;
      for (const n of rNodes) {
        for (const conn of n.connections) {
          if (!regionNodeIds.has(conn.node_id)) continue;
          if (conn.node_id < n.id) continue;
          const fromPos = nodePositions.get(n.id);
          const toPos = nodePositions.get(conn.node_id);
          if (!fromPos || !toPos) continue;
          const dx = toPos.px - fromPos.px;
          const dy = toPos.py - fromPos.py;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const steps = Math.ceil(dist / edgeSpacing);
          for (let s = 1; s < steps; s++) {
            const t = s / steps;
            circles.push({ cx: fromPos.px + dx * t, cy: fromPos.py + dy * t, r: OUTLINE_RADIUS });
          }
        }
      }

      if (circles.length === 0) return;
      const { paths, bbox } = computeRegionOutline(circles);
      outlines.push({ regionId, paths, bbox });
    });
    return outlines;
  }, [visibleNodes, nodePositions]);

  // Area outlines — admin style with edge interpolation and fill
  const areaOutlines = useMemo(() => {
    const areaMap = new Map<string, GameNode[]>();
    for (const node of visibleNodes) {
      if (!node.area_id) continue;
      const list = areaMap.get(node.area_id) || [];
      list.push(node);
      areaMap.set(node.area_id, list);
    }
    const outlines: Array<{ areaId: string; path: string; labelX: number; labelY: number }> = [];
    areaMap.forEach((aNodes, areaId) => {
      const areaNodeIds = new Set(aNodes.map(n => n.id));
      const circles: Circle[] = [];

      for (const n of aNodes) {
        const pos = nodePositions.get(n.id);
        if (pos) circles.push({ cx: pos.px, cy: pos.py, r: AREA_OUTLINE_RADIUS });
      }

      // Edge interpolation
      const edgeSpacing = AREA_OUTLINE_RADIUS * 1.4;
      for (const n of aNodes) {
        for (const conn of n.connections) {
          if (!areaNodeIds.has(conn.node_id)) continue;
          if (conn.node_id < n.id) continue;
          const fromPos = nodePositions.get(n.id);
          const toPos = nodePositions.get(conn.node_id);
          if (!fromPos || !toPos) continue;
          const dx = toPos.px - fromPos.px;
          const dy = toPos.py - fromPos.py;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const steps = Math.ceil(dist / edgeSpacing);
          for (let s = 1; s < steps; s++) {
            const t = s / steps;
            circles.push({ cx: fromPos.px + dx * t, cy: fromPos.py + dy * t, r: AREA_OUTLINE_RADIUS });
          }
        }
      }

      if (circles.length === 0) return;
      const { paths } = computeRegionOutline(circles);
      const positions = aNodes.map(n => nodePositions.get(n.id)!).filter(Boolean);
      const labelX = positions.reduce((s, p) => s + p.px, 0) / positions.length;
      const labelY = Math.min(...positions.map(p => p.py)) - AREA_OUTLINE_RADIUS - 4;
      outlines.push({ areaId, path: paths.join(' '), labelX, labelY });
    });
    return outlines;
  }, [visibleNodes, nodePositions]);

  // Lookups
  const regionById = useMemo(() => new Map(regions.map(r => [r.id, r])), [regions]);
  const areaById = useMemo(() => new Map((areas || []).map(a => [a.id, a])), [areas]);

  // Pan/zoom handlers
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(0.2, Math.min(5, zoom * delta));
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

  const centerOnCurrent = useCallback(() => {
    if (!currentNodeId) return;
    const p = nodePositions.get(currentNodeId);
    if (!p) return;
    setPan({ x: -p.px * zoom, y: -p.py * zoom });
  }, [currentNodeId, nodePositions, zoom]);

  useEffect(() => {
    if (open && !loading && nodePositions.size > 0) {
      setTimeout(() => centerOnCurrent(), 100);
    }
  }, [open, loading, nodePositions.size]);

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
                {/* Region outlines — dashed border like admin */}
                {regionOutlines.map(({ regionId, paths, bbox }) => {
                  const region = regionById.get(regionId);
                  const rNodes = visibleNodes.filter(n => n.region_id === regionId);
                  const positions = rNodes.map(n => nodePositions.get(n.id)!).filter(Boolean);
                  const labelX = positions.length > 0
                    ? positions.reduce((s, p) => s + p.px, 0) / positions.length
                    : bbox.cx;
                  const labelY = positions.length > 0
                    ? Math.min(...positions.map(p => p.py)) - OUTLINE_RADIUS - 10
                    : bbox.minY - 8;

                  return (
                    <g key={regionId}>
                      {paths.map((d, i) => (
                        <path
                          key={i}
                          d={d}
                          fill="hsl(35 20% 25% / 0.12)"
                          stroke="hsl(35 20% 40% / 0.4)"
                          strokeWidth={1.5}
                          strokeDasharray="8 4"
                        />
                      ))}
                      {region && (
                        <>
                          <text
                            x={labelX} y={labelY}
                            textAnchor="middle"
                            className="font-display"
                            fill="hsl(var(--primary))"
                            fontSize={11}
                          >
                            {region.name}
                          </text>
                          <text
                            x={labelX} y={labelY + 13}
                            textAnchor="middle"
                            fill="hsl(var(--muted-foreground))"
                            fontSize={8}
                          >
                            Lvl {region.min_level}–{region.max_level}
                          </text>
                        </>
                      )}
                    </g>
                  );
                })}

                {/* Area hulls — colored fill + stroke like admin */}
                {areaOutlines.map(({ areaId, path, labelX, labelY }) => {
                  const area = areaById.get(areaId);
                  const emoji = area ? (emojiMap[area.area_type] || '📍') : '📍';
                  const fill = getAreaFillColor(emoji);
                  const stroke = getAreaStrokeColor(emoji);

                  return (
                    <g key={`area-${areaId}`}>
                      <path
                        d={path}
                        fill={fill}
                        stroke={stroke}
                        strokeWidth={1.5}
                      />
                      {area && (
                        <text
                          x={labelX} y={labelY}
                          textAnchor="middle"
                          fill={stroke.replace('/ 0.6)', '/ 0.9)')}
                          className="font-display"
                          fontSize={8}
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

                {/* Ghost edges */}
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

                {/* Ghost nodes */}
                {[...ghostNodes.keys()].map(ghostId => {
                  const p = nodePositions.get(ghostId);
                  if (!p) return null;
                  return (
                    <g key={`ghost-${ghostId}`}>
                      <circle
                        cx={p.px} cy={p.py} r={NODE_R * 0.75}
                        fill="hsl(var(--muted) / 0.3)"
                        stroke="hsl(var(--muted-foreground) / 0.25)"
                        strokeWidth={1}
                        strokeDasharray="3 3"
                      />
                      <text
                        x={p.px} y={p.py + 1}
                        textAnchor="middle" dominantBaseline="middle"
                        fill="hsl(var(--muted-foreground))"
                        fontSize={13} fontWeight={700} opacity={0.35}
                      >
                        ?
                      </text>
                    </g>
                  );
                })}

                {/* Nodes — simple colored dots with name only */}
                {visibleNodes.map(node => {
                  const p = nodePositions.get(node.id);
                  if (!p) return null;
                  const isCurrent = node.id === currentNodeId;
                  const isHovered = hoveredNode === node.id;
                  const area = node.area_id ? areaById.get(node.area_id) : null;
                  const emoji = area ? (emojiMap[area.area_type] || '📍') : '📍';
                  const displayName = getNodeDisplayName(node, area);
                  const fillColor = isCurrent ? 'hsl(var(--primary) / 0.25)' : getAreaFillColor(emoji);
                  const strokeColor = isCurrent ? 'hsl(var(--primary))' : isHovered ? 'hsl(var(--foreground) / 0.6)' : getAreaStrokeColor(emoji);

                  return (
                    <g
                      key={node.id}
                      onMouseEnter={() => setHoveredNode(node.id)}
                      onMouseLeave={() => setHoveredNode(null)}
                    >
                      <circle
                        cx={p.px} cy={p.py} r={NODE_R * 0.6}
                        fill={fillColor}
                        stroke={strokeColor}
                        strokeWidth={isCurrent ? 2.5 : 1.5}
                        opacity={isCurrent ? 1 : 0.85}
                      />

                      {/* Current node pulse */}
                      {isCurrent && (
                        <>
                          <circle
                            cx={p.px} cy={p.py} r={NODE_R * 0.6 + 4}
                            fill="none" stroke="hsl(var(--primary))"
                            strokeWidth={1.5} opacity={0.4}
                          >
                            <animate attributeName="r" values={`${NODE_R * 0.6 + 2};${NODE_R * 0.6 + 8};${NODE_R * 0.6 + 2}`} dur="2s" repeatCount="indefinite" />
                            <animate attributeName="opacity" values="0.5;0.1;0.5" dur="2s" repeatCount="indefinite" />
                          </circle>
                          <text
                            x={p.px} y={p.py + 1}
                            textAnchor="middle" dominantBaseline="middle"
                            fill="hsl(var(--primary))" fontSize={8}
                            className="font-display"
                          >
                            ◆
                          </text>
                        </>
                      )}

                      {/* Node name */}
                      <text
                        x={p.px} y={p.py - NODE_R * 0.6 - 4}
                        textAnchor="middle"
                        className="font-body"
                        fill={isCurrent ? 'hsl(var(--primary))' : 'hsl(var(--foreground) / 0.7)'}
                        fontSize={isHovered ? 8 : 7}
                        fontWeight={isCurrent ? 600 : 400}
                      >
                        {displayName}
                      </text>
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
