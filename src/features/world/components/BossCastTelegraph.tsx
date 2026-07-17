import { useEffect, useState } from 'react';

interface Props {
  label: string;
  emoji: string;
  startedAt: number;
  expiresAt: number;
  amount?: number;
}

/**
 * Boss telegraph bar rendered inside a creature card while a cast is in flight.
 * The bar fills from 0 → 100% between startedAt and expiresAt. When it fills,
 * the server has (or will imminently) apply the effect to every character
 * still at the node — moving away before then avoids it entirely.
 */
export function BossCastTelegraph({ label, emoji, startedAt, expiresAt, amount }: Props) {
  const total = Math.max(1, expiresAt - startedAt);
  const [pct, setPct] = useState(() =>
    Math.min(100, Math.max(0, ((Date.now() - startedAt) / total) * 100))
  );

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const now = Date.now();
      const next = Math.min(100, Math.max(0, ((now - startedAt) / total) * 100));
      setPct(next);
      if (next < 100) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [startedAt, total]);

  const remaining = Math.max(0, expiresAt - Date.now());
  const isImminent = pct > 75;

  return (
    <div className="mt-1 px-1">
      <div className="flex items-center justify-between mb-0.5">
        <span className={`text-[10px] font-display ${isImminent ? 'text-destructive animate-pulse' : 'text-dwarvish'}`}>
          {emoji} {label} — FLEE THE NODE
          {amount ? <span className="text-muted-foreground ml-1">({amount} dmg)</span> : null}
        </span>
        <span className="text-[9px] text-muted-foreground tabular-nums">{(remaining / 1000).toFixed(1)}s</span>
      </div>
      <div className="w-full h-1.5 bg-background rounded-full overflow-hidden border border-destructive/40">
        <div
          className="h-full transition-[width] duration-100"
          style={{
            width: `${pct}%`,
            backgroundColor: isImminent ? 'hsl(var(--destructive))' : 'hsl(var(--dwarvish))',
          }}
        />
      </div>
    </div>
  );
}
