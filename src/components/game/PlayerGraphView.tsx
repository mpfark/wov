import { useState, useMemo, useEffect } from 'react';
import { GameNode, Area, getNodeDisplayName } from '@/hooks/useNodes';
import { PartyMember } from '@/hooks/useParty';
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
}

const DIRECTION_OFFSETS: Record<string, [number, number]> = {
  N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0],
  NE: [1, -1], NW: [-1, -1], SE: [1, 1], SW: [-1, 1],
};

function layoutFromCenter(currentNode: GameNode, neighbors: GameNode[]) {
  const positions = new Map<string, { x: number; y: number }>();
  positions.set(currentNode.id, { x: 0, y: 0 });

  for (const conn of currentNode.connections) {
    const neighbor = neighbors.find(n => n.id === conn.node_id);
    if (!neighbor) continue;
    const offset = DIRECTION_OFFSETS[conn.direction] || [1, 0];
    let nx = offset[0];
    let ny = offset[1];
    // Avoid collisions
    while ([...positions.values()].some(p => p.x === nx && p.y === ny)) {
      nx += offset[0] || 1;
      ny += offset[1] || 1;
    }
    positions.set(neighbor.id, { x: nx, y: ny });
  }

  return positions;
}

export default function PlayerGraphView({ currentNodeId, nodes, onNodeClick, partyMembers, myCharacterId, areas = [], characterId }: Props) {
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [creatureMap, setCreatureMap] = useState<Map<string, NodeCreatureInfo>>(new Map());
  const [visitedNodeIds, setVisitedNodeIds] = useState<Set<string>>(new Set());

  const currentNode = nodes.find(n => n.id === currentNodeId);
  // Filter out hidden connections for player view
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
    // Use a virtual node with only visible connections for layout
    const virtualNode = { ...currentNode, connections: visibleConnections };
    const basePositions = layoutFromCenter(virtualNode, neighbors);

    // Place 2nd-degree visited nodes beyond their parent neighbor
    for (const secNode of visitedSecondDegree) {
      // Find which neighbor connects to this node
      for (const neighbor of neighbors) {
        const conn = neighbor.connections.find(c => c.node_id === secNode.id && !c.hidden);
        if (!conn) continue;
        const neighborPos = basePositions.get(neighbor.id);
        if (!neighborPos) continue;
        const offset = DIRECTION_OFFSETS[conn.direction] || [1, 0];
        let nx = neighborPos.x + offset[0];
        let ny = neighborPos.y + offset[1];
        // Avoid collisions
        while ([...basePositions.values()].some(p => p.x === nx && p.y === ny)) {
          nx += offset[0] || 1;
          ny += offset[1] || 1;
        }
        basePositions.set(secNode.id, { x: nx, y: ny });
        break;
      }
    }

    return basePositions;
  }, [currentNode, visibleConnections, neighbors, visitedSecondDegree]);

  const { nodePositions, svgWidth, svgHeight, SPACING } = useMemo(() => {
    if (positions.size === 0) return { nodePositions: new Map<string, { px: number; py: number }>(), svgWidth: 300, svgHeight: 250, SPACING: 120 };

    const SPACING = 120;
    const PADDING = 70;
    const vals = [...positions.values()];
    const minX = Math.min(...vals.map(p => p.x));
    const maxX = Math.max(...vals.map(p => p.x));
    const minY = Math.min(...vals.map(p => p.y));
    const maxY = Math.max(...vals.map(p => p.y));

    // Always ensure at least 1 unit extent in each direction from center so layout is stable
    const maxExtentX = Math.max(1, Math.abs(minX), Math.abs(maxX));
    const maxExtentY = Math.max(1, Math.abs(minY), Math.abs(maxY));

    const totalW = maxExtentX * 2 * SPACING + PADDING * 2;
    const totalH = maxExtentY * 2 * SPACING + PADDING * 2;
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

  // Collect edges
  const edges = useMemo(() => {
    if (!currentNode) return [];
    const result: Array<{ from: string; to: string; label?: string }> = [];
    for (const conn of visibleConnections) {
      if (nodePositions.has(conn.node_id)) {
        result.push({ from: currentNode.id, to: conn.node_id, label: conn.label });
      }
    }
    return result;
  }, [currentNode, visibleConnections, nodePositions]);

  // Compute visible node IDs for creature fetch
  const visibleNodeIds = useMemo(() => {
    if (!currentNode) return [];
    return [currentNode.id, ...neighbors.map(n => n.id)];
  }, [currentNode, neighbors]);

  // Fetch visited nodes for this character
  useEffect(() => {
    if (!characterId) return;
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
    // Also upsert current node as visited
    supabase.from('character_visited_nodes').upsert(
      { character_id: characterId, node_id: currentNodeId },
      { onConflict: 'character_id,node_id' }
    ).then();
  }, [characterId, currentNodeId]);

  // Fetch creature presence for all visible nodes
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

  const allDisplayNodes = [currentNode, ...neighbors];
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

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${Math.max(svgWidth, 280)} ${Math.max(svgHeight, 200)}`}
        className="block w-full h-auto"
        preserveAspectRatio="xMidYMid meet"
      >
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
                stroke="hsl(35 20% 35%)" strokeWidth={2} strokeDasharray="6 3"
              />
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

          return (
            <g key={node.id}
              onMouseEnter={() => setHoveredNode(node.id)}
              onMouseLeave={() => setHoveredNode(null)}
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
                cx={pos.px} cy={pos.py} r={28}
                className={`transition-all duration-200 ${
                  isCurrent
                    ? 'fill-primary/20 stroke-primary'
                    : isHovered
                    ? 'fill-primary/10 stroke-primary/70 cursor-pointer'
                    : 'fill-card stroke-border cursor-pointer'
                }`}
                strokeWidth={isCurrent ? 2.5 : isHovered ? 2 : 1.5}
                onClick={() => !isCurrent && onNodeClick(node.id)}
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
              {/* Current marker */}
              {isCurrent && (
                <text x={pos.px} y={pos.py - 16} textAnchor="middle"
                  className="fill-primary text-[10px] select-none pointer-events-none font-display">
                  ◆
                </text>
              )}
              {/* Node name */}
              {(() => {
                const nodeArea = node.area_id ? areas.find(a => a.id === node.area_id) : undefined;
                let displayName = getNodeDisplayName(node, nodeArea);
                // For unnamed nodes, show the travel direction instead
                if (displayName === 'Unknown Location' && !isCurrent) {
                  const conn = currentNode.connections.find(c => c.node_id === node.id);
                  if (conn) {
                    const dirNames: Record<string, string> = {
                      N: 'North', S: 'South', E: 'East', W: 'West',
                      NE: 'Northeast', NW: 'Northwest', SE: 'Southeast', SW: 'Southwest',
                    };
                    displayName = dirNames[conn.direction] || conn.direction;
                  }
                }
                const truncated = displayName.length > 14 ? displayName.slice(0, 13) + '…' : displayName;
                return (
                  <text
                    x={pos.px} y={pos.py + 4}
                    textAnchor="middle"
                    className={`font-display text-[10px] pointer-events-none select-none ${
                      isCurrent ? 'fill-primary' : isHovered ? 'fill-primary/80' : 'fill-foreground'
                    }`}
                  >
                    {truncated}
                  </text>
                );
              })()}
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
