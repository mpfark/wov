/**
 * RegionMiniMap — read-only mini-map used by treasure map items.
 *
 * Renders one region with area outlines, all nodes as dots, connections as
 * lines, and a glowing red ✕ over the target node. Visited nodes appear
 * solid; unvisited nodes are dim so the map feels like a hand-drawn guide
 * rather than a satellite view.
 */
import { useMemo } from 'react';
import { useAreaTypes } from '@/features/world/hooks/useAreaTypes';
import { getAreaFillColor, getAreaStrokeColor } from '@/features/world/utils/area-colors';
import { computeRegionOutline, type Circle } from '@/features/world/utils/outline-geometry';
import type { GameNode, Area } from '@/features/world/hooks/useNodes';

interface Props {
  regionId: string;
  highlightNodeId: string;
  nodes: GameNode[];
  areas: Area[];
  visitedNodeIds?: Set<string>;
  currentNodeId?: string | null;
}

const SPACING = 70;
const NODE_R = 12;
const AREA_OUTLINE_RADIUS = NODE_R + 8;
const PAD = 60;

export default function RegionMiniMap({
  regionId,
  highlightNodeId,
  nodes,
  areas,
  visitedNodeIds,
  currentNodeId,
}: Props) {
  const { emojiMap } = useAreaTypes();

  const regionNodes = useMemo(
    () => nodes.filter(n => n.region_id === regionId),
    [nodes, regionId],
  );

  const { positions, viewBox } = useMemo(() => {
    if (regionNodes.length === 0) {
      return { positions: new Map<string, { px: number; py: number }>(), viewBox: '0 0 200 200' };
    }
    const xs = regionNodes.map(n => n.x);
    const ys = regionNodes.map(n => n.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const w = (maxX - minX) * SPACING + PAD * 2;
    const h = (maxY - minY) * SPACING + PAD * 2;
    const pos = new Map<string, { px: number; py: number }>();
    for (const n of regionNodes) {
      pos.set(n.id, {
        px: (n.x - minX) * SPACING + PAD,
        py: (n.y - minY) * SPACING + PAD,
      });
    }
    return { positions: pos, viewBox: `0 0 ${Math.max(w, 200)} ${Math.max(h, 200)}` };
  }, [regionNodes]);

  const edges = useMemo(() => {
    const seen = new Set<string>();
    const out: Array<{ from: string; to: string }> = [];
    const idSet = new Set(regionNodes.map(n => n.id));
    for (const n of regionNodes) {
      for (const c of n.connections || []) {
        if (c.hidden) continue;
        if (!idSet.has(c.node_id)) continue;
        const key = [n.id, c.node_id].sort().join('-');
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ from: n.id, to: c.node_id });
      }
    }
    return out;
  }, [regionNodes]);

  const areaHulls = useMemo(() => {
    const out: Array<{ areaId: string; path: string; fill: string; stroke: string }> = [];
    const byArea = new Map<string, GameNode[]>();
    for (const n of regionNodes) {
      if (!n.area_id) continue;
      const arr = byArea.get(n.area_id) || [];
      arr.push(n);
      byArea.set(n.area_id, arr);
    }
    byArea.forEach((areaNodes, areaId) => {
      const ids = new Set(areaNodes.map(n => n.id));
      const circles: Circle[] = [];
      for (const n of areaNodes) {
        const p = positions.get(n.id);
        if (p) circles.push({ cx: p.px, cy: p.py, r: AREA_OUTLINE_RADIUS });
      }
      const spacing = AREA_OUTLINE_RADIUS * 1.4;
      for (const n of areaNodes) {
        for (const c of n.connections || []) {
          if (!ids.has(c.node_id) || c.node_id < n.id) continue;
          const a = positions.get(n.id);
          const b = positions.get(c.node_id);
          if (!a || !b) continue;
          const dx = b.px - a.px, dy = b.py - a.py;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const steps = Math.ceil(dist / spacing);
          for (let s = 1; s < steps; s++) {
            const t = s / steps;
            circles.push({ cx: a.px + dx * t, cy: a.py + dy * t, r: AREA_OUTLINE_RADIUS });
          }
        }
      }
      if (circles.length === 0) return;
      const { paths } = computeRegionOutline(circles);
      const area = areas.find(a => a.id === areaId);
      const emoji = area ? emojiMap[area.area_type] || '📍' : '📍';
      out.push({
        areaId,
        path: paths.join(' '),
        fill: getAreaFillColor(emoji),
        stroke: getAreaStrokeColor(emoji),
      });
    });
    return out;
  }, [regionNodes, positions, areas, emojiMap]);

  if (regionNodes.length === 0) {
    return (
      <div className="p-4 text-center text-xs italic text-muted-foreground">
        This region holds no charted paths.
      </div>
    );
  }

  return (
    <svg viewBox={viewBox} className="block w-full h-auto" preserveAspectRatio="xMidYMid meet">
      {/* Parchment-toned backdrop */}
      <rect x={0} y={0} width="100%" height="100%" fill="hsl(35 30% 12% / 0.4)" />

      {/* Area hulls */}
      {areaHulls.map(h => (
        <path key={h.areaId} d={h.path} fill={h.fill} stroke={h.stroke} strokeWidth={1.2} />
      ))}

      {/* Edges */}
      {edges.map((e, i) => {
        const a = positions.get(e.from);
        const b = positions.get(e.to);
        if (!a || !b) return null;
        return (
          <line
            key={i}
            x1={a.px} y1={a.py} x2={b.px} y2={b.py}
            stroke="hsl(35 25% 50% / 0.5)" strokeWidth={1.5} strokeDasharray="4 3"
          />
        );
      })}

      {/* Nodes */}
      {regionNodes.map(n => {
        const p = positions.get(n.id);
        if (!p) return null;
        const isCurrent = currentNodeId === n.id;
        const isTarget = highlightNodeId === n.id;
        const visited = !visitedNodeIds || visitedNodeIds.has(n.id);
        return (
          <g key={n.id} opacity={visited || isTarget ? 1 : 0.35}>
            <circle
              cx={p.px} cy={p.py} r={NODE_R}
              fill={isCurrent ? 'hsl(var(--primary) / 0.25)' : 'hsl(35 30% 18%)'}
              stroke={isCurrent ? 'hsl(var(--primary))' : 'hsl(35 25% 55%)'}
              strokeWidth={isCurrent ? 2 : 1}
            />
            {visited && n.name && (
              <text
                x={p.px} y={p.py + NODE_R + 10}
                textAnchor="middle"
                fontSize={9}
                fill="hsl(35 25% 70%)"
                className="font-display select-none pointer-events-none"
              >
                {n.name}
              </text>
            )}
          </g>
        );
      })}

      {/* X marker on the target */}
      {(() => {
        const p = positions.get(highlightNodeId);
        if (!p) return null;
        const s = NODE_R + 4;
        return (
          <g style={{ filter: 'drop-shadow(0 0 4px hsl(0 90% 55%))' }}>
            <line x1={p.px - s} y1={p.py - s} x2={p.px + s} y2={p.py + s}
              stroke="hsl(0 90% 55%)" strokeWidth={3} strokeLinecap="round" />
            <line x1={p.px - s} y1={p.py + s} x2={p.px + s} y2={p.py - s}
              stroke="hsl(0 90% 55%)" strokeWidth={3} strokeLinecap="round" />
          </g>
        );
      })()}
    </svg>
  );
}
