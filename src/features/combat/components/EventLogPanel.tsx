/**
 * Owns: event/combat log list rendering.
 *
 * Newest-at-top ordering — the freshest entry appears directly under the
 * top of the panel.
 *
 * Display settings (font size, flavor mode) are owned by useEventLogDisplay
 * and rendered as EventLogControls — typically mounted next to the command
 * input bar so the log itself stays chrome-free.
 */
import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { stripFlavorNumber } from '@/features/combat/utils/combat-text';
import EventLogLine from '@/features/combat/components/EventLogLine';
import {
  FONT_SIZE_CLASS,
  type EventLogDisplay,
} from '@/features/combat/hooks/useEventLogDisplay';

interface EventLogPanelProps {
  filteredEventLog: string[];
  display: EventLogDisplay;
  className?: string;
}

export default function EventLogPanel({
  filteredEventLog,
  display,
  className,
}: EventLogPanelProps) {
  const { displayMode, fontSize } = display;

  // Newest first; preserve original index in the key so React keys stay stable.
  const reversedLog = useMemo(
    () => filteredEventLog.map((rawLog, i) => ({ rawLog, key: i })).reverse(),
    [filteredEventLog],
  );

  return (
    <div className={cn("min-h-0 border-t border-border px-3 py-2 flex flex-col", className || "flex-[3]")}>
      <div className={cn('flex-1 min-h-0 overflow-y-auto p-2 surface-row rounded', FONT_SIZE_CLASS[fontSize])}>
        {reversedLog.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">Your journey begins...</p>
        ) : (
          reversedLog.map(({ rawLog, key }) => {
            if (rawLog === '---tick---') {
              return <div key={key} className="divider-hairline my-2" />;
            }
            // Flavor mode: strip the trailing canonical [N] suffix server lines emit.
            const log = displayMode === 'flavor' ? stripFlavorNumber(rawLog) : rawLog;
            return <EventLogLine key={key} log={log} />;
          })
        )}
      </div>
    </div>
  );
}

