---
name: Legacy cleanup L1 — retired combat mutator privileges
description: 15 retired combat mutation RPCs are revoked from PUBLIC/anon/authenticated; bodies retained one release before any L6 drop
type: feature
---

Applied 2026-08-28 as a privilege-only migration. Retired standalone combat
mutators (`encounter_apply_damage/heal`, `encounter_apply_character_*`,
`encounter_stored_power_add/consume/set_cap`, `encounter_boss_start/resolve/fizzle_cast`,
both `award_party_member` overloads, `degrade_party_member_equipment`,
`update_party_member_hp`) are no longer executable by PUBLIC, anon or
authenticated. Bodies remain installed for one release; any drop is a separate
L6 decision that must not be scheduled automatically.

Never revoke the deliberately live out-of-combat writers: `damage_party_member`
(movement hazard), `heal_party_member` (rest/out-of-combat), `grant_searched_item`
(search), `respawn_creatures`.

Known remaining authority gaps for the state-ownership phase: the `characters`
self-UPDATE policy still allows direct client writes to hp/cp/mp/xp/renown, and
`prune_ended_encounters` is still client-executable.

Details: docs/design/legacy-cleanup-l1-checkpoint.md
