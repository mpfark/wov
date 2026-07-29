/**
 * Owns: rendering of a single structured log event (event log AND chat).
 *
 * Family / colour / marker / urgency come exclusively from
 * events/presentation.ts, derived from the event's structured fields. This
 * component never inspects prose.
 *
 * Legacy events (produced by legacy-adapter.ts from historical strings)
 * carry their original text in `legacy.raw`; only for those do we run the
 * old leading-glyph suppression and trailing-number split so historical
 * lines render exactly as before. Emoji embedded inside prose is always
 * preserved.
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
import { splitLogTokens, type EventLogMarker } from '@/features/combat/utils/event-log-styles';
import { stripFlavorNumber, type CombatLogDisplayMode } from '@/features/combat/utils/combat-text';
import { presentationForEvent } from '@/features/combat/events/presentation';
import type { GameLogEvent } from '@/features/combat/events/log-event';

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
  event: GameLogEvent;
  /** `log` = event log styling; `chat` = conversational styling. */
  variant?: 'log' | 'chat';
  displayMode?: CombatLogDisplayMode;
  className?: string;
}

function renderTokens(event: GameLogEvent, displayMode: CombatLogDisplayMode) {
  const raw = event.legacy?.raw;
  if (raw !== undefined) {
    const src = displayMode === 'flavor' ? stripFlavorNumber(raw) : raw;
    const { body, number } = splitLogTokens(src);
    return { body, number };
  }
  const number =
    displayMode !== 'flavor' && event.amount != null ? `[${event.amount}]` : '';
  return { body: event.message, number };
}

export default function EventLogLine({
  event,
  variant = 'log',
  displayMode = 'flavor_numbers',
  className,
}: EventLogLineProps) {
  const pres = presentationForEvent(event);
  const { body, number } = renderTokens(event, displayMode);
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
        event.observed && 'opacity-60 italic',
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
