/**
 * Owns: event/combat log list rendering.
 *
 * Consumes structured `GameLogEvent`s (legacy strings are adapted at
 * ingress, never here). Newest-at-top ordering — the freshest entry appears
 * directly under the top of the panel.
 *
 * Display settings (font size, flavor mode) are owned by useEventLogDisplay
 * and rendered as EventLogControls — typically mounted next to the command
 * input bar so the log itself stays chrome-free.
 */
import { useCallback, useMemo, useRef } from 'react';
import { cn } from '@/lib/utils';
import EventLogLine from '@/features/combat/components/EventLogLine';
import type { GameLogEvent } from '@/features/combat/events/log-event';
import {
  FONT_SIZE_CLASS,
  type EventLogDisplay,
} from '@/features/combat/hooks/useEventLogDisplay';

interface EventLogPanelProps {
  filteredEventLog: GameLogEvent[];
  display: EventLogDisplay;
  className?: string;
  /** Older, already-evicted entries from the on-device archive (newest-first). */
  olderEvents?: GameLogEvent[];
  hasMoreHistory?: boolean;
  loadingHistory?: boolean;
  onLoadOlder?: () => void;
}

/** Distance (px) from the older end of the list that triggers a history load. */
const LOAD_THRESHOLD = 120;

export default function EventLogPanel({
  filteredEventLog,
  display,
  className,
  olderEvents,
  hasMoreHistory = false,
  loadingHistory = false,
  onLoadOlder,
}: EventLogPanelProps) {
  const { displayMode, fontSize } = display;
  const scrollRef = useRef<HTMLDivElement>(null);

  // Newest first; preserve original index in the key so React keys stay stable.
  const reversedLog = useMemo(
    () => filteredEventLog.map((event, i) => ({ event, key: event.id || String(i) })).reverse(),
    [filteredEventLog],
  );

  const archived = useMemo(
    () => (olderEvents ?? []).map((event, i) => ({ event, key: `arch-${event.id || i}-${i}` })),
    [olderEvents],
  );

  // Newest is at the top, so "older" lives at the bottom of the scroll box.
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !onLoadOlder || loadingHistory || !hasMoreHistory) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < LOAD_THRESHOLD) {
      onLoadOlder();
    }
  }, [onLoadOlder, loadingHistory, hasMoreHistory]);

  const renderEvent = ({ event, key }: { event: GameLogEvent; key: string }) => {
    if (event.effectType === 'tick_separator') {
      return <div key={key} className="divider-hairline my-2" />;
    }
    return <EventLogLine key={key} event={event} displayMode={displayMode} />;
  };

  return (
    <div className={cn("min-h-0 border-t border-border px-3 py-2 flex flex-col", className || "flex-[3]")}>
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className={cn('flex-1 min-h-0 overflow-y-auto p-2 surface-row rounded', FONT_SIZE_CLASS[fontSize])}
      >
        {reversedLog.length === 0 && archived.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">Your journey begins...</p>
        ) : (
          <>
            {reversedLog.map(renderEvent)}
            {archived.length > 0 && <div className="divider-hairline my-2" />}
            {archived.map(renderEvent)}
            {loadingHistory && (
              <p className="text-[10px] text-muted-foreground italic py-1">Recalling older memories…</p>
            )}
            {!hasMoreHistory && archived.length > 0 && (
              <p className="text-[10px] text-muted-foreground italic py-1">— the beginning of your chronicle —</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
