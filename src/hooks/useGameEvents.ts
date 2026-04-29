/**
 * Lightweight pub/sub event bus for game events.
 *
 * Inspired by LPMud's central event dispatcher — decouples producers
 * (combat, abilities, DoTs) from consumers (event log, broadcasts, UI).
 *
 * Usage:
 *   const bus = useCreateGameEventBus();          // once, at top-level
 *   useGameEvent(bus, 'log', ({ message }) => …); // subscribe
 *   bus.emit('log', { message: 'Hello' });        // publish
 */
import { useRef, useEffect, useMemo } from 'react';

// ─── Event type map ────────────────────────────────────────────────
export interface GameEvents {
  // Logging
  'log': { message: string };
  'log:local': { message: string };

  // Combat broadcasts
  'creature:damage': {
    creatureId: string;
    newHp: number;
    damage: number;
    attackerName: string;
    killed: boolean;
  };
  'party:hp': {
    characterId: string;
    hp: number;
    maxHp: number;
    source: string;
  };
  'party:reward': {
    characterId: string;
    xp: number;
    gold: number;
    source: string;
  };

  // Combat lifecycle
  'combat:start': { creatureId: string };
  'combat:stop': Record<string, never>;
  'combat:kill': {
    creatureName: string;
    creatureLevel: number;
    creatureRarity: string;
    xp: number;
    gold: number;
  };

  // Player events
  'player:levelup': { level: number };
  'player:death': { goldLost: number };

  // Loot
  'loot:drop': { itemName: string; creatureName: string };

  // Buff management (consumed by GamePage state setters)
  'buff:clear': { buff: 'stealth' | 'disengage' };
  'dot:add': { type: 'poison' | 'ignite'; creatureId: string };
  'absorb:hit': { remaining: number };
}

// ─── Bus implementation ────────────────────────────────────────────
type Listener<T = any> = (payload: T) => void;

export interface GameEventBus {
  emit: <K extends keyof GameEvents>(event: K, payload: GameEvents[K]) => void;
  on: <K extends keyof GameEvents>(event: K, listener: Listener<GameEvents[K]>) => void;
  off: <K extends keyof GameEvents>(event: K, listener: Listener<GameEvents[K]>) => void;
}

export function createGameEventBus(): GameEventBus {
  const listeners = new Map<string, Set<Listener>>();

  return {
    emit(event, payload) {
      const set = listeners.get(event as string);
      if (set) for (const fn of set) fn(payload);
    },
    on(event, listener) {
      if (!listeners.has(event as string)) listeners.set(event as string, new Set());
      listeners.get(event as string)!.add(listener);
    },
    off(event, listener) {
      listeners.get(event as string)?.delete(listener);
    },
  };
}

// ─── React hooks ───────────────────────────────────────────────────

/**
 * Subscribe to a game event with automatic cleanup.
 * The callback ref is updated every render so closures are never stale,
 * but the underlying subscription is stable (no re-subscribe on re-render).
 */
export function useGameEvent<K extends keyof GameEvents>(
  bus: GameEventBus,
  event: K,
  callback: Listener<GameEvents[K]>,
) {
  const cbRef = useRef(callback);
  cbRef.current = callback;

  useEffect(() => {
    const handler: Listener<GameEvents[K]> = (payload) => cbRef.current(payload);
    bus.on(event, handler);
    return () => bus.off(event, handler);
  }, [bus, event]);
}

/** Create a stable bus instance that persists for the component's lifetime. */
export function useCreateGameEventBus(): GameEventBus {
  return useMemo(() => createGameEventBus(), []);
}
