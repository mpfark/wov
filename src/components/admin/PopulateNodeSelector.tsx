import { useMemo, useCallback, useState, useRef } from 'react';
import { Button } from '@/components/ui/button';

interface NodeData {
  id: string;
  name: string;
  connections: Array<{ node_id: string; direction: string }>;
}

interface Props {
  nodes: NodeData[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
}

const DIRECTION_OFFSETS: Record<string, [number, number]> = {
  N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0],
  NE: [1, -1], NW: [-1, -1], SE: [1, 1], SW: [-1, 1],
};

function layoutNodes(nodes: NodeData[]): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  if (nodes.length === 0) return positions;

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
      while ([...positions.values()].some(p => p.x === nx && p.y === ny)) {
        nx += offset[0] >= 0 ? 1 : -1;
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

export default function PopulateNodeSelector({ nodes, selectedIds, onToggle, onSelectAll, onDeselectAll }: Props) {
  const positions = useMemo(() => layoutNodes(nodes), [nodes]);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  const edges = useMemo(() => {
    const edgeSet = new Set<string>();
    const result: Array<{ from: string; to: string }> = [];
    const nodeIdSet = new Set(nodes.map(n => n.id));
    for (const node of nodes) {
      for (const conn of node.connections) {
        if (!nodeIdSet.has(conn.node_id)) continue;
        const key = [node.id, conn.node_id].sort().join('-');
        if (edgeSet.has(key)) continue;
        edgeSet.add(key);
        result.push({ from: node.id, to: conn.node_id });
      }
    }
    return result;
  }, [nodes]);

  const handleClick = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onToggle(id);
  }, [onToggle]);

  if (nodes.length === 0) return null;

  const GAP = 80;
  const PAD = 50;
  const vals = [...positions.values()];
  const minX = Math.min(...vals.map(p => p.x));
  const minY = Math.min(...vals.map(p => p.y));
  const maxX = Math.max(...vals.map(p => p.x));
  const maxY = Math.max(...vals.map(p => p.y));
  const width = (maxX - minX) * GAP + PAD * 2;
  const height = (maxY - minY) * GAP + PAD * 2;
  const offsetX = -minX * GAP + PAD;
  const offsetY = -minY * GAP + PAD;

  return (
    <div className="border border-border rounded p-2 space-y-1">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[10px] text-muted-foreground font-medium">
          Click nodes to select ({selectedIds.size}/{nodes.length})
        </span>
        <Button variant="link" size="sm" onClick={onSelectAll} className="text-[10px] h-4 p-0">All</Button>
        <Button variant="link" size="sm" onClick={onDeselectAll} className="text-[10px] h-4 p-0">None</Button>
      </div>
      <div
        className="overflow-hidden rounded bg-card/30 cursor-grab active:cursor-grabbing relative"
        style={{ maxHeight: '280px', minHeight: '160px' }}
        onWheel={(e) => {
          e.preventDefault();
          setZoom(z => Math.min(Math.max(z * (e.deltaY > 0 ? 0.9 : 1.1), 0.3), 4));
        }}
        onMouseDown={(e) => {
          if (e.button !== 0) return;
          setIsPanning(true);
          panStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
        }}
        onMouseMove={(e) => {
          if (!isPanning) return;
          setPan({
            x: panStart.current.panX + (e.clientX - panStart.current.x),
            y: panStart.current.panY + (e.clientY - panStart.current.y),
          });
        }}
        onMouseUp={() => setIsPanning(false)}
        onMouseLeave={() => setIsPanning(false)}
      >
        <div className="absolute top-1 right-1 z-10 flex gap-0.5">
          <button onClick={() => setZoom(z => Math.min(z * 1.2, 4))}
            className="w-5 h-5 rounded bg-card border border-border text-[10px] font-bold hover:bg-accent">+</button>
          <button onClick={() => setZoom(z => Math.max(z * 0.8, 0.3))}
            className="w-5 h-5 rounded bg-card border border-border text-[10px] font-bold hover:bg-accent">−</button>
          <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}
            className="h-5 px-1 rounded bg-card border border-border text-[9px] hover:bg-accent">⟲</button>
        </div>
        <svg
          width="100%"
          height="100%"
          viewBox={`0 0 ${Math.max(width, 160)} ${Math.max(height, 100)}`}
          className="block"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: '0 0',
            minHeight: '160px',
          }}
        >
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
              stroke="hsl(35 20% 35%)"
              strokeWidth={1.5}
              strokeDasharray="6 3"
            />
          );
        })}

        {/* Nodes */}
        {[...positions.entries()].map(([id, pos]) => {
          const px = pos.x * GAP + offsetX;
          const py = pos.y * GAP + offsetY;
          const isSelected = selectedIds.has(id);
          const name = nodes.find(n => n.id === id)?.name || id;

          return (
            <g
              key={id}
              onClick={(e) => handleClick(id, e)}
              className="cursor-pointer"
            >
              <circle
                cx={px} cy={py} r={22}
                fill={isSelected ? 'hsl(120 40% 30% / 0.35)' : 'hsl(35 15% 25% / 0.15)'}
                stroke={isSelected ? 'hsl(120 60% 55%)' : 'hsl(35 20% 40% / 0.5)'}
                strokeWidth={isSelected ? 2.5 : 1.5}
              />
              {isSelected && (
                <text x={px} y={py - 10} textAnchor="middle"
                  className="text-[10px] select-none pointer-events-none fill-primary">
                  ✓
                </text>
              )}
              <text
                x={px} y={py + (isSelected ? 5 : 3)}
                textAnchor="middle"
                className={`font-display text-[8px] pointer-events-none select-none ${
                  isSelected ? 'fill-primary' : 'fill-muted-foreground'
                }`}
              >
                {name.length > 10 ? name.slice(0, 9) + '…' : name}
              </text>
            </g>
          );
        })}
        </svg>
      </div>
    </div>
  );
}
