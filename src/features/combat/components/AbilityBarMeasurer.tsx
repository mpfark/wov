/**
 * AbilityBarMeasurer — invisibly renders the widest class's ability bar
 * (Templar) using the exact same button classes as the real bar, then
 * reports its pixel width via ResizeObserver. GamePage uses the measured
 * width to cap the center panel so the bar always fits on one line.
 *
 * Templar is the widest class — "Divine Challenge" (16 chars) is the
 * longest single ability label in the game.
 */

import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { CLASS_ABILITIES } from '@/features/combat';

interface Props {
  onMeasure: (width: number) => void;
}

export function AbilityBarMeasurer({ onMeasure }: Props) {
  const rowRef = useRef<HTMLDivElement>(null);
  const abilities = CLASS_ABILITIES.templar ?? [];

  useEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    const report = () => onMeasure(el.getBoundingClientRect().width);
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [onMeasure]);

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed left-0 top-0 opacity-0 -z-10"
      style={{ visibility: 'hidden' }}
    >
      <div ref={rowRef} className="inline-flex items-center gap-1 whitespace-nowrap">
        {abilities.map((ability, idx) => (
          <Button
            key={idx}
            variant="outline"
            size="sm"
            disabled
            className="font-display text-[10px] h-6 px-2 text-elvish border-elvish/50"
          >
            {ability.emoji} {ability.label}
            <span className="ml-0.5 text-[8px] text-muted-foreground">[{idx + 1}]</span>
          </Button>
        ))}
      </div>
    </div>
  );
}
