import type { Combat2PresentationCreature, Combat2PresentationModel } from './presentation';
export type Combat2TargetRoster = Pick<Combat2PresentationModel, 'encounterId' | 'creatures'>;

export interface Combat2TargetIdentity {
  encounterId: string;
  id: string;
  creatureId: string;
  spawnSeq: number;
}
export type Combat2TargetResolution =
  | { ok: true; target: Combat2TargetIdentity }
  | { ok: false; reason: string };

export function targetIdentity(encounterId: string, creature: Combat2PresentationCreature): Combat2TargetIdentity {
  return { encounterId, id: creature.id, creatureId: creature.creatureId, spawnSeq: creature.spawnSeq };
}

/** No server current-target field exists. Never infer one from tank or legacy state. */
export function resolveCombat2Target(
  model: Combat2TargetRoster | null,
  selected: Combat2TargetIdentity | null,
): Combat2TargetResolution {
  if (!model) return { ok: false, reason: 'Combat2 has no authoritative target roster.' };
  const living = model.creatures.filter(c => c.isAlive && c.hp > 0);
  if (selected) {
    const valid = selected.encounterId === model.encounterId && living.find(c =>
      c.id === selected.id && c.creatureId === selected.creatureId && c.spawnSeq === selected.spawnSeq);
    return valid ? { ok: true, target: targetIdentity(model.encounterId, valid) }
      : { ok: false, reason: 'The selected Combat2 target is no longer valid. Select a living creature.' };
  }
  const engaged = living.filter(c => c.engaged);
  if (engaged.length === 1) return { ok: true, target: targetIdentity(model.encounterId, engaged[0]) };
  return { ok: false, reason: engaged.length > 1
    ? 'Choose a target: multiple living opponents are engaged.'
    : 'No living engaged target. Select a living creature explicitly to initiate engagement.' };
}
