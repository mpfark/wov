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

/** True when the prose already states this number, so it must not repeat. */
function bodyStatesAmount(body: string, amount: number): boolean {
  return new RegExp(`(?<!\\d)${amount}(?!\\d)`).test(body);
}

function renderTokens(event: GameLogEvent, displayMode: CombatLogDisplayMode) {
  // Both legacy strings and client-authored prose may still carry a leading
  // glyph and/or an inline `[N]` tail. Strip both, then re-attach exactly one
  // number token (a pre-composed `numberText` wins, then inline, then `amount`;
  // a number already written into the sentence suppresses the token entirely)
  // so nothing renders twice.
  const src = event.legacy?.raw ?? event.message;
  const cleaned = displayMode === 'flavor' ? stripFlavorNumber(src) : src;
  const { body, number: inline } = splitLogTokens(cleaned);
  if (displayMode === 'flavor') return { body, number: '' };
  const number =
    event.numberText ||
    inline ||
    (event.amount != null && !bodyStatesAmount(body, event.amount) ? `[${event.amount}]` : '');
  return { body, number };
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
          aria-hidden={pres.marker === 'kill' ? true : undefined}
          aria-label={pres.marker === 'kill' ? undefined : MARKER_LABEL[pres.marker!]}
          role={pres.marker === 'kill' ? undefined : 'img'}
        />
      )}
      {!isChat && pres.marker === 'kill' && (
        <span className="event-log-marker-label">{MARKER_LABEL.kill} — </span>
      )}
      <span className="event-log-body">{body}</span>
      {number && (
        <span className={cn('event-log-number', pres.numberClass)}>{` ${number}`}</span>
      )}
    </p>
  );
}
