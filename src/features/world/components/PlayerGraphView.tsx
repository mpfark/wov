import { useState, useMemo, useEffect, useRef } from 'react';
import { GameNode, Area, useAreaTypes } from '@/features/world';
import { getAreaFillColor, getAreaStrokeColor } from '@/features/world/utils/area-colors';
import { computeRegionOutline, type Circle } from '@/features/world/utils/outline-geometry';
import { PartyMember } from '@/features/party';
import { supabase } from '@/integrations/supabase/client';

interface NodeCreatureInfo {
  hasCreatures: boolean;
  hasAggressive: boolean;
}

interface Props {
  currentNodeId: string;
  nodes: GameNode[];
  onNodeClick: (nodeId: string) => void;
  partyMembers?: PartyMember[];
  myCharacterId?: string;
  areas?: Area[];
  characterId?: string;
  unlockedConnections?: Map<string, number>;
}

const DIRECTION_OFFSETS: Record<string, [number, number]> = {
  N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0],
  NE: [1, -1], NW: [-1, -1], SE: [1, 1], SW: [-1, 1],
};

const PLAYER_NODE_RADIUS = 28;
const AREA_PAD = 10;
const AREA_OUTLINE_RADIUS = PLAYER_NODE_RADIUS + AREA_PAD;

export default function PlayerGraphView({ currentNodeId, nodes, onNodeClick, partyMembers, myCharacterId, areas: _areas = [], characterId, unlockedConnections }: Props) {
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [creatureMap, setCreatureMap] = useState<Map<string, NodeCreatureInfo>>(new Map());
  const [visitedNodeIds, setVisitedNodeIds] = useState<Set<string>>(new Set());
  const initialFetchDone = useRef(false);
  const { emojiMap } = useAreaTypes();

  const currentNode = nodes.find(n => n.id === currentNodeId);
  // Filter out hidden connections for player view (locked connections ARE visible)
  const visibleConnections = useMemo(() => {
    if (!currentNode) return [];
    return currentNode.connections.filter(c => !c.hidden);
  }, [currentNode]);

  const neighbors = useMemo(() => {
    if (!currentNode) return [];
    const connIds = new Set(visibleConnections.map(c => c.node_id));
    return nodes.filter(n => connIds.has(n.id));
  }, [currentNode, visibleConnections, nodes]);

  // Compute 2nd-degree visited nodes (neighbors of neighbors that have been visited before)
  const visitedSecondDegree = useMemo(() => {
    if (visitedNodeIds.size === 0) return [];
    const directIds = new Set([currentNodeId, ...neighbors.map(n => n.id)]);
    const secondDeg: GameNode[] = [];
    for (const neighbor of neighbors) {
      for (const conn of neighbor.connections.filter(c => !c.hidden)) {
        if (directIds.has(conn.node_id)) continue;
        if (!visitedNodeIds.has(conn.node_id)) continue;
        const node = nodes.find(n => n.id === conn.node_id);
        if (node && !secondDeg.some(s => s.id === node.id)) {
          secondDeg.push(node);
        }
      }
    }
    return secondDeg;
  }, [currentNodeId, neighbors, visitedNodeIds, nodes]);

  const positions = useMemo(() => {
    if (!currentNode) return new Map<string, { x: number; y: number }>();
    // Use stored coordinates, translated so current node is at center (0,0)
    const basePositions = new Map<string, { x: number; y: number }>();
    basePositions.set(currentNode.id, { x: 0, y: 0 });

    for (const neighbor of neighbors) {
      basePositions.set(neighbor.id, { x: neighbor.x - currentNode.x, y: neighbor.y - currentNode.y });
    }

    // Place 2nd-degree visited nodes using stored coords relative to current
    for (const secNode of visitedSecondDegree) {
      if (!basePositions.has(secNode.id)) {
        basePositions.set(secNode.id, { x: secNode.x - currentNode.x, y: secNode.y - currentNode.y });
      }
    }

    return basePositions;
  }, [currentNode, neighbors, visitedSecondDegree]);

  const { nodePositions, svgWidth, svgHeight, SPACING: _SPACING } = useMemo(() => {
    if (positions.size === 0) return { nodePositions: new Map<string, { px: number; py: number }>(), svgWidth: 300, svgHeight: 250, SPACING: 120 };

    const SPACING = 120;
    const PADDING = 70;

    // Only use primary nodes (current + direct neighbors) to determine SVG size
    // so ghost nodes don't cause the map to resize
    const primaryIds = new Set([currentNodeId, ...neighbors.map(n => n.id)]);
    const primaryVals = [...positions.entries()].filter(([id]) => primaryIds.has(id)).map(([, p]) => p);
    const sizeVals = primaryVals.length > 0 ? primaryVals : [...positions.values()];

    const minX = Math.min(...sizeVals.map(p => p.x));
    const maxX = Math.max(...sizeVals.map(p => p.x));
    const minY = Math.min(...sizeVals.map(p => p.y));
    const maxY = Math.max(...sizeVals.map(p => p.y));

    // Always ensure at least 1 unit extent in each direction from center so layout is stable
    const maxExtentX = Math.max(1, Math.abs(minX), Math.abs(maxX));
    const maxExtentY = Math.max(1, Math.abs(minY), Math.abs(maxY));

    // Add 1 extra unit of extent to accommodate ghost nodes without resizing
    const totalW = (maxExtentX + 1) * 2 * SPACING + PADDING * 2;
    const totalH = (maxExtentY + 1) * 2 * SPACING + PADDING * 2;
    const centerPx = totalW / 2;
    const centerPy = totalH / 2;

    const np = new Map<string, { px: number; py: number }>();
    positions.forEach((pos, id) => {
      np.set(id, {
        px: centerPx + pos.x * SPACING,
        py: centerPy + pos.y * SPACING,
      });
    });

    return {
      nodePositions: np,
      svgWidth: totalW,
      svgHeight: totalH,
      SPACING,
    };
  }, [positions]);

  const secondDegIds = useMemo(() => new Set(visitedSecondDegree.map(n => n.id)), [visitedSecondDegree]);

  // Collect edges (including edges from neighbors to 2nd-degree visited nodes)
  const edges = useMemo(() => {
    if (!currentNode) return [];
    const result: Array<{ from: string; to: string; label?: string; faded?: boolean; locked?: boolean }> = [];
    for (const conn of visibleConnections) {
      if (nodePositions.has(conn.node_id)) {
        const isLocked = !!conn.locked;
        const unlockKey = `${currentNode.id}-${conn.direction}`;
        const expiry = unlockedConnections?.get(unlockKey);
        const isUnlocked = expiry && Date.now() < expiry;
        result.push({ from: currentNode.id, to: conn.node_id, label: conn.label, locked: isLocked && !isUnlocked });
      }
    }
    // Add edges from neighbors to 2nd-degree visited nodes
    for (const neighbor of neighbors) {
      for (const conn of neighbor.connections.filter(c => !c.hidden)) {
        if (secondDegIds.has(conn.node_id) && nodePositions.has(conn.node_id)) {
          result.push({ from: neighbor.id, to: conn.node_id, faded: true });
        }
      }
    }
    return result;
  }, [currentNode, visibleConnections, nodePositions, neighbors, secondDegIds]);

  // Compute visible node IDs for creature fetch
  const visibleNodeIds = useMemo(() => {
    if (!currentNode) return [];
    return [currentNode.id, ...neighbors.map(n => n.id)];
  }, [currentNode, neighbors]);

  // Fetch visited nodes ONCE on mount, then accumulate client-side
  useEffect(() => {
    if (!characterId || initialFetchDone.current) return;
    initialFetchDone.current = true;
    const fetchVisited = async () => {
      const { data } = await supabase
        .from('character_visited_nodes')
        .select('node_id')
        .eq('character_id', characterId);
      if (data) {
        setVisitedNodeIds(new Set(data.map(d => d.node_id)));
      }
    };
    fetchVisited();
  }, [characterId]);

  // Accumulate current node into visited set + upsert to DB
  useEffect(() => {
    if (!characterId) return;
    setVisitedNodeIds(prev => {
      if (prev.has(currentNodeId)) return prev;
      const next = new Set(prev);
      next.add(currentNodeId);
      return next;
    });
    supabase.from('character_visited_nodes').upsert(
      { character_id: characterId, node_id: currentNodeId },
      { onConflict: 'character_id,node_id' }
    ).then();
  }, [characterId, currentNodeId]);

  // Fetch creature presence for all visible nodes (batched query)
  useEffect(() => {
    if (visibleNodeIds.length === 0) return;
    const fetchCreaturePresence = async () => {
      const { data } = await supabase
        .from('creatures')
        .select('node_id, is_aggressive')
        .eq('is_alive', true)
        .in('node_id', visibleNodeIds);
      const map = new Map<string, NodeCreatureInfo>();
      if (data) {
        for (const c of data) {
          if (!c.node_id) continue;
          const existing = map.get(c.node_id) || { hasCreatures: false, hasAggressive: false };
          existing.hasCreatures = true;
          if (c.is_aggressive) existing.hasAggressive = true;
          map.set(c.node_id, existing);
        }
      }
      setCreatureMap(map);
    };
    fetchCreaturePresence();
  }, [visibleNodeIds]);

  if (!currentNode) {
    return <p className="text-xs text-muted-foreground italic p-3">No location data...</p>;
  }

  const allDisplayNodes = [currentNode, ...neighbors, ...visitedSecondDegree];
  
  const displayedIds = new Set(allDisplayNodes.map(n => n.id));

  // Compute exit stubs for neighbor nodes (connections leading to nodes not displayed)
  const exitStubs: Array<{ fromPx: number; fromPy: number; toPx: number; toPy: number }> = [];
  const STUB_LEN = 22;
  const NODE_RADIUS = 28;
  for (const neighbor of neighbors) {
    const pos = nodePositions.get(neighbor.id);
    if (!pos) continue;
    for (const conn of neighbor.connections) {
      if (displayedIds.has(conn.node_id)) continue;
      const offset = DIRECTION_OFFSETS[conn.direction] || [1, 0];
      const len = Math.sqrt(offset[0] ** 2 + offset[1] ** 2) || 1;
      const dx = offset[0] / len;
      const dy = offset[1] / len;
      exitStubs.push({
        fromPx: pos.px + dx * NODE_RADIUS,
        fromPy: pos.py + dy * NODE_RADIUS,
        toPx: pos.px + dx * (NODE_RADIUS + STUB_LEN),
        toPy: pos.py + dy * (NODE_RADIUS + STUB_LEN),
      });
    }
  }

  // Compute party member positions on displayed nodes
  const partyMembersByNode = (() => {
    if (!partyMembers || partyMembers.length === 0) return new Map<string, PartyMember[]>();
    const map = new Map<string, PartyMember[]>();
    for (const m of partyMembers) {
      if (!m.character || m.character_id === myCharacterId) continue;
      const nodeId = m.character.current_node_id;
      if (!nodeId || !displayedIds.has(nodeId)) continue;
      if (!map.has(nodeId)) map.set(nodeId, []);
      map.get(nodeId)!.push(m);
    }
    return map;
  })();

  // Compute area outline hulls for displayed nodes
  const areaHulls = (() => {
    if (nodePositions.size === 0 || _areas.length === 0) return [];
    const primaryNodeIds = new Set(allDisplayNodes.filter(n => !secondDegIds.has(n.id)).map(n => n.id));
    const nodeById = new Map(nodes.map(node => [node.id, node]));
    const results: Array<{ path: string; fill: string; stroke: string }> = [];

    for (const area of _areas) {
      const areaNodes = allDisplayNodes.filter(n => n.area_id === area.id && primaryNodeIds.has(n.id));
      if (areaNodes.length === 0) continue;
      const areaNodeIds = new Set(areaNodes.map(n => n.id));
      const circles: Circle[] = [];

      for (const n of areaNodes) {
        const pos = nodePositions.get(n.id);
        if (pos) circles.push({ cx: pos.px, cy: pos.py, r: AREA_OUTLINE_RADIUS });
      }

      const edgeSpacing = AREA_OUTLINE_RADIUS * 1.4;
      for (const n of areaNodes) {
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

      // Bleed only from primary area nodes, but allow 2nd-degree ghost nodes to count as continuation targets.
      // This keeps the hull open toward continuation without creating giant branching blobs from every ghost node.
      for (const n of areaNodes) {
        const pos = nodePositions.get(n.id);
        if (!pos) continue;

        const continuationVectors = n.connections
          .map((conn) => {
            const isGhostTarget = secondDegIds.has(conn.node_id);
            const isVisiblePrimaryTarget = displayedIds.has(conn.node_id) && !isGhostTarget;
            if (isVisiblePrimaryTarget) return null;

            const target = nodeById.get(conn.node_id);
            if (!target || target.area_id !== area.id) return null;

            const rawDx = target.x - n.x;
            const rawDy = target.y - n.y;
            if (rawDx !== 0 || rawDy !== 0) {
              return { dx: rawDx, dy: rawDy };
            }

            const [fallbackDx, fallbackDy] = DIRECTION_OFFSETS[conn.direction] || [0, 0];
            if (fallbackDx === 0 && fallbackDy === 0) return null;
            return { dx: fallbackDx, dy: fallbackDy };
          })
          .filter((vector): vector is { dx: number; dy: number } => vector !== null);

        if (continuationVectors.length === 0) continue;

        let dx = 0;
        let dy = 0;
        for (const vector of continuationVectors) {
          dx += vector.dx;
          dy += vector.dy;
        }
        if (dx === 0 && dy === 0) {
          dx = continuationVectors[0].dx;
          dy = continuationVectors[0].dy;
        }

        const len = Math.hypot(dx, dy);
        if (len === 0) continue;

        const ux = dx / len;
        const uy = dy / len;
        const viewBoxWidth = Math.max(svgWidth, 280);
        const viewBoxHeight = Math.max(svgHeight, 200);
        const distancesToEdge = [
          ux > 0 ? (viewBoxWidth - pos.px) / ux : Infinity,
          ux < 0 ? -pos.px / ux : Infinity,
          uy > 0 ? (viewBoxHeight - pos.py) / uy : Infinity,
          uy < 0 ? -pos.py / uy : Infinity,
        ].filter((distance) => Number.isFinite(distance) && distance > 0);

        const distanceToEdge = distancesToEdge.length > 0 ? Math.min(...distancesToEdge) : _SPACING;
        const bleedDistance = distanceToEdge + AREA_OUTLINE_RADIUS;
        // Space bleed circles densely enough to overlap (max gap = 1.4 * radius)
        const stepSize = AREA_OUTLINE_RADIUS * 1.4;
        const bleedSteps = Math.max(2, Math.ceil(bleedDistance / stepSize));

        for (let step = 1; step <= bleedSteps; step++) {
          const travel = (bleedDistance * step) / bleedSteps;
          circles.push({
            cx: pos.px + ux * travel,
            cy: pos.py + uy * travel,
            r: AREA_OUTLINE_RADIUS,
          });
        }
      }

      if (circles.length === 0) continue;
      const emoji = emojiMap[area.area_type] || '📍';
      const { paths } = computeRegionOutline(circles);
      results.push({
        path: paths.join(' '),
        fill: getAreaFillColor(emoji),
        stroke: getAreaStrokeColor(emoji),
      });
    }
    return results;
  })();

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${Math.max(svgWidth, 280)} ${Math.max(svgHeight, 200)}`}
        className="block w-full h-auto"
        preserveAspectRatio="xMidYMid meet"
        overflow="hidden"
      >
        {/* Area outlines — color-coded by area type */}
        {areaHulls.map((hull, i) => (
          <path
            key={`area-hull-${i}`}
            d={hull.path}
            fill={hull.fill}
            stroke={hull.stroke}
            strokeWidth={1.5}
            className="pointer-events-none"
          />
        ))}

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
                stroke={edge.locked ? "hsl(35 80% 50%)" : edge.faded ? "hsl(35 20% 35% / 0.3)" : "hsl(35 20% 35%)"}
                strokeWidth={edge.faded ? 1.5 : 2} strokeDasharray={edge.locked ? "3 5" : edge.faded ? "4 4" : "6 3"}
              />
              {edge.locked && (
                <text x={midX} y={midY} textAnchor="middle" dominantBaseline="central" className="text-[10px] select-none pointer-events-none">
                  🔒
                </text>
              )}
            </g>
          );
        })}

        {/* Exit stubs — short dashed lines showing additional exits from neighbors */}
        {exitStubs.map((stub, i) => (
          <line
            key={`stub-${i}`}
            x1={stub.fromPx} y1={stub.fromPy} x2={stub.toPx} y2={stub.toPy}
            stroke="hsl(35 20% 35% / 0.6)" strokeWidth={2} strokeDasharray="4 3"
          />
        ))}

        {/* Nodes */}
        {allDisplayNodes.map(node => {
          const pos = nodePositions.get(node.id);
          if (!pos) return null;
          const isCurrent = node.id === currentNodeId;
          const isHovered = hoveredNode === node.id;
          const isVisitedGhost = secondDegIds.has(node.id);

          return (
            <g key={node.id}
              onMouseEnter={() => setHoveredNode(node.id)}
              onMouseLeave={() => setHoveredNode(null)}
              opacity={isVisitedGhost ? 0.35 : 1}
            >
              {/* Glow for current node */}
              {isCurrent && (
                <circle cx={pos.px} cy={pos.py} r={34}
                  className="fill-none stroke-primary/30"
                  strokeWidth={4}
                />
              )}
              {/* Node circle */}
              <circle
                cx={pos.px} cy={pos.py} r={isVisitedGhost ? 22 : 28}
                className={`transition-all duration-200 ${
                  isCurrent
                    ? 'fill-primary/20 stroke-primary'
                    : isVisitedGhost
                    ? 'fill-muted/30 stroke-muted-foreground/30'
                    : isHovered
                    ? 'fill-primary/10 stroke-primary/70 cursor-pointer'
                    : 'fill-card stroke-border cursor-pointer'
                }`}
                strokeWidth={isCurrent ? 2.5 : isVisitedGhost ? 1 : isHovered ? 2 : 1.5}
                strokeDasharray={isVisitedGhost ? "3 2" : undefined}
                onClick={() => !isCurrent && !isVisitedGhost && onNodeClick(node.id)}
              />
              {/* Creature presence dot */}
              {creatureMap.has(node.id) && (() => {
                const info = creatureMap.get(node.id)!;
                return (
                  <circle
                    cx={pos.px + 20} cy={pos.py - 20} r={4}
                    fill={info.hasAggressive ? 'hsl(0 70% 50%)' : 'hsl(35 60% 50%)'}
                    className="stroke-background pointer-events-none"
                    strokeWidth={1.5}
                  />
                );
              })()}
              {/* Service icons positioned outside the node circle */}
              {node.is_vendor && (
                <text x={pos.px - 26} y={pos.py - 26} textAnchor="middle" className="text-[10px] select-none pointer-events-none">
                  🪙
                </text>
              )}
              {node.is_inn && (
                <text x={pos.px + 26} y={pos.py - 26} textAnchor="middle" className="text-[10px] select-none pointer-events-none">
                  🏨
                </text>
              )}
              {node.is_blacksmith && (
                <text x={pos.px - 26} y={pos.py + 30} textAnchor="middle" className="text-[10px] select-none pointer-events-none">
                  🔨
                </text>
              )}
              {node.is_teleport && (
                <text x={pos.px + 26} y={pos.py + 30} textAnchor="middle" className="text-[10px] select-none pointer-events-none">
                  🌀
                </text>
              )}
              {(node as any).is_trainer && (
                <text x={pos.px} y={pos.py + 34} textAnchor="middle" className="text-[10px] select-none pointer-events-none">
                  🏋️
                </text>
              )}
            </g>
          );
        })}
        {/* Party member indicators */}
        {[...partyMembersByNode.entries()].map(([nodeId, pmembers]) => {
          const pos = nodePositions.get(nodeId);
          if (!pos) return null;
          return pmembers.map((m, i) => {
            // Place party dots along the bottom arc (π/4 to 3π/4) to avoid top indicators
            const startAngle = Math.PI * 0.25;
            const endAngle = Math.PI * 0.75;
            const angle = pmembers.length === 1
              ? Math.PI / 2
              : startAngle + (i / (pmembers.length - 1)) * (endAngle - startAngle);
            const r = 22;
            const cx = pos.px + Math.cos(angle) * r;
            const cy = pos.py + Math.sin(angle) * r;
            return (
              <g key={`pm-${m.id}`}>
                <circle cx={cx} cy={cy} r={5} className="fill-chart-2 stroke-background" strokeWidth={1.5} />
                <text x={cx} y={cy + 3} textAnchor="middle" className="fill-background text-[6px] font-bold pointer-events-none select-none">
                  {m.character.name.charAt(0)}
                </text>
                <title>{m.character.name}</title>
              </g>
            );
          });
        })}
      </svg>
    </div>
  );
}
