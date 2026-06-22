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
import {
  classifyLogLine,
  splitLogTokens,
  EVENT_STYLE,
} from '@/features/combat/utils/event-log-styles';
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
            const cls = classifyLogLine(log);
            const style = EVENT_STYLE[cls.category];
            const { icon, body, number } = splitLogTokens(log);
            return (
              <p
                key={key}
                className={cn(
                  'event-log-line',
                  style.textClass,
                  style.emphasis === 'strong' && 'font-semibold',
                  cls.isRemote && 'opacity-60 italic',
                )}
              >
                {icon && <span className={cn('event-log-icon', style.iconClass)}>{icon}</span>}
                <span className="event-log-body">{body}</span>
                {number && (
                  <span className={cn('event-log-number', style.numberClass)}>{` ${number}`}</span>
                )}
              </p>
            );
          })
        )}
      </div>
    </div>
  );
}
