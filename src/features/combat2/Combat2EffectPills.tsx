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

interface PresentedEffect {
  id: string;
  label: string;
  category: Combat2PresentationEffect['category'];
  stacks: number | null;
  expiresAt: string | null;
  details: string[];
}

/**
 * A Combat2 stance intentionally has two authoritative records: the stance
 * mechanic and its CP reservation. Present them as one stance state while
 * retaining both records (and both meanings) in the accessible description.
 * Identity includes source, target and ability; this is not label-based
 * deduplication and therefore cannot collapse unrelated stackable effects.
 */
function presentEffects(effects: readonly Combat2PresentationEffect[]): PresentedEffect[] {
  const paired = new Map<string, Combat2PresentationEffect[]>();
  const stanceKey = (effect: Combat2PresentationEffect) => [
    effect.sourceCharacterId ?? '', effect.targetCharacterId ?? '', effect.abilityKey ?? '',
  ].join(':');

  for (const effect of effects) {
    if (effect.category !== 'stance' || effect.abilityKey === null || effect.targetCharacterId === null) continue;
    const key = stanceKey(effect);
    paired.set(key, [...(paired.get(key) ?? []), effect]);
  }

  const consumed = new Set<string>();
  const result: PresentedEffect[] = [];
  for (const effect of effects) {
    if (consumed.has(effect.id)) continue;
    const group = effect.category === 'stance' ? paired.get(stanceKey(effect)) ?? [effect] : [effect];
    const reservation = group.find((candidate) => candidate.isReservation);
    const mechanics = group.filter((candidate) => !candidate.isReservation);
    const isPairedStance = reservation !== undefined && mechanics.length > 0;
    const members = isPairedStance ? group : [effect];
    members.forEach((member) => consumed.add(member.id));

    const details = isPairedStance
      ? [
          reservation.magnitude !== null ? `${reservation.magnitude} CP reserved` : 'CP reserved',
          ...mechanics.map((mechanic) => {
            const semantic = titleCase(mechanic.kind);
            return mechanic.magnitude !== null ? `${semantic} magnitude ${mechanic.magnitude}` : semantic;
          }),
        ]
      : [
          effect.stacks !== null ? `${effect.stacks} stack${effect.stacks === 1 ? '' : 's'}` : null,
          effect.magnitude !== null ? `magnitude ${effect.magnitude}` : null,
        ].filter((detail): detail is string => detail !== null);
    const expiresAt = members.map((member) => member.expiresAt).find((value) => value !== null) ?? null;
    result.push({
      id: members.map((member) => member.id).join(' '),
      label: titleCase(effect.abilityKey ?? effect.effectType ?? effect.kind),
      category: effect.category,
      stacks: isPairedStance ? null : effect.stacks,
      expiresAt,
      details,
    });
  }
  return result;
}

export function Combat2EffectPills({ effects }: Props) {
  const [now, setNow] = useState(Date.now());
  const hasExpiry = effects.some((effect) => effect.expiresAt !== null);
  const presented = presentEffects(effects);

  useEffect(() => {
    if (!hasExpiry) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [hasExpiry]);

  return presented.map((effect) => {
    const details = [
      ...effect.details,
      effect.expiresAt !== null ? `${remaining(effect.expiresAt, now)} remaining` : null,
    ].filter((detail): detail is string => detail !== null);
    const accessible = details.length > 0 ? `${effect.label}: ${details.join(', ')}` : effect.label;
    return (
      <span
        key={effect.id}
        className={`rounded border px-1.5 py-0.5 text-[9px] font-display ${CATEGORY_STYLE[effect.category]}`}
        title={accessible}
        aria-label={accessible}
        data-combat2-effect-id={effect.id}
      >
        {effect.label}{effect.stacks !== null && effect.stacks > 1 ? ` ×${effect.stacks}` : ''}
        {effect.expiresAt !== null ? ` · ${remaining(effect.expiresAt, now)}` : ''}
      </span>
    );
  });
}
