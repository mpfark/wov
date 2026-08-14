---
name: Presence vs participation
description: Encounter snapshots carry all participants for attribution/rewards; presentAtNode is the only target roster.
type: feature
---

`encounter_snapshot_v2` returns **every** `encounter_participants` row (complete
attribution: durable effect sources, contributions, kill recipients, rewards)
and stamps each participant with `presentAtNode = (characters.current_node_id =
encounters.node_id)`.

The pure resolver uses `presentAtNode` (helper `isPresent`) as the **only**
target roster:
- may not be attacked by creatures, healed, party-regenerated, or hit by a
  telegraphed cast;
- may not act — queued actions are rejected with reason `not_present`;
- still ticks their DoTs, still earns kill XP/gold/renown/salvage/gems/bond.

Never derive target eligibility from delivery/RLS grace
(`encounter_access_grants`) — that is delivery only. Absent `presentAtNode` in a
snapshot means present (back-compat for older fixtures).

Guard: `src/test/combat/pure/presence.test.ts`.
