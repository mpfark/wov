import { useState, useCallback, useRef, useEffect } from 'react';
import { GameNode } from '@/hooks/useNodes';
import { type Direction } from '@/hooks/useKeyboardMovement';
import { GripHorizontal } from 'lucide-react';

interface Props {
  currentNode: GameNode | undefined;
  onMove: (nodeId: string, direction?: Direction) => void;
  disabled?: boolean;
  unlockedConnections?: Map<string, number>;
}

const DIR_GRID: (Direction | null)[] = [
  'NW', 'N', 'NE',
  'W',  null, 'E',
  'SW', 'S', 'SE',
];

const DIR_ARROWS: Record<Direction, string> = {
  NW: '↖', N: '↑', NE: '↗',
  W: '←', E: '→',
  SW: '↙', S: '↓', SE: '↘',
};

export default function MovementPad({ currentNode, onMove, disabled }: Props) {
  const [pos, setPos] = useState({ x: 16, y: -1 }); // -1 means "use bottom default"
  const [dragging, setDragging] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const padRef = useRef<HTMLDivElement>(null);
  const [cooldown, setCooldown] = useState(false);

  // Compute available directions from current node connections
  const availableDirs = new Set<string>();
  if (currentNode?.connections) {
    for (const conn of currentNode.connections as any[]) {
      if (!conn.hidden) availableDirs.add(conn.direction);
    }
  }

  const handleDirClick = useCallback((dir: Direction) => {
    if (disabled || cooldown || !currentNode) return;
    const conn = (currentNode.connections as any[])?.find(
      (c: any) => c.direction === dir && !c.hidden
    );
    if (conn) {
      setCooldown(true);
      setTimeout(() => setCooldown(false), 500);
      onMove(conn.node_id, dir);
    }
  }, [currentNode, onMove, disabled, cooldown]);

  // Drag handlers
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    setDragging(true);
    const rect = padRef.current?.getBoundingClientRect();
    if (rect) {
      dragOffset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging) return;
    const newX = Math.max(0, Math.min(window.innerWidth - 140, e.clientX - dragOffset.current.x));
    const newY = Math.max(0, Math.min(window.innerHeight - 140, e.clientY - dragOffset.current.y));
    setPos({ x: newX, y: newY });
  }, [dragging]);

  const handlePointerUp = useCallback(() => {
    setDragging(false);
  }, []);

  // Default position: bottom-center
  const resolvedY = pos.y === -1 ? window.innerHeight - 180 : pos.y;

  if (minimized) {
    return (
      <button
        onClick={() => setMinimized(false)}
        className="fixed z-40 h-10 w-10 rounded-full ornate-border bg-card/90 shadow-lg flex items-center justify-center"
        style={{ left: pos.x, top: resolvedY }}
      >
        <span className="text-lg">🧭</span>
      </button>
    );
  }

  return (
    <div
      ref={padRef}
      className="fixed z-40 select-none touch-none"
      style={{ left: pos.x, top: resolvedY }}
    >
      <div className="ornate-border bg-card/90 backdrop-blur-sm rounded-lg shadow-xl p-1.5">
        {/* Drag handle + minimize */}
        <div
          className="flex items-center justify-between mb-1 cursor-grab active:cursor-grabbing px-1"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          <GripHorizontal className="h-3 w-3 text-muted-foreground" />
          <button
            onClick={() => setMinimized(true)}
            className="text-[10px] text-muted-foreground hover:text-foreground leading-none"
          >
            ✕
          </button>
        </div>

        {/* 3x3 direction grid */}
        <div className="grid grid-cols-3 gap-1">
          {DIR_GRID.map((dir, i) => {
            if (dir === null) {
              return <div key={i} className="w-10 h-10" />;
            }
            const available = availableDirs.has(dir);
            return (
              <button
                key={dir}
                onClick={() => handleDirClick(dir)}
                disabled={!available || disabled || cooldown}
                className={`w-10 h-10 rounded border text-sm font-bold flex items-center justify-center transition-colors
                  ${available
                    ? 'border-primary/50 bg-primary/10 text-primary hover:bg-primary/25 active:bg-primary/40'
                    : 'border-border/30 bg-muted/20 text-muted-foreground/30 cursor-not-allowed'
                  }
                  ${cooldown && available ? 'opacity-60' : ''}
                `}
              >
                {DIR_ARROWS[dir]}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
