import { useState, useEffect, useRef } from 'react';

interface Props {
  lastTickTime: number | null;
  tickInterval?: number; // ms, default 2000
}

export default function HeartbeatIndicator({ lastTickTime, tickInterval = 2000 }: Props) {
  const [progress, setProgress] = useState(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (lastTickTime === null) { setProgress(0); return; }

    const animate = () => {
      const elapsed = Date.now() - lastTickTime;
      const pct = Math.min(elapsed / tickInterval, 1);
      setProgress(pct);
      if (pct < 1) {
        rafRef.current = requestAnimationFrame(animate);
      }
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [lastTickTime, tickInterval]);

  const size = 20;
  const strokeWidth = 2.5;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - progress);

  // Pulse on tick
  const justTicked = lastTickTime !== null && Date.now() - lastTickTime < 200;

  return (
    <div className="flex items-center gap-1" title="Next attack tick">
      <svg width={size} height={size} className={`-rotate-90 ${justTicked ? 'scale-125' : 'scale-100'} transition-transform duration-150`}>
        {/* Background circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="hsl(var(--border))"
          strokeWidth={strokeWidth}
        />
        {/* Progress arc */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="hsl(var(--destructive))"
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          className="transition-none"
        />
      </svg>
      <span className="text-[9px] font-display text-destructive/70 tracking-wide">⚔️</span>
    </div>
  );
}
