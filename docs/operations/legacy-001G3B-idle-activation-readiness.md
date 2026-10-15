# ENG-LEGACY-001G3B — Local idle/activation correction and regression

2026-10-15; starting/fetched checkpoint `2b90725d11957be801408a7c518a055056d26cc6`. Implements only the local scope authorized after [G3A](legacy-001G3A-idle-activation-serialization.md). **Production readiness: BLOCKED.** Actual supported caller isolation and fresh installed parity remain unresolved. No hosted operation, installation, cron invocation, gameplay, deployment or frontend publication occurred.

## Classification

| Gate | Result |
|---|---|
| Source correction prepared | YES — one initial transaction advisory lock added to idle_shutdown_check only. |
| Local regression demonstrated | YES —11 native PostgreSQL18.6 tests passed, including the original race and both corrected independent-session orderings. |
| Caller isolation verified | NO — local test sessions explicitly READ COMMITTED; actual PostgREST session-access and cron connection contracts unresolved. |
| Installed parity verified | NO — exact installed idle body/settings/ACL and necessary dependency parity require separately authorized evidence. |
| Hosted deployment | NOT AUTHORIZED; nothing installed, deployed or manually published. |

## Candidate and preservation

[Reviewed SQL candidate](legacy-001G3B-idle-activation-lock.sql), SHA-256:

`ec2ddfc2458c28d8ecb291c8f405f5091a8364708fd7c6097716ba51c97f233c`

It adds exactly:

```sql
PERFORM pg_advisory_xact_lock(hashtext('combat2-production-activation'));
```

immediately after the initial BEGIN, before any eligibility read or effect in public.idle_shutdown_check(). The candidate is one BEGIN/DO/COMMIT installation transaction and does not invoke lifecycle or scheduling functions. Guards require the expected source body, postgres owner, PL/pgSQL, VOLATILE, SECURITY DEFINER, void/no arguments and search_path=public, cron, pg_temp. FALSE/NULL fails closed. Deparsed existing definition supplies all other declaration attributes; no GRANT, REVOKE or ALTER OWNER is issued. A postcondition compares the complete pg_proc record except prosrc, including owner, security, configuration and ACL, and verifies the exact patched body. Any failed guard/postcondition aborts the installation transaction.

Expected original normalized prosrc SHA-256 (CRLF→LF only):

`3c14b179b83d26da8b25cf50f1f568f0a137490b603e51b947c299c6a261604e`

This is a **repository-derived prerequisite**, not a newly verified installed fingerprint. The guard intentionally refuses drift and a second application. It does not weaken checks to accommodate unknown installation state.

The original body comes from [September13 production source](../../supabase/migrations/20260913100000_combat2_production_cutover.sql), lines69–81; session access is extracted unchanged from [Drizzle0013](../../drizzle/migrations/0013_progression_001g_c2_reset_and_cutover.sql), lines326–357. Removing the added line reproduces the exact original body in the native test. Existing30minute ordinary and5minute authorized-test presence predicates, live-claim predicate, item return, maintenance write, scheduler disable and shutdown are unchanged. No session-access correction was necessary for the demonstrated READ COMMITTED boundary.

Encounter completion, world wake semantics, dispatcher identity/cadence, combat authority, character/reward/progression behavior and other routines are not changed. Relevant existing specification areas are [engine authority/one authoritative heartbeat](../design/game-engine.md); roadmap IDs [ENG-LEGACY-001 and ENG-HB-001](../roadmap/game-engine-roadmap.md). Rules/statuses are preserved, not revised. Historical migrations, journal, snapshots, generated types and application code remain untouched.

Keep this candidate under docs/operations. A future authorized installation must use only the [approved standard Lovable Drizzle channel](ai-operating-guide.md), with separately approved evidence and post-install checks; do not move it into automatic migrations, replay historical Supabase files, register an execution now or alter history. Local fixture execution is not a migration installation.

## Native regression evidence

Run from repository root:

```powershell
node scripts/legacy-001G3B-idle-concurrency.test.mjs "C:\Program Files\PostgreSQL\18\bin"
```

[Harness](../../scripts/legacy-001G3B-idle-concurrency.test.mjs) always initializes a new loopback-only temporary cluster and accepts only a local binaries directory, no connection URL or existing database. [Fixture](../../scripts/fixtures/legacy-001G3B-idle-fixture.mjs) extracts both exact target routine definitions, applies the unchanged candidate, and uses two worker sessions plus a controller/observer. Activation executes as fixture authenticated, idle as fixture service_role, with synthetic account/character/node identifiers; no real or protected characters are accessed. All normal connections assert READ COMMITTED. The cluster is stopped by the harness after tests; temporary files are outside the repository.

Executed environment: **PostgreSQL18.6, x86_64-windows, msvc19.44.35229,64-bit; Node24.19.0; postgres.js3.4.9**,2026-10-15. Successful run duration7.106seconds,11 passed,0 failed,0 skipped. Explicit barriers, pg_blocking_pids and ungranted advisory pg_locks observations establish ordering, rather than timing-only sleeps. Polling has a5second deadline; lock/statement timeouts and deadlock_timeout bound unexpected waits. Unexpected deadlock errors fail the target tests. A separate deliberately inverted fixture-only lock pair demonstrates40P01 detection and rollback release; it does not imply the corrected routines have that cycle or prove a complete deadlock analysis.

| Executed native case | Observation / assertion |
|---|---|
| Original race | Idle pauses after its checks in fixture return_unique_items; activation commits allowed with one fresh lease; resumed original idle commits asleep/maintenance/disabled despite that lease. |
| Corrected idle-first | Controller→idle barrier and idle→activation advisory blocking observed. After idle commits, activation wakes/open/enables and records its one lease. |
| Corrected activation-first | Controller→activation barrier and activation→idle blocking observed. After activation commits, idle sees presence, returns and performs no shutdown. |
| Eligibility preservation | Empty-presence idle sleeps; ordinary lease, valid test lease and live claim separately prevent shutdown. |
| Authorization/lifecycle | NULL actor, wrong owner and deleted character each refuse before wake or presence. |
| Scheduler refusal / exception | Refusal preserves existing compensation; raised scheduler error rolls activation's exception block back. Neither grants presence. |
| Failure / rollback / release | Injected shutdown error rolls idle writes back; explicit outer rollback restores prior state; another session acquires released gate. |
| Timeout detection | Holding production-activation causes bounded55P03 lock refusal; no side effects, gate available after release. |
| Deadlock detector | A deliberately inverted fixture-only advisory pair produces exactly one40P01; both transactions roll back and release their locks. |
| Higher-isolation boundary | An explicitly established REPEATABLE READ snapshot encounters40001 after concurrent activation writes; rollback retains activation. This particular serialization failure is not proof all higher-isolation executions are safe. |
| SQL/ACL/drift preservation | Full pg_proc metadata unchanged; only added body line differs; browser EXECUTE remains denied, service_role remains allowed; repeat patch refuses source drift and is rolled back. |

Harness source extraction hashes (LF-normalized complete CREATE statements, different hash domain from prosrc): original idle `3f71d0d3822899495395e3ebba1a77e202c9980c115b092a873bf6c124f790f2`; unchanged activation `8cdfe2442018c277ae56ee2b7f652056cc0beafb93f243c68c61e30dfca5e442`.

Dependency doubles explicitly replace auth.uid, Arena-access lookup, unique-item reclamation, wake, shutdown and scheduler controls. Scheduler doubles retain the schedule advisory lock and deterministic refusal/exception behavior but **do not run pg_cron/Vault/HTTP, trigger/publication DDL, item triggers, cleanup or a worker**. Native sessions prove target-body serialization and fixture transaction behavior, not full hosted scheduler composition or global runtime quiescence.

Initial execution inside the Windows sandbox failed initdb's WAL rename with Permission denied. The identical loopback-only cluster setup succeeded under authorized sandbox escalation. The first outside-sandbox run exposed harness defects (lazy postgres.js idle dispatch, a timeout caught by the original reclaim exception block, and a fixture-role snapshot read without table permission). These were corrected in the harness: eagerly dispatch pending idle queries, test timeout at the initial gate, and establish the repeatable-read snapshot using a permitted snapshot query. No candidate/body guard was changed to obtain passing tests. The final run above passed all cases.

## Caller-isolation investigation and blocker

- [Session-access client](../../src/features/combat2/session-access.ts) calls supabase.rpc with two arguments; [generated client setup](../../src/integrations/supabase/client.ts) configures auth storage, not transaction isolation. Neither proves the server's actual RPC transaction mode.
- [Wake scheduling source](../../supabase/migrations/20260824010343_58a2d74d-8e2d-41e2-adb0-a3e2576785ec.sql), line220, schedules `SELECT public.idle_shutdown_check();` without an explicit isolation contract. Current installed job owner/connection options, database/role settings and execution overrides are not established locally.
- Bounded searches of source-controlled configuration/migrations find no setting establishing isolation for these two callers. C2 creation/lifecycle routines independently refuse non-READ-COMMITTED isolation; those checks do not govern these routines and were not changed.
- Prior [C3 metadata caveat](legacy-001C3-resource-sync-preflight.md) and [F5B observations](legacy-001F5B-party-correction-readiness.md) explicitly leave actual API/service isolation unverified. G2B's conditionally accepted forbidden-role metadata session is neither caller proof nor permission to repeat that execution.

**Caller isolation UNRESOLVED; production readiness BLOCKED.** No connection isolation was silently changed. The local harness explicitly sets only its disposable sessions. A shared advisory lock does not refresh a REPEATABLE READ snapshot; the observed40001 is a bounded demonstration, not a replacement for the supported caller contract. Do not install on an assumption that PostgreSQL defaults, inspection-session isolation or this successful READ COMMITTED test establish actual caller behavior.

Smallest next evidence step, separately authorized: reuse available permitted metadata for the exact two function settings and actual PostgREST/cron database-role isolation configuration; establish relevant request/connection overrides from the supported platform configuration. Metadata defaults alone may still leave actual execution unresolved. If the READ COMMITTED contract cannot be established, request an explicit owner decision on a narrowly reviewed fail-closed higher-isolation policy before changing the candidate. No broader privilege scan, scheduler invocation, connection-setting change or gameplay probe is authorized by this report.

## Lock assessment and remaining gates

For the two cooperating routines: production-activation transaction gate precedes idle eligibility, dependent cleanup/mode writes and schedule gate. Activation already takes that gate before its mode/wake/schedule/presence work. Neither scheduler double nor inspected source enable/disable acquires production-activation after schedule. No new node/encounter/character advisory locks or alternate heartbeat are added. Idle maintenance extends the gate hold time and can delay activation. Actual dependency/trigger DDL, privileged external callers and legacy Combat1 lock risks remain outside this narrow proof.

Deployment gates: caller-isolation contract; fresh exact installed idle source/settings/ACL and relevant session/dependency parity; reviewed supported runner/ledger prerequisites; explicit owner installation authorization; post-install metadata preservation checks. No hosted runtime/concurrency or complete dependency-stack behavior is proved. Direct wake/admin/raw writers, lease-only heartbeats and asynchronous in-flight work are not automatically covered by this two-routine gate.

## Files, validation and preservation

Four local artifacts only: this report, SQL candidate, fixture and native harness linked above. Existing project-state JSON/Markdown, roadmap and statuses remain unchanged as requested. Executed18 focused tests PASS (project-state3, production-cutover5, scheduler7, session-access3), plus native11 PASS. Project-state synchronization PASS unchanged;14 repository links PASS; source/candidate hash and ancestry PASS; tracked source/history/state unchanged; staged whitespace checked before commit. No build/typecheck is necessary for unchanged application code.

G2 acceptance and limitations, OPEN E13, G/ENG-LEGACY-001 OPEN, prior B–F closures, privileged v3→v2/Combat1 uncertainty and OPEN deferred ENG-LEGACY-001F-R3-RETRY remain unchanged. All four progression F limitations remain OPEN. Administrative XP grants remain paused; normal gameplay XP is not intentionally disabled or runtime-established here. Recovery stash preserved. Commit/push is publication of local preparation only, not production-readiness approval or installation authorization.
