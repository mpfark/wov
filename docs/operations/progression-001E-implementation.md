# ENG-PROGRESSION-001E — Local implementation and prepared cutover

**CURRENT (operator-reported): CLOSED / INSTALLED / VERIFIED / EDGE DEPLOYED / TRAINER-ORDER COMMANDS PAUSED / FRONTEND NOT PUBLISHED.**

2026-10-07 [Closure reconciliation](progression-001E-close.md): canonical R2 XP body
installed and independently verified by operator; reviewed progression-command deployed.
Missing historical 0004 final newline and absent Edge revision ID are recorded.
Authenticated paused runtime probe was not executed; natural runtime and hosted
multi-session behavior remain unproven. Earlier R2/R1 preparation below is historical.

2026-10-07 R2: [Exact XP body forward repair prepared](progression-001E-R2-reconciliation.md).
The second R1 attempt installed with one extra leading space on line340; containment
passed and character fingerprint was unchanged. R2 is prepared only; no hosted work
or deployment is authorized. The earlier preparation and R1 account below is historical.

2026-10-07 R1: **RECONCILED LOCALLY / READY FOR HOSTED INSTALL RETRY**. The first
hosted attempt fully rolled back at the over-broad final sidecar assertion; no
installation or Edge deployment remained after that first attempt. The [R1 reconciliation](progression-001E-R1-reconciliation.md)
records supplied evidence, the precise repaired invariant and current acceptance.
Hosted retry is not authorized by the local R1 task.

Prepared 2026-10-06 from task_start_sha / synchronized origin/main
`fc370869cc38696ebe1e5caf4d25ac57d47892d5`. Supplied hosted preflight is reconciled
in the [audit](progression-001E-audit.md) and [plan](progression-001E-plan.md).
Codex performed local work only. No Lovable/hosted Supabase access, Edge deployment,
activation, frontend publication or 001F/G/H implementation occurred.

Affected specification: Progression and rewards, especially class growth,
Resources/provenance/trainer and transactional authority. Roadmap ID:
ENG-PROGRESSION-001E. Accepted XP thresholds, destination growth, resource formulas,
leaving cost and one authoritative world heartbeat are preserved. Safe respec's
stance decision remains 001F; no automatic stance cleanup is introduced.

## Exact DB release artifact

Historical prepared release (now installed with the documented one-space deviation;
do not replay). The original handoff required one atomic standard Lovable Drizzle transaction to apply
[progression-001E-cutover.sql](progression-001E-cutover.sql).

| Identity | SHA-256 | UTF-8 bytes | LF lines |
|---|---|---:|---:|
| Current R1 prepared payload | `734e6a1934372b548003e0336b9207998f6da8de01057e66ad63ef5950569b40` | 41,673 | 461 |
| Historical first attempt, fully rolled back | `175d0c15c0f82a79c9682e0dca01c17f360eff88ab48fcf9fd0fedd650930266` | 40,840 | 451 |

The [release manifest](progression-001E-manifest.json) pins every SQL/generator,
Edge/shared handler, config and affected browser source hash/bytes/lines. Explicit
`.gitattributes` entries preserve LF release bytes across checkouts. Generate with
`node scripts/prepare-progression-001E.mjs --write`; verify with `--check`.
Check compares raw SQL bytes, all release source endings and the complete manifest.
No numbered migration, journal, snapshot or frozen historical migration was changed.

Pre-install guards check exact normalized dependency body SHA-256, input names,
return type, volatility, postgres ownership, SECURITY DEFINER and search_path for
the five 001C primitives plus five legacy Order/bond/Renown functions. They reject
unexpected overloads, object collisions, receipt-check drift, sidecar/RLS/private
ACL drift, ordinary character UPDATE or ordinary bond write policies. Both accepted
character trigger definitions are guarded by supplied full pg_get_functiondef
hashes. Local full-definition legacy hashes match all five supplied abbreviations.
Final assertions check effective private/legacy/narrow-command/table privileges,
including custom ordinary inheritance, and disabled command control. R1 separates
owner-only direct table/column ACLs from effective gameplay access. Known anon,
authenticated and service_role principals are never exempt. Other roles with
superuser/BYPASSRLS attributes or effective global read/write authority are classified
by metadata, not platform names; ordinary inherited access still fails. Explicit
nonowner ACLs fail for authority roles too. Global read/write authority alone does
not bypass RLS. The specific role matching the first hosted failure is unknown.

Installation creates schema/functions/ACLs and one disabled singleton control row;
it never initializes players, updates character data or invokes gameplay functions.
The XP extension records proof when the already-authorized 001D path subsequently
awards XP. Fresh trainer/Order commands remain paused until separately authorized
activation; replay remains possible after a later pause.

## Milestone and XP authority

`progression_class_growth_milestone` has exactly:

- character_id UUID, FK to existing state with character deletion cascade;
- destination_level integer, restricted to 3,6,...42;
- class_key text and is_classless boolean, consistent with classless identity;
- applied_deltas JSONB, exactly six normalized nonnegative integer stats;
- config_fingerprint text, canonical SHA-256;
- source text and event_id UUID, deferred composite FK to the legitimate receipt;
- primary key `(character_id,destination_level)`.

There is no mutable class FK, timestamp-dependent identity or backfill. Classless
deltas must be six zeros. A deferred private constraint trigger checks that the
linked receipt is XP, contains the destination, and captures the exact class/flag,
fingerprint and normalized per-destination deltas. Postgres owns the table, RLS is
enabled with no policies, and no nonowner gameplay role has table access.

The generator extends only `progression_apply_xp_internal`: the existing captured
config, level loop, aggregate growth, points/tokens and resource semantics remain.
Each newly crossed multiple of three inserts one row, including zero classless
decisions. Same-event replay returns before mutation. A distinct event re-crossing
a destination proven by a milestone OR a prior canonical XP receipt raises
`class_growth_destination_conflict`, rolling back the entire XP/reward transaction.
No ON CONFLICT skip, retroactive catch-up or independent growth command exists.
Semantic config equivalence keeps the fingerprint stable; edits affect future
events only. Invalid config and later Combat2 failures leave no partial proof.

## Narrow trainer and Order transaction

Service-only signature:

```sql
progression_command(_character uuid, _actor uuid, _request uuid,
  _expected_version numeric, _operation text,
  _allocations jsonb DEFAULT NULL, _target_class text DEFAULT NULL)
```

Allowed operations are allocate/join/switch. The server supplies verified actor;
SQL requires that actor owns the character and refuses any non-null browser JWT
context. Character/request IDs, safe nonnegative integer expected version, payload
shape and integer ranges are validated. Source, metadata, rewards, negative deltas
and resource/refill flags cannot be selected by the caller.

Lock order is **initial acting-node advisory → acting character FOR UPDATE** using
the existing `combat_enter_node:` namespace. Re-read current_node_id after locking;
location_changed refuses without taking a second node or encounter lock. Replay
checks precede fresh version/location/config/lifecycle/activation checks after owner
verification. No encounter lock is acquired by these commands.

Fresh requests require exact version, canonical level/XP/class flag, nonnegative
stats/resources/pools, valid maxima, counters no greater than materialized stats,
and receipt/counter coherence with existing proven version. Alive is HP>0. Unsafe
means active canonical stance, pending stance request/node intent, queued/finalizing
solo or party departure, movement timer, legacy combat session, or a linked live
Combat2 claim / present fighter with an active encounter and living positive-HP
engaged creature. An inert active-status encounter shell alone is safe.

Allocation additionally requires an authoritative trainer node and enough U.
Unknown/null/negative/fractional stats and zero total refuse. Absent keys normalize
to zero; explicit zeros are valid only within a positive batch. The private existing
discretionary primitive atomically increases S and matching I, spends U, increments
version, captures a permanent receipt and synchronizes resources. It preserves
class/bonds/XP/tokens. Counters and opaque baseline are reused, never reset or inferred.

JOIN requires classless; SWITCH requires classed and a different target. A fresh
same-class request returns already_in_order; mismatched operation returns
wrong_operation. Current node must have target class_hall. Target configuration
is share-locked, active/selectable/non-pre-class and validated. Both operations
change class/flag, intentionally delete old bonds and initialize target bond0,
synchronize resources, increment version and insert operation='order' receipt.
No attributes, points, tokens, catch-up or growth rows are granted. Equipment,
ability-role/loadout history, old receipts/milestones and permanent growth survive.
Active stances refuse; they are never cleared or refunded.

Resource policy for allocation and Order change is canonical private sync with
fixed refill=false: derived HP/CP/MP maxima reflect class/stats/equipment; current
resources are preserved or clamped down, never healed/refilled. Dead requests
refuse. AC is never persisted by these commands. Existing XP level-up refill
semantics remain unchanged, including dead HP preservation.

Allocation keeps source='discretionary_allocation', operation='permanent' and
normalized existing request identity with verified actor metadata. Order uses
fixed source='order_command', receipt operation='order', narrow join/switch request.
Receipts record request/expected version, actor, before/after versions and progression,
investment/resource/config evidence; Order also captures before/after class/bonds.
Identical UUID+normalized payload replays without another spend, even after location,
version, activation or config changes. Changed payload/version/operation under an
accepted identity returns request_conflict. A fresh stale request returns stale_state.
Transient refusals have no durable successful receipt. PL/pgSQL's outer exception
block rolls all mutation back before returning invalid_transaction.

## Prepared Edge and browser

The prepared `progression-command` Edge verifies JWT using auth.getClaims, derives
actor from the verified subject, and invokes only the narrow SQL command with a
service client. It never forwards the owner JWT to SQL, clears auth context, sets
trusted_rpc, accepts body actor/source/metadata, or exposes private primitives.
The SDK HTTPS import is pinned to locally typechecked Supabase JS 2.116.0.
verify_jwt=false in local function config delegates verification to the explicit
handler, following the existing accepted mechanism. No browser service secret.

Body: characterId/requestId/expectedVersion plus allocations OR operation+targetClass.
Unknown/malformed fields reject. HTTP 401/400/405 distinguish auth/input/method;
structured SQL refusals use JSON kind=refused. Uncertain transport returns 503 and
cannot be treated as success. The authenticated read RPC
`progression_command_projection(uuid)` owner-filters a selected current projection
and version; it creates no state. Private read helper remains owner-only.

Browser callers replace generic UPDATE+public sync and old Order RPCs. Requests
persist in sessionStorage before sending; uncertain retry keeps UUID/version/payload
through remount and cannot replace choices. A per-character in-flight guard prevents
overlapping panels from replacing the pending request identity. Planner rehydrates
pending allocation, awaits acknowledgment, disables duplicate submission, keeps plan on unconfirmed
failure and clears only after confirmed commit/replay. Confirmed resources are
refetched; failed refresh logs that commit succeeded, preventing a second spend.
No optimistic permanent update or false success log. Order correctly chooses JOIN
for classless and SWITCH for classed; pending Order retry remains accessible even
after current class/hall changes and awaits character reconciliation.

Official Cloud-generated types remain unchanged; the uninstalled read RPC uses a
narrow local boundary cast. Supabase type regeneration belongs to authorized
installation and must not imply deployment/publication. Deno Edge serving/auth/RPC
were not executed against hosted services; pure handler tests and SDK-backed strict
local typechecking establish only the prepared source boundary.

## Legacy and temporary containment decisions

Old join_order/switch_order plus both bond helpers and train_renown_stat lose
PUBLIC/anon/authenticated/service_role and all custom default/inherited nonowner
EXECUTE in the same atomic payload. Owner/postgres bodies remain intact, with no
compatibility wrappers. Ordinary character progression UPDATE grants stay closed.
Bond table broad grants are retained with read-only ordinary RLS; negative tests
deny direct upsert and helper calls.

Dependency proof: no runtime src/Edge caller invokes either bond helper. Generated
types and formula comments merely describe them. Historical legacy commit/catchup
SQL calls award_class_bond_for_kill→award_class_bond, but the connected transferred
five-layer 001D authority has neither helper call, and those legacy entries are
already owner-only. Owner SECURITY DEFINER composition retains capability after
revocation; no proven connected server requirement loses access.

Renown decision: **unsafe to leave reachable**. Its legacy stat/resource write
does not advance canonical version or receipt and can invalidate provenance.
Smallest temporary fence is owner-only EXECUTE plus unavailable trainer Renown UI.
Training remains unavailable until 001F; no Renown roll/spend redesign implemented.
Full respec is also unavailable, without guessed refund.

Admin decision: **technical boundary A**. Existing set-level/update-character/
reset-stats and grant-respec service DML can invalidate proven state or tokens.
An additive SECURITY INVOKER BEFORE UPDATE trigger rejects any non-postgres change
to stats, level/XP, class/flag, U or respec_points. Owner-internal canonical functions
execute as postgres and continue; tested service direct UPDATE fails. This covers
dangerous field changes rather than broad admin disablement; resource-only/gold/
preference/location updates and creation INSERT remain outside this narrow fence.
Accepted creation function and both old trigger bodies remain untouched. Direct
postgres/superuser repair remains explicit privileged database authority, never
canonical history; ordinary runtime has no exception. Actual reconciliation is G.
Crafting/ordinary grant-xp pauses and all 001D ACL fences remain unchanged.

## Local verification

Pinned embedded engine: PGlite 0.3.14 from existing external local test tooling.
No network DB connection mode exists. Commands run with Node because npm executable
is absent; they are equivalent to the repository scripts.

| Check | Result |
|---|---|
| New pure Edge/browser/React boundary tests | 27 pass,0 fail |
| Focused progression/reference/class registry/validation/config UI/loadout/Combat2 ownership, entry, stance/resource suites | 252 pass,0 fail (includes new 27) |
| Full generated E SQL / existing trigger hashes / allocation, Order, growth, lifecycle, rollback, effective ACL, deterministic lock interleaving | 22 pass,0 fail |
| Actual five-layer Combat2 after full E payload install, including accepted triggers/raw fence, later failures and growth collision | 11 pass,0 fail |
| Existing 001C SQL | 16 pass,0 fail |
| Existing 001D integration / containment | 9 / 6 pass,0 fail |
| Root/app/node typechecks; strict isolated Edge typecheck against installed SDK | pass |
| Production Vite build | pass; existing chunk-size warning retained |
| Full suite pre-change | 2,703 pass,18 fail |
| Full suite final | 2,730 pass,18 fail; identical failed test identities, no new/resolved failure |
| E exact generator/manifest, unchanged D generator, state generator/check/tests, whitespace | pass |

Full-suite baseline failures remain in combat shell/static purity/catchup scope,
Test Arena formatting, region/connection SQL assertions, effect/Edge mirrors,
departure SQL assertions and legacy historical-state contract. No unrelated repair.
Raw baseline/final JSON and logs are retained outside Git under
`../001C-local-db-tests/E-*`; compare test identities, not only totals.

The only changed existing assertion is 001C's dormant source-caller scan: it now
excludes exactly the official generated `src/integrations/supabase/types.ts`, since
private RPC declarations are not executable callers. All executable source and
Edge caller checks remain. No baseline assertion was relaxed to accept a writer.
The E Combat2 test reuses the unchanged D harness, installs the full guarded E
payload and adds growth to its rollback snapshot; the original D script is unchanged. Test/build-generated unrelated MCP
bundle and two platform-sensitive snapshots were restored to the starting bytes.

Deterministic competition is PGlite-serialized, and changed-location injection
checks the revalidation branch plus single-lock source discipline. This is not
true two-session lock contention, production full-schema/arrival-trigger execution
or deployed Edge/browser gameplay evidence. No claim that a naturally dispatched
hosted tick was observed. Retain **NATURAL RUNTIME PATH NOT YET OBSERVED** and
**HOSTED MULTI-SESSION BEHAVIOR UNPROVEN**.

## Separately authorized hosted installation order

Recommended exact next task: **ENG-PROGRESSION-001E-INSTALL — verify reviewed hashes,
install one atomic standard Drizzle migration, deploy only progression-command,
and perform post-install verification; keep trainer/Order activation and frontend
publication separate.** This recommendation is not present authorization.

1. Verify the pinned Git checkpoint and complete release manifest; obtain fresh
   narrow dependency/ACL/operational evidence. Use normal maintenance controls and
   ensure no conflicting command/arrival/stance/departure/claim activity during
   installation. Do not infer current hosted conditions from this report.
2. Use the standard Lovable Drizzle lane to install exactly the reviewed payload
   once in one tool transaction. Its guards/final assertions must all pass. Any
   dependency/security drift aborts the entire transaction; do not strip guards,
   patch frozen migrations, split revokes, or silently substitute source. Preserve
   migration tool output/ledger/hash evidence and existing player/world fingerprints.
3. Verify install ledger/payload hash, replacement XP security/body, new private
   relation/constraint/receipt model, unchanged creation/accepted triggers/C private
   primitives, effective old Order/bond/Renown denials, raw-write fence and existing
   D/crafting denials. Check no eager state/milestone initialization and disabled
   command control. Installation verification invokes no successful gameplay mutation.
4. Deploy only the manifest-reviewed Edge entry/shared handler and config, after
   old writer revocation is proven. Verify authenticated subject derivation,
   malformed/forged-body rejection, service-only SQL and paused fresh command
   response. Regenerate official types through the standard authorized lane and
   reconcile any generated source/tool output separately. Do not deploy admin/craft
   or alter schedules/world wake behavior as part of this task.
5. Report **INSTALLED / VERIFIED / EDGE DEPLOYED / TRAINER-ORDER COMMANDS PAUSED**
   with exact evidence; stop. Existing D XP may record new forward proof after its
   normal runtime resumes. A later explicit task controls trainer/Order activation;
   Mik alone controls manual frontend publication. Do not auto-publish or treat
   Git push as frontend release. No F/G/H implementation follows automatically.

DB-first is fail-closed: legacy callers become unavailable while new fresh commands
remain paused. Edge/browser first could leave old direct Order/Renown writers
reachable beside a new authority. Use the atomic DB fence before Edge deployment;
the frontend source is prepared, not published by this Git checkpoint.

## Git and state handoff

Starting/synchronized SHA is stated above; recorded prior state baseline
`5437da1a8a1f6b424c0eeafcf204ae8ae986e1c8` is a verified ancestor. Final commit and
HEAD/origin/main equality are reported in the delivery message, avoiding a
self-referential commit hash in its own source. Normal main commit/push only;
recovery stash `0a5529d5227675319b166881b10f1c91edd7486b` is retained unchanged.
Project state records local preparation and supplied preflight separately from
installed/deployed/published state; current E source is not claimed hosted active.

Changed files: `.gitattributes`; engine specification/roadmap; E audit/plan/report/
SQL/manifest; project-state JSON/generated Markdown; E generator/command fragment/
SQL and Combat2 tests/Edge type declarations; one narrow C assertion; new browser
command/client tests; allocation hook, planner/trainer/Order components and GamePage;
Edge entry/shared handler and function config. Official types, old migrations,
creation, admin handlers and D payload are unchanged. No unresolved local authority,
lock or containment blocker remains; retained hosted/runtime limits are above.

**STOP. No installation, activation or publication is authorized by this report.**
