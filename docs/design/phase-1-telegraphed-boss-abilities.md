# Phase 1 — Telegraphed Boss Abilities (v3)

**Status:** Paused pending combat architecture decision (see `combat-architecture-comparison.md`).

This document preserves the v3 proposal as approved-in-principle. It is not the final implementation spec — several mechanisms here (per-node advisory lock, stale-HP re-seeding, transactional resolve RPC) exist specifically to paper over the fact that the current combat model has no first-class notion of a shared, node-scoped encounter. Whether those mechanisms survive as-is or get replaced by first-class primitives depends on the architecture decision.

---

## Goal

Give bosses reusable **telegraphed** abilities: a visible cast begins, all players in the node see the same cast bar, and players who leave the node before resolution avoid the effect. Abandoning the fight has a cost (partial boss heal). Multiple parties on the same creature share one cast.

## Data model

### `creature_abilities` (template)
Reusable ability definitions. Assignable to any creature.
- `id`, `key` (unique, e.g. `shadow_nova`), `display_name`
- `cast_time_ms` (int)
- `effect_kind` (`damage` | `debuff` | `heal_self` | `summon` | `hazard`)
- `effect_payload` (jsonb — damage dice, debuff key/duration, etc.)
- `avoidance` (`leave_node` | `interrupt` | `both`)
- `on_empty_room_heal_pct` (int, default 0) — heal the boss by this % of max HP if resolution finds zero eligible players.
- `min_hp_pct` / `max_hp_pct` — HP threshold gating.
- `internal_cooldown_ms` — per-creature cooldown after resolution.

### `creature_ability_assignments`
`(creature_id, ability_id, weight)` — many-to-many with pick weights.

### `active_boss_casts` — the boss-owned runtime state
One row per **active** cast. Keyed by `creature_id` with a partial unique index so only one live cast per creature can exist across all statuses.
- `id`, `creature_id`, `node_id`, `ability_id`
- `started_at`, `resolves_at`
- `status` (`pending` | `resolving` | `resolved` | `interrupted` | `expired`)
- `eligibility_snapshot` (jsonb) — the set of `character_id`s captured at cast start (used only as a hint; the authoritative "still here at resolution" check happens inside the resolve RPC).
- `resolved_at`, `resolution_summary` (jsonb) — for client replay & audit.

Unique index (Postgres):
```sql
CREATE UNIQUE INDEX one_live_cast_per_creature
  ON active_boss_casts (creature_id)
  WHERE status IN ('pending', 'resolving');
```

### `boss_encounter_state`
Per-creature persistent encounter memory that survives an empty room without a permanent loop.
- `creature_id` (PK), `node_id`
- `phase_thresholds_fired` (jsonb array of hp_pct thresholds already triggered this life)
- `last_ability_at`, `last_ability_id`
- `combat_started_at`
- **Reset points** (only): creature death, respawn, or full out-of-combat heal back to `max_hp`.

## Cast lifecycle

1. **Schedule.** During a tick, if the boss is eligible (HP band, cooldown elapsed, no live cast row), the tick tries `INSERT ... ON CONFLICT (creature_id) WHERE status IN ('pending','resolving') DO NOTHING`. Losers of the race silently continue — only one cast exists.
2. **Broadcast.** After a successful insert, the tick emits `boss_cast_started` on the `node-<id>` channel with `{cast_id, ability_key, resolves_at, eligibility_snapshot}` so every client at the node renders the same cast bar.
3. **Resolve.** When `now >= resolves_at`, resolution is triggered by:
   - the boss's next tick from any party present, OR
   - `combat-tick`'s per-invocation sweep, OR
   - `combat-catchup` on next node entry (defines "overdue abandoned casts resolve on next interaction").
4. **Transactional resolve RPC — `resolve_boss_cast(cast_id)`.** SECURITY DEFINER. Inside a single transaction:
   - Take advisory lock `pg_advisory_xact_lock(hashtext('boss_cast:' || creature_id))`.
   - `SELECT ... FOR UPDATE` the cast row; if status ≠ `pending`, return (idempotent).
   - Flip status to `resolving`.
   - Recompute *actual* eligible players = characters currently at `node_id` whose `updated_at` (or a last_seen equivalent) proves they haven't left. `eligibility_snapshot` is a hint only.
   - Apply `effect_payload` to eligible players; if `eligible = 0` and `on_empty_room_heal_pct > 0`, heal the boss (bounded by `max_hp`).
   - Write `resolution_summary`, flip status to `resolved`.
   - Broadcast `boss_cast_resolved` on `node-<id>`.

   Advisory lock + status guard + unique-partial-index means: even if three parties' ticks all fire the resolve at the same moment, exactly one transaction lands the effect; the rest no-op.

## Stale HP-write guard

The current model lets `combat-tick` compute damage against an HP snapshot read at the top of the request, then write via `damage_creature` at the end. If `resolve_boss_cast` heals the boss between those two moments, the tick's blind `UPDATE creatures SET hp = <stale>` overwrites the heal.

Mitigations bundled into Phase 1:
- `combat-tick` re-seeds `mHp[creature_id]` from a fresh `SELECT hp` **immediately before** calling `writeCreatureState`, and applies the tick's damage as a delta rather than an absolute value.
- `damage_creature` is extended to accept an optional `_expected_hp` and skip the write on mismatch, letting the tick retry the delta on the fresh value.
- The resolve RPC bumps a `creatures.hp_version` counter so tick logic can also detect concurrent writes cheaply.

These changes are worth doing under any architecture, but they are especially necessary if we stay session-driven.

## Overdue / abandoned casts

- "Overdue" = `now > resolves_at` and status still `pending`.
- Resolution triggers (in order of likelihood): next boss tick from any party present; per-invocation sweep at the top of `combat-tick`; `combat-catchup`'s sweep on node re-entry.
- Because resolve is atomic and idempotent, all three sweepers can safely try; only one wins.
- If the room is genuinely empty when resolution fires, `on_empty_room_heal_pct` is applied and the summary records `reason: "empty_room"`.

## Phase thresholds & resets

- `boss_encounter_state.phase_thresholds_fired` prevents re-triggering the same HP-band ability twice in one life.
- Reset only on: creature death, creature respawn, or full OOC heal to `max_hp`. Combat-start does **not** reset — walking out and back in must not re-arm bosses.

## Client rendering

- Single node-scoped cast bar sourced from `boss_cast_started` / `boss_cast_resolved` broadcasts (falls back to a poll on `active_boss_casts` for late joiners).
- Cast bar shows ability name, remaining time, and a "leave the node to avoid" hint when `avoidance` includes `leave_node`.
- No per-party state — every viewer sees the same bar.

## Out of scope for Phase 1

- Interrupt mechanics (`avoidance = interrupt`) are modeled in schema but not wired to any ability-based interrupt yet.
- Boss hazards (persistent room effects) beyond a single cast → single resolution.
- Cross-node effects, summons that spawn creatures in other nodes.
- Phase transitions that alter the boss's stat block (only ability access changes).

## Open dependencies

- The stale-HP-write guard (`hp_version` + `_expected_hp`) is a `damage_creature` API change; it needs to land before any concurrent-write scenario, boss cast or not.
- The unique partial index requires `active_boss_casts` to exist before any tick tries to insert — first migration must run alone.
- The resolve RPC needs `service_role` GRANT and RLS keeping clients out of `active_boss_casts` writes.
