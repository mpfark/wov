/**
 * Owns: log string → CSS class mapping for combat/event log entries.
 */

const logColorCache = new Map<string, string>();

export function getLogColor(log: string): string {
  const cached = logColorCache.get(log);
  if (cached) return cached;
  let color = 'text-foreground/80';
  if (log.startsWith('⏳')) color = 'text-muted-foreground italic';
  else if (log.startsWith('💬')) color = 'text-foreground';
  else if (log.startsWith('🤫 To ')) color = 'text-purple-400/70';
  else if (log.startsWith('🤫')) color = 'text-purple-400';
  else if (log.includes('(remote)') && (log.startsWith('🩸') || log.startsWith('🧪') || log.startsWith('🔥'))) color = 'text-muted-foreground/60 italic text-[10px]';
  else if (log.includes('(remote)')) color = 'text-foreground/60';
  else if (log.includes('bleeds for') && log.startsWith('🩸')) color = 'text-dot-bleed italic';
  else if (log.includes('poison damage') && log.startsWith('🧪')) color = 'text-dot-poison italic';
  else if (log.includes('burns for') && log.startsWith('🔥')) color = 'text-dot-burn italic';
  else if (log.includes('CRITICAL!')) color = 'text-primary font-semibold log-crit';
  else if (log.startsWith('💀') || log.includes('been defeated') || log.includes('struck down')) color = 'text-destructive';
  else if (log.startsWith('☠️')) color = 'text-elvish';
  else if (log.startsWith('🎉') || log.includes('Level Up')) color = 'text-primary font-semibold';
  else if (log.startsWith('📈')) color = 'text-primary';
  else if (log.startsWith('⚠️')) color = 'text-dwarvish';
  else if (log.startsWith('💔')) color = 'text-destructive/80';
  else if (log.startsWith('💉')) color = 'text-blood font-semibold';
  else if (log.startsWith('💚') || log.startsWith('💪') || log.includes('restore') || log.includes('recover')) color = 'text-elvish';
  else if (log.startsWith('🌑')) color = 'text-primary';
  else if (log.startsWith('🦅')) color = 'text-primary';
  else if (log.startsWith('🎶') || log.startsWith('✨')) color = 'text-elvish';
  else if (log.startsWith('🌿')) color = 'text-elvish';
  else if (log.startsWith('🏹🏹')) color = 'text-primary';
  else if (log.startsWith('🛡️')) color = 'text-dwarvish';
  else if (log.startsWith('📯')) color = 'text-dwarvish';
  else if (log.startsWith('🩸')) color = 'text-blood';
  else if (log.startsWith('🧪')) color = 'text-elvish';
  else if (log.startsWith('🔪')) color = 'text-primary font-semibold';
  else if (log.startsWith('🌫️')) color = 'text-primary';
  else if (log.startsWith('🔥🔥') || log.startsWith('🔥')) color = 'text-dwarvish';
  else if (log.startsWith('🦘')) color = 'text-elvish font-semibold';
  else if (log.startsWith('🎯')) color = 'text-primary font-semibold';
  else if (log.startsWith('💥')) color = 'text-primary font-semibold';
  else if (log.startsWith('🛡️✨')) color = 'text-primary';
  else if (log.startsWith('🎵💢')) color = 'text-dwarvish';
  else if (log.startsWith('🎶✨')) color = 'text-elvish';
  else if (log.startsWith('🔄🎭')) color = 'text-primary font-semibold';
  else if (log.startsWith('🔨')) color = 'text-dwarvish font-semibold';
  else if (log.includes('miss')) color = 'text-muted-foreground';
  else if (log.includes('damage')) color = 'text-foreground/90';
  
  if (logColorCache.size > 200) logColorCache.clear();
  logColorCache.set(log, color);
  return color;
}
