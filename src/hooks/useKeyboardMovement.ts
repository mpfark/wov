import { useEffect, useRef, useCallback, useState } from 'react';
import { GameNode } from '@/hooks/useNodes';

export type Direction = 'N' | 'S' | 'E' | 'W' | 'NE' | 'NW' | 'SE' | 'SW';
export type KeyBindings = Record<Direction, string[]>;

export type ActionName = 'attack' | 'search' | 'pickup' | 'ability1' | 'ability2' | 'ability3' | 'ability4' | 'ability5' | 'potion1' | 'potion2' | 'potion3' | 'potion4' | 'potion5' | 'potion6';
export type ActionBindings = Record<ActionName, string[]>;

const DIRECTIONS: Direction[] = ['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW'];

const DIRECTION_LABELS: Record<Direction, string> = {
  N: 'North', S: 'South', E: 'East', W: 'West',
  NE: 'NE', NW: 'NW', SE: 'SE', SW: 'SW',
};

const DEFAULT_BINDINGS: KeyBindings = {
  NW: ['q'], N: ['w'], NE: ['e'],
  W: ['a'],            E: ['d'],
  SW: ['z'], S: ['x'], SE: ['c'],
};

const ACTION_NAMES: ActionName[] = [
  'attack', 'search', 'pickup', 'ability1', 'ability2', 'ability3', 'ability4', 'ability5',
  'potion1', 'potion2', 'potion3', 'potion4', 'potion5', 'potion6',
];

const ACTION_LABELS: Record<ActionName, string> = {
  attack: 'Attack',
  search: 'Search',
  pickup: 'Pick Up',
  ability1: 'Ability 1', ability2: 'Ability 2', ability3: 'Ability 3', ability4: 'Ability 4', ability5: 'Ability 5',
  potion1: 'Potion 1', potion2: 'Potion 2', potion3: 'Potion 3',
  potion4: 'Potion 4', potion5: 'Potion 5', potion6: 'Potion 6',
};

const DEFAULT_ACTION_BINDINGS: ActionBindings = {
  attack: [' '],
  search: ['s'],
  pickup: ['f'],
  ability1: ['1'], ability2: ['2'], ability3: ['3'], ability4: ['4'], ability5: ['5'],
  potion1: ['!'], potion2: ['@'], potion3: ['#'],
  potion4: ['$'], potion5: ['%'], potion6: ['^'],
};

const STORAGE_KEY = 'movement-keybindings';
const ACTION_STORAGE_KEY = 'action-keybindings';

// Map shift+number characters to friendly labels
const SHIFT_NUM_MAP: Record<string, string> = {
  '!': 'Sh+1', '@': 'Sh+2', '#': 'Sh+3',
  '$': 'Sh+4', '%': 'Sh+5', '^': 'Sh+6',
};

function loadBindings(): KeyBindings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      for (const dir of DIRECTIONS) {
        if (!Array.isArray(parsed[dir])) return { ...DEFAULT_BINDINGS };
      }
      return parsed;
    }
  } catch { /* ignore */ }
  return { ...DEFAULT_BINDINGS };
}

function loadActionBindings(): ActionBindings {
  try {
    const raw = localStorage.getItem(ACTION_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      for (const name of ACTION_NAMES) {
        if (!Array.isArray(parsed[name])) return { ...DEFAULT_ACTION_BINDINGS };
      }
      return parsed;
    }
  } catch { /* ignore */ }
  return { ...DEFAULT_ACTION_BINDINGS };
}

function saveBindings(bindings: KeyBindings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings));
}

function saveActionBindings(bindings: ActionBindings) {
  localStorage.setItem(ACTION_STORAGE_KEY, JSON.stringify(bindings));
}

export function getKeyLabel(key: string): string {
  if (SHIFT_NUM_MAP[key]) return SHIFT_NUM_MAP[key];
  if (key === ' ') return 'Space';
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
  onAttackFirst?: () => void;
  onSearch?: () => void;
  onUseAbility?: (index: number) => void;
  onUseBeltPotion?: (index: number) => void;
  onPickUpLoot?: () => void;
  onOpenChat?: () => void;
  onCycleTarget?: () => void;
}

export function useKeyboardMovement({ currentNode, nodes, onMove, disabled, onAttackFirst, onSearch, onUseAbility, onUseBeltPotion, onPickUpLoot, onOpenChat, onCycleTarget }: UseKeyboardMovementOptions) {
  const [bindings, setBindingsState] = useState<KeyBindings>(loadBindings);
  const [actionBindings, setActionBindingsState] = useState<ActionBindings>(loadActionBindings);
  const [moveCooldown, setMoveCooldown] = useState(false);
  const bindingsRef = useRef(bindings);
  const actionBindingsRef = useRef(actionBindings);
  const moveCooldownRef = useRef(false);
  const currentNodeRef = useRef(currentNode);
  const onMoveRef = useRef(onMove);
  const disabledRef = useRef(disabled);
  const onAttackFirstRef = useRef(onAttackFirst);
  const onSearchRef = useRef(onSearch);
  const onUseAbilityRef = useRef(onUseAbility);
  const onUseBeltPotionRef = useRef(onUseBeltPotion);
  const onPickUpLootRef = useRef(onPickUpLoot);
  const onOpenChatRef = useRef(onOpenChat);
  const onCycleTargetRef = useRef(onCycleTarget);

  useEffect(() => { bindingsRef.current = bindings; }, [bindings]);
  useEffect(() => { moveCooldownRef.current = moveCooldown; }, [moveCooldown]);
  useEffect(() => { actionBindingsRef.current = actionBindings; }, [actionBindings]);
  useEffect(() => { currentNodeRef.current = currentNode; }, [currentNode]);
  useEffect(() => { onMoveRef.current = onMove; }, [onMove]);
  useEffect(() => { disabledRef.current = disabled; }, [disabled]);
  useEffect(() => { onAttackFirstRef.current = onAttackFirst; }, [onAttackFirst]);
  useEffect(() => { onSearchRef.current = onSearch; }, [onSearch]);
  useEffect(() => { onUseAbilityRef.current = onUseAbility; }, [onUseAbility]);
  useEffect(() => { onUseBeltPotionRef.current = onUseBeltPotion; }, [onUseBeltPotion]);
  useEffect(() => { onPickUpLootRef.current = onPickUpLoot; }, [onPickUpLoot]);
  useEffect(() => { onOpenChatRef.current = onOpenChat; }, [onOpenChat]);
  useEffect(() => { onCycleTargetRef.current = onCycleTarget; }, [onCycleTarget]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (disabledRef.current) return;

      // Skip if typing in form element
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

      // Skip if dialog/modal is open
      if (document.querySelector('[role="dialog"]')) return;

      const key = e.key;

      // Enter key opens chat
      if (key === 'Enter' && onOpenChatRef.current) {
        e.preventDefault();
        onOpenChatRef.current();
        return;
      }

      // Check movement bindings first
      const node = currentNodeRef.current;
      const b = bindingsRef.current;
      let matchedDirection: Direction | null = null;
      for (const dir of DIRECTIONS) {
        if (b[dir].includes(key)) {
          matchedDirection = dir;
          break;
        }
      }
      if (matchedDirection && node) {
        // Movement cooldown — prevent spam
        if (moveCooldownRef.current) return;
        const conn = node.connections?.find(
          c => c.direction === matchedDirection && !c.hidden
        );
        if (conn) {
          e.preventDefault();
          setMoveCooldown(true);
          moveCooldownRef.current = true;
          setTimeout(() => { setMoveCooldown(false); moveCooldownRef.current = false; }, 500);
          onMoveRef.current(conn.node_id, matchedDirection);
          return;
        }
      }

      // Check action bindings
      const ab = actionBindingsRef.current;

      if (ab.attack.includes(key) && onAttackFirstRef.current) {
        e.preventDefault();
        onAttackFirstRef.current();
        return;
      }

      if (ab.search.includes(key) && onSearchRef.current) {
        e.preventDefault();
        onSearchRef.current();
        return;
      }

      if (ab.pickup.includes(key) && onPickUpLootRef.current) {
        e.preventDefault();
        onPickUpLootRef.current();
      }

      for (let i = 0; i < 5; i++) {
        const name = `ability${i + 1}` as ActionName;
        if (ab[name].includes(key) && onUseAbilityRef.current) {
          e.preventDefault();
          onUseAbilityRef.current(i);
          return;
        }
      }

      for (let i = 0; i < 6; i++) {
        const name = `potion${i + 1}` as ActionName;
        if (ab[name].includes(key) && onUseBeltPotionRef.current) {
          e.preventDefault();
          onUseBeltPotionRef.current(i);
          return;
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const setBindings = useCallback((newBindings: KeyBindings) => {
    setBindingsState(newBindings);
    saveBindings(newBindings);
  }, []);

  const setActionBindings = useCallback((newBindings: ActionBindings) => {
    setActionBindingsState(newBindings);
    saveActionBindings(newBindings);
  }, []);

  const resetBindings = useCallback(() => {
    const defaults = { ...DEFAULT_BINDINGS };
    setBindingsState(defaults);
    saveBindings(defaults);
    const actionDefaults = { ...DEFAULT_ACTION_BINDINGS };
    setActionBindingsState(actionDefaults);
    saveActionBindings(actionDefaults);
  }, []);

  return {
    bindings, setBindings, resetBindings,
    actionBindings, setActionBindings,
    DIRECTIONS, DIRECTION_LABELS,
    ACTION_NAMES, ACTION_LABELS,
    moveCooldown,
  };
}

export { DEFAULT_BINDINGS, DEFAULT_ACTION_BINDINGS, ACTION_NAMES, ACTION_LABELS, SHIFT_NUM_MAP };
