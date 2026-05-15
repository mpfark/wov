/**
 * Owns: log string → CSS class mapping for combat/event log entries.
 *
 * Thin shim over event-log-styles.classifyLogLine — kept for any caller that
 * just wants a single text color class. The Event Log itself renders
 * structured icon/body/number spans via splitLogTokens.
 */

import { classifyLogLine, EVENT_STYLE } from './event-log-styles';

const logColorCache = new Map<string, string>();

export function getLogColor(log: string): string {
  const cached = logColorCache.get(log);
  if (cached) return cached;

  const { category, isRemote } = classifyLogLine(log);
  const style = EVENT_STYLE[category];
  let color = style.textClass;
  if (style.emphasis === 'strong') color += ' font-semibold';
  if (isRemote) color += ' opacity-60 italic';

  if (logColorCache.size > 200) logColorCache.clear();
  logColorCache.set(log, color);
  return color;
}
