# P2-A local creation authority handoff

**LOCAL IMPLEMENTATION COMPLETE / NOT INSTALLED / OWNER-ONLY / NOT ACTIVATED.**

Primary contracts: [C2 blueprint](../design/progression-001G-C2-creation-blueprint.md),
[P1-B storage](../design/progression-001G-C2-P1-B-storage-proposal.md),
[initial manifest](../design/progression-001G-C2-P2-A-creation-manifest.md).
Affected engine: Progression and rewards / Resources and attributes / transactional
authority; ENG-PROGRESSION-001G. Approved gameplay rules and heartbeat unchanged.

## Scope and semantics

[Reviewed SQL](progression-001G-C2-P2-A-creation-authority.sql) stays outside migration
discovery. It introduces exactly one postgres-owned SECURITY DEFINER operation:
`public.character_create_c2_internal(uuid,text,text,text,uuid,text,text) RETURNS jsonb`.
Arguments: request UUID, display name, race, gender, optional target account, reason,
expected creation revision. No actor, stats, resources, class, family or item argument.
Fixed `search_path=pg_catalog,public,pg_temp`; explicit revocation of PUBLIC/browser/
service/default grantees and effective-access assertion. No wrapper, new table,
trigger, extension, service grant, old function replacement or frontend call.

Reviewed UTF8/LF SQL SHA256: 785ef260b90e5255ed37055aea29414a7b352c6bbced52f52cb53a12be071174, 15344 bytes.
Executed only in disposable local fixtures, not hosted Supabase.

Actor derives from auth.uid() and must exist. Delegate requires existing target,
Overlord membership and reason; role/account rows are held against concurrent deletion/
revocation. Service credentials alone are insufficient, and service_role cannot execute.
Only a future reviewed entry can establish verified caller context; this function's
owner may exercise it in isolated tests, not through a gameplay browser route.

At READ COMMITTED: request lock namespace173201(actor,request), then sorted/deduplicated
namespace173202 actor/target locks, then identity/role/log/catalog rows. UUID/digest
comparison uses real values, never lock hashes as identity. A fresh count after locks
includes every retained target character, no tombstone filter; >=5 refuses. This
serializes cooperating callers, not the still-permitted direct INSERT/legacy authority.
Controlled deletion/other cooperating commands must adopt compatible account ordering.

Payload-v1 SHA256 binds normalized choices, actor/target/mode/reason/expected revision.
Exact replay returns the same immutable initial result, even after catalog edits,
quota exhaustion or receipt-detail expiry. Changed intent conflicts. Purged replay
is terminal; inexplicably missing applied result refuses. Retired account identities
cannot authenticate. No replay creates, restores or grants again, and expired detail
is not rebuilt. No replay content exposes detailed admin receipt to gameplay callers.

All new writes are one function statement in the caller transaction: calculated
character INSERT, existing material trigger, exact-result checks, progression version0,
immutable origin, applied log. Reread the character to catch AFTER-trigger drift.
One server creation timestamp is used for character/origin/log; detail expiry is12
UTC calendar months. Any exception (including deferred commit constraint failure)
rolls back the caller transaction; no error handler returns misleading success.
State baseline matches the canonical projection, investments0/no milestones/no fake
progression receipt. Origin has actual inputs/values/four versions, no lifetime
actor/request/reason; private log contains delegated audit and retains minimal replay.
No retention maintenance or account deletion operation is added.

## Supplied hosted evidence and containment gates

The owner now confirms postgres-owned private origin/log, atomic definer write ability,
transactional starting-material trigger, and **no character_materials FK**. Treat these
as operator-reported, not independent Codex inspection; no repeat hosted audit occurred.
The prior FK omission ambiguity is resolved by this new supplied finding, not a repair.

Remaining explicit activation gates:

1. Legacy character_create still callable and service_role direct INSERT remain:
   bypass quota, provenance and this calculation. Contain in a separate coordinated cutover.
2. Materials lack FK and have broad direct grants currently restricted by RLS:
   separately contain writers and review cleanup/privacy behavior; do not silently
   add a FK/revoke historical grants here.
3. Active hard-delete must be contained before approved soft-delete/30-day restoration/
   controlled permanent deletion lifecycle is enabled. Origin RESTRICT protection is
   not a replacement lifecycle. No second deletion mechanism is implemented.
4. Receipt expiry/history projection and controlled actor/target account purge must
   obey installed replay/retention rules; delegated recipient origin survives creator
   deletion. Existing chars get no backfill or changes.
5. Public wrappers/adapters, UI, first real integration and multi-session behavior
   require separately scoped verification/authorization. Family and combat integration
   retain approved existing gates; no activation implied by installing an owner-only function.

O13 initial values and future Overlord-only revision approval are now approved.
No catalog publication framework is needed or added. New catalog values fail closed
until a reviewed Overlord-approved revision is installed prospectively.

## Local validation

[Exact-SQL tests](../../scripts/progression-001G-C2-P2-A-sql.test.mjs):21/21 pass on
PGlite0.3.14/PostgreSQL17.5. Tests use exact0007/0008, exact starting-material trigger,
canonical C functions and F fresh-state validator, with isolated dependency tables
and auth/role fixtures. Cover six races/display/empty inventory/materials, old data
preservation, default/inherited/private privileges, own/delegated refusal and audit,
payload conflicts, quota including simulated tombstones, catalog drift, name uniqueness,
rollback at five write boundaries, unexpected grants, expired history/purged replay,
READ COMMITTED requirement, and first canonical XP/F continuity. No secret/key material
is read or generated. Expiry/purge fixture manipulation is local-only test setup.
Existing storage regressions22/22, S2 regressions10/10 and project-state tests3/3
also pass; state generation/check, local documentation links and whitespace checks pass.

Queued competing calls share a single PGlite backend; lock lifetime is inspected,
but **two independent session contention is not proven**. No local postgres/psql/docker
executable was available; no external DB/runtime was installed. Keep this explicit
before integration; do not substitute queued tests for multi-session proof.

## Minimal future Lovable installation task — prepared, not dispatched

1. Require separate source publication and installation authorization. Current base
   `34ad8fe9d897d7691760798ff36f2e8bf97c8b29` plus uncommitted P2-A files is **not** a
   published installable checkpoint. Record exact reviewed SQL SHA256 before dispatch.
2. Use only the standard tool/B2 route; expected installed prefix0000–0008, preserve
   history and verify source/prefix/hash/current target. No Supabase history repair.
   Tool creates the next available numbered SQL/journal/snapshot; no prewritten collision.
3. Install only the exact reviewed P2-A SQL in one transaction. Dependencies:0007/0008,
   established creation/progression tables, role helper, gender enum, start config and
   sole material trigger. No creation invocation, catalog/data repair or gameplay write.
   Preflight assertions must pass; existing namespace conflict or any unreviewed delta
   means STOP. Advisory namespaces173201/173202 remain reserved for this family of commands.
   Confirm no competing installed lock protocol uses those namespaces before installation.
4. Inspect automatic source commits after success or failure. On success verify installed
   history/hash/journal/snapshot, single exact seven-argument identity, postgres ownership,
   VOLATILE SECURITY DEFINER/fixed search_path, effective owner-only EXECUTE, derived types,
   unchanged old ACLs/functions/material trigger and persistent data. No frontend/Edge action.
5. Stop on dependency, hash, privilege or prefix mismatch; no fallback runner or automatic
   history repair. Installation does not grant any application entry or activate creation.

Recovery stash unchanged. Preserve F CLOSED / INSTALLED / VERIFIED / EDGE DEPLOYED /
COMMANDS PAUSED / FRONTEND NOT PUBLISHED and:

```text
HOSTED MULTI-SESSION BEHAVIOR UNPROVEN
NATURAL RUNTIME PATH NOT YET OBSERVED
AUTHENTICATED COMMANDS-PAUSED RUNTIME PROBE NOT EXECUTED
RP EARNING AUTHORITY GAP
```

STOP after local implementation/validation. No hosted SQL, migration execution,
deployment, frontend activation/publication, existing-character changes, commit or push.
