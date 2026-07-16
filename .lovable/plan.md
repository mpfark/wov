# Combat Architecture Investigation — Session vs Node-Owned vs Hybrid

**This is a research plan, not an implementation plan.** The deliverable is a written recommendation and a preserved design doc for the paused boss work. No code changes.

## 0. Preserve the paused work

Before the investigation begins, save the approved-in-principle v3 boss proposal as `docs/design/phase-1-telegraphed-boss-abilities.md` (verbatim from the previous plan, marked "Status: Paused pending combat architecture decision"). This is the only file created during this planning cycle.

## 1. Fact-finding pass (read-only)

Produce a short "current state" reference doc at `docs/design/combat-architecture-current.md` covering, with file:line citations:

- `combat_sessions` schema, lifecycle (create, tick, destroy), and which columns are authoritative.
- Who owns time today: request-driven cadence from `useCombatDriver` / `useGameLoop`, tick timings, mobile background-worker interaction, `combat-catchup` triggers.
- `creatures.hp` write paths — every RPC and Edge Function that mutates it, and any locking (or lack thereof).
- Multi-party overlap: what the code does today when two parties share a node/creature (broadcast merge in `useCreatureBroadcast`, `useMergedCreatureHpOverrides`).
- Realtime surface: `node-<id>` channel events, postgres_changes subscriptions, per-character subscriptions.
- Party-leader authority pattern and its enforcement points.
- Shared `kill-resolver` module — callers and invariants.
- Existing per-node state precedents (`node_ground_loot`, `world_state`, presence).
- World-slumber interaction (`useWorldState`, `wake_world`, `world_is_awake()`).

Rule: no opinions in this doc — just how things work today. It becomes the shared baseline for the comparison.

## 2. Approaches to compare

### Approach A — Extend the current session-based model
Keep `combat_sessions` (solo or party) as the driver. Add per-creature or per-node side tables for shared state (boss casts, hazards) that any session on the node consults.

### Approach B — Node-owned encounters
Introduce a `node_encounters` (or `active_encounters`) row per node that has live combat. It owns encounter time, boss cast state, hazards, and the authoritative "who is fighting here" list. `combat_sessions` becomes a per-player/party *participation* record referencing the encounter, not an independent simulation.

### Approach C — Hybrid: sessions for participation + node encounter for shared state
Keep sessions for per-party context (leader, action queue, party buffs, party-scoped rewards), but move all *shared* combat state (creature HP writes, boss casts, hazards, room-wide effects, empty-room heal) into a node-level owner. Time is still request-driven; the first tick on a node that finds an encounter row "borrows the baton" atomically.

## 3. Comparison matrix

For each of A, B, C, produce a one-page analysis answering **the same 12 questions in the same order** so they can be read side-by-side:

1. Ownership of combat state (per session vs per node vs split).
2. Ownership of time — who advances the clock, and what happens when nobody ticks.
3. Multiple parties fighting the same creatures — HP write serialization, kill credit, reward attribution.
4. Boss encounter mechanics — casts, phases, room-wide effects, thresholds.
5. Creature targeting — is a creature "the same target" across sessions or a per-session snapshot?
6. Party-specific buffs and abilities — where do party-scoped effects live so they don't bleed across parties on the same node.
7. Concurrency and HP synchronization — locking strategy (advisory locks, `FOR UPDATE`, unique indexes, MVCC race windows), and the specific stale-HP-write scenario surfaced in the boss proposal.
8. Realtime usage — which channels/tables clients subscribe to, and what the server broadcasts vs what the client polls.
9. Empty-node behavior — how encounter state persists, how OOC regen/heal is applied, when state is torn down.
10. Catch-up on re-entry — what `combat-catchup` looks like under this model.
11. Migration complexity from today's code — concrete list of files/RPCs touched, backward-compat window, playtest risk.
12. Long-term maintainability and scalability — how well the model absorbs hazards, telegraphed abilities, encounter phases, summons, cross-node effects, PvP if it ever appears, and horizontal load if concurrent nodes grow.

Each answer gets a short "cost" tag: `low` / `medium` / `high` for engineering effort and `low` / `medium` / `high` for ongoing complexity.

## 4. Cross-cutting probes

Questions the comparison must explicitly answer, because they're what tripped the boss proposal:

- **Who writes `creatures.hp` when two parties overlap?** Show the exact serialization mechanism per approach.
- **Where does empty-room state live** so it survives every player leaving without a permanent loop?
- **How is a room-wide effect delivered** to a player whose party's tick didn't run it (e.g., other party ticked, or player is solo-observing)?
- **How is one "encounter" identified** — is it `(node_id)`, `(node_id, boss_creature_id)`, `(node_id, active_since)`? Different choices have very different implications for phase resets and simultaneous mini-bosses.
- **What is the smallest change** that unlocks telegraphed abilities *without* boxing us out of future hazards, phases, and summons?

## 5. Decision recommendation

A single recommendation section that:

- Picks A, B, or C — biased toward what still makes sense in 2–3 years, not what's cheapest this month.
- States which of the boss proposal's mechanisms (transactional resolve RPC, per-node advisory lock, eligibility snapshot, cast dedup) survive as-is under the chosen model and which are replaced by first-class primitives.
- Lists prerequisites the architecture change would need before Phase 1 Boss Abilities is picked back up.
- Explicitly identifies the reversal points — decisions we can defer, and decisions that will be very expensive to change later.

## 6. Deliverables

Three files, no code:

- `docs/design/phase-1-telegraphed-boss-abilities.md` — the preserved v3 boss proposal.
- `docs/design/combat-architecture-current.md` — factual current-state reference.
- `docs/design/combat-architecture-comparison.md` — the A/B/C comparison + recommendation.

## 7. Out of scope

- No schema migrations.
- No Edge Function changes.
- No client refactors.
- No decision on *when* to execute the recommendation — that's a separate planning cycle after you've read the comparison.

## 8. Open questions to confirm before writing

1. Is `docs/design/` the right location, or do you want these under `.lovable/` or somewhere else?
2. Should the comparison also weigh a future **PvP** possibility, or explicitly exclude it? (Affects Approach B/C attractiveness.)
3. Is horizontal scale (many concurrent active nodes) a real concern in the 2–3 year window, or is single-region single-Postgres the assumed shape?

I can proceed with defaults (`docs/design/`, exclude PvP, assume single-region) if you don't want to answer up-front.
