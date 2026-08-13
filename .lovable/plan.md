# Combat engine clean replacement (C0–C5)

Replaces the earlier R0–R5 migration plan. Audit findings stand: `combat_sessions.last_tick_at` is the real pre-simulation mutex, the shared claim happens last (`combat-tick/index.ts` L3860) after creature HP (L3215), durability (L3510-3536), loot, Stored Power (L2772/L3094), boss casts and broadcasts (L3182), the commit covers tail writes only, `applyTickStateFallback` (L3924) can apply an unowned simulation, and no resolver imports `tick-rng.ts`.

## What happens to R0–R5

- **Discarded:** R0 as written (removing the fallback does not undo pre-claim writes, and returning simulated events with `encounter_tick: null` would still show uncommitted results), R1/R2 as incremental in-place surgery on the 3979-line resolver, R5's phased legacy retirement.
- **Retained as content, not as staging:** the deterministic-RNG work (now inside C1), the full transactional boundary (C2), the delivery/recovery hardening (C4), the documentation correction (C5).
- **Changed:** rollback is a maintenance switch, not a `tick_owner` latch; the cutover is one coordinated version instead of a dual-writer window.

## Containment decision

Chosen: **maintenance mode now, reconstruction immediately.** Reason: pre-claim mutations cannot be made safe without reordering the resolver, which is exactly the work C1/C2 do; keeping combat open in the interim keeps a known duplicate-reward and torn-state risk alive for no testing benefit. Combat is paused, testers see a maintenance message, and the replacement is built and tested against paused production.

## Post-replacement architecture

```text
submit intent  -> validate ownership + effective loadout -> one durable pending combat_action -> ack (no resolution)
wake signal    -> claim_encounter_tick (FIRST call; refusal => idle response, no events, no writes)
load           -> encounter-wide roster: participants, engagements, creatures, parties/followers,
                  pending actions, active effects, applied statuses, boss casts, stored power
simulate       -> pure function, zero DB access, seeded RNG, returns a proposed tick
commit         -> commit_encounter_tick(token): ALL authoritative state + ordered batch + cursor
publish        -> realtime/HTTP/recovery deliver the committed batch only
```

The encounter owns resolution. `combat_sessions` becomes presence/UI bookkeeping only and never gates a tick. Every active creature acts exactly once per encounter tick regardless of party count. `combat-catchup` keeps the same claim/commit contract in `effects_only` mode (it already claims first) and shares the same pure resolver and commit RPC, so live and offscreen resolution can never both own one tick.

## Legacy/hybrid paths to remove

- `combat-tick/index.ts`: session CAS reservation (L461-477), `session.last_tick_at` cadence math (L450-452), `writeCreatureState` call site (L3215), durability writes (L3510-3536), pre-claim loot/Stored Power/boss-cast writes, pre-commit broadcasts (L3182-3190), the entire refused-commit fallback block (L3924-3944), the trailing encounter lookup (L3845).
- `_shared/combat/tick-commit.ts`: delete `applyTickStateFallback`.
- `_shared/combat/tick-owner.ts`: keep durable-intent reading, drop anything session-scoped.
- Database: `combat_tick_owner()`, `encounters.tick_owner`, `combat_config.tick_owner` (repurposed as the maintenance switch).
- Client: any path in `useCombatDriver.ts` that applies HTTP/broadcast events not carrying a committed `encounter_tick`.

## Gameplay to preserve unchanged

2s cadence, all formulas and probabilities, auto-attacks, ability slots and superseding, durable actions, offscreen DoT/catch-up semantics, boss telegraphs and Stored Power, party movement/follow/tank selection, targeting and threat, death and reward rules, multi-creature encounters, XP penalty and party bonus curves, loot/unique exclusivity, no-emoji rule. All class/ability/base-ability/on-hit configuration, creature and world authoring, and item/loot tables are read as-is.

## Table classification and reset permission

| Table | Type | Cutover action |
| --- | --- | --- |
| profiles, characters, character_inventory, character_materials, character_class_bonds, character_ability_loadout, character_visited_nodes, character_npc_gifts, user_roles, families, parties, party_members, marketplace_listings | permanent player state | never touched |
| classes, abilities, base_abilities, class_ability_*, races, items, loot_tables, loot_table_entries, creatures, nodes, areas, regions, npcs, guide_*, combat_config (keys other than the switch), loot_pool_config, weapon_progression_config | authored configuration | never touched |
| combat_sessions (2), encounters runtime columns + rows (117), encounter_tick_batches (261), encounter_engagements (0), encounter_participants (1), encounter_creatures (9), encounter_cast_events (130), active_effects (0), applied_statuses (5) | regenerable runtime combat state | cleared at cutover |
| combat_actions pending/cancelled rows (24 total, 0 pending now) | regenerable runtime intent | pending cleared; consumed rows may be truncated |
| combat_audit_log (9465), party_combat_log (141), encounter_contributions (118), world_slumber_log, ai_credit_drain_log | historical/audit | retained |
| node_ground_loot (0) | unclear — dropped items are player-visible | **needs your approval**; default is retain |
| creatures.hp / is_alive | authored content with runtime field | HP reset to max, `is_alive` true (same as existing wake heal) |

Exact clearing at cutover: `DELETE FROM combat_sessions`; `DELETE FROM combat_actions WHERE status IN ('pending','cancelled')`; `DELETE FROM encounter_tick_batches`; `DELETE FROM encounter_engagements`; `DELETE FROM encounter_cast_events`; `DELETE FROM active_effects`; `DELETE FROM applied_statuses`; `UPDATE encounters SET status='ended'` (or delete ended rows) plus reset of `tick_state/resolving_tick/claim_token/lease_until/attempt`.

## Stages

**C0 — maintenance mode and classification.** Add `combat_config` key `combat_mode` (`open` | `maintenance`). `combat-tick` and `combat-catchup` read it as the first statement and return a typed `{ maintenance: true }` idle response with no events. Client shows a maintenance notice in the combat panel and stops the worker timer. Files: `supabase/functions/combat-tick/index.ts`, `combat-catchup/index.ts`, `src/features/combat/hooks/useCombatDriver.ts`, `src/features/combat/components/*` (notice), migration for the config row. This is also the permanent kill switch and the rollback mechanism.

**C1 — pure deterministic resolver + encounter roster.** New `supabase/functions/_shared/combat/engine/` modules: `roster.ts` (encounter-wide load), `simulate.ts` (pure `(snapshot, intents, rng, config) => ProposedTick`), `rng.ts` wiring the existing `tick-rng.ts` seeded by `encounter_id + tick_number + stream@v1 + entity ids + roll index`. Existing rule modules (`resolution.ts`, `status-application.ts`, `on-hit-effects.ts`, `proc-runtime.ts`, `creature-damage-modifiers.ts`, `ability-magnitude.ts`, `kill-resolver.ts`, `reward-calculator.ts`, shared formulas) are reused verbatim; only their call harness is new. Deterministic replay test proves byte-identical output for a reclaimed tick.

**C2 — complete atomic commit.** Extend `commit_encounter_tick` to apply, inside the token-gated transaction: creature HP/death, character HP/CP/MP and column patches, XP/gold/Renown/bond, materials/gems/salvage, contracts, effects and applied statuses, engagements, equipment durability and unequip, loot and unique drops, boss-cast rows, Stored Power, action consumption/rejection, cursor and the ordered batch. Realtime/broadcast publication becomes post-commit and idempotent, derived from the committed batch keyed by `(encounter_id, tick_number)`.

**C3 — resolver rewrite.** `combat-tick/index.ts` becomes claim → load → simulate → commit → publish, with the legacy paths above deleted. `combat-catchup` uses the same engine in `effects_only` mode. Fail closed: any load, simulate or commit error releases the claim and returns an error with no partial writes.

**C4 — delivery client.** Client applies only committed batches in tick order; HTTP/broadcast are accepted only when they carry `encounter_tick` and pass the sequencer. Fix the first-batch re-anchor, retry suppressed gap recoveries, reconcile on buffer overflow, guarantee an `encounter_participants` row (plus a grace window after leaving) so batch RLS permits recovery, and raise batch retention to ~180s.

**C5 — cutover, validation, cleanup.** Coordinated deployment, smoke tests, reopen, then delete obsolete objects (`combat_tick_owner`, `encounters.tick_owner`) and rewrite `docs/design/shared-encounter-cutover.md` to describe real behaviour. Timing panel stays until parity is signed off.

## Coordinated deployment sequence

1. Set `combat_mode = maintenance`; testers see the notice.
2. Let in-flight invocations finish or leases expire (~15s).
3. Snapshot permanent state: row counts and checksums for characters (xp, level, gold, renown), inventory (durability, equipped_slot), materials, bonds, loadouts.
4. Apply forward migration (commit RPC extension, claim adjustments, config keys, retention, participant grace).
5. Deploy `combat-tick` and `combat-catchup`.
6. Publish frontend.
7. Clear approved runtime rows.
8. Run automated tests plus controlled smoke tests.
9. Ask testers to reload; set `combat_mode = open`.

Expected downtime: minutes for the cutover itself; combat stays closed for the whole build if you prefer, which is the recommendation. Only one writer exists at any moment because resolution is disabled while code changes land.

## Failure and recovery

Any anomaly ⇒ set `combat_mode = maintenance` (takes effect on the next request, before any simulation), leave all permanent state intact, fix and redeploy, clear only invalid runtime rows, reopen. Request-carried ability authority is never restored. Because commits are token-gated and atomic, a rollback of function code cannot leave half a tick behind.

## Tests

Automated (vitest, pure modules): claim refusal produces no mutation and no events; stale token; `already_committed`; lease expiry then reclaim yields byte-identical output; simulate is pure (DB client stub asserts zero calls); RNG stream stability and distribution vectors; roster completeness for solo, two parties, mixed solo+party, multi-creature; kill/reward/loot/durability exactly-once; sequencer re-anchor, overflow reconcile, suppressed-recovery retry; maintenance response shape.

Controlled manual: one player/one creature; one player/multi-creature; one party; two parties on one creature; solo plus party on one creature; party joining an active encounter; live overlapping catch-up; offscreen DoT death; Consecrate; boss telegraph and Stored Power; duplicate and missing realtime delivery; mobile background >60s; world sleep/wake; maintenance toggle mid-fight.

## Parity measurement

Before reopening: run 200+ simulated ticks through the new pure resolver with fixed seeds and compare aggregate distributions (hit rate, mean damage per attack by class, crit rate, dodge/block rate, DoT throughput, XP per kill, loot drop rate, durability loss per tick) against the same aggregates computed from `combat_audit_log` and `party_combat_log` history. Acceptance: aggregate means within a few percent, and no rule-level differences.

## Needs your approval

- `node_ground_loot`: retain (default) or clear at cutover.
- Truncating `consumed` `combat_actions` rows and old `encounter_tick_batches` history.
- Accepting that exact random outcomes differ from the legacy nondeterministic implementation while distributions and rules are preserved.
- Whether combat stays closed for the full build (recommended) or reopens between stages.
