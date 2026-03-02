import { useMemo, useState } from 'react';
import { useAreaTypes } from '@/hooks/useAreaTypes';
import { getAreaPreviewColor } from '@/lib/area-colors';

interface GeneratedArea {
  temp_id: string;
  name: string;
  description: string;
  area_type: string;
}

interface GeneratedNode {
  temp_id: string;
  name: string;
  description: string;
  area_temp_id?: string;
  is_inn?: boolean;
  is_vendor?: boolean;
  is_blacksmith?: boolean;
  connections: { target_temp_id: string; direction: string }[];
}

interface GeneratedCreature {
  temp_id?: string;
  name: string;
  node_temp_id: string;
  rarity: string;
  is_aggressive: boolean;
  is_humanoid?: boolean;
}

interface GeneratedNPC {
  name: string;
  node_temp_id: string;
}

interface GeneratedItem {
  temp_id: string;
  name: string;
  item_type: string;
  rarity: string;
  creature_temp_ids: string[];
}

interface ExistingAnchor {
  id: string;
  name: string;
}

interface Props {
  nodes: GeneratedNode[];
  creatures: GeneratedCreature[];
  npcs: GeneratedNPC[];
  items: GeneratedItem[];
  areas?: GeneratedArea[];
  existingAnchors?: ExistingAnchor[];
  mode: 'rulebook' | 'new' | 'expand' | 'populate';
  populateNodeNames?: Map<string, string>;
}


const DIRECTION_OFFSETS: Record<string, [number, number]> = {
  N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0],
  NE: [1, -1], NW: [-1, -1], SE: [1, 1], SW: [-1, 1],
};

function layoutPreviewNodes(
  nodes: GeneratedNode[],
  existingAnchors: ExistingAnchor[]
): Map<string, { x: number; y: number; isExisting: boolean }> {
  const positions = new Map<string, { x: number; y: number; isExisting: boolean }>();
  if (nodes.length === 0 && existingAnchors.length === 0) return positions;

  const visited = new Set<string>();
  const nodeMap = new Map(nodes.map(n => [n.temp_id, n]));
  const existingIds = new Set(existingAnchors.map(a => `existing:${a.id}`));

  if (nodes.length > 0) {
    const startId = nodes[0].temp_id;
    const queue: Array<{ id: string; x: number; y: number }> = [{ id: startId, x: 0, y: 0 }];
    visited.add(startId);
    positions.set(startId, { x: 0, y: 0, isExisting: false });

    while (queue.length > 0) {
      const current = queue.shift()!;
      const node = nodeMap.get(current.id);
      if (!node) continue;

      for (const conn of node.connections) {
        const targetId = conn.target_temp_id;
        if (visited.has(targetId)) continue;
        visited.add(targetId);

        const offset = DIRECTION_OFFSETS[conn.direction] || [1, 0];
        let nx = current.x + offset[0];
        let ny = current.y + offset[1];

        while ([...positions.values()].some(p => p.x === nx && p.y === ny)) {
          nx += offset[0] >= 0 ? 1 : -1;
        }

        const isExisting = existingIds.has(targetId);
        positions.set(targetId, { x: nx, y: ny, isExisting });

        if (!isExisting) {
          queue.push({ id: targetId, x: nx, y: ny });
        }
      }
    }

    let row = 0;
    for (const node of nodes) {
      if (!positions.has(node.temp_id)) {
        const maxX = Math.max(0, ...[...positions.values()].map(p => p.x));
        positions.set(node.temp_id, { x: maxX + 2, y: row++, isExisting: false });
      }
    }
  }

  return positions;
}

export default function WorldBuilderPreviewGraph({
  nodes, creatures, npcs, items, areas = [], existingAnchors = [], mode, populateNodeNames,
}: Props) {
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const { emojiMap } = useAreaTypes();

  const populatePositions = useMemo(() => {
    if (mode !== 'populate' || !populateNodeNames) return null;
    const pos = new Map<string, { x: number; y: number; isExisting: boolean }>();
    const ids = [...populateNodeNames.keys()];
    const cols = Math.ceil(Math.sqrt(ids.length));
    ids.forEach((id, i) => {
      pos.set(id, { x: i % cols, y: Math.floor(i / cols), isExisting: true });
    });
    return pos;
  }, [mode, populateNodeNames]);

  const positions = useMemo(() => {
    if (mode === 'populate') return populatePositions || new Map();
    return layoutPreviewNodes(nodes, existingAnchors);
  }, [nodes, existingAnchors, mode, populatePositions]);

  const creatureCounts = useMemo(() => {
    const counts = new Map<string, { total: number; aggressive: number; humanoid: number }>();
    for (const cr of creatures) {
      const entry = counts.get(cr.node_temp_id) || { total: 0, aggressive: 0, humanoid: 0 };
      entry.total++;
      if (cr.is_aggressive) entry.aggressive++;
      if (cr.is_humanoid) entry.humanoid++;
      counts.set(cr.node_temp_id, entry);
    }
    return counts;
  }, [creatures]);

  const npcCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const npc of npcs) {
      counts.set(npc.node_temp_id, (counts.get(npc.node_temp_id) || 0) + 1);
    }
    return counts;
  }, [npcs]);

  const itemCountsPerNode = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      for (const creatureTempId of item.creature_temp_ids) {
        const creature = creatures.find(c => c.temp_id === creatureTempId);
        if (creature) {
          counts.set(creature.node_temp_id, (counts.get(creature.node_temp_id) || 0) + 1);
        }
      }
    }
    return counts;
  }, [items, creatures]);

  const edges = useMemo(() => {
    const edgeSet = new Set<string>();
    const result: Array<{ from: string; to: string; toExisting: boolean }> = [];
    for (const node of nodes) {
      for (const conn of node.connections) {
        const key = [node.temp_id, conn.target_temp_id].sort().join('-');
        if (edgeSet.has(key)) continue;
        if (!positions.has(node.temp_id) || !positions.has(conn.target_temp_id)) continue;
        edgeSet.add(key);
        result.push({
          from: node.temp_id,
          to: conn.target_temp_id,
          toExisting: conn.target_temp_id.startsWith('existing:'),
        });
      }
    }
    return result;
  }, [nodes, positions]);

  const hoveredInfo = useMemo(() => {
    if (!hoveredNode) return null;
    const cc = creatureCounts.get(hoveredNode);
    const nc = npcCounts.get(hoveredNode) || 0;
    const ic = itemCountsPerNode.get(hoveredNode) || 0;
    const node = nodes.find(n => n.temp_id === hoveredNode);
    const area = node?.area_temp_id ? areas.find(a => a.temp_id === node.area_temp_id) : null;
    const desc = node?.description || area?.description;
    const crList = creatures.filter(c => c.node_temp_id === hoveredNode);
    const npcList = npcs.filter(n => n.node_temp_id === hoveredNode);
    const nodeCreatureTempIds = crList.map(c => c.temp_id).filter(Boolean) as string[];
    const itemList = items.filter(item => item.creature_temp_ids.some(id => nodeCreatureTempIds.includes(id)));
    let name = hoveredNode;
    if (mode === 'populate' && populateNodeNames) {
      name = populateNodeNames.get(hoveredNode) || hoveredNode;
    } else if (hoveredNode.startsWith('existing:')) {
      const realId = hoveredNode.replace('existing:', '');
      name = existingAnchors.find(a => a.id === realId)?.name || 'Existing';
    } else {
      name = node?.name || area?.name || hoveredNode;
    }
    return { name, cc, nc, ic, desc, crList, npcList, itemList, areaType: area?.area_type };
  }, [hoveredNode, nodes, creatures, npcs, items, areas, creatureCounts, npcCounts, itemCountsPerNode, mode, populateNodeNames, existingAnchors]);

  if (positions.size === 0) return null;

  const GAP = 90;
  const PAD = 60;
  const vals = [...positions.values()];
  const minX = Math.min(...vals.map(p => p.x));
  const minY = Math.min(...vals.map(p => p.y));
  const maxX = Math.max(...vals.map(p => p.x));
  const maxY = Math.max(...vals.map(p => p.y));
  const width = (maxX - minX) * GAP + PAD * 2;
  const height = (maxY - minY) * GAP + PAD * 2;
  const offsetX = -minX * GAP + PAD;
  const offsetY = -minY * GAP + PAD;

  const getNodeName = (id: string) => {
    if (mode === 'populate' && populateNodeNames) {
      return populateNodeNames.get(id) || id;
    }
    if (id.startsWith('existing:')) {
      const realId = id.replace('existing:', '');
      return existingAnchors.find(a => a.id === realId)?.name || 'Existing';
    }
    const node = nodes.find(n => n.temp_id === id);
    if (node?.name) return node.name;
    const area = node?.area_temp_id ? areas.find(a => a.temp_id === node.area_temp_id) : null;
    return area?.name || id;
  };

  const getNodeFlags = (id: string) => {
    const node = nodes.find(n => n.temp_id === id);
    if (!node) return '';
    return [node.is_inn && '🏨', node.is_vendor && '🛒', node.is_blacksmith && '🔨'].filter(Boolean).join('');
  };

  const getNodeAreaColor = (id: string): string | null => {
    const node = nodes.find(n => n.temp_id === id);
    if (!node?.area_temp_id) return null;
    const area = areas.find(a => a.temp_id === node.area_temp_id);
    if (!area) return null;
    const emoji = emojiMap[area.area_type] || '📍';
    return getAreaPreviewColor(emoji);
  };

  return (
    <div className="relative">
      <svg
        width="100%"
        viewBox={`0 0 ${Math.max(width, 200)} ${Math.max(height, 120)}`}
        className="block border border-border rounded bg-card/30"
        style={{ maxHeight: '300px' }}
      >
        {/* Edges */}
        {edges.map(edge => {
          const from = positions.get(edge.from);
          const to = positions.get(edge.to);
          if (!from || !to) return null;
          return (
            <line
              key={`${edge.from}-${edge.to}`}
              x1={from.x * GAP + offsetX}
              y1={from.y * GAP + offsetY}
              x2={to.x * GAP + offsetX}
              y2={to.y * GAP + offsetY}
              stroke={edge.toExisting ? 'hsl(200 60% 55% / 0.7)' : 'hsl(35 20% 35%)'}
              strokeWidth={edge.toExisting ? 2.5 : 1.5}
              strokeDasharray={edge.toExisting ? '8 4' : '6 3'}
            />
          );
        })}

        {/* Nodes */}
        {[...positions.entries()].map(([id, pos]) => {
          const px = pos.x * GAP + offsetX;
          const py = pos.y * GAP + offsetY;
          const isExisting = pos.isExisting;
          const isHovered = hoveredNode === id;
          const name = getNodeName(id);
          const flags = getNodeFlags(id);
          const cc = creatureCounts.get(id);
          const nc = npcCounts.get(id) || 0;
          const ic = itemCountsPerNode.get(id) || 0;
          const areaColor = getNodeAreaColor(id);

          return (
            <g
              key={id}
              onMouseEnter={() => setHoveredNode(id)}
              onMouseLeave={() => setHoveredNode(null)}
              className="cursor-pointer"
            >
              {/* Area color ring */}
              {areaColor && !isExisting && (
                <circle
                  cx={px} cy={py} r={30}
                  fill="none"
                  stroke={areaColor}
                  strokeWidth={3}
                />
              )}

              <circle
                cx={px} cy={py} r={26}
                fill={isExisting
                  ? isHovered ? 'hsl(200 30% 30% / 0.3)' : 'hsl(200 20% 25% / 0.15)'
                  : isHovered ? 'hsl(120 40% 30% / 0.3)' : 'hsl(120 30% 25% / 0.15)'
                }
                stroke={isExisting
                  ? isHovered ? 'hsl(200 60% 55%)' : 'hsl(200 40% 50% / 0.5)'
                  : isHovered ? 'hsl(120 60% 55%)' : 'hsl(120 40% 50% / 0.6)'
                }
                strokeWidth={isHovered ? 2.5 : 1.5}
                strokeDasharray={isExisting ? '4 2' : 'none'}
              />

              {flags && (
                <text x={px} y={py - 12} textAnchor="middle"
                  className="text-[8px] select-none pointer-events-none">
                  {flags}
                </text>
              )}

              {cc && cc.aggressive > 0 && (
                <circle cx={px - 10} cy={py + 16} r={3.5}
                  fill="hsl(0 70% 50%)" className="stroke-background" strokeWidth={1} />
              )}
              {cc && cc.total - cc.aggressive > 0 && (
                <circle cx={px + (cc.aggressive > 0 ? -2 : -4)} cy={py + 16} r={3.5}
                  fill="hsl(35 60% 50%)" className="stroke-background" strokeWidth={1} />
              )}
              {nc > 0 && (
                <text x={px + 6} y={py + 20}
                  className="text-[7px] select-none pointer-events-none">💬</text>
              )}
              {ic > 0 && (
                <text x={px + 14} y={py + 20}
                  className="text-[7px] select-none pointer-events-none">📦</text>
              )}

              <text
                x={px} y={py + 3}
                textAnchor="middle"
                className={`font-display text-[9px] pointer-events-none select-none ${
                  isExisting ? 'fill-muted-foreground' : isHovered ? 'fill-primary' : 'fill-foreground'
                }`}
              >
                {name.length > 12 ? name.slice(0, 11) + '…' : name}
              </text>

              {isExisting && (
                <text x={px} y={py + 36} textAnchor="middle"
                  className="fill-muted-foreground text-[7px] select-none pointer-events-none italic">
                  existing
                </text>
              )}

              {(cc?.total || nc > 0 || ic > 0) && (
                <text x={px} y={py + (isExisting ? 46 : 36)} textAnchor="middle"
                  className="fill-muted-foreground text-[7px] select-none pointer-events-none">
                  {cc?.total ? `${cc.total}c` : ''}{nc > 0 ? ` ${nc}n` : ''}{ic > 0 ? ` ${ic}i` : ''}
                </text>
              )}
            </g>
          );
        })}

        {/* Legend */}
        <g transform={`translate(8, ${Math.max(height, 120) - 30})`}>
          <circle cx={6} cy={6} r={5} fill="hsl(120 30% 25% / 0.15)" stroke="hsl(120 40% 50% / 0.6)" strokeWidth={1.5} />
          <text x={16} y={9} className="fill-muted-foreground text-[8px]">New</text>
          <circle cx={46} cy={6} r={5} fill="hsl(200 20% 25% / 0.15)" stroke="hsl(200 40% 50% / 0.5)" strokeWidth={1.5} strokeDasharray="3 2" />
          <text x={56} y={9} className="fill-muted-foreground text-[8px]">Existing</text>
          <circle cx={100} cy={6} r={3} fill="hsl(0 70% 50%)" />
          <text x={108} y={9} className="fill-muted-foreground text-[8px]">Aggro</text>
          <circle cx={140} cy={6} r={3} fill="hsl(35 60% 50%)" />
          <text x={148} y={9} className="fill-muted-foreground text-[8px]">Passive</text>
          <text x={170} y={9} className="fill-muted-foreground text-[8px]">📦 Items</text>
        </g>
      </svg>

      {/* Tooltip */}
      {hoveredInfo && (
        <div className="absolute top-2 right-2 bg-card border border-border rounded p-2 shadow-lg max-w-[200px] z-10">
          <div className="font-display text-xs text-primary">{hoveredInfo.name}</div>
          {hoveredInfo.areaType && (
            <span className="text-[9px] text-muted-foreground italic">{hoveredInfo.areaType}</span>
          )}
          {hoveredInfo.desc && (
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {hoveredInfo.desc.slice(0, 100)}{hoveredInfo.desc.length > 100 ? '…' : ''}
            </p>
          )}
          {hoveredInfo.crList.length > 0 && (
            <div className="mt-1">
              <span className="text-[9px] text-muted-foreground font-medium">Creatures:</span>
              {hoveredInfo.crList.map((cr, i) => (
                <div key={i} className="text-[9px] text-muted-foreground">
                  {cr.is_aggressive ? '⚔' : '🐾'} {cr.name} ({cr.rarity}){cr.is_humanoid ? ' 🧑' : ''}
                </div>
              ))}
            </div>
          )}
          {hoveredInfo.itemList.length > 0 && (
            <div className="mt-1">
              <span className="text-[9px] text-muted-foreground font-medium">Items:</span>
              {hoveredInfo.itemList.map((item, i) => (
                <div key={i} className="text-[9px] text-muted-foreground">
                  📦 {item.name} ({item.rarity})
                </div>
              ))}
            </div>
          )}
          {hoveredInfo.npcList.length > 0 && (
            <div className="mt-1">
              <span className="text-[9px] text-muted-foreground font-medium">NPCs:</span>
              {hoveredInfo.npcList.map((npc, i) => (
                <div key={i} className="text-[9px] text-muted-foreground">💬 {npc.name}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
