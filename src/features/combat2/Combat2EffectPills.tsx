import { useEffect, useState } from 'react';
import type { Combat2PresentationEffect } from './presentation';

interface Props {
  effects: readonly Combat2PresentationEffect[];
}

const CATEGORY_STYLE = {
  beneficial: 'border-elvish/50 bg-elvish/10 text-elvish',
  harmful: 'border-destructive/50 bg-destructive/10 text-destructive',
  stance: 'border-primary/50 bg-primary/10 text-primary',
  unknown: 'border-border bg-muted/40 text-muted-foreground',
} as const;

function titleCase(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function remaining(expiresAt: string, now: number): string {
  return `${Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 1000))}s`;
}

export function Combat2EffectPills({ effects }: Props) {
  const [now, setNow] = useState(Date.now());
  const hasExpiry = effects.some((effect) => effect.expiresAt !== null);

  useEffect(() => {
    if (!hasExpiry) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [hasExpiry]);

  return effects.map((effect) => {
    const label = titleCase(effect.abilityKey ?? effect.effectType ?? effect.kind);
    const details = [
      effect.stacks !== null ? `${effect.stacks} stack${effect.stacks === 1 ? '' : 's'}` : null,
      effect.magnitude !== null ? `magnitude ${effect.magnitude}` : null,
      effect.expiresAt !== null ? `${remaining(effect.expiresAt, now)} remaining` : null,
    ].filter((detail): detail is string => detail !== null);
    const accessible = details.length > 0 ? `${label}: ${details.join(', ')}` : label;
    return (
      <span
        key={effect.id}
        className={`rounded border px-1.5 py-0.5 text-[9px] font-display ${CATEGORY_STYLE[effect.category]}`}
        title={accessible}
        aria-label={accessible}
        data-combat2-effect-id={effect.id}
      >
        {label}{effect.stacks !== null && effect.stacks > 1 ? ` ×${effect.stacks}` : ''}
        {effect.expiresAt !== null ? ` · ${remaining(effect.expiresAt, now)}` : ''}
      </span>
    );
  });
}
