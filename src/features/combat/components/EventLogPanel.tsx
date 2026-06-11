/**
 * Owns: event/combat log list rendering, scroll anchor, display mode toggle.
 *
 * Visual styling is data-driven — every entry is classified into a category
 * (event-log-styles) and rendered as icon + body + number spans with the
 * category's color/emphasis. Wording is preserved byte-for-byte.
 */
import { useState, useCallback, useMemo } from 'react';
import { cn } from '@/lib/utils';
import {
  type CombatLogDisplayMode,
  getStoredDisplayMode,
  setStoredDisplayMode,
  stripFlavorNumber,
} from '@/features/combat/utils/combat-text';
import {
  classifyLogLine,
  splitLogTokens,
  EVENT_STYLE,
} from '@/features/combat/utils/event-log-styles';

interface EventLogPanelProps {
  filteredEventLog: string[];
}
...
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
