import { useEffect, useMemo, useState } from 'react';
import { TICK_MS } from '@/shared/combat2/boss-catalog';
import type { Combat2PresentationTelegraph } from './presentation';

interface Props {
  telegraph: Combat2PresentationTelegraph;
  encounterTick: number;
}

function labelFor(telegraph: Combat2PresentationTelegraph): string {
  return telegraph.abilityLabel?.trim()
    || telegraph.abilityKey.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function Combat2TelegraphIndicator({ telegraph, encounterTick }: Props) {
  const ticksRemaining = Math.max(0, telegraph.resolveAtTick - encounterTick);
  const deadline = useMemo(
    () => Date.now() + ticksRemaining * TICK_MS,
    [telegraph.id, encounterTick, ticksRemaining],
  );
  const [now, setNow] = useState(Date.now());
  const millisecondsRemaining = Math.max(0, deadline - now);

  useEffect(() => {
    setNow(Date.now());
    if (ticksRemaining === 0) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [deadline, ticksRemaining]);

  const label = labelFor(telegraph);
  const state = millisecondsRemaining > 0
    ? `Gathering · ${Math.ceil(millisecondsRemaining / 1000)}s`
    : 'Awaiting resolution';
  const target = telegraph.targetIsCurrentCharacter ? ' · Target: You' : '';
  const accessible = `${label}: ${state}${target}`;

  return (
    <span
      className="rounded border border-destructive/60 bg-destructive/10 px-1.5 py-0.5 text-[9px] font-display text-destructive"
      title={accessible}
      aria-label={accessible}
      data-combat2-telegraph-id={telegraph.id}
    >
      {label} · {state}{target}
    </span>
  );
}
