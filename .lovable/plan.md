# WoV Classic — Architectural Modernization Plan

The game stays the same: same nodes, classes, abilities, live 2-second combat, manual abilities and existing data. What changes is how it is built, so ordinary features stop touching dozens of systems.

## 1. Current architecture (measured)
- **Two combat engines in parallel.** The Classic engine (`combat/pure/resolver.ts`, about 3,000 lines, plus the `c3` orchestration and snapshot decode) and Combat2 (`combat2/resolver.ts`, about 1,800 lines, plus mechanics/decode). Combat1 endpoints are refusal shells, but its code and 35 importers remain.
- **About 140 tables and about 430 database functions.** Many features come with their own request, receipt, ledger or log table, plus "_internal", "_without_X" and wrapper variants: 163 such references in generated types. Examples include the four `node_tick_commit` wrappers, separate request tables for stance, special travel, inventory, respawn and departure, and both `encounter_*` (C1) and `node_*` (C2) families.
- **Processing chain.** pg_cron triggers dispatch-once, which runs tick-once, which calls commit RPCs, which run character triggers (13 on `characters`), deferred stance triggers and catch-up/wake logic. A single attack crosses Edge, SQL, triggers and Realtime.
- **Frontend.** About 136k lines. `useCombatDriver` (1,741 lines) plus legacy combat hooks, event builders and parallel `combat` and `combat2` feature folders.
- **Process overhead.** 544 frozen migrations plus 32 Drizzle migrations, 254 operations documents and 45 design documents. Each change requires a hash, ACL, ancestry and preflight ritual.

## 2. Complexity diagnosis
1. **Logic split across languages and layers.** Rules live partly in TypeScript and partly in PL/pgSQL, with triggers acting as hidden side effects. To understand one ability you must read 5–10 files across both.
2. **Two sources of truth for combat.** The C1 and C2 tables, resolvers and UI paths coexist.
3. **A "request table per action" pattern.** Each new player action means a new table, RPC, receipt, guard, ACL and types. That is the main cost multiplier.
4. **Wrapper sediment.** Functions are wrapped instead of replaced (`_without_*`, `_internal`, `_c2`), so call chains are 4–6 deep.
5. **Triggers as business logic.** These are order-dependent and invisible from the calling code, which causes regressions and deadlock risk.
6. **The state ownership boundary leaks.** The client still holds combat-driver logic that duplicates server timing.
7. **Process weight exceeds code weight.** Every SQL change needs a manual hash and ACL disposition because SQL is the main logic layer.

## 3. Target architecture
```text
Browser (display + intents)
   | supabase.rpc('game_command', {type, payload})   <- one entry point
   v
Postgres: thin, generic, stable
   - game_command(): auth, validate shape, append to command_inbox
   - tables = state only (no business triggers)
   ^
   | single service-role RPCs: load_node_state / commit_node_state
Edge worker "world-tick" (TypeScript, one engine)
   - every 2s per active node: load state -> pure engine -> commit diff
   - engine/ = pure deterministic TS modules, fully unit-tested
   v
Realtime: one broadcast per node per tick (node_events)
```
Key principles:
- **One engine, in TypeScript.** All gameplay rules (combat, effects, movement outcomes, loot, XP, progression) are pure functions: `(state, commands, rng) -> (newState, events)`. SQL only stores data, enforces ownership and commits atomically.
- **One command pipeline.** A single `command_inbox` table plus a single `game_command` RPC replace the dozen request/receipt tables. Idempotency comes from one generic `command_id` key. Adding a player action becomes a TypeScript handler, not a migration.
- **One atomic commit per node per tick.** It uses optimistic versioning (`node_state.version`) instead of multi-table lock ordering. On conflict, the worker re-runs the tick, which is safe because the engine is pure.
- **Heartbeat.** Keep the authoritative 2-second cadence (the binding decision) using the existing dispatch approach, simplified to one worker that loops over active nodes. Sleep/wake reduces to "a node with no players and no fight isn't ticked". On wake, apply a single regeneration step with no replay.
- **Data-driven content.** Abilities, creatures, items and classes stay in their existing tables. The engine reads them through one typed `content` loader with a per-version cache, which replaces the many registry, fallback and resolver files.

## 4. System consolidation
| Area | Becomes |
|---|---|
| combat/pure + c3 + combat2 resolvers | `engine/combat` (one resolver, reusing the best of Combat2 mechanics) |
| encounter_* tables + node_* tables | `node_state`, `node_creature`, `node_fighter`, `node_effect` (the C2 shape, kept) |
| ~15 *_request/_receipt tables | `command_inbox` + `command_result` |
| node_tick_commit and its 4 wrappers, catch-up, wake, slumber | `commit_node_state` (one function) |
| 13 character triggers | explicit engine steps (derived stats computed in TS) |
| forge/sell/stonebinder/gem/progression Edge functions | handlers inside one `game-command` worker plus shared engine |
| useCombatDriver + legacy combat hooks | `useNodeStream` (subscribe, render events, send commands) |
| combat-catchup, combat-tick, combat2-test-arena | removed |
| docs/operations evidence | archived; project-state slimmed to current facts |

The likely target is about 40 tables and about 30 database functions (estimate, to be confirmed by the schema inventory in phase 0).

## 5. Gameplay preservation
- **Golden-master tests.** Before rewriting, capture current Combat2 behaviour: given a seed, character, ability and creature, record the exact round outputs. The new engine must reproduce them bit for bit, except for documented bug fixes.
- The ability, class, creature and item formulas move as-is into engine modules, with the existing memory rules (damage pipeline, hit quality, stances, CP, procs) as test cases.
- Ambiguous behaviour is listed for Mik to decide. It is never silently changed.

## 6. Data migration strategy
- **Stays as-is:** world (regions, areas, nodes, NPCs), creature, item, ability and class content, characters, inventory, materials, progression and the user/role tables.
- **Moves into the new tables:** live combat and request state. Combat is drained first in maintenance mode, so only an empty world is converted.
- **Archived, not dropped:** obsolete tables are marked DEPRECATED, become read-only, and are dropped only after a later explicit approval.
- **Validation per step:** row counts, checksums of character stats/inventory/XP before and after, and a smoke test on a disposable character.
- Everything runs through the existing Drizzle workflow with additive migrations. Production data is not touched during planning.

## 7. Future development workflow
Adding an ability looks like this:
1. Add a row via the admin editor.
2. If it needs a new mechanic, write one TS function in `engine/mechanics/` plus a test.

There is no migration, no ACL and no deployment chain beyond one worker. Adding a player action means one command handler, one test and one UI button. Routine work then touches about 2–3 files instead of 10–20, and AI tools need one folder of context instead of SQL, Edge, triggers and docs. The heavy hash/ACL ritual remains only for the rare schema changes.

## 8. Implementation phases (each verified before the next)
0. **Inventory and freeze:** list every live function, trigger and table with its callers, and mark keep/merge/remove. *Verify:* a reviewed inventory document.
1. **Golden-master harness** against the current Combat2 resolver. *Verify:* 200+ recorded scenarios.
2. **Pure engine package** (combat, effects, loot, XP). *Verify:* all golden tests pass.
3. **Command pipeline** (`command_inbox` and `game_command`), behind a flag. *Verify:* existing actions (move, attack, ability, stance) work through it on a test node.
4. **New world-tick worker plus commit function**, run on the canary node. *Verify:* a 2-player shared fight, a disconnect, a reconnect, no duplicate rewards.
5. **Frontend switch** to `useNodeStream`, with legacy hooks removed. *Verify:* Playwright runs of the core flows.
6. **Migrate the remaining actions** (crafting, gems, marketplace, progression) into handlers.
7. **Retire legacy objects:** deprecate, then remove after Mik approves. *Verify:* nothing references them, and the counts above are met.
8. **Slim the docs/process:** a short architecture document plus contribution rules in `AGENTS.md`.

## 9. Risks and trade-offs
- **Edge timing:** short-lived workers make a true 2-second cadence best-effort. This risk already exists today. The plan keeps it isolated in one worker, so it could later move to an external always-on process without touching the engine.
- **Logic moves out of SQL:** a compromised service-role worker could write anything. This is mitigated by one narrow commit RPC with shape validation.
- **Big-bang risk:** this is avoided by running the new engine on the canary node first, with the old path still available until phase 5.
- **Time and credits:** the investment is large up front (phases 0–5 are substantial). I can't promise specific savings, but routine changes should touch far fewer systems.
- **Existing unverified items** (caller isolation, live bundle identity, sub-minute cron reliability) remain open and get re-checked in phase 4.

## Decisions needed from Mik
1. Approve "rules in TypeScript, SQL as storage plus atomic commit"?
2. Approve a single generic command pipeline that replaces per-feature request tables?
3. Approve lighter process rules for engine-only TypeScript changes (tests instead of per-change hash/ACL preflights)?
