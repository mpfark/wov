/**
 * Owns: event/combat log list rendering, scroll anchor, inline chat input, display mode toggle.
 */
import { RefObject, useState, useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { getLogColor } from '@/features/combat/utils/combat-log-utils';
import {
  type CombatLogDisplayMode,
  getStoredDisplayMode,
  setStoredDisplayMode,
} from '@/features/combat/utils/combat-text';

interface EventLogPanelProps {
  filteredEventLog: string[];
  logEndRef: RefObject<HTMLDivElement>;
  chatOpen: boolean;
  isWideScreen: boolean;
  chatInput: string;
  onChatInputChange: (value: string) => void;
  onChatSubmit: () => void;
  onChatClose: () => void;
  chatInputRef: RefObject<HTMLInputElement>;
}

const MODE_LABELS: Record<CombatLogDisplayMode, string> = {
  numbers: 'N',
  words: 'W',
  both: 'B',
};

const MODE_TITLES: Record<CombatLogDisplayMode, string> = {
  numbers: 'Numbers — classic numeric log',
  words: 'Words — flavorful text only',
  both: 'Both — flavor text + damage numbers',
};

const MODE_CYCLE: CombatLogDisplayMode[] = ['numbers', 'words', 'both'];

export default function EventLogPanel({
  filteredEventLog, logEndRef,
  chatOpen, isWideScreen,
  chatInput, onChatInputChange, onChatSubmit, onChatClose,
  chatInputRef,
}: EventLogPanelProps) {
  const [displayMode, setDisplayMode] = useState<CombatLogDisplayMode>(getStoredDisplayMode);

  const cycleMode = useCallback(() => {
    setDisplayMode(prev => {
      const idx = MODE_CYCLE.indexOf(prev);
      const next = MODE_CYCLE[(idx + 1) % MODE_CYCLE.length];
      setStoredDisplayMode(next);
      return next;
    });
  }, []);

  return (
    <div className="flex-[1] min-h-0 border-t border-border px-3 py-2 flex flex-col">
      <div className="flex items-center justify-between mb-1 shrink-0">
        <h3 className="font-display text-xs text-muted-foreground">Event Log</h3>
        <button
          onClick={cycleMode}
          title={MODE_TITLES[displayMode]}
          className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-border bg-background/50 text-muted-foreground hover:text-foreground hover:bg-accent/30 transition-colors"
        >
          {MODE_LABELS[displayMode]}
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-2 bg-background/30 rounded border border-border space-y-0.5">
        {filteredEventLog.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">Your journey begins...</p>
        ) : (
          filteredEventLog.map((log, i) =>
            log === '---tick---' ? (
              <div key={i} className="border-t-2 border-border/60 my-2" />
            ) : (
              <p key={i} className={`text-xs ${getLogColor(log)}`}>{log}</p>
            )
          )
        )}
        <div ref={logEndRef} />
      </div>
      {(!isWideScreen && chatOpen) && (
        <div className="shrink-0 mt-1">
          <Input
            ref={chatInputRef}
            value={chatInput}
            onChange={e => onChatInputChange(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); onChatSubmit(); }
              if (e.key === 'Escape') { onChatClose(); }
            }}
            placeholder="Say something... (/w name message to whisper)"
            className="h-7 text-xs bg-background/50 border-border"
            autoComplete="off"
          />
        </div>
      )}
    </div>
  );
}
