# ENG-LEGACY-001G4A20 — shared HP integration progress and release blockers

Starting checkpoint: `cc9b4d84303ca0fa4c2978ca536371245401d004`. **Partial local implementation; NO-GO for installation or activation.** This does not complete the requested production transition integration. Existing frontend activation remains OFF. No hosted operation occurred.

## Implemented candidate

The [forward candidate](legacy-001G4A20-shared-hp-candidate.sql) is a complete replacement for the **uninstalled** [G4A19 candidate](legacy-001G4A19-admin-candidate.sql), not a migration to apply after it. SHA-256: `fc0eba6441f682d16b73199952b0a99a699dea2ffc2fdbeac07741f91458dc9a`. [Assembly](../../scripts/proofs/g4a15/prepare-shared-hp.mjs) pins G4A19's unchanged hash and produces this exact file; the native test compares generated and reviewed bytes before execution. Historical migrations are untouched.

- Quiet same-generation retained projections now support protected saves: HP is synchronized and encounter versions fenced, including configuration changes with no whole-HP increase. Active encounters/effects/actions/events/claims remain refusal conditions. Historical-generation projections refuse.
- Server boss configuration validation follows the actual [catalogue acceptance contract](../../src/shared/combat2/boss-catalog.ts): disabled/null documents remain inert, changed enabled documents require a name/key, positive numeric cast time/amount and supported target mode. Missing amount rejects with a NULL-safe predicate. Existing unchanged documents are preserved. This validates supported configuration, not encounter execution or every rich-field value.
- Safe-ended reassignment to an existing quiet destination encounter transfers the same-generation projection, clears engagement/tank, preserves wounds and fences both encounters. Missing destination composition, retained unassignment/deletion and other unsafe cases fail closed. No new Admin RPC, receipt, table or reward writer.
- Existing regeneration maintenance delegates to one private shared-accounting function. Its early coverage is sorted node gates → party lifecycle → encounter rows → dependent rows, with graph revalidation and 40001 on changed coverage. It scans the current creature/encounter/projection graph; scalability and complete production caller lock composition are not established.
- Wake healing becomes a no-op, avoiding full heals and late node locks from wake's trigger-DDL context. Eligible elapsed sleep settles later through maintenance/entry. This is candidate behavior only.

The candidate retains G4A19's default **2% maximum HP per four completed eligible seconds**, first award at four seconds, exact fractional carry, old-rate completed-interval settlement, no blocked-time credit and ordinary dead-creature respawn. Max edits preserve missing HP/living floor. No gameplay rule, balance, reward RPC, Admin application source or runtime resolver changed in this task.

## Executed integration and source fidelity

[Tests](../../scripts/proofs/g4a15/shared-hp.test.mjs) reuse the existing [G4A15 harness](../../scripts/proofs/g4a15/postgres.test.mjs), [G4A19 extension](../../scripts/proofs/g4a15/admin-boundary.test.mjs) and pinned source extraction. No second cluster framework. Full worker/decoder/catalogue/resolver and selected complete SQL entry, movement, arrival, claim/commit, respawn and canonical reward/progression bodies remain loaded as documented in G4A7–G4A15. Their namespace/Auth/clock adaptations and dependency doubles remain; this is not the full public schema or hosted trigger/scheduler/Arena composition.

The new tests redirect existing **local adapter** settle/reconcile hooks to the new four-second helper. A successful claim explicitly records blocked eligibility before a later commit clears its lease; otherwise an unobserved lease interval could incorrectly earn healing. This claim hook is implemented in the isolated composition, **not promoted into the public production claim function**. Entry/commit/departure adapters likewise remain local, not installed public wrappers. Do not equate those adapter calls with completed production source wiring.

Executed new cases: quiescent end and 3/4/8/20-second accounting; real re-entry interruption; real DoT pulse followed by its actual next-tick expiry; projected max/rate edits and no-op retry; safe-ended transfer; SQL/catalogue boss acceptance parity; wake/sleep elapsed settlement; lease interval exclusion; retained-engagement refusal; canonical death/reward replay versus maintenance; protected edit versus maintenance; actual solo and coordinated party movement. G4A9 party extraction still uses the isolated G4A10 ambiguity correction; G4A9-R1 is not declared installed or resolved.

## Concrete blocker: retreat is not equivalent to quiescence

The [real resolver lifecycle](../../src/shared/combat2/resolver.ts:1792) keeps an encounter active while any living creature remains engaged. The inspected resolver does not clear engagement simply because no fighters remain. A native case sets that reachable retained state, runs the real claim/resolver/commit, then attempts maintenance at twenty seconds: HP stays wounded and eligibility remains NULL. This confirms local source behavior, not a hosted incident.

Consequently the required **telegraphed-cast retreat followed by recovery** is not proved. The passing 4/8/20-second case is a quiescent nonengaged encounter, and the movement cases demonstrate HP preservation/accounting rather than full hostile-cast completion. Changing the no-combat regeneration guard to heal an active engaged creature would violate the approved contract. No such bypass was introduced. A bounded quiescent encounter-ending/engagement transition must be implemented and tested through pending-cast resolution, DoT expiry, departure and re-entry before claiming this scenario complete.

## Exact remaining installation blockers

1. Promote the already exercised early-coverage accounting hooks into the exact public entry/claim/commit/movement/respawn composition. Candidate currently replaces Admin and maintenance leaves, not that complete composition. No safe partial activation.
2. Resolve the concrete retained-engagement transition above without dropping pending casts, effects, events or claims. Keep regeneration disabled until then.
3. Review the complete existing maintenance/wake caller lock composition and legacy SECURITY DEFINER effective EXECUTE rights. The two replacements preserve existing ownership/ACL through CREATE OR REPLACE; this file does **not** establish that inherited browser EXECUTE is absent. Table DML denial alone is insufficient. Fresh installed source/settings/ACL parity and guarded preservation of required server rights are outstanding. No general privilege scan or access-route workaround.
4. Review exact final forward SQL prerequisites/recovery, caller isolation and installed trigger/reference coverage through a permitted read-only route. Existing G3D/G4A11 BLOCKED routes stay blocked. This partial artifact is not an installation handoff.

After those gates, separate authorization is required for Drizzle installation/reconciliation, any affected Edge deployment, deliberate frontend gate enablement and Mik's manual publication, followed by disposable acceptance. Recovery must preserve wounds/generations/history and keep incompatible operations disabled; never restore an independent full-heal writer as an automatic rollback.

## Validation

[Native PostgreSQL output](evidence/legacy-001G4A20-shared-hp-postgres.txt): **49 PASS, zero failures**, PostgreSQL 18.6, disposable cluster stopped. Includes 37 reused cases and 12 new cases. Twelve observed independent-session cases overall: ten reused and two new (canonical death/reward commit versus maintenance; protected projected edit versus settlement). Blocking is observed with pg_locks/pg_blocking_pids under explicit READ COMMITTED. No claim of global deadlock freedom, real cron execution, production isolation or hosted concurrency.

Reproduce: `node --experimental-strip-types scripts/proofs/g4a15/shared-hp.test.mjs "C:\Program Files\PostgreSQL\18\bin"`. Requires the local Node/PostgreSQL dependencies already used by G4A19; no new package. Application/state, typecheck, source/history preservation, documentation links/synchronization and whitespace results are recorded below after final checks.

## Complexity and ownership

Two new runtime functions relative to G4A19: private `creature_admin_boss_valid(jsonb)` and `creature_hp_maintain()`. Two existing legacy leaves replaced in the candidate: `regen_creature_hp()` and `heal_creatures_on_wake()`. Existing Admin/settlement helpers are reused. Five proposed creature columns are carried forward from G4A19; **zero additional tables, columns or package dependencies** in G4A20. The standalone candidate repeats G4A19's uninstalled bootstrap by design; the assembly pins/reuses that source. Independent legacy heal formulas are removed from these candidate leaves, not from installed runtime.

Line totals below count the standalone SQL as runtime, native evidence as documentation, and assembly as tooling; they are publication delta, not a claim that all added SQL is newly invented logic.

| Category | Added | Deleted | Net |
|---|---:|---:|---:|
| Runtime (standalone SQL candidate) | 353 | 0 | +353 |
| Tests | 135 | 2 | +133 |
| Documentation/state/evidence | 171 | 11 | +160 |
| Other (assembly and LF configuration) | 99 | 0 | +99 |

Final checks:24 focused application/state tests PASS; typecheck PASS; JSON/Markdown synchronization PASS;23-entry journal/snapshot chain PASS;11 report/readiness local links PASS; prior state records and production source/history preservation PASS; staged whitespace PASS. Candidate assembly equals reviewed bytes; G4A19 hash unchanged. No build/deployment was needed for unchanged application/runtime source. Recovery stash remains `0a5529d5227675319b166881b10f1c91edd7486b`.

## Dispositions and next action

G4A20 is partial local implementation with specific release blockers, not completed shared-runtime rollout. G4-R1/G4-R2/G4A9-R1/E13/G/parent remain OPEN; G3 correction deferred; G3D/G4A11 BLOCKED. Previous progression/B–F closures, all four OPEN progression F limitations, privileged/external caller uncertainties, Combat1 risk and deferred F1 retry correction unchanged. Administrative XP grants remain paused; normal gameplay XP is not intentionally paused or newly runtime-verified. Recovery stash preserved.

Smallest next slice: implement the bounded no-fighter quiescent-ending transition through the actual resolver and SQL commit, preserving pending work, then promote existing accounting hooks into public caller bodies. Do not add another accounting system or proof hierarchy. No installation or frontend activation is recommended from this partial package.
