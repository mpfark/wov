/**
 * Owns: log string → CSS class mapping for callers that only need a single
 * text color class.
 *
 * Thin shim over event-log-styles.toPresentation so there is exactly one
 * styling path. Line rendering itself goes through <EventLogLine />.
 */

import { legacyStringToEvent } from '@/features/combat/events/legacy-adapter';
import { presentationForEvent } from '@/features/combat/events/presentation';

const logColorCache = new Map<string, string>();

export function getLogColor(log: string): string {
  const cached = logColorCache.get(log);
  if (cached) return cached;

  const event = legacyStringToEvent(log);
  const pres = presentationForEvent(event);
  let color = pres.textClass;
  if (pres.strong) color += ' font-medium';
  if (event.observed) color += ' opacity-60 italic';

  if (logColorCache.size > 200) logColorCache.clear();
  logColorCache.set(log, color);
  return color;
}

