import { useEffect, useRef, useState } from 'react';
import { resolveCombat2ManualAttackTarget, resolveCombat2Target, targetIdentity, type Combat2TargetIdentity, type Combat2TargetRoster } from './target-resolution';

export function useCombat2Targets(model: Combat2TargetRoster | null) {
  const [selected, setSelected] = useState<Combat2TargetIdentity | null>(null);
  const living = model?.creatures.filter(c => c.isAlive && c.hp > 0) ?? [];
  const current = selected && model?.encounterId === selected.encounterId
    ? living.find(c => c.id === selected.id && c.creatureId === selected.creatureId && c.spawnSeq === selected.spawnSeq) : undefined;
  // Forget invalid selections, rather than letting an old identity reappear later.
  useEffect(() => { if (selected && !current) setSelected(null); }, [selected, current]);
  const explicit = current ? selected : null;
  const resolved = resolveCombat2Target(model, explicit);
  const latest = useRef({ model, explicit });
  latest.current = { model, explicit };
  return {
    selectedId: resolved.ok ? resolved.target.creatureId : null,
    livingIds: new Set(living.map(c => c.creatureId)),
    resolve: () => resolveCombat2Target(latest.current.model, latest.current.explicit),
    resolveManualAttack: () => resolveCombat2ManualAttackTarget(latest.current.model, latest.current.explicit),
    resolveId: (id: string) => {
      const roster = latest.current.model;
      const creature = roster?.creatures.find(c => c.creatureId === id && c.isAlive && c.hp > 0);
      return creature && roster ? { ok: true as const, target: targetIdentity(roster.encounterId, creature) }
        : { ok: false as const, reason: 'The selected Combat2 target is no longer valid.' };
    },
    resolveManualAttackId: (id: string) => {
      const roster = latest.current.model;
      const creature = roster?.creatures.find(c => c.creatureId === id && c.isAlive && c.hp > 0 && !c.engaged);
      return creature && roster ? { ok: true as const, target: targetIdentity(roster.encounterId, creature) }
        : { ok: false as const, reason: 'The selected creature is already engaged or no longer valid.' };
    },
    select: (id: string | null) => {
      const creature = living.find(c => c.creatureId === id);
      setSelected(creature && model ? targetIdentity(model.encounterId, creature) : null);
    },
    cycle: () => {
      const index = living.findIndex(c => c.creatureId === (resolved.ok ? resolved.target.creatureId : null));
      const next = living[(index + 1) % living.length];
      setSelected(next && model ? targetIdentity(model.encounterId, next) : null);
    },
  };
}
