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

interface AreaHull {
  path: string;
  fill: string;
  stroke: string;
  faded?: boolean;
}

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

  // Filter ghost nodes to only those that fit inside the viewBox — otherwise their
  // edges/hulls get clipped at the SVG edge and appear as floating dashed segments
  // disconnected from any visible node.
  const visibleSecondDegree = useMemo(() => {
    const GHOST_MARGIN = PLAYER_NODE_RADIUS;
    return visitedSecondDegree.filter(n => {
      const pos = nodePositions.get(n.id);
      if (!pos) return false;
      return (
        pos.px >= GHOST_MARGIN &&
        pos.px <= svgWidth - GHOST_MARGIN &&
        pos.py >= GHOST_MARGIN &&
        pos.py <= svgHeight - GHOST_MARGIN
      );
    });
  }, [visitedSecondDegree, nodePositions, svgWidth, svgHeight]);

  const secondDegIds = useMemo(() => new Set(visibleSecondDegree.map(n => n.id)), [visibleSecondDegree]);

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

  const viewBoxWidth = Math.max(svgWidth, 280);
  const viewBoxHeight = Math.max(svgHeight, 200);

  const allDisplayNodes = [currentNode, ...neighbors, ...visibleSecondDegree];
  
  const displayedIds = new Set(allDisplayNodes.map(n => n.id));

  // Compute exit stubs for neighbor nodes (connections leading to nodes not displayed)
  // IMPORTANT: only render stubs whose destination node is actually loaded/visible to
  // this character (i.e. exists in `nodes`). Connections to nodes filtered out by
  // tier gating, RLS, or out-of-bounds must NOT produce ghost stubs.
  const loadedNodeIds = useMemo(() => new Set(nodes.map(n => n.id)), [nodes]);
  const exitStubs: Array<{ fromPx: number; fromPy: number; toPx: number; toPy: number }> = [];
  const STUB_LEN = 22;
  const NODE_RADIUS = 28;
  for (const neighbor of neighbors) {
    const pos = nodePositions.get(neighbor.id);
    if (!pos) continue;
    for (const conn of neighbor.connections) {
      if (conn.hidden) continue;
      if (displayedIds.has(conn.node_id)) continue;
      if (!loadedNodeIds.has(conn.node_id)) continue;
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

  // Compute area outline hulls — primary nodes at full opacity, ghost-only portions faded
  const areaHulls = (() => {
    if (nodePositions.size === 0 || _areas.length === 0) return [] as AreaHull[];

    const primaryIds = new Set([currentNodeId, ...neighbors.map(n => n.id)]);
    const hulls: AreaHull[] = [];

    const buildHull = (areaNodes: typeof allDisplayNodes, areaNodeIds: Set<string>): string | null => {
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
      if (circles.length === 0) return null;
      const { paths } = computeRegionOutline(circles);
      return paths.length > 0 ? paths.join(' ') : null;
    };

    for (const area of _areas) {
      const allAreaNodes = allDisplayNodes.filter(n => n.area_id === area.id);
      if (allAreaNodes.length === 0) continue;

      const emoji = emojiMap[area.area_type] || '📍';
      const fill = getAreaFillColor(emoji);
      const stroke = getAreaStrokeColor(emoji);
      const hasGhostNodes = allAreaNodes.some(n => secondDegIds.has(n.id));

      if (hasGhostNodes) {
        // Render unified hull at ghost opacity (faded layer underneath)
        const allAreaNodeIds = new Set(allAreaNodes.map(n => n.id));
        const fullPath = buildHull(allAreaNodes, allAreaNodeIds);
        if (fullPath) {
          hulls.push({ path: fullPath, fill, stroke, faded: true });
        }
      }

      // Render primary hull at full opacity on top
      const primaryAreaNodes = allAreaNodes.filter(n => primaryIds.has(n.id));
      if (primaryAreaNodes.length > 0) {
        const primaryAreaNodeIds = new Set(primaryAreaNodes.map(n => n.id));
        const primaryPath = buildHull(primaryAreaNodes, primaryAreaNodeIds);
        if (primaryPath) {
          hulls.push({ path: primaryPath, fill, stroke });
        }
      }
    }
    return hulls;
  })();

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${viewBoxWidth} ${viewBoxHeight}`}
        className="block w-full h-auto"
        preserveAspectRatio="xMidYMid meet"
        overflow="hidden"
      >
        {/* Area outlines — color-coded by area type */}
        <g className="pointer-events-none">
          {areaHulls.map((hull, i) => (
            <path
              key={`area-hull-${i}`}
              d={hull.path}
              fill={hull.fill}
              stroke={hull.stroke}
              strokeWidth={hull.faded ? 1 : 1.5}
              opacity={hull.faded ? 0.35 : 1}
              strokeDasharray={hull.faded ? "3 2" : undefined}
            />
          ))}
        </g>

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
                  🏛️
                </text>
              )}
              {(node as any).is_marketplace && (
                <text x={pos.px + 26} y={pos.py + 12} textAnchor="middle" className="text-[10px] select-none pointer-events-none">
                  🏛️
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
