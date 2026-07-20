import { useEffect, useState } from 'react';

interface Props {
  label: string;
  emoji: string;
  expiresAt: number;
  amount?: number;
}

/**
 * Compact inline telegraph label rendered next to a boss's HP bar while a
 * cast is in flight. Shows emoji + label + live countdown + FLEE hint.
 * The HP bar itself glows destructive-red (applied in NodeView) to signal
 * the telegraph — this component intentionally has no progress bar.
 */
export function BossCastTelegraph({ label, emoji, expiresAt, amount }: Props) {
  const [remainingMs, setRemainingMs] = useState(() => Math.max(0, expiresAt - Date.now()));

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const next = Math.max(0, expiresAt - Date.now());
      setRemainingMs(next);
      if (next > 0) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [expiresAt]);

  const isImminent = remainingMs < 1500;

  return (
    <span
      className={`text-[10px] font-display whitespace-nowrap ${
        isImminent ? 'text-destructive animate-pulse' : 'text-destructive/90'
      }`}
    >
      {emoji} {label}
      {amount ? <span className="text-muted-foreground ml-1">({amount})</span> : null}
      <span className="ml-1 tabular-nums">· {(remainingMs / 1000).toFixed(1)}s</span>
      <span className="ml-1 font-bold">· FLEE</span>
    </span>
  );
}
