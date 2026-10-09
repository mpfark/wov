# ENG-PROGRESSION-001G-C2-P2-A — prerequisite review

**PRECONDITIONS NOT ESTABLISHED / CREATION OPERATION NOT IMPLEMENTED.**

Historical review above: subsequently superseded by the owner's supplied dependency
facts, initial-value approval and Overlord-only future revision approval. See the
[completed local P2-A handoff](progression-001G-C2-P2-A-local-creation-handoff.md).
The original prerequisite findings below remain historical evidence.

Owner authorizes local P2-A implementation, not installation or activation. The task
also requires verification of installed definitions/privileges/dependencies and
explicit approved creation/catalog/formula versions before implementation. Those
requirements are not satisfied by the evidence currently supplied. This report
isolates completed local verification; no new policy or catalog revision is invented.
Affected engine sections: Progression and rewards / Resources and attributes /
transactional authority; ENG-PROGRESSION-001G. No engine or heartbeat rule changed.

## Completed local verification

- Clean source fast-forwarded from `f97b2a446c590298583aa73b5e67fbe65e4a25c3`
  to `34ad8fe9d897d7691760798ff36f2e8bf97c8b29`, equal to fetched origin/main.
  Only new 0008 SQL/journal/snapshot arrived; existing history was preserved.
- Committed [0007 storage](../../drizzle/migrations/0007_progression_001g_c2_private_creation_storage.sql)
  matches reviewed SHA256
  `6eb30eedfab8544b1d80745c4b4a844323c9ec538c0441e23f578863d90b76cb`.
  It supplies the two private origin/log tables, independent version labels,
  applied snapshot, request binding and retention/lifecycle guards.
- Committed [0008 name identity](../../drizzle/migrations/0008_progression_001g_c2_s2_name_identity.sql)
  matches reviewed SHA256
  `d6c53867de0c1a0503ce8fc41f75acc73370908d1a66df9d8dc4ca36c5fbc510`.
  Journal has idx8 after idx7; source identity is not a current hosted ACL/catalog dump.
  The user describes 0007/0008 as installed; this is operator-reported evidence.
- The [approved blueprint](../design/progression-001G-C2-creation-blueprint.md#4-transaction-calculation-and-replay-architecture-p)
  defines base8, L1/XP0/gold200, classless Wayfarer, calculated full resources and
  empty equipment/inventory. Its six-race resource vectors are explicitly source-derived,
  not permission to hardcode current mutable race values.
- [Creation source](../../supabase/migrations/20260908175256_2e41c1c0-9b14-40a2-9627-68f6cf7dbc2b.sql#L18)
  derives identity/start location but accepts client stats and retains the old class
  enum cast; it is not an approved authority to reuse.
- [Canonical creation helper](../../src/lib/game-data.ts#L68) uses base8;
  [resource formulas](../../src/shared/formulas/resources.ts) and the blueprint
  agree on L1 resource arithmetic. [Race registry](../../src/shared/formulas/races.ts)
  explicitly identifies its constants as fallback defaults replaced by mutable DB rows.
- [Starting-material trigger](../../supabase/migrations/20260803232302_acc7c4e5-4148-48c0-8f35-8c2299e23944.sql#L1)
  grants salvage40 and six gems1 with conflict handling. Source is inspected, not invoked.
- [Overlord source](../../supabase/migrations/20260215091228_fce1ea0c-a649-4361-959e-c677e1011267.sql#L9)
  derives membership through auth.uid()/has_role. [Version0 schema](../../drizzle/migrations/0001_progression_001c_dormant_authority.sql#L6)
  provides opaque_baseline and six invested counters; no creation receipt should be
  forged into progression_receipt. Generated types do not prove effective privileges.

## Actual prerequisite gaps

1. **Approved initial manifest absent.** [O13](../design/progression-001G-B-admin-policy.md)
   leaves catalog validation/publication authority undecided; the
   [next implementation plan](../design/progression-001G-C2-next-implementation-preparation.md)
   recommends reviewed version constants and fail-closed catalog drift, but supplies
   no approved manifest with actual race/class inputs and four version identities.
   Request the approved initial manifest, or owner approval of an explicit candidate
   before binding it as authoritative. Future catalog-publication machinery need not
   be designed now. Do not silently adopt current rows or UI fallbacks as approved.
2. **Required installed dependency verification absent.** No current hosted metadata
   report for the exact character/catalog/material/inventory/progression definitions,
   insert triggers, starting config, role helpers/effective privileges and advisory
   namespace use was supplied with P2-A. 0007/0008 source and installation reports
   establish narrower facts. Obtain the existing safe report if available; Codex
   cannot query hosted DB under this task. Do not infer installed state from historical
   Supabase migrations or derived type declarations.

The unresolved materials FK is **not proof of a missing FK** and does not by itself
prevent a local transaction from relying on the trigger and asserting its output.
Its actual constraints remain a deletion/lifecycle installation gate; no repair proposed.
[Hard-delete source](../../supabase/migrations/20260623072204_ba238bbb-a55c-4000-8b35-69eb36bb3cba.sql#L1)
allows owner/Steward/Overlord and deletes dependent rows before characters. The
installed origin's RESTRICT FK would refuse character deletion unless origin is
explicitly removed; that is protection, not a soft-delete/restore lifecycle. Actual
reachability remains unverified. Do not alter deletion or add a second mechanism.
Hard-delete and raw INSERT containment are activation gates, not permission to
redefine the approved lifecycle in P2-A.

## Implementation boundary after prerequisites

Retain the already-approved one-private-function plan, not a redesign: request lock
173201 then sorted/deduplicated actor/target account locks173202; revalidate identity
and Overlord delegation/reason; compare payload-v1 digest before quota/catalog reads;
replay without grants, reject conflicts/purged recreation; count every retained target
character at READ COMMITTED before INSERT; calculate from approved pinned inputs;
single canonical character INSERT, sole materials trigger, version0 state, immutable
origin and applied creation log in one transaction. Any failed substep rolls back all.
Owner-only fixed-search-path function; no public/service EXECUTE or client activation.
No creation operation, new SQL artifact or database object was prepared in this review.

Future P2-A tests must exercise actual creation/replay/conflict/quota/delegation,
first progression continuity and every-substep rollback against pinned dependencies.
Two-session quota/replay/name contenders require a suitable disposable PostgreSQL
fixture; serial PGlite tests must not be labelled proof of contention. Existing S2
tests pass10/10; they are name-index regression checks, **not P2-A tests**.

## Handoff / stop

- Final local/remote source: `34ad8fe9d897d7691760798ff36f2e8bf97c8b29`.
- Local changes: this report and project-state JSON/generated MD/roadmap tracking.
- Recovery stash unchanged: `0a5529d5227675319b166881b10f1c91edd7486b`.
- No authored/installed P2-A migration, RPC, gameplay write, hosted inspection,
  deletion change, deployment, frontend activation/publication, commit or push.
- Next action: supply approved initial manifest and installed dependency evidence;
  resume the already-authorized local implementation after these prerequisites pass.

Preserve F CLOSED / INSTALLED / VERIFIED / EDGE DEPLOYED / COMMANDS PAUSED /
FRONTEND NOT PUBLISHED and all four accepted limitations:

```text
HOSTED MULTI-SESSION BEHAVIOR UNPROVEN
NATURAL RUNTIME PATH NOT YET OBSERVED
AUTHENTICATED COMMANDS-PAUSED RUNTIME PROBE NOT EXECUTED
RP EARNING AUTHORITY GAP
```
