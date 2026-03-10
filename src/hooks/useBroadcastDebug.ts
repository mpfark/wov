import { useState, useEffect, useCallback, useRef } from 'react';

export interface BroadcastLogEntry {
  id: number;
  direction: 'out' | 'in';
  channel: string;
  event: string;
  timestamp: number;
}

type Listener = (entry: BroadcastLogEntry) => void;

const listeners = new Set<Listener>();
let nextId = 1;

/** Call from any hook to log a broadcast event to the debug overlay */
export function logBroadcast(direction: 'out' | 'in', channel: string, event: string) {
  const entry: BroadcastLogEntry = {
    id: nextId++,
    direction,
    channel,
    event,
    timestamp: Date.now(),
  };
  listeners.forEach(fn => fn(entry));
}

/** Hook that subscribes to broadcast debug log entries */
export function useBroadcastDebug(enabled: boolean) {
  const [entries, setEntries] = useState<BroadcastLogEntry[]>([]);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  useEffect(() => {
    if (!enabled) return;
    const handler: Listener = (entry) => {
      if (!enabledRef.current) return;
      setEntries(prev => [...prev.slice(-99), entry]);
    };
    listeners.add(handler);
    return () => { listeners.delete(handler); };
  }, [enabled]);

  const clear = useCallback(() => setEntries([]), []);

  return { entries, clear };
}
