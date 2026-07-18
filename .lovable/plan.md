## Goal

If a player is still at the boss's node when a telegraphed cast resolves, apply a short **movement lock** so they can't immediately walk out afterward. Leaving before resolution still avoids everything (damage + lock), preserving the "flee the node" fantasy.

## Behavior

- Cast resolves → for each character still at the node:
  - Take the damage (unchanged).
  - Receive a `cast_lock` effect for a configurable duration (default 3000ms).
- While `cast_lock` is active:
  - Movement attempts are blocked with a log line: *"You're staggered by <Cast Label> — can't move for Xs."*
  - Wimp auto-flee is also blocked (it just tried and failed anyway; this keeps it from spamming).
- Lock ends automatically; no cleanse, no dispel. Purely a short punish window.
- Players who left before resolution are unaffected — the resolve RPC already filters by "still at node".

## Admin control

Extend the Boss Cast section in `CreatureManager` with one new field:
- **Lock after resolve (ms)** — number input, default 3000, 0 disables.

Stored inside the existing `creatures.boss_cast` JSON as `lock_ms`. No schema migration needed.

## Server changes

`encounter_boss_resolve_cast` RPC (in Postgres):
- After applying damage to each eligible character, insert an `active_effects` row:
  - `effect_key = 'cast_lock'`
  - `expires_at = now() + lock_ms`
  - `source = creature_id`, `payload = { label, emoji }`
- Skip insert when `lock_ms <= 0`.

`combat-tick` / cast starter passes `lock_ms` through from `boss_cast` config into the resolve payload so the RPC knows the duration.

## Client changes

- `useMovementActions` (and any other movement entrypoint): before moving, check `activeEffects` for a non-expired `cast_lock`; if found, emit a log and abort. This mirrors the existing root/snare guard pattern.
- `useWimp`: same guard — treat active `cast_lock` as "no path" so it doesn't repeatedly try.
- `BossCastTelegraph` / status bar: show the lock as a normal debuff via the existing active-effect chip (no new UI component).

## Technical details

- Reuse `active_effects` — no new table. `cast_lock` becomes another entry alongside `root_debuff`, matching how snares/roots already block movement.
- Movement guard lives client-side (fast feedback) **and** server-side in the movement RPC if one exists, so a modified client can't bypass it. Confirm during implementation whether movement is currently server-validated; if it is only client-side, add a check in the character-move path or accept client-authority parity with existing root debuffs.
- Lock duration is authoritative on the server (written by the resolve RPC from the boss's config), never trusted from the client.

## Out of scope

- Cleanses, immunities, or diminishing returns on repeated locks.
- Different lock durations per player (e.g., CON-based reduction).
- Visual "chains" overlay — reuse the existing debuff chip styling.
