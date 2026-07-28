/**
 * Owns: rendering of a single log line (event log AND chat panel).
 *
 * All classification / colour / marker decisions come from
 * event-log-styles.toPresentation — no component parses emoji or picks
 * colours on its own.
 *
 * Routine presentation emoji (the leading glyph run produced by the
 * emitters) is suppressed visually; the underlying string is never
 * modified, so routing, dedup, broadcasts and stored history are
 * unaffected. Emoji embedded later in a message — authored dialogue,
 * boss flavour, item names — is always preserved.
 */
import { cn } from '@/lib/utils';
import {
  ChevronsUp,
  ScrollText,
  Skull,
  Sparkles,
  TriangleAlert,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import {
  classifyLogLine,
  splitLogTokens,
  toPresentation,
  type EventLogMarker,
} from '@/features/combat/utils/event-log-styles';

const MARKER_ICON: Record<EventLogMarker, LucideIcon> = {
  kill: Skull,
  level_up: ChevronsUp,
  loot_rare: Sparkles,
  quest: ScrollText,
  telegraph: Zap,
  error: TriangleAlert,
};

const MARKER_LABEL: Record<EventLogMarker, string> = {
  kill: 'Death',
  level_up: 'Level gained',
  loot_rare: 'Rare loot',
  quest: 'Quest',
  telegraph: 'Boss ability',
  error: 'Error',
};

interface EventLogLineProps {
  /** Already display-normalised (e.g. flavor-number stripped) log string. */
  log: string;
  /** `log` = event log styling; `chat` = conversational styling. */
  variant?: 'log' | 'chat';
  className?: string;
}

export default function EventLogLine({ log, variant = 'log', className }: EventLogLineProps) {
  const cls = classifyLogLine(log);
  const pres = toPresentation(log, cls);
  const { body, number } = splitLogTokens(log);
  const isChat = variant === 'chat';
  const Marker = !isChat && pres.marker ? MARKER_ICON[pres.marker] : null;

  return (
    <p
      className={cn(
        isChat ? 'event-chat-line' : 'event-log-line',
        !isChat && pres.edgeClass,
        pres.textClass,
        pres.strong && !isChat && 'font-medium',
        pres.urgent && !isChat && 'event-log-urgent',
        cls.isRemote && 'opacity-60 italic',
        className,
      )}
    >
      {Marker && (
        <Marker
          className="event-log-marker"
          aria-label={MARKER_LABEL[pres.marker!]}
          role="img"
        />
      )}
      <span className="event-log-body">{body}</span>
      {number && (
        <span className={cn('event-log-number', pres.numberClass)}>{` ${number}`}</span>
      )}
    </p>
  );
}
