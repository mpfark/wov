import { useCallback, useRef, useState } from 'react';
import type { GameLogEvent } from '@/features/combat/events/log-event';
import { presentationForEvent } from '@/features/combat/events/presentation';

/**
 * useMiniLog — wraps the parent structured-event emitter so service-panel
 * actions also surface inside the panel via <ServicePanelMiniLog>. Keeps a
 * small ring buffer (default 5), newest first.
 *
 * Stage 11: entries are structured `GameLogEvent`s, so the mini log colours
 * itself from the same presentation map as the main event log — no string
 * inspection anywhere.
 *
 * Usage:
 *   const { entries, addEvent } = useMiniLog(props.addLogEvent);
 */
export interface MiniLogEntry {
  id: number;
  event: GameLogEvent;
  at: number;
}

export function useMiniLog(parentAddLogEvent?: (event: GameLogEvent) => void, max = 5) {
  const [entries, setEntries] = useState<MiniLogEntry[]>([]);
  const idRef = useRef(0);

  const addEvent = useCallback((event: GameLogEvent) => {
    parentAddLogEvent?.(event);
    setEntries((prev) => {
      const id = ++idRef.current;
      return [{ id, event, at: Date.now() }, ...prev].slice(0, max);
    });
  }, [parentAddLogEvent, max]);

  return { entries, addEvent };
}

export function ServicePanelMiniLog({ entries }: { entries: MiniLogEntry[] }) {
  if (entries.length === 0) {
    return (
      <div className="text-[10px] text-muted-foreground italic text-center py-1">
        — actions you take will appear here —
      </div>
    );
  }
  return (
    <ul className="gap-row text-[11px] leading-tight" aria-live="polite">
      {entries.map((e, i) => (
        <li
          key={e.id}
          className={`truncate ${presentationForEvent(e.event).textClass}`}
          style={{ opacity: 1 - i * 0.15 }}
          title={e.event.message}
        >
          {e.event.message}
        </li>
      ))}
    </ul>
  );
}

export default ServicePanelMiniLog;
