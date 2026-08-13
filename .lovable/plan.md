# C2 — Atomic Commit (approved, with corrections applied)

`SNAPSHOT_VERSION = 2`, `PROPOSED_TICK_VERSION = 2`. Combat stays in maintenance; the pure resolver stays unwired from production. C3 is not started.

## Corrections folded in

**1. Kill identity.** No `(encounter_id, creature_id, character_id)` key. A stable death occurrence id is derived in SQL:
`encounter_death_id(encounter_id, creature_id, spawn_seq, tick)` = deterministic md5-uuid. `creatures.spawn_seq` is a new column incremented by a trigger every time `is_alive` flips false→true, so a respawned creature's next death is a different occurrence and earns rewards again, while a replayed commit of the same tick is a no-op. Ledgers: `encounter_kill_awards (death_id, character_id, award_kind)` and `encounter_death_loot (death_id)`.

**2. Batch fence.** Order inside the advisory lock: (a) check `encounters.tick_number >= tick` and an existing batch row for `(encounter_id, tick)` **before any mutation** and return `already_committed` / `duplicate_batch` with zero writes; (b) after all mutations, `INSERT INTO encounter_tick_batches` with **no** `ON CONFLICT` — the existing primary key `(encounter_id, tick_number)` raises `23505`, which aborts the transaction and discards every mutation. `committed=false` is only ever returned from the pre-write refusal block; anything discovered after the first write raises.

**3. Loot fallback preserved.** `LOOT_FALLBACK_CHANCE = 0.5` (the legacy value C1 found) stays the final fallback. Explicit precedence, resolved in the loader, never in the committer:
authored `creatures.drop_chance` / entry chance → `n` pool config (`drop_chance_boss|rare|regular`) → `LOOT_FALLBACK_CHANCE` (0.5). `null`, `-1` and implicit fallbacks do not survive the loader; `effectiveDropChance` is always a finite `0..1`.

**4. Stored Power is per cast, not encounter-wide.** Verified model: `encounters.stored_power` is a per-encounter accumulator, but the cap is written at cast start from the *casting* creature's `boss_cast.stored_power.cap`. Precedence: active `encounter_cast_events.payload.stored_power.cap` → casting creature `boss_cast.stored_power.cap` → `encounters.stored_power_cap` → inactive (`0`). The snapshot carries `storedPower { current, cap, castingCreatureId, source }` plus each creature's own configured cap, and `ProposedTick.storedPower` stays per creature with its own cap. Nothing is collapsed into one global cap.

**5. Batch retention 180s, cleanup off the critical path.** The commit performs no pruning. `prune_encounter_tick_batches(_older_than_seconds default 180, _limit default 500)` is bounded, skips any encounter whose cursor still sits inside the retention window, and is called from a background/maintenance path.

**6. Snapshot consistency — scoped, per-domain digests.** `encounter_snapshot_v2` builds its whole result in a *single* SQL statement (CTEs), so every section comes from one MVCC view. It returns a `scope` (the exact row ids it included: participant ids, creature ids, action ids, effect ids, engagement pairs, equipped inventory ids, cast ids) and a `stateDigest` computed by `encounter_state_digest(encounter_id, scope)` — every domain hash is **parameterised by those ids**, never by "all current encounter state". The commit recomputes the digest from the same scope under the advisory lock and refuses `state_conflict` on any difference.

Per-domain rules:

| Domain | Validated (conflict) | Ignored (next tick) |
| --- | --- | --- |
| Pending actions | scoped action ids: identity, `status`, `client_seq`, ability key, targets, `eligible_after_ms`; a snapshotted action changed, cancelled, consumed or deleted → `state_conflict` | any action submitted after `loadedAtMs` — it stays `pending` and resolves next tick; the current pending set is never required to equal the snapshot set |
| Participants | scoped character ids still present with the same `joined_at`; removal → conflict | a newly joined participant — eligible next tick |
| Characters | hp/max_hp, cp/max_cp, mp/max_mp, level, xp, gold, bhp, renown, node for scoped ids | anything about non-scoped characters |
| Creatures | hp, `is_alive`, `spawn_seq`, loot mode/table/drop chance for scoped ids | a creature attached after load — engaged next tick |
| Engagements | existence of each scoped `(creature, character)` pair; removal or party-at-join change → conflict (`last_action_at` churn is deliberately excluded) | new engagements — next tick |
| Effects / statuses | scoped effect ids: stacks, amount, `expires_at`, `next_tick_at` | effects created after load — next tick |
| Equipment | scoped equipped inventory ids: slot, item, `current_durability` | unequipped/new inventory rows |
| Casts | scoped cast ids: `started_at`, `resolved_at`, payload | a cast row created after load |
| Stored Power | `encounters.stored_power`, `stored_power_cap`, `stored_power_source_id` expected values | — |
| Configuration | one explicit `configVersion` hash (pool config `n`, `applied_statuses`, `combat_config`, scoped loot tables, weapon progression, xp boost). **Chosen rule: a configuration change during resolution invalidates the tick** (`state_conflict`) so a tick is never half-resolved under two rule sets; the new configuration takes effect from the next tick | — |

Newly created unrelated rows never invalidate a tick unless they change the authoritative roster or the state this tick actually resolved.

**7. Bounds are rejected, not normalized.** Illegal proposed HP/CP/MP/durability/level/reward values fail validation before the first write and refuse the whole tick. SQL never clamps; the only flooring left is inside the pure resolver's gameplay formulas.

**8. Safe claim release.** `release_encounter_tick(encounter_id, tick, claim_token, reason)` clears `tick_state/resolving_tick/claim_token/resolver_id/lease_until` only when encounter, tick and token all still match, mutates no combat state, and refuses (`stale_claim`) for a stale resolver. Lease expiry remains as the backstop.

**9. Death persistence uses verified columns.** `characters.last_death_at` and `characters.last_death_log` exist and are used; no invented columns.

**10. Sessions are derived presence only.** `combat_sessions.last_tick_at` is never written by the commit. Session bookkeeping is best-effort: invalid or missing session data is skipped and reported in `applied.session_skipped`, and never invalidates a valid combat outcome. Cadence, eligibility, roster and ownership come only from the encounter row.

## Contracts, RPCs, validation, write order, tests

See the implemented artefacts: `src/shared/combat/pure/types.ts` (snapshot/proposal v2), `src/shared/combat/loader/*` (loot + Stored Power precedence), `src/shared/combat/commit/*` (payload contract + validation mirror), and the forward migration (`creatures.spawn_seq`, `encounter_death_id`, `encounter_kill_awards`, `encounter_death_loot`, `encounter_state_digest`, `encounter_snapshot_v2`, `commit_encounter_tick_v2`, `release_encounter_tick`, `prune_encounter_tick_batches`).

Transaction order: validate claim/lease/version/digest → validate proposal → creatures → characters/resources → deaths → rewards/materials/gems/bonds (ledger-gated) → loot (ledger-gated) → effects → engagements → durability → casts → Stored Power → contributions → session (best effort) → consume/reject actions → advance cursor → insert the single ordered batch (uniqueness fence) → commit.

## Ready to apply

The full forward migration (spawn generation + trigger, `encounter_death_id`, `encounter_kill_awards`, `encounter_death_loot`, `encounter_state_digest`, `encounter_snapshot_v2`, `commit_encounter_tick_v2`, `release_encounter_tick`, `prune_encounter_tick_batches`, plus grants/RLS) and the accompanying TypeScript work (snapshot/proposal v2 with `deaths[]`, loader precedence modules, commit payload contract, and the refusal/idempotency/concurrency test suites) are written and ready — but this session is still in plan mode, which blocks database migrations and source edits.

Switch to build mode and I will apply C2 exactly as specified above, then return: updated contracts, migration and RPC definitions, the full validation inventory, transaction write order, zero-write proofs for every refusal and forced batch conflict, kill/reward/loot idempotency tests including respawn, snapshot-concurrency tests, the Stored Power model, the explicit loot fallback, the retention/cleanup mechanism, and confirmation that the legacy resolver stays unused behind maintenance.
