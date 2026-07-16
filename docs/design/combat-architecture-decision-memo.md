# Decision Memo — Combat Architecture

**To:** Project Lead  
**From:** Build Agent  
**Date:** 2026-07-16  
**Re:** Recommended combat-state ownership model for telegraphed boss abilities and future room-wide mechanics

## Bottom Line

Adopt **Approach C — Hybrid**: keep `combat_sessions` for per-party participation state, introduce a new `node_encounters` table for all shared node state, and make the encounter RPC the only path that writes creature HP and resolves room-wide transitions. This delivers the same authority and scalability as a full node-owned model while preserving the existing session tick loop and client driver.

## Problem Statement

Today’s combat is driven by `combat_sessions`. Each party leader ticking advances their own session, which reads and writes `creatures.hp` independently. This works for isolated party fights but creates three structural risks as soon as we add shared mechanics (telegraphed boss casts, room-wide effects, hazards, phases):

1. **Lost-update races** when multiple parties overlap on the same creature.
2. **No clean owner** for room-wide state — each new mechanic would need a bespoke side table and catch-up sweep.
3. **Broadcast/rejoin fragility** — late joiners cannot snapshot a single source of truth for the current encounter.

## Alternatives Considered

| Approach | Model | Migration Cost | Long-term Cost |
|---|---|---|---|
| **A** — Extend session model | Add side tables (`active_boss_casts`, `boss_encounter_state`) beside `combat_sessions` | Low | High |
| **B** — Full node-owned encounters | `node_encounters` becomes the sole owner; `combat_sessions` becomes a participation row | High | Low |
| **C** — Hybrid (recommended) | `node_encounters` owns shared state; `combat_sessions` keeps party-scoped state | Medium | Low |

## Key Findings

- **A is a dead end.** It solves the immediate boss-cast problem but repeats the same graft pattern for every future shared mechanic (hazards, summons, phases). Operations cost grows unbounded.
- **B is the cleanest endpoint but too disruptive now.** Demoting `combat_sessions` requires restructuring `combat-tick`, `combat-catchup`, and `useCombatDriver` in one large change, with meaningful play-test risk.
- **C reaches the same guarantees as B for the variables that matter.** Creature HP writes and encounter transitions are serialized under a per-node advisory lock; sessions cannot bypass them. Party authority, buffs, and the client loop remain unchanged.
- **The atomicity issue is fixed by construction, not by convention.** Once `creatures.hp` is only writable through the encounter RPC, the stale-HP race disappears. We do not need `hp_version` / `_expected_hp` guards inside the session tick path.

## Recommendation

Adopt **Approach C — Hybrid** and implement the following prerequisites before resuming Phase 1 Boss Abilities:

1. Create `node_encounters` with RLS, GRANT, and a unique `(node_id, encounter_key)` identity.
2. Build `encounter_resolve` / `encounter_advance` RPCs that take `pg_advisory_xact_lock('node_enc:'||node_id)` and are the only writers of `creatures.hp` and `node_encounters` state.
3. Rewire `combat-tick` to route creature HP writes through the encounter RPC.
4. Rewire `combat-catchup` to call a single `encounter_reconcile(node_id)` instead of per-feature sweeps.
5. Add a client subscription to `node_encounters` postgres_changes (or `encounter_transition` broadcast) for late-joiner snapshots.
6. Keep `useCombatDriver` mostly unchanged; only add the encounter snapshot when computing HP display.

## Reversal Points

- **Cheap to change later:** reward attribution policy, which columns live on `node_encounters` vs JSONB, and whether to drop `combat_sessions.engaged_creature_ids` now or after a deprecation window.
- **Expensive to change later:** encounter identity (pick `(node_id, encounter_key)` now), the rule that sessions must never write `creatures.hp` directly, and the choice of advisory locking vs row-level locking. Commit to these up front.

## What We Are Not Deciding

This memo does not set the migration timeline, nor whether Phase 1 Boss Abilities ships before or after the full encounter model. It only selects the architecture so that future combat work does not paint us into a corner.

## Decision

Proceed with **Approach C — Hybrid**. Preserve the v3 boss-abilities design document as the feature requirement, but build the encounter-state foundation first.
