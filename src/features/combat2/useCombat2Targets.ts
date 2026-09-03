import { useState } from 'react';
import type { Combat2PresentationModel } from './presentation';

export function useCombat2Targets(model: Combat2PresentationModel | null) {
  const [selected, setSelected] = useState<string | null>(null);
  const living = model?.creatures.filter(c => c.isAlive && c.hp > 0) ?? [];
  const key = (c: typeof living[number]) => `${model?.encounterId}:${c.id}:${c.creatureId}:${c.spawnSeq}`;
  const current = living.find(c => key(c) === selected);
  return {
    selectedId: current?.creatureId ?? null,
    livingIds: new Set(living.map(c => c.creatureId)),
    select: (id: string | null) => {
      const creature = living.find(c => c.creatureId === id);
      setSelected(creature ? key(creature) : null);
    },
    cycle: () => {
      const index = current ? living.indexOf(current) : -1;
      const next = living[(index + 1) % living.length];
      setSelected(next ? key(next) : null);
    },
  };
}
