# C0 — Combat maintenance gate (fail closed)

Scope: C0 only. No resolver, commit or delivery work. Combat ends this checkpoint closed and stays closed until you approve reopening.

## What C0 does

A single operational switch decides whether any authoritative combat resolution may run. Both resolvers read it as their first database access — before intent is read, before a roster is loaded, before any roll, before any write. Anything other than the exact value `open` means closed, including a missing row or a failed read.

`combat_config` already exists as a `key` / `value` text table and currently holds only `tick_owner = shared`. C0 adds the row `combat_mode = maintenance` to it.

## Fail-closed points

```text
combat-tick     auth -> parse body -> READ MODE -> [closed] return maintenance
                                                -> [open]  intent, roster, simulate, commit

combat-catchup  auth -> node proximity -> snapshot_only (read-only, still served)
                     -> READ MODE -> [closed] return maintenance + plain creature read
                                  -> [open]  claim, replay effects, commit
```

Nothing is claimed, no lease is taken, no `combat_actions` row is consumed and no HP, loot, XP, durability or effect row is touched on the closed path. Read-only creature snapshots keep working so the world screen still renders.

## Client behaviour

- The gated response carries no events and no batch identity, so it can never be mistaken for a resolved tick.
- On seeing it the combat driver stops the tick timer, clears any pending CP reservation, shows the maintenance notice once, and refuses to start combat again.
- Player-facing text: "Combat is closed for maintenance. The world is safe; the Wayfarers rest until the smiths are done."

## Verification for this checkpoint

1. Unit tests: only `open` opens; missing row, empty string, `Open`, `shared`, read error and a thrown read all close; the gated payload has empty events and null encounter/batch identity.
2. Live path: invoke `combat-tick` and confirm the maintenance response, then confirm from the database that no creature HP, `combat_actions`, `encounter_tick_batches`, `encounters` lease or `active_effects` row changed.
3. Catch-up path: invoke `combat-catchup` for a node with pending effects and confirm effects are not advanced, no claim is recorded, and the creature read still returns.

## Technical detail

- New `supabase/functions/_shared/combat/maintenance.ts`: `parseCombatMode`, `readCombatMode` (fail closed on error/missing), `maintenanceResponse()`.
- Mirror `src/shared/combat/maintenance.ts` for the client contract (`isMaintenanceResponse`, `maintenanceMessage`).
- Gate inserted in `supabase/functions/combat-tick/index.ts` immediately after body validation, and in `supabase/functions/combat-catchup/index.ts` after the proximity/snapshot block and before the shared claim.
- `useCombatDriver.ts` gains a maintenance branch in the tick response handler plus a `combatMaintenance` flag surfaced to the game page for the notice.
- Data change (not schema): insert `combat_mode = maintenance` into `combat_config`.
- Client-side ability submission is disabled while closed; server-side gating of action intake and the cleanup of any actions queued during maintenance belong to C3/C5, not C0.

## After C0

I report the verification results and stop. C1 (pure resolver plus its tests), the C2 payload review, C2, C3, C4 and the full validation suite follow as separate checkpoints, and `combat_mode` is only set to `open` with your explicit approval.
