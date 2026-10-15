# ENG-LEGACY-001G3A — Idle shutdown / session activation serialization

2026-10-15. Starting/fetched source checkpoint: `0dd9198bbf400827a3fe8ddba6d26180ee0da828`. Local source, history, archived evidence and test review only. No SQL or concurrency scenario executed. This report is the only changed artifact; authoritative project-state/roadmap and all closure decisions remain unchanged.

## Decision and scope

**Source-proven:** under READ COMMITTED, the inspected functions permit idle shutdown to use an eligibility decision made before a successful concurrent activation commits. No common exclusion lock or final presence revalidation prevents that ordering in the reconstructed source. **Plausible but unverified:** its occurrence in hosted gameplay. **Requires installed/runtime evidence:** current installed parity, caller isolation and complete dependency composition. No hosted race is claimed.

This refines the candidate in [G3](legacy-001G3-world-lifecycle-scheduling.md), not the completed Combat2 audit. An empty active encounter is not a shutdown defect: idle presence/claim criteria and encounter completion remain independent. Relevant existing rules are [engine authority and one authoritative world heartbeat](../design/game-engine.md), [ENG-LEGACY-001 / ENG-HB-001](../roadmap/game-engine-roadmap.md). No rule, implementation, permissions, runner or scheduler change is authorized here.

## Exact definition reconstruction

| Identity | Latest relevant repository definition / supporting evidence |
|---|---|
| `public.combat2_session_access(uuid,uuid)` | [Drizzle0013](../../drizzle/migrations/0013_progression_001g_c2_reset_and_cutover.sql), lines326–357. Replaces the [September13 production version](../../supabase/migrations/20260913100000_combat2_production_cutover.sql), lines35–67, with the active-character exclusion. Git history attributes0013 to9148e366; production source to0c396464. |
| `public.idle_shutdown_check()` | [September13 production cutover](../../supabase/migrations/20260913100000_combat2_production_cutover.sql), lines69–81; corresponding generated historical copy [September13 ledger source](../../supabase/migrations/20260913212930_792138d6-ff33-4dd1-868c-85d0e930f112.sql). Supersedes September10–12 Arena-only/earlier presence checks;0013 does not replace it. |
| `public.wake_world()` / `public.shutdown_world()` | [August24 source](../../supabase/migrations/20260824010343_58a2d74d-8e2d-41e2-adb0-a3e2576785ec.sql), lines170–263 /118–167. Source retains trigger/publication/maintenance side effects. |
| `public.combat2_dispatch_scheduler_enable()` / `public.combat2_dispatch_scheduler_disable()` | [Scheduler foundation](../../supabase/migrations/20260831133000_combat2_dispatch_scheduler_foundation.sql), enable from125, disable from26. Both take the schedule transaction advisory lock. Later fire/heartbeat composition changes are reused from G3; no common activation gate is introduced by them. |

Exact-name searches across historical Supabase and Drizzle migrations locate no later replacement of these idle/wake/shutdown/enable/disable bodies; the only matching Drizzle session-access replacement is0013. This is bounded source reconstruction, not proof that hosted definitions match. Historical files are frozen evidence, not instructions to replay them.

Both target routines are PL/pgSQL SECURITY DEFINER functions (session access explicitly VOLATILE; idle uses the default VOLATILE). They cannot independently COMMIT. State, presence and transaction advisory locks belong to the caller's transaction; returning JSON is not itself a commit. For ordinary single-RPC requests, analyze commit after successful request transaction completion. A caller retaining an explicit transaction retains its locks until that transaction ends.

Session access validates auth.uid, character ownership, active lifecycle state, current node and applicable Arena access before activation. It preserves its existing exception block: an exception rolls back changes within that block and returns access_check_failed. Explicit scheduler refusal follows the compensating disable/maintenance/shutdown branch and does not record successful presence. The counterexample below requires the successful allowed branch and a committed caller transaction, not an exception or refusal.

Idle returns for a recent ordinary lease (30minutes), valid test lease (5minutes) or live encounter claim. Its permission intent remains service_role, not browser callers. Those predicates do not lock the matching absence against a later INSERT, and the function has no final repeat of them.

## Lock and transaction order

| Path, in execution order | Locks / writes and significance |
|---|---|
| Activation authorization / Arena lookup | Ordinary reads; no character FOR UPDATE or presence predicate lock. These reads precede the existing activation advisory lock. |
| Activation gate | `pg_advisory_xact_lock(hashtext('combat2-production-activation'))` held through caller transaction. Serializes cooperating activations, not idle. |
| Activation mode / wake | Conditional combat_config UPDATE to open, then wake_world. Wake performs trigger/publication DDL and cron operations, helper calls, simulation_pause_state UPDATE and world_state UPDATE to awake. Ordinary SQL row/relation locks are real, but they occur after idle's possible decision point. |
| Activation scheduler / presence | Enable takes `pg_advisory_xact_lock(hashtext('combat2-dispatch-once-schedule'))`, verifies awake/open and exact job; may call disable reentrantly. Then INSERT/ON CONFLICT UPDATE ordinary/test presence with clock_timestamp; successful JSON return, caller commit. |
| Idle decision | Three SELECT EXISTS checks: ordinary presence, test presence, claims. No activation advisory lock, FOR UPDATE, or final recheck. Ordinary read locks do not make absence of a future presence row exclusive. |
| Idle side effects | return_unique_items; combat_config UPDATE to maintenance; scheduler_disable takes schedule lock; shutdown_world performs maintenance/unscheduling/trigger/publication changes, simulation pause and world_state asleep; caller commit. |

Direct necessary dependencies do not close the gap:

- [return_unique_items](../../supabase/migrations/20260720070010_cb736a97-fb3e-44d6-ade1-dceb66f6e772.sql) deletes qualifying inventory, without an activation gate or presence recheck. The counterexample can use no qualifying unique inventory; no item mutation/trigger lock is needed to demonstrate the ordering.
- final_maintenance_sweep in the August24 file invokes bounded cleanup/pruning after idle's decision. Those later writes cannot retroactively re-evaluate presence. Actual helper/trigger failures may abort or be caught; the counterexample assumes successful dependencies, not their failure.
- [sim_note_resume/suspend](../../supabase/migrations/20260817152132_f0017999-4605-4a17-a2a5-1ac6404f2ef9.sql), lines29–46, update simulation_pause_state. They serialize that row when overlapping, not the earlier decision.
- Scheduler enable/disable exclusion protects the named job changes. It does not acquire the production-activation lock, publish a presence lease or require idle to recheck. A later disable can validly wait for an earlier enable and then remove its job.
- Wake's trigger/publication DDL can add contention. It does not introduce a shared production-activation gate into idle. The timeline pauses idle before its cleanup/state writes and completes activation first; it does not require simultaneous conflicting DDL or bypass a row lock. Relation read locks held by idle's checks do not exclude all activation writes; trigger enable/disable is not a substitute for presence serialization.

Thus existing locks **prevented by existing synchronization** cases include two cooperating activations overlapping inside their gate and simultaneous enable/disable job editing. They do **not** prevent an obsolete idle decision from being applied after activation. In the bad ordering, activation has committed and released every lock before idle starts its shutdown writes, so waiting on those locks cannot rescue the decision.

## Concrete READ COMMITTED interleaving

Preconditions: world already awake/open, no recent qualifying presence, no live claim, valid owned active ordinary character, successful wake/scheduler dependencies and no unique inventory requiring reclamation. No real/test UUID is selected here.

| Step | Session I — idle transaction | Session A — authenticated activation transaction |
|---|---|---|
| 1 | BEGIN; invoke idle. All three absence predicates pass. Pause before return_unique_items / first shutdown write. | Not started. |
| 2 | Still paused; no production-activation lock held. | Validate own character/node; acquire activation lock. |
| 3 | No shutdown writes yet. | Open mode if necessary; wake; enable/already-enable dispatcher; insert fresh ordinary presence. Return allowed. |
| 4 | Still paused. | COMMIT; fresh lease, awake/open and job become committed. Release locks. |
| 5 | Resume without another presence check. Reclaim step succeeds; set maintenance; acquire schedule lock; disable; shutdown sets asleep. COMMIT. | Already committed. |
| 6 | Stored fresh presence coexists with asleep/maintenance and removed dispatcher. | Earlier allowed response did not protect against the stale idle decision. |

READ COMMITTED would let a new predicate query see the lease after step4, but **no such query is executed**. now() is transaction-start time; using it does not invalidate a newly recorded clock_timestamp lease, nor does a clock value provide synchronization. Row-level configuration/job locks order step3 before step5; that is exactly the undesirable final ordering, not a contradiction.

This is a source-permitted execution, not a measured probability or reproduced runtime incident. A different interleaving may block, fail or leave activation last and the world awake. No claim that every concurrent attempt fails, that the worker must tick after sleep, or that active empty encounters cause it.

## Smallest justified correction proposal — not implemented

Add the **same transaction advisory lock** to the beginning of idle_shutdown_check, **before all three eligibility reads and any side effect**, preserving the existing predicates and body. Keep it through transaction completion. Do not merely take the schedule lock earlier, or add a last unprotected presence read: either still leaves a check/write window against activation.

Under READ COMMITTED with the existing VOLATILE routine, eligibility reads after a wait can see the activation committed before lock release:

1. Activation wins gate: idle waits; after activation commits, idle sees fresh presence and returns without shutdown.
2. Idle wins gate: activation waits; idle can complete sleep; activation then performs its existing open/wake/enable/presence sequence and commits awake.

Lock hierarchy for cooperating paths becomes production-activation gate first, then existing cleanup/configuration/wake/scheduler row and advisory locks; schedule gate is subordinate. Do not acquire production-activation from scheduler_enable/disable/fire after taking schedule/fire locks. Existing source scheduler controls have no such reverse acquisition. Holding the gate longer through maintenance can increase activation latency. It does not prove freedom from all legacy dependency/DDL deadlocks; inherited hazards and callers holding external locks remain limitations. No broad Combat1 or cleanup repair is proposed.

**Isolation qualification:** an advisory lock does not refresh a REPEATABLE READ transaction snapshot fixed before the wait. SERIALIZABLE may refuse an execution rather than make every caller succeed. Existing [C3 isolation caveat](legacy-001C3-resource-sync-preflight.md) and [F5B/F7 evidence](legacy-001F5B-party-correction-readiness.md) do not prove actual RPC/cron transaction isolation. Before calling this proposal sufficient for all supported callers, establish their READ COMMITTED contract; otherwise design explicit fail-closed handling/retry for unsupported stale snapshots as separately reviewed scope. Do not silently change connection isolation or assume metadata-session defaults prove API settings.

The proposal addresses these two cooperating paths only. Direct wake, presence heartbeat, admin environment controls, privileged/raw writes and in-flight claims are not automatically serialized by adding this gate to idle. Existing lease-only heartbeats do not wake a world; this review does not assert a global no-sleep-with-any-new-heartbeat invariant. Any broader requirement needs a separate decision, not expansion of this correction.

## Existing tests and evidence reuse

| Evidence | What it covers / does not cover |
|---|---|
| [Production-cutover tests](../../src/server/combat2/__tests__/production-cutover-migration.test.ts) | Static assertions for activation gate, auth/location, wake/fail-closed calls, leases/live claims and departure preservation. Reads the older production source, not the0013 replacement; no independent sessions or decision-window assertion. |
| [Scheduler tests](../../src/server/combat2/__tests__/scheduler-migration.test.ts) | Static job identity/cadence, service-only controls, eligibility and fire overlap. No activation/idle shared gate proof. |
| [Arena lifecycle](../../src/server/combat2/__tests__/test-arena-lifecycle-repair-migration.test.ts) / [runtime repair](../../src/server/combat2/__tests__/test-arena-runtime-repair-migration.test.ts) | Historical Arena lease/shutdown predicate contracts. Not latest ordinary activation/idle interleaving coverage. |
| [C2 SQL fixture](../../scripts/progression-001G-C2-P2-C-sql.test.mjs), deleted-session test | Active-lifecycle rejection before wake/presence; isolated fixture, not this two-session race. Reviewed only, not executed for G3A. |
| [F6 native harness](../../scripts/legacy-001F6-party-concurrency.test.mjs) | Reusable pattern for native PostgreSQL sessions, barriers and blocker inspection, but tests party/combat entry. Its earlier PostgreSQL18 results are not world-lifecycle results. No harness changes or execution here. |
| [G3 / F11](legacy-001F11-evidence-and-closure-assessment.md) and prior archived metadata | F10 successful reported sleep is not a concurrent activation test. No reused complete, fresh parity proof for both target bodies/direct dependencies or caller isolation located. G2B forbidden-role outputs remain conditionally accepted only, not permission to repeat their method. |

## Proposed independent-session PostgreSQL regression

Future local authorization only. Use a disposable PostgreSQL database with two worker connections plus a controller/observer; never hosted or real characters. Extract the exact source target bodies, preserve auth/active-node checks and explicit READ COMMITTED transactions. Use a minimal fixture for singleton/config/presence/claims and deterministic dependency doubles where real cron/Vault/publication setup is unavailable. Label doubled dependencies explicitly: this proves the target serialization boundary, not the full production scheduler/trigger stack.

1. **Original-body reproduction:** controller gates a fixture return_unique_items at entry (after eligibility checks). Start idle, confirm the barrier is reached; allow successful activation on the second connection, verify allowed and COMMIT; release idle and commit. Assert fresh lease remains but final asleep/maintenance/dispatcher-disabled. Show the original defect rather than accepting an arbitrary timeout as reproduction.
2. **Corrected idle-first ordering:** with the proposed gate, pause at the same fixture barrier. Start activation; observer confirms it is waiting on idle's production-activation advisory lock, with bounded timeouts. Release idle, commit; activation then succeeds and commits. Assert awake/open/enabled and exact owned presence. No stale idle shutdown after that commit.
3. **Corrected activation-first ordering:** pause activation in fixture scheduler_enable while it holds production-activation; start idle and confirm wait on that exact lock. Release/commit activation; idle then sees presence and returns without shutdown calls. Assert unchanged activation state and no duplicate presence row.
4. **Preservation:** no-presence/no-claim idle still sleeps; fresh ordinary or authorized Arena lease and live claim each prevent sleep. Unauthorized/inactive activation does not wake. Scheduler refusal/raised error keeps existing compensation/rollback semantics. Rollback releases the gate; no partial commit or leaked fixture job state. Include opposite-order timeout/deadlock detection and bounded fixture teardown.
5. **Isolation guard:** demonstrate or explicitly refuse stale-snapshot higher-isolation callers per the decided contract; do not report a READ COMMITTED pass as universal isolation safety.

Use explicit barriers and pg_blocking_pids/lock evidence, not timing-only sleeps. Any test-only hook/double stays in the disposable fixture, never production SQL. Record PostgreSQL version, extracted-body hashes, transaction isolation, actor fixture identities, ordered events and committed assertions. These tests are a plan, **not executed G3A results**. Even a later native pass is not hosted concurrency verification.

## Evidence gate, owner decision and preservation

No new hosted verification is needed to justify preparing the narrow correction and local regression. Installation later requires current definitions/settings/ownership/ACL parity for both targets and the exact necessary dependencies, plus caller-isolation evidence or an explicit accepted boundary. Reuse G3/archived evidence first; if insufficient, seek separate authorization for bounded catalog-only, permitted read-only verification. No sandbox_exec, read_only=off connection, gameplay probe or general scheduler/privilege scan is authorized.

**Next owner decision:** authorize a local minimal idle-gate candidate and the isolated regression above, with the isolation contract explicitly addressed; or explicitly accept/defer this newly documented source race. Neither decision is inferred here. Do not install, deploy or start G4 automatically.

G2 remains COMPLETE WITH EXPLICIT LIMITATIONS; E13 contract/quest transfer and G/ENG-LEGACY-001 remain OPEN. Preserve B–F closures, privileged v3→v2 and Combat1 uncertainty, OPEN deferred ENG-LEGACY-001F-R3-RETRY and all four OPEN progression F limitations (HOSTED MULTI-SESSION BEHAVIOR UNPROVEN; NATURAL RUNTIME PATH NOT YET OBSERVED; AUTHENTICATED COMMANDS-PAUSED RUNTIME PROBE NOT EXECUTED; RP EARNING AUTHORITY GAP). Administrative XP grants remain paused; normal gameplay XP is not intentionally disabled or runtime-established here. Recovery stash preserved.

## Validation and publication scope

Only this report is authorized for commit/push. No state status changes, SQL candidate, migration, test/code edit, hosted execution, scheduler operation, gameplay, deployment or frontend publication.

Executed local validation:26 tests PASS across five files (project-state3, production-cutover5, scheduler7, Arena lifecycle5 and runtime repair6); project-state JSON/Markdown synchronization PASS unchanged;20 repository links PASS; baseline ancestry and scoped source-order/absence-of-shared-idle-gate assertions PASS. Whitespace checked before commit, including the staged new report. No independent-session test was executed; all race timelines and proposed regression steps above remain analysis/design. Recovery stash unchanged.
