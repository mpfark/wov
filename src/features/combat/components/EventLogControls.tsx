/**
 * Owns: the small "Aa·S" / "F+N" toggle buttons for the Event Log.
 * State lives in useEventLogDisplay so this can render anywhere
 * (e.g. next to the command input bar).
 */
import {
  type EventLogDisplay,
  FONT_SIZE_TITLE,
  MODE_LABELS,
  MODE_TITLES,
} from '@/features/combat/hooks/useEventLogDisplay';

interface Props {
  display: EventLogDisplay;
  className?: string;
}

export default function EventLogControls({ display, className }: Props) {
  const { fontSize, displayMode, cycleFontSize, cycleMode } = display;
  return (
    <div className={`flex items-center gap-1 ${className ?? ''}`}>
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
  );
}
