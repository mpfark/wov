import { useEffect, useRef, useCallback, useState } from 'react';
import { GameNode } from '@/hooks/useNodes';

export type Direction = 'N' | 'S' | 'E' | 'W' | 'NE' | 'NW' | 'SE' | 'SW';
export type KeyBindings = Record<Direction, string[]>;

const DIRECTIONS: Direction[] = ['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW'];

const DIRECTION_LABELS: Record<Direction, string> = {
  N: 'North', S: 'South', E: 'East', W: 'West',
  NE: 'NE', NW: 'NW', SE: 'SE', SW: 'SW',
};

const DEFAULT_BINDINGS: KeyBindings = {
  N: ['w', 'ArrowUp'],
  S: ['s', 'ArrowDown'],
  E: ['d', 'ArrowRight'],
  W: ['a', 'ArrowLeft'],
  NE: [], NW: [], SE: [], SW: [],
};

const STORAGE_KEY = 'movement-keybindings';

function loadBindings(): KeyBindings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Validate shape
      for (const dir of DIRECTIONS) {
        if (!Array.isArray(parsed[dir])) return { ...DEFAULT_BINDINGS };
      }
      return parsed;
    }
  } catch { /* ignore */ }
  return { ...DEFAULT_BINDINGS };
}

function saveBindings(bindings: KeyBindings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings));
}

export function getKeyLabel(key: string): string {
  if (key === ' ') return 'Space';
  if (key.startsWith('Arrow')) return key.replace('Arrow', '↑↓←→'.charAt(0)).length ? key.replace('Arrow', '') : key;
  if (key === 'ArrowUp') return '↑';
  if (key === 'ArrowDown') return '↓';
  if (key === 'ArrowLeft') return '←';
  if (key === 'ArrowRight') return '→';
  if (key.length === 1) return key.toUpperCase();
  return key;
}

interface UseKeyboardMovementOptions {
  currentNode: GameNode | undefined;
  nodes: GameNode[];
  onMove: (nodeId: string, direction?: Direction) => void;
  disabled: boolean;
}

export function useKeyboardMovement({ currentNode, nodes, onMove, disabled }: UseKeyboardMovementOptions) {
  const [bindings, setBindingsState] = useState<KeyBindings>(loadBindings);
  const bindingsRef = useRef(bindings);
  const currentNodeRef = useRef(currentNode);
  const onMoveRef = useRef(onMove);
  const disabledRef = useRef(disabled);

  useEffect(() => { bindingsRef.current = bindings; }, [bindings]);
  useEffect(() => { currentNodeRef.current = currentNode; }, [currentNode]);
  useEffect(() => { onMoveRef.current = onMove; }, [onMove]);
  useEffect(() => { disabledRef.current = disabled; }, [disabled]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (disabledRef.current) return;

      // Skip if typing in form element
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

      // Skip if dialog/modal is open
      if (document.querySelector('[role="dialog"]')) return;

      const node = currentNodeRef.current;
      if (!node) return;

      const b = bindingsRef.current;
      let matchedDirection: Direction | null = null;
      for (const dir of DIRECTIONS) {
        if (b[dir].includes(e.key)) {
          matchedDirection = dir;
          break;
        }
      }
      if (!matchedDirection) return;

      // Find matching visible connection
      const conn = node.connections?.find(
        c => c.direction === matchedDirection && !c.hidden
      );
      if (!conn) return;

      e.preventDefault();
      onMoveRef.current(conn.node_id, matchedDirection);
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const setBindings = useCallback((newBindings: KeyBindings) => {
    setBindingsState(newBindings);
    saveBindings(newBindings);
  }, []);

  const resetBindings = useCallback(() => {
    const defaults = { ...DEFAULT_BINDINGS };
    setBindingsState(defaults);
    saveBindings(defaults);
  }, []);

  return { bindings, setBindings, resetBindings, DIRECTIONS, DIRECTION_LABELS };
}

export { DEFAULT_BINDINGS };
