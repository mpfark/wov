---
name: Generation-scoped boss-cast recovery
description: Boss cast cooldown/recovery ledger is keyed by (creatureId, spawnSeq), never creature id alone or wall clock
type: feature
---

The in-memory recovery ledger in `src/shared/combat/pure/resolver.ts` (`Working.castReadyTick`)
is keyed by a branded `CreatureGenerationKey` built only through `generationKey(creatureId, spawnSeq)`.

Rules:
- a cast's recovery boundary is written to the generation that CAST it (`cast.casterSpawnSeq`);
- readiness lookups and new-cast writes use the live creature's current `spawnSeq`;
- when the spawn fence trips (`casterSpawnSeq !== creature.spawnSeq`) the cast is cancelled and its
  recovery is written to the old generation's key, so it is mechanically invisible to the respawn;
- terminal outcomes of the SAME generation (evade, zero damage, fully mitigated, all targets departed)
  still keep their cooldown — cooldown is never broadly skipped just because a cast terminated;
- durable `castReadyTick` stays fenced by encounter + creature + matching `spawn_seq` in SQL;
- never derive recovery from wall clock, `died_at`, or rely on the next snapshot to self-heal.

Coverage: `src/test/combat/pure/boss-cast-lifecycle.test.ts` (caster spawn identity section).
