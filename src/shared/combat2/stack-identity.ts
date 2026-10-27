/** Shared only by explicitly opted-in owned status stacks; legacy keys stay unchanged. */
export function ownedStackIdentity(
  sourceCharacterId: unknown, nodeCreatureId: unknown, spawnSeq: unknown, effectType: unknown,
  sourceFighterId: unknown, sourceEntrySeq: unknown,
): string {
  return JSON.stringify(['caster_status', sourceCharacterId, nodeCreatureId, spawnSeq, effectType,
    sourceFighterId, sourceEntrySeq]);
}
