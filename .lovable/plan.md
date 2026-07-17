# M4 — Participant Lifecycle

Before starting: play a short fight and confirm HP no longer snaps back and edge logs are free of `23505 duplicate key value violates encounters_active_key_uidx`. If clean, proceed with M4 below.

## Goal

Make `encounter_participants` the single source of truth for "who is fighting whom, right now, at this node." Right now nothing writes to it in a meaningful lifecycle way, so:

- Non-aggressive creatures never formally "disengage" when a player leaves the node → they linger in combat state and reset to full HP on next tick.
- Characters who walked past an aggressive creature months ago are still treated as engaged → summon block, stale `combat_sessions`, phantom in-combat flags.
- Rogue "double kill" — creature is marked dead in one path but participant row isn't cleared, so the next tick treats it as re-engaged.

M4 makes engage/disengage explicit, atomic, and node-scoped.

## Scope

In scope
- Formal `engage` and `disengage` transitions on `encounter_participants` (both character and creature rows).
- Auto-disengage on: node departure, character death, creature death, wimp flee, teleport, summon accept, logout.
- Non-aggressive creatures release their participant row when the last engaged character leaves the node.
- `combat_sessions` becomes derived: created when a participant row is inserted at a node, ended when the last character participant leaves.
- `characters.in_combat` (or the equivalent flag consumed by summon/teleport) becomes a **read from `encounter_participants`**, not a persisted column write.
- Backfill migration that clears every orphan participant + orphan session.

Out of scope
- Cast lifecycle (M6).
- Removing `combat_sessions` table entirely (M7).
- Wizard force-shield regen fix (separate track).

## SQL — new RPCs

All `SECURITY DEFINER`, `SET search_path = public`, single transaction, `pg_advisory_xact_lock(encounter_lock_key(encounter_id))`.

```
encounter_engage_character(_character_id uuid, _node_id uuid)
  → upserts participant row, ensures encounter, creates session if none

encounter_disengage_character(_character_id uuid, _reason text)
  → 'left_node' | 'died' | 'fled' | 'teleport' | 'summoned' | 'logout'
  → removes participant row, cascades: if 0 character participants left,
    releases all creature participants and closes the session

encounter_disengage_creature(_creature_id uuid, _reason text)
  → 'died' | 'released' | 'despawned'
  → removes creature participant row

encounter_release_orphans(_node_id uuid)
  → sweep: any creature participant at node with 0 engaged characters
    → disengage (respects aggressive flag: aggressive stays engaged until
    the aggro target actually leaves the node area, non-aggressive
    releases immediately)
```

Character-side view:
```
character_is_engaged(_character_id uuid) RETURNS boolean
  → EXISTS on encounter_participants; used by accept_summon, teleport,
    wimp checks, and any client "in combat" gate
```

## TypeScript touchpoints

`supabase/functions/combat-tick/index.ts`
- On session open: call `encounter_engage_character` for each party member present at the node.
- On tick, when a creature reaches 0 HP: `encounter_disengage_creature(..., 'died')` in the same transaction as the kill write.
- On character death: `encounter_disengage_character(..., 'died')`.
- On session close (no engaged creatures left): iterate remaining character participants → `encounter_disengage_character(..., 'left_node')`.

`supabase/functions/combat-catchup/index.ts`
- On DoT resolution that kills a creature: `encounter_disengage_creature(..., 'died')`.
- After sweep, call `encounter_release_orphans(node_id)`.

`src/features/world/hooks/useMovementActions.ts`
- After a successful move, call `encounter_disengage_character(character_id, 'left_node')`. Fire-and-forget, non-blocking.

`src/features/world/hooks/useKeyboardMovement.ts` / teleport / summon accept / wimp flee
- Same disengage call with the appropriate reason.

`src/hooks/useAuth.ts` (or wherever sign-out lives)
- Disengage on sign-out with reason `logout`.

`accept_summon` RPC (existing)
- Replace the "self-heal orphan sessions" logic with a straight
  `character_is_engaged(target)` check. If false, allow. If true, block
  with the current combat message. The disengage-on-move path means
  orphans should stop appearing entirely, so this becomes a simple guard.

Client "in combat" gates (teleport, summon, world map fast-travel, wimp)
- Replace any read of `characters.in_combat` with a read of
  `character_is_engaged` (or a cached selector derived from the
  encounter_participants realtime subscription).

## Backfill migration

Single migration, runs once:
1. `DELETE FROM encounter_participants` where the referenced character is not at the encounter's node OR the referenced creature is dead.
2. `DELETE FROM combat_sessions` where there is no matching participant row.
3. Clear any `characters.in_combat = true` rows whose character has no participant row.

## Rollout

1. Ship the SQL RPCs + backfill migration first (safe: no callers yet).
2. Ship the TS wiring (engage on tick, disengage on move/death/logout).
3. Flip the "in combat" gate on `accept_summon` / teleport / wimp to use `character_is_engaged`.
4. Watch edge logs for one play session across: leave-node during fight, kill creature, die to creature, teleport mid-fight, summon accept, sign out mid-fight, DoT kill offscreen.
5. Declare M4 done → move to M5 (encounter reconciliation, which cleans up the duplicate DoT reward bug).

## Expected bug outcomes after M4

| Bug | Fix path |
|---|---|
| Non-aggressive creature resets on player leave | `encounter_release_orphans` releases the participant row → next tick has no engaged character → creature stays at damaged HP, does not regen back to full mid-fight |
| Character stuck "in combat" after walking past aggressive creature | Disengage-on-move + backfill migration |
| Rogue "double kill" | Disengage-on-death happens in the same transaction as the HP write, so the next tick can't re-engage |
| Duplicate DoT reward for party member | Still needs M5 — participant lifecycle alone won't dedupe the reward path |

## Technical notes

- Participant rows are cheap; the design deliberately keeps `combat_sessions` alive as a compatibility shim so the client tick loop and party-authority code don't need rewriting yet. M7 will collapse them.
- Disengage-on-move is fire-and-forget from the client, but the RPC is idempotent so a lost call just means the next tick's `release_orphans` sweep catches it.
- `encounter_release_orphans` must respect the aggressive flag — an aggressive creature whose target is still at the node stays engaged even if a non-target character walks away. That prevents an exploit where a bystander steps in and out to force disengage.
- Everything runs under the existing `encounter_lock_key(encounter_id)` advisory lock, so no new lock hierarchy.
