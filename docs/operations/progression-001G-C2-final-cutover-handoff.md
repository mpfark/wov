# C2 final cutover preparation — local only

**Current execution path:** [full reset preparation](progression-001G-C2-character-reset-preparation.md) supersedes the historical standalone cleanup sequence below. Latest owner authorization removes ALL ground loot/obsolete runtime without provenance reconstruction. Prepared reset-and-cutover.sql contains reset then the unchanged corrected B in ONE transaction; unchanged inactive A remains separate. All material rows, including the 203 historical orphans, are removed by reset. The exact snapshot/cleanup sections below are retained historical evidence and must NOT be executed in addition to reset. Local preparation is complete; fresh installed checks, practical private recovery checkpoint and separate destructive reset/cutover approval remain execution gates. No hosted action is authorized.


Baseline: ee64bb3ac16742702ea3a0bcd9a82017d436cdb5. No hosted access or execution. This handoff supersedes the earlier blocker report and integrated handoff wherever readiness, runtime composition or orphan disposition differs. ENG-PROGRESSION-001G/C2 gameplay rules remain unchanged.

**Issue-report correction:** first combined attempt reportedly failed23502 and rolled back. The corrected reset clears only issue_reports.character_id and preserves historical character_name plus all report/account/content/status fields. See the current reset handoff for new SQL hashes and source-defined regression fixtures. Corrected B remains byte-identical; inactive support0012 is now registered in fetched source—verify existing installation rather than replay it. No hosted retry/publication is authorized here.

## Evidence and owner decision

Supplied hosted definitions are retained in [settlement evidence](progression-001G-C2-settlement-installed-definitions.txt). All three LF-normalized body SHA-256 hashes reproduce exactly: wrapper 17185b0df23c90e8707a739249c7940324dd387d49f6ec300a7be1d58d99c183; corrected inner 69e507eb64d25d0559cfd4a37cfc4e3016b2201f221692a3326bb9c219d46e90; Force Shield helper bb2b219f099d6f78809ff1172f219518e5d20f3894dab8a06adddcf8ce1764d8. Supplied postgres ownership, SECURITY DEFINER, volatility, search paths and ACLs are checked in the revised source guards. These are supplied inspection observations, not a Codex hosted verification.

The exact [CSV](progression-001G-C2-orphan-materials-snapshot.csv) contains 203 unique material rows, 29 UUIDs and 1,341 units. Owner approval includes the seven deviations from starter balances, conditional on complete unchanged snapshot verification; execution remains unauthorized. Full inspection visibility and absent inventory/progression/origin/replay/lifecycle links are operator-reported. Legacy fingerprint 71d68d37096ee571eb3926a360c623f4 is historical MD5 evidence only. Its missing timestamp/row separator/session serialization cannot be recovered; it is deliberately not an executable assertion.

Operator-reported installer metadata: postgres Auth TRIGGER and required catalog/schema privileges; cron USAGE, schedule EXECUTE and job SELECT; pg_cron 1.6.4; no character-c2-receipt-expiry collision. Existing target-postgres preflight remains unchanged and must be rerun immediately before the authorized installation. Metadata does not establish a scheduler launch or Auth runtime behavior.

## Exact snapshot comparison and cleanup

The existing cleanup template now embeds all 203 CSV rows as explicit typed values, retaining the existing one-transaction temporary allowlist architecture. UUID/text/integer equality and UTC microseconds (extract(epoch FROM timestamptz)*1000000 cast to bigint) define the new deterministic comparison. Explicit UTC offsets in CSV literals preserve their instants; no textual timestamp rendering, collation-sensitive digest, DateStyle, TimeZone or row delimiter determines equality. Counts require 203 rows, 29 UUIDs and 1,341 units in the allowlist. A bidirectional EXCEPT compares the entire physical orphan set to that allowlist; key uniqueness plus full equality proves the same live aggregate totals. Missing, changed, extra or now-parented rows abort.

Require postgres and complete visibility. Acquire characters SHARE, materials SHARE ROW EXCLUSIVE, then SHARE on inventory/progression/origin/log/lifecycle evidence tables, under 5-second lock/30-second statement timeouts. These table locks prevent concurrent parent/material changes and new recovery evidence through commit. Broad locks are bounded maintenance locks for this one legacy cleanup, not a new lifecycle mechanism. Timeout/deadlock is an abort, never permission to bypass protection. Local one-backend tests cannot prove independent-session lock interactions.

Reject incoming material FKs and enabled user triggers before deletion. Require absent recovery evidence and live parents. Delete only exact matching allowlist rows, require 203 deleted, then require zero remaining orphans. Confirm the sole installed character-material FK name, columns, nondeferrability, ON UPDATE RESTRICT and ON DELETE CASCADE. Cleanup performs no ALTER/VALIDATE; actual FK validation stays in atomic cutover. A missing/drifted FK fails after deletion and rolls it back in the same transaction. Any exception must roll back the entire file. Never execute individual statements in autocommit or resume after a failure. No character, live character material, origin, receipt or other record is deleted.

## Settlement correction

The outer October wrapper is not replaced; its exact installed body and metadata are guarded. The September24 inner is recreated from the verified complete definition with only WHERE deleted_at IS NULL on its ordered character loop. Both present-fighter predicates, settlement cursor/cadence, resource formulas and locks remain exact. The Force Shield helper gains only c.deleted_at IS NULL in its ordered character/stance selection; ward calculations, update/version logic and locks are unchanged. CREATE OR REPLACE retains owners and ACLs; no new execution grants. Known sandbox execution remains as inspected, not replaced with a new role model.

The lifecycle prerequisite now follows wrapper → inner and checks the helper exclusion. Corrected runtime guards inspect all three settlement bodies instead of substituting a wrapper hash into the obsolete implementation. Integrated composition is regenerated from the existing five components. The private support SQL is unchanged, dormant, and separate. No old September23 body restoration or parallel lifecycle system.

## Dependency-ordered Lovable actions

No action below is authorized to execute by this local-preparation task. Publish a reviewed source checkpoint only after separate approval; use the normal B2 workflow, standard Lovable Drizzle and inspect automatic source commits after success or failure. Reviewed installation SQL stays outside migrations until the tool generates its file/journal/snapshot. Preserve Supabase history.

1. Read-only pre-install checks from the checkpoint: standard installer identity postgres, installed 0007–0011 prefix/dependencies, exact three settlement bodies/metadata and other existing source guards, material FK/trigger map, complete visibility and exact CSV snapshot, Auth hooks, cron API/permissions and job collision. No gameplay function calls. Stop on drift; no additional owner policy decision is needed if the exact approved snapshot holds.
2. A — separately authorize/install unchanged inactive private support in one standard-tool transaction. Verify owner/private ACLs, capacity/retention helpers, no application activation, no attached Auth hook or new cron job. A does not depend on orphan cleanup; it must precede atomic cutover.
3. B — separately authorize the exact cleanup artifact in one explicit postgres transaction. No gameplay calls. Hold all specified locks through commit; any assertion failure rolls back the whole cleanup. Verify 203 affected/zero orphans and unchanged live materials; preserve the exact reviewed snapshot with the handoff. Orphan cleanup and A have no mutual dependency, but both must complete before cutover. Never combine cleanup into support/cutover.
4. C — under separate explicit activation authorization and a coordinated maintenance window, recheck zero orphans/current source guards, then install corrected integrated-cutover.sql in ONE standard-tool transaction. This validates the existing FK, closes old creation/hard-delete paths, patches runtime eligibility, attaches fences/Auth hook, schedules private receipt maintenance and enables approved authenticated bridges. Do not install component files separately. No unreviewed intervening source/runtime change.
5. D — verify generated SQL/hash/history/journal/snapshot, owners/search paths/ACLs, validated FK, active predicates, protected15/unprotected38/authenticated six preferences, private storage, legacy/custom inheritance containment, retained quota/name/replay boundaries, Auth hook and exactly one dedicated receipt job with world jobs unchanged. Separately authorize bounded runtime canaries for creation/replay/delegation/lifecycle and Auth retirement; verify actual job launch/maintenance privately without forcing expiry or aging production records. Retain existing hosted unarmed/empty-equipment/Realtime and independent-session verification gates. No unsafe account deletion or production recovery fixture.
6. E — Mik manually publishes the reviewed frontend only after required database/runtime verification. Git push and migration installation do not publish it. On failure retain fences/audit, stop affected entry points and use a separately reviewed forward fix; never restore legacy bypasses or resume a partial transaction.

## Focused local validation

P2-A 21/21, P2-B 16/16, revised P2-C 46/46 and cleanup 8/8 pass (91 SQL tests); project-state tests 3/3, generated-state/composition/diff checks also pass. Cleanup tests use the actual CSV on disposable PGlite, including per-row drift/missing/extra/live parent, one-microsecond change, non-UTC/SQL DateStyle, recovery evidence, incoming FK/user-trigger rejection, rollback and separate FK validation. Runtime tests compare bodies to the verified source with only the four intended eligibility predicates, preserve the wrapper/ACLs, reject body drift, exercise the real Force Shield helper (not a stub), stale non-present versus present claimed fighters, tombstone resource/ward exclusion and full composed-cutover late-failure rollback. Auth/cron catalog/API fixtures are local mocks; no hosted scheduler execution or concurrency is claimed.

## Readiness and retained limits

GO for local corrected-package review and installation preparation, subject to source checkpoint publication and separate A/cleanup/C authorizations. NO-GO for automatic execution or frontend publication. Any changed approved row, unknown material side effect, function/ACL/dependency drift or job collision stops installation. No newly unresolved owner policy question; runtime/platform verification remains required.

Four F limitations preserved: HOSTED MULTI-SESSION BEHAVIOR UNPROVEN; NATURAL RUNTIME PATH NOT YET OBSERVED; AUTHENTICATED COMMANDS-PAUSED RUNTIME PROBE NOT EXECUTED; RP EARNING AUTHORITY GAP.

## Reviewed SQL SHA-256

| File under docs/operations | SHA-256 |
|---|---|
| progression-001G-C2-integrated-private-support.sql | 5aa1c167bd59c239e94bdfd9e7a929f5ed060deda9ad3f754a68b83b8e01938c |
| progression-001G-C2-orphan-cleanup-template.sql | a9e2c5149ed5fa4c61bcac915b7c5260aab84a79458db5caf49ce29a1670879b |
| progression-001G-C2-integrated-cutover.sql | 7df1c1cd143433878019628d40d2bff6695df317e43cdb25105c1db31edf4fae |
| progression-001G-C2-P2-C-runtime-exclusions.sql | 15530c2f1d07934ce2987ed9c8a5a35bff46231376c07fecb79fdc93b2c0a12c |
| progression-001G-C2-P2-C-lifecycle-cutover.sql | 2ef9cfe0c3cd913ca78200e18815e0a1e48320d6dcb7112c1e78438204726b52 |
| progression-001G-C2-integrated-preflight.sql | 609fbb06b10e14174f3d58a2f721478bf3b8acf41a54ed18b803e53c864257be |
| progression-001G-C2-blocker-evidence.sql | 5e9ba617020c6a426f845d298bc415d5199da747873eef92503f465e71bef147 |

Evidence file SHA-256: CSV 22fe515b2d392bdadf19643e6ed5055d082a61f3c9b933500a4671a4af23f7b6; definitions f7575011bbdce22a8decd5092f9e2fe1f450bebce18d1699d650cea016b0aef2. Repository copies normalize CRLF to LF only; row values/function bodies are unchanged.

## Exact local file inventory

- docs/operations/progression-001G-C2-orphan-cleanup-template.sql
- docs/operations/progression-001G-C2-P2-C-runtime-exclusions.sql
- docs/operations/progression-001G-C2-P2-C-lifecycle-cutover.sql
- docs/operations/progression-001G-C2-integrated-cutover.sql
- docs/operations/progression-001G-C2-integrated-handoff.md
- docs/operations/progression-001G-C2-blocker-resolution.md
- docs/operations/progression-001G-C2-final-cutover-handoff.md
- docs/operations/progression-001G-C2-orphan-materials-snapshot.csv
- docs/operations/progression-001G-C2-settlement-installed-definitions.txt
- scripts/progression-001G-C2-orphan-cleanup.test.mjs
- scripts/progression-001G-C2-P2-C-sql.test.mjs
- docs/operations/project-state.json
- docs/operations/project-state.md
- docs/roadmap/game-engine-roadmap.md
