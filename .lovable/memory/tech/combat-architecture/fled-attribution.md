---
name: Fled-contributor attribution roster
description: encounter_snapshot_v2 and commit_encounter_tick_v2 use encounter_attribution_roster (participants UNION live effect sources) so offscreen effect kills still reward departed owners.
type: feature
---

A finite player-owned effect belongs to its source after that source flees,
logs out, disengages, or dies. `encounter_participants` rows are DELETED on all
of those transitions (`trg_character_encounter_lifecycle`,
`encounter_reconcile`, `encounter_disengage`).

Run `c5t20260817c` failure: a fled character's Rend bleed killed a creature
offscreen; death committed, zero `encounter_kill_awards` and zero XP/gold/
salvage. Cause: the source was absent from `encounter_snapshot_v2`'s participant
list, so the pure resolver's `byParticipant.get(killerId)` missed and
`recipients` was empty (`resolver.ts` `killCreature`).

Fix (earliest loss point, SQL layer):
`public.encounter_attribution_roster(encounter_id)` =
`encounter_participants` UNION character `active_effects.source_id` whose target
is a creature of this encounter or a rostered character. Both
`encounter_snapshot_v2` (participant rows + effect target filter, `joinedAtMs`/
`rowVersion` falling back to `characters.created_at`) and
`commit_encounter_tick_v2` (all 5 membership validations) read that roster.

Roster membership grants **attribution only**. `presentAtNode` remains the sole
target/act roster, so a rostered absentee is never attacked, healed, or allowed
to act. Never recreate an engagement to make rewards work.

Diagnostics: offscreen death counts come from the orchestration result
(`creatureDeaths`/`characterDeaths`/`rewardedCharacterIds`, derived from the
committed `ProposedTick`). Never grep `events` for a `death` type — the resolver
emits `creature_killed`, which is why `combat-catchup` reported `deaths = 0`.

Guard: `src/test/combat/pure/fled-attribution.test.ts`.

Tightened contract (preflight before the deployed revalidation):
`encounter_attribution_roster` admits participants, plus the character owner of an
effect that is non-stance, unexpired, not consumed (`remaining` > 0 or NULL),
bound to the encounter's node, and targeting a LIVING creature of this encounter
whose current spawn generation postdates `creatures.died_at`, or a living
participant. It is `service_role`-only (EXECUTE revoked from anon/authenticated)
and raises 42501 for any JWT role other than `service_role`.
Extra guard: `src/test/combat/pure/fled-attribution-multi.test.ts`.
