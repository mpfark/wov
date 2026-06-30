import { useCallback, useRef, useState } from 'react';
import { getLogColor } from '@/features/combat/utils/combat-log-utils';

/**
 * useMiniLog — wraps an existing `addLog` so messages also surface inside a
 * service panel via <ServicePanelMiniLog>. Keeps a small ring buffer (default 5),
 * newest first. Each entry gets a unique id so React can animate / key cleanly.
 *
 * Usage:
 *   const { entries, addLog } = useMiniLog(props.addLog);
 *   // pass `addLog` everywhere the panel logs, pass `entries` to the shell.
 */
export interface MiniLogEntry {
  id: number;
  text: string;
  at: number;
}

export function useMiniLog(parentAddLog?: (msg: string) => void, max = 5) {
  const [entries, setEntries] = useState<MiniLogEntry[]>([]);
  const idRef = useRef(0);

  const addLog = useCallback((msg: string) => {
    parentAddLog?.(msg);
    setEntries((prev) => {
      const id = ++idRef.current;
      const next = [{ id, text: msg, at: Date.now() }, ...prev];
      return next.slice(0, max);
    });
  }, [parentAddLog, max]);

  return { entries, addLog };
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
          className={`truncate ${getLogColor(e.text)}`}
          style={{ opacity: 1 - i * 0.15 }}
          title={e.text}
        >
          {e.text}
        </li>
      ))}
    </ul>
  );
}

export default ServicePanelMiniLog;
