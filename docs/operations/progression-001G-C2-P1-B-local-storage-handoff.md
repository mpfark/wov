# ENG-PROGRESSION-001G-C2-P1-B — Local storage implementation handoff

**S1 LOCAL IMPLEMENTATION COMPLETE / NOT INSTALLED / CREATION NOT ACTIVATED.**

Historical local-preparation status above. On 2026-10-09 Mik subsequently reports
0007 installed at generated commit `011a026d`, merged into `5ecc36c7`. The
[next implementation preparation](../design/progression-001G-C2-next-implementation-preparation.md)
records source reconciliation and remaining evidence; this handoff is retained.

Primary specification: [P1-B proposal](../design/progression-001G-C2-P1-B-storage-proposal.md).
Owner authorized local storage implementation only. Affected specification boundaries:
Progression/provenance and Transactional authority; roadmap ENG-PROGRESSION-001G.
No engine rule or shared-heartbeat change. Creation authority remains future P2.

## Exact files changed by this task

- [Forward SQL](../../drizzle/migrations/0007_progression_001g_c2_private_creation_storage.sql).
- [Executable isolated tests](../../scripts/progression-001G-C2-P1-B-sql.test.mjs).
- This handoff.
- [Project-state JSON](project-state.json) and generated [Markdown](project-state.md).
- [Roadmap](../roadmap/game-engine-roadmap.md), status/evidence only.

Pre-existing uncommitted P0/P1-A/simplification/P1-B proposal files remain unchanged.
No existing SQL migration, journal, snapshot, Supabase history, runtime application,
package/lock file, generated type or existing gameplay record was changed.

## Implemented objects and guarantees

| Object | Purpose |
|---|---|
| public.character_creation_origin | Empty postgres-owned private table; UUID character PK/FK RESTRICT; four nonempty creation/race/class/formula versions; snapshot schema 1; applied JSON object and creation time |
| public.character_creation_log | Empty private table; independent log UUID PK; actor-scoped unique request and unique result UUID; 32-byte digest/version; constrained applied/purged/retired status and six replay fields; detailed JSON receipt and fixed UTC twelve-calendar-month expiry |
| character_creation_log_detail_expiry_idx | Partial expiry index for nonnull detailed receipts; no character-name index |
| public.character_creation_storage_guard() | One postgres-owned SECURITY INVOKER trigger function, fixed pg_catalog search_path, no nonowner EXECUTE grants |
| character_creation_origin_immutable | BEFORE UPDATE rejects every origin UPDATE, including no-op |
| character_creation_log_lifecycle | BEFORE UPDATE protects bindings/timestamps/detail; permits only expired detail clearing, absent-result purge marking and absent-actor replay retirement |

Five indexes total including ordinary PK/UNIQUE indexes. Ordinary validated,
nondeferrable constraints; FK generates normal internal referential-integrity
triggers on origin/characters. The existing starting-material trigger is untouched.
No sequences, extensions, custom ICU collation, account-lock table, separate receipt
table, configuration hashes or JSON validation framework.

Finite timestamp CHECKs additionally prevent PostgreSQL infinity timestamps from
evading the twelve-month duration; this tightens storage validity without changing
policy. UUIDs/timestamps/INSERT contents come from the future trusted authority.
No INSERT trigger or semantic baseline initializer is added.

Both tables have RLS enabled, no policies, FORCE RLS false, owner-private access.
Explicit table/function REVOKEs include PUBLIC/anon/authenticated/service_role;
the migration also clears all discovered nonowner default grants on **these new
objects only**, including column grants, without changing defaults or role membership.
Final assertions reject direct ACL leaks and effective application/member access.
Independent platform global authority is classified by actual capabilities under
the operating contract, not mistaken for gameplay permission or an object grant.

The log has no account/character cascade FK. Expired detail clearing preserves replay
data. Controlled actor deletion can clear all replay identifiers/digest, retaining
unexpired audit under log_id; delegated recipient provenance remains character-owned.
An expired retired row can later be removed. Origin deletes and log cleanup are
reserved for trusted future lifecycle operations, not application table access.
Owner-level operations remain a trusted administrative boundary.

## Validation

Run executable SQL tests with:

```text
node scripts/progression-001G-C2-P1-B-sql.test.mjs <local PGlite 0.3.14 dist/index.js>
```

The existing external local dependency was reused; no application dependency installed.
Tests execute exact migration bytes in explicit transactions on disposable in-memory
PGlite 0.3.14 / PostgreSQL 17.5; they accept no hosted connection string.

| Check | Result / boundary |
|---|---|
| New storage SQL suite | **22/22 pass**: schema/constraints, actual role reads/writes denied, default/inherited ACLs, immutable origin, FK restriction, UTC/leap expiry, replay after expiry, independent account/history retention, delegated provenance, lifecycle rollback, drift/late-assertion full migration rollback, history preservation |
| Existing F-R1 SQL suite | **13 pass / 1 pre-existing failure**: case02 `R1 installation history/type preservation drift`; same archival baseline failure documented in [001G-A validation](progression-001G-A-admin-creation-audit.md#9-test-coverage-fresh-baseline-and-gaps). All privilege/DML/inheritance tests pass; no fix made outside scope |
| Historical F-R2 closure check | Refuses `R2 history/runtime preservation drift`: its frozen closure check rejects **any** untracked Drizzle file, including authorized new 0007. Earlier installed SQL/journal/Edge identity assertions passed before this refusal. This is a scope mismatch with new work, not a changed historical migration; checker unchanged |
| Project-state Vitest | **3/3 pass**; retried outside sandbox after local Windows EPERM dependency resolution; no hosted activity |
| Project-state generator/check | Regenerated and synchronized |
| Git diff/whitespace and preservation | Checked at final handoff; old migrations, journal/snapshots and P0/P1-A bytes retained |

No application typecheck/build was needed for SQL/test/document-only changes.
Serial embedded tests prove local PostgreSQL behavior, not current hosted roles,
production triggers, true multi-session races, creation command behavior or retention
maintenance execution. Fixture lifecycle DML is **test-only**, not an account-deletion
implementation or gameplay RPC. Future authority must validate exact applied values,
sidecar linkage, live identities, permission, quota and request payload at INSERT.

## Installation readiness and stop/go

**Safe to propose as an additive, dormant S1 installation after scoped installed
metadata/privilege verification and separate owner authorization.** It contains no
creation RPC, initializer, backfill, direct application grant or activation write.
Empty storage adds no origin FK protection to existing rows until future origin
insertion. No existing character receives a new origin or replay row.

Before installation, independently confirm:

1. Current source/journal/installed ledger prefix and next migration identity; no
   object/function/index name collision. public.characters(id) and auth.users(id)
   must have the expected UUID identities; characters(id) must support the FK.
2. Actual tool transaction boundary and role can create/own the reviewed objects
   as postgres. Compare exact reviewed SQL with tool-generated migration input.
3. Effective application memberships/global rights, defaults, resulting direct
   table/column/function ACLs and RLS satisfy the assertion policy. Do not change
   roles or existing grants to force a pass. Failed assertions must roll back fully.
4. After authorized installation verify empty tables, owner/RLS/ACLs, function/guard
   identities, FK actions/indexes, retained original rows/privileges/material trigger,
   and normal appended Drizzle journal/ledger evidence.

The new SQL file is local preparation numbered after installed 0006. **No journal
entry or snapshot is fabricated locally.** Existing installed metadata prefix stays
byte-identical. The standard authorized Lovable migration tool must register the
actual forward migration/snapshot/ledger on installation and reconcile this prepared
filename/input; an ordinary journal-based runner currently does not discover 0007.
Do not bypass the standard lane, rerun histories or assume Git presence installs it.

Name-index actual comparison/collision evidence is an S2 gate, not a prerequisite
for installing these two empty tables. character_materials FK discrepancy remains
unresolved; no repair or additional request. No advisory lock code is added before
the authority exists; the P1-B request/account lock ordering remains its contract.

Before **eventual activation**, separately complete authoritative creation/version-0
initialization, sole-material-trigger assertions, manifest/digest identities, quota
serialization, name uniqueness, raw service/legacy writer containment, hard-delete
containment, controlled account/result purge integration, physical twelve-month
receipt expiry/admin projection, family rules and no-item combat integration.
This migration neither implements nor authorizes those packages. Receipt cleanup
is not operational merely because an expiry index and guard exist.

## Preserved state and next action

- Starting/synchronized/final local/remote SHA:
  `9489b991b3e4c4be5c443d2fa246d0382ca62c7e`; origin/main fetched, unchanged.
- Recorded-baseline ancestry: preserved. Recovery stash
  `0a5529d5227675319b166881b10f1c91edd7486b` unchanged.
- Worktree: intentionally dirty; existing design work plus local S1 migration/tests/docs.
- Migrations authored: this S1 file only. Migrations installed: **none by this task**.
- Cloud/gameplay operations: none. No Lovable request, hosted SQL or data access.
- Generated types, Edge deployment and frontend publication: unchanged; none performed.
- Next safe action: owner review of this exact local S1 artifact and retained hosted
  preconditions. No automatic installation, P2 authority work, commit or push.

F remains CLOSED / INSTALLED / VERIFIED / EDGE DEPLOYED / COMMANDS PAUSED /
FRONTEND NOT PUBLISHED under its accepted staged closure; all four limits remain:

```text
HOSTED MULTI-SESSION BEHAVIOR UNPROVEN
NATURAL RUNTIME PATH NOT YET OBSERVED
AUTHENTICATED COMMANDS-PAUSED RUNTIME PROBE NOT EXECUTED
RP EARNING AUTHORITY GAP
```

## Source checkpoint authorization — 2026-10-09

The owner subsequently authorized a scoped Git commit/push of this exact migration,
isolated tests, handoff, required P0/P1-A/P1-B planning documents and tracking files.
The preceding local implementation/worktree statements are that task's historical
checkpoint. The source-publication report supplies the resulting full commit SHA;
use that pushed checkpoint for any later separately authorized hosted preparation.

Reviewed SQL identity: SHA-256
`6eb30eedfab8544b1d80745c4b4a844323c9ec538c0441e23f578863d90b76cb`,
11,371 bytes. Verify the committed blob as well as the working file. No SQL change,
registration, installation, activation or frontend publication is authorized.

Registration readiness remains blocked locally: the established
[001C application procedure](progression-001C-lovable-application.md) says the
standard Lovable tool generates numbered SQL/journal metadata during atomic execution
and prohibits hand-editing the journal. B2 prohibits direct CLI lifecycle management.
No supported local registration-only procedure was found; 0007 remains a reviewed,
unregistered input for the standard tool. Existing 0000–0006 journal/snapshot chains
are verified and preserved, not expanded or repaired by this source checkpoint.

STOP after authorized source publication and report. Hosted preparation/execution
still requires separate authorization; no Lovable task is dispatched here.
