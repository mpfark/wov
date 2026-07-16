# Combat Architecture — Comparison and Recommendation

Companion to `combat-architecture-current.md`. Compares three combat architectures against the same 12 questions. Ends in a single recommendation.

Cost tags per answer:
- **Eng** = one-time engineering effort to reach the model.
- **Ops** = ongoing maintenance/complexity cost once we're there.

Scale: `low` / `med` / `high`.

---

## Approaches under comparison

### A — Extend the current session-based model
Keep `combat_sessions` (solo or party) as the driver. Add per-creature or per-node **side tables** (boss casts, hazards) that any session on the node consults. Ownership stays with sessions; shared state is grafted on.

### B — Node-owned encounters
Introduce `node_encounters` (one row per node with live combat). It owns encounter time, boss cast state, hazards, and the authoritative "who is fighting here" list. `combat_sessions` becomes a per-player/party **participation** record referencing the encounter, not an independent simulation. Time still request-driven; the first tick on a node "borrows the baton" atomically.

### C — Hybrid: sessions for participation, node encounter for shared state
Keep `combat_sessions` for per-party context (leader, action queue, party buffs, party-scoped rewards). Move all **shared** state (creature HP writes, boss casts, hazards, room-wide effects, empty-room heal) to a node-level owner. The first tick on a node finds/creates the encounter row and drives shared state under an advisory lock; each party's own tick drives their own session state.

---

## Comparison matrix

### 1. Ownership of combat state

- **A.** Split by accident. `combat_sessions` owns timing, engagement, party buffs. New side tables (`active_boss_casts`, hazards) sit next to sessions but aren't referenced by them. Ownership is convention, not schema. **Eng: low. Ops: high** (every new shared feature needs its own bespoke table + convention).
- **B.** Clean. Everything shared lives on `node_encounters`; everything per-party lives on `combat_sessions` (now demoted to a participation row). Schema encodes the split. **Eng: high. Ops: low.**
- **C.** Clean split, but two owners of "the same fight." Sessions own participation state; node_encounter owns shared world state. Encoded in schema. **Eng: med. Ops: low–med.**

### 2. Ownership of time — who advances the clock, what happens when nobody ticks

- **A.** Solo player / party leader (unchanged). No one ticking = nothing happens; sessions eventually GC on node change / no members. Boss casts scheduled inside a tick could go stale if the last party leaves before resolution — must be swept by `combat-catchup` on next entry. **Eng: low. Ops: high** (sweepers proliferate per shared feature).
- **B.** Any present party's leader advances the encounter under a per-encounter advisory lock. First tick per interval wins; others no-op the shared work but still update their own participation. If nobody's here, the encounter row sleeps; next entry's `combat-catchup` resolves anything overdue. **Eng: high. Ops: low.**
- **C.** Same as B for shared state; each party's leader still advances their own session for party-scoped work. One `pg_advisory_xact_lock('node_enc:'||node_id)` guards the shared write in every tick. **Eng: med. Ops: low.**

### 3. Multiple parties fighting the same creatures — HP writes, kill credit, reward attribution

- **A.** Broken today (lost-update race, §3 of current-state doc). Fixable with `hp_version` + `_expected_hp` + retries inside `damage_creature`, but every session still races for the write. Kill credit remains sticky to whichever tick lands the killing blow; reward attribution stays per-session via `kill-resolver`. **Eng: med. Ops: med** (races always live one refactor away).
- **B.** The encounter row serializes HP writes via advisory lock. Kill credit is naturally node-scoped; `kill-resolver` receives the full participant list from the encounter (all sessions that hit the creature) and can attribute rewards by damage share or equal split — a design choice, but now cleanly expressible. **Eng: high. Ops: low.**
- **C.** Encounter row serializes HP writes; sessions still own damage math per party. Kill credit routed through the encounter to `kill-resolver` with the participant list, same as B. Party-scoped reward math (party XP bonus, etc.) stays where it already lives. **Eng: med. Ops: low.**

### 4. Boss encounter mechanics — casts, phases, room-wide effects, thresholds

- **A.** Requires the full boss-proposal apparatus: `active_boss_casts`, unique partial index, resolve RPC, per-node advisory lock, stale-HP guard. All grafted on beside sessions. Works but is convention-heavy. **Eng: med (once). Ops: high** (each future shared mechanic — hazards, summons — repeats the grafting).
- **B.** First-class. `boss_cast_id`, `phase`, `hazard_ids` are columns/refs on `node_encounters`. Resolve RPC becomes a method on the encounter, not a bolt-on. Empty-room heal is a natural encounter transition. **Eng: high (once). Ops: low.**
- **C.** First-class shared state on the encounter row, participation-scoped effects still on sessions. Cleanest fit for the paused boss proposal — most of its bespoke mechanisms collapse into encounter primitives. **Eng: med. Ops: low.**

### 5. Creature targeting — same target across sessions, or per-session snapshot?

- **A.** Per-session snapshot in practice (each tick re-reads `creatures.hp`). Cross-session consistency depends entirely on write-time races. **Eng: n/a. Ops: high.**
- **B.** Single target: every present session engages the creature *through* the encounter's canonical creature list. **Eng: high. Ops: low.**
- **C.** Same as B for HP/aggro; each session still models its own aggro table for party-scoped display, but shared truth is on the encounter. **Eng: med. Ops: low.**

### 6. Party-specific buffs and abilities — no bleed across parties on the same node

- **A.** Fine today: buffs live on the party's session (`member_buffs`) or the character's `active_effects` — never on the creature. No change needed. **Eng: none. Ops: low.**
- **B.** Fine — the session-as-participation row still carries party-scoped buffs. Same isolation guarantee. **Eng: low. Ops: low.**
- **C.** Fine — participation row unchanged; shared state doesn't know about party buffs. **Eng: none. Ops: low.**

### 7. Concurrency and HP synchronization — locking strategy, MVCC races, stale-HP guard

- **A.** Requires optimistic concurrency retrofit (`hp_version` / `_expected_hp`) plus tick-time re-seed. Every write path must remember to use the guarded API. **Eng: med. Ops: high.**
- **B.** `pg_advisory_xact_lock('node_enc:'||node_id)` around any shared HP write. Only one writer at a time per node; blind writes are impossible because sessions cannot write `creatures.hp` directly — they route through an encounter RPC. **Eng: high. Ops: low.**
- **C.** Same lock model as B; sessions retain their own tick logic but the HP write is centralized in an encounter RPC that takes the lock. Stale-HP race can't reappear because sessions physically can't bypass the RPC. **Eng: med. Ops: low.**

### 8. Realtime usage

- **A.** Unchanged: `node-<id>` for shared visuals + `party-combat-<partyId>` for tick results. Boss cast broadcasts added on `node-<id>`. **Eng: low. Ops: med** (per-feature broadcast wiring).
- **B.** Same channels. Encounter transitions broadcast on `node-<id>`; a single `encounter_state` broadcast replaces per-feature ad-hoc broadcasts. Late joiners can `SELECT * FROM node_encounters WHERE node_id = ?` for the source-of-truth snapshot instead of hoping to catch a broadcast. **Eng: med. Ops: low.**
- **C.** Same as B. Late-joiner snapshot is a single row read. **Eng: med. Ops: low.**

### 9. Empty-node behavior — persistence, OOC regen/heal, teardown

- **A.** Sessions are already deleted on empty node. Shared state (casts) requires bespoke sweep logic in `combat-tick` + `combat-catchup` to handle "no one is here to resolve." **Eng: med. Ops: high.**
- **B.** Encounter row persists across empty node (that's its point); a `last_activity_at` + threshold controls when it decays or resets. OOC heal is an encounter transition triggered on empty-plus-timeout. **Eng: high. Ops: low.**
- **C.** Same as B — encounter row persists; participation rows come and go. **Eng: med. Ops: low.**

### 10. Catch-up on re-entry — what `combat-catchup` looks like

- **A.** Grows a "resolve overdue boss casts" branch, and later "resolve overdue hazards," "resolve overdue phases." One branch per feature. **Eng: low per feature, unbounded growth. Ops: high.**
- **B.** Becomes "reconcile the node's encounter row" — a single call into an encounter-resolve RPC that internally sweeps whatever transitions are overdue. **Eng: med. Ops: low.**
- **C.** Same as B for shared state; catch-up for effects (`active_effects`) unchanged. **Eng: med. Ops: low.**

### 11. Migration complexity from today's code

- **A.** Small. Add `active_boss_casts`, `boss_encounter_state`, extend `damage_creature`. Minimal client changes. **Eng: low. Ops: high** (paid forever after).
- **B.** Large. New `node_encounters` table. `combat_sessions` demoted (add `encounter_id`, remove `engaged_creature_ids` authority). `combat-tick` restructured around encounter-first flow. `writeCreatureState` moves behind an encounter RPC. Client `useCombatDriver` updated to read encounter snapshot. Meaningful playtest risk. **Eng: high. Ops: low.**
- **C.** Medium. Add `node_encounters` alongside existing sessions. Add encounter RPC as the only path for `creatures.hp` writes and shared state; keep session tick logic. Deprecate `combat_sessions.engaged_creature_ids` in favor of an encounter-side participants list, but keep the column during the migration window. Client changes are additive (subscribe to encounter row / broadcast) — no rewrite of `useCombatDriver`. **Eng: med. Ops: low.**

### 12. Long-term maintainability and scalability

- **A.** Each new shared mechanic (hazards, phases, summons, cross-node effects, PvP) repeats the grafting pattern. Every addition adds a sweep branch to `combat-catchup`. Session-scoped assumptions leak into places they shouldn't. Absorbs telegraphed abilities but paints future features into corners. **Eng: n/a. Ops: high.**
- **B.** Absorbs hazards, phases, summons, room-wide effects, and eventual PvP as first-class encounter transitions. Horizontal scale: encounter rows are the natural sharding unit (per-node lock is the bottleneck, not global). **Eng: n/a. Ops: low.**
- **C.** Same absorption properties as B for shared state. Party features stay simple because they didn't move. Highest ceiling for the least disruption. **Eng: n/a. Ops: low.**

---

## Cross-cutting probes

### Who writes `creatures.hp` when two parties overlap?
- **A.** Both parties, racing. Requires `hp_version` + `_expected_hp` + retry to be safe.
- **B.** Only the encounter-owned RPC, under `pg_advisory_xact_lock('node_enc:'||node_id)`. Sessions cannot bypass.
- **C.** Same as B.

### Where does empty-room state live so it survives every player leaving without a permanent loop?
- **A.** In per-feature side tables (`boss_encounter_state`, future `active_hazards`), each with its own sweep semantics. No loop needed but bookkeeping proliferates.
- **B.** On `node_encounters`, with a `last_activity_at` and explicit decay/reset transitions triggered by the next visitor. No loop.
- **C.** Same as B.

### How is a room-wide effect delivered to a player whose party's tick didn't run it?
- **A.** Whichever session's tick resolves the cast broadcasts on `node-<id>`; other players' clients apply it locally. Server-side, the resolve RPC applies the effect to all eligible `character_id`s directly (bypassing "which session were they in"). Works, but the write path skips sessions.
- **B.** The encounter's resolve RPC applies effects to all participants (a snapshot of characters currently at `node_id`) and broadcasts `encounter_transition` on `node-<id>`. Sessions read the resulting `active_effects` on their next tick. Clean.
- **C.** Same as B.

### How is one "encounter" identified?
- **A.** Ad hoc. Boss casts key on `creature_id`; hazards would key on `node_id` or `creature_id`; no unifying identity.
- **B.** `(node_id, encounter_key)` where `encounter_key` is derived (e.g., the boss creature's UUID, or `"ambient"` for non-boss combat). Ends by explicit transition — death, reset, or timeout.
- **C.** Same as B.

### What is the smallest change that unlocks telegraphed abilities *without* boxing us out of future hazards, phases, and summons?
- **A.** The boss proposal as written. Delivers Phase 1 but is a dead-end pattern.
- **B.** Ship `node_encounters` + encounter-resolve RPC + advisory lock. The boss proposal's `active_boss_casts` collapses into an `encounter.pending_transition` column or a `node_encounter_transitions` sub-table.
- **C.** Same as B — but with the option to defer demoting `combat_sessions` (keep them writing to `active_effects` as they do today, just not to `creatures.hp`). The smallest change with the least future regret.

---

## Recommendation

**Adopt Approach C — Hybrid.**

Rationale:
- **B is the right endpoint, but the migration cost is high.** C reaches the same shared-state guarantees as B in the write paths that matter (HP, boss casts, hazards, empty-room effects) without rewriting the session tick loop or the client's `useCombatDriver`. Every future shared mechanic lands on the encounter row as a first-class primitive, matching B's ceiling.
- **A is a dead end.** Every shared mechanic added to the current model requires its own side table, its own sweep in `combat-catchup`, and its own broadcast wiring. The boss proposal is A-shaped; shipping it as-is repeats the pattern for hazards and phases later. Ops cost compounds.
- **C preserves what already works.** Party leader authority, `party-combat-<partyId>` broadcasts, `_shared/kill-resolver.ts`, `active_effects`, `combat-catchup`'s effect reconciliation, `useCombatLifecycle` — none of these move.
- **C fixes the lost-update race by construction, not by convention.** Sessions physically cannot write `creatures.hp` after the encounter RPC becomes the only writer; you don't have to remember to use the guarded API.

### Which of the boss proposal's mechanisms survive under C

| Mechanism | Fate under C |
|---|---|
| `active_boss_casts` unique partial index | **Replaced.** Cast state becomes `node_encounters.pending_transition` (nullable) or a `node_encounter_transitions` sub-table keyed by encounter. Uniqueness is per encounter, not per creature. |
| Per-node advisory lock at resolve | **Kept, generalized.** The lock is taken by every encounter RPC call (not just cast resolve), so it also guards HP writes. |
| Transactional `resolve_boss_cast` RPC | **Kept in spirit.** Becomes `resolve_encounter_transition` — one function, many transition kinds (cast resolve, phase change, hazard tick). |
| Eligibility snapshot vs re-check at resolve | **Kept as-is.** Snapshot at start, authoritative re-check inside the RPC. |
| `on_empty_room_heal_pct` | **Kept as-is**, moved to the transition definition. |
| Stale-HP re-seed + `_expected_hp` in `damage_creature` | **Not needed.** Sessions no longer call `damage_creature`; the encounter RPC does, under the lock. Ship `damage_creature` unchanged. |
| `boss_encounter_state` (phase_thresholds_fired, etc.) | **Replaced.** Rolls into `node_encounters` as columns / jsonb; reset points are encounter transitions. |
| `boss_cast_started` / `boss_cast_resolved` broadcasts on `node-<id>` | **Kept**, renamed `encounter_transition_started` / `encounter_transition_resolved`. |

### Prerequisites before picking Phase 1 Boss Abilities back up

1. `node_encounters` table + RLS + GRANT (service_role writes, authenticated read for their current node).
2. `encounter_resolve` / `encounter_advance` RPC — takes the per-node advisory lock, is the only path that writes `creatures.hp` or `node_encounters` state.
3. `combat-tick` rewired to route creature HP writes through the encounter RPC; `writeCreatureState` becomes an encounter method internally.
4. `combat-catchup` rewired to call `encounter_reconcile(node_id)` — one call replaces future per-feature sweep branches.
5. Client subscribes to `node_encounters` postgres_changes on the current node (or the `encounter_transition` broadcast) for late-joiner snapshots.
6. `useCombatDriver` unchanged except for reading the encounter snapshot when computing HP display.

Only after 1–6 are live does the boss ability schema (`creature_abilities`, `creature_ability_assignments`, transition definitions) get built on top.

### Reversal points

**Cheap to defer / change later:**
- Reward attribution policy (damage-share vs equal-split vs first-hit) — a `kill-resolver` input, not a schema decision.
- Which specific columns live on `node_encounters` vs a `node_encounter_state` jsonb — column extraction is a routine migration.
- Whether `combat_sessions.engaged_creature_ids` is dropped now or kept during a deprecation window — additive migration either way.

**Expensive to change later:**
- The encounter identity choice: `(node_id)` vs `(node_id, encounter_key)`. Pick `(node_id, encounter_key)` up front — encoding multi-encounter nodes retroactively is a data migration and a client-model change.
- Whether sessions can ever write `creatures.hp` directly. Say no once, forever, and enforce with a DB-level revoke + a `SECURITY DEFINER`-only write path.
- Whether the encounter RPC uses `pg_advisory_xact_lock` vs row-level `FOR UPDATE`. Advisory lock scales further and doesn't block reads; switching later would require re-auditing every write path.

### What we are explicitly not deciding here

- Timeline for the migration.
- Whether Phase 1 Boss Abilities ships before or after the full encounter model (recommendation: after, but not decided).
- PvP: excluded from scope per open question #2 (defaults). If reintroduced, encounter-model choice above still holds — encounters just gain participant-vs-participant transitions.
