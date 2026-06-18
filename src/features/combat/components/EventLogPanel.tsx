/**
 * Owns: event/combat log list rendering, display mode toggle.
 *
 * Newest-at-top ordering — the freshest entry appears directly under the
 * header so it sits visually close to the ability bar / status bars above.
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

const MODE_LABELS: Record<CombatLogDisplayMode, string> = {
  flavor: 'F',
  flavor_numbers: 'F+N',
};

const MODE_TITLES: Record<CombatLogDisplayMode, string> = {
  flavor: 'Flavor — narrative text only',
  flavor_numbers: 'Flavor + Numbers — narrative text with damage values',
};

const MODE_CYCLE: CombatLogDisplayMode[] = ['flavor', 'flavor_numbers'];

type FontSize = 'S' | 'M' | 'L';
const FONT_SIZE_KEY = 'eventLog.fontSize';
const FONT_SIZE_CYCLE: FontSize[] = ['S', 'M', 'L'];
const FONT_SIZE_CLASS: Record<FontSize, string> = {
  S: 'text-xs',
  M: 'text-sm',
  L: 'text-base',
};
const FONT_SIZE_TITLE: Record<FontSize, string> = {
  S: 'Text size: Small (click for Medium)',
  M: 'Text size: Medium (click for Large)',
  L: 'Text size: Large (click for Small)',
};

function getStoredFontSize(): FontSize {
  if (typeof window === 'undefined') return 'S';
  const v = window.localStorage.getItem(FONT_SIZE_KEY);
  return v === 'M' || v === 'L' || v === 'S' ? v : 'S';
}


export default function EventLogPanel({
  filteredEventLog,
}: EventLogPanelProps) {
  const [displayMode, setDisplayMode] = useState<CombatLogDisplayMode>(getStoredDisplayMode);
  const [fontSize, setFontSize] = useState<FontSize>(getStoredFontSize);

  const cycleMode = useCallback(() => {
    setDisplayMode(prev => {
      const idx = MODE_CYCLE.indexOf(prev);
      const next = MODE_CYCLE[(idx + 1) % MODE_CYCLE.length];
      setStoredDisplayMode(next);
      return next;
    });
  }, []);

  const cycleFontSize = useCallback(() => {
    setFontSize(prev => {
      const idx = FONT_SIZE_CYCLE.indexOf(prev);
      const next = FONT_SIZE_CYCLE[(idx + 1) % FONT_SIZE_CYCLE.length];
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(FONT_SIZE_KEY, next);
      }
      return next;
    });
  }, []);

  // Newest first; preserve original index in the key so React keys stay stable.
  const reversedLog = useMemo(
    () => filteredEventLog.map((rawLog, i) => ({ rawLog, key: i })).reverse(),
    [filteredEventLog],
  );

  return (
    <div className="flex-[3] min-h-0 border-t border-border px-3 py-2 flex flex-col">
      <div className="flex items-center justify-between mb-1 shrink-0">
        <h3 className="font-display text-xs text-muted-foreground">Event Log</h3>
        <div className="flex items-center gap-1">
          <button
            onClick={cycleFontSize}
            title={FONT_SIZE_TITLE[fontSize]}
            className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-border bg-background/50 text-muted-foreground hover:text-foreground hover:bg-accent/30 transition-colors"
          >
            {`Aa·${fontSize}`}
          </button>
          <button
            onClick={cycleMode}
            title={MODE_TITLES[displayMode]}
            className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-border bg-background/50 text-muted-foreground hover:text-foreground hover:bg-accent/30 transition-colors"
          >
            {MODE_LABELS[displayMode]}
          </button>
        </div>
      </div>
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
