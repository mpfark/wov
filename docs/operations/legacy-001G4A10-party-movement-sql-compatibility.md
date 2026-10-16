# ENG-LEGACY-001G4A10 — Party movement SQL compatibility

2026-10-16. Starting/fetched checkpoint `d5d92f2b27a96dfda41105ce178ab576aeb07978`. **LOCAL / NON-DEPLOYABLE.** Bounded follow-up to [G4A9-R1](legacy-001G4A9-movement-party-coverage-integration.md#result-and-new-compatibility-finding). No production function, migration/history, runtime, grant, application, scheduler, hosted state or deployment changed. Rules in [Movement and party movement](../design/game-engine.md#movement-and-party-movement) and the [future creature HP contract](../design/game-engine.md#approved-future-creature-hp-contract--not-implemented) are preserved; no new balance or party decision.

**Recommendation: CORRECTION REQUIRED for the reviewed source to give deterministic member-result semantics.** Installation applicability is conditional on fresh installed parity; no hosted defect is asserted. G4A9-R1 remains **OPEN — local candidate validated, production disposition/installation outstanding**. NO-GO for hosted installation or direct promotion of this fixture artifact.

## Exact evidence and ambiguity

Identity: `public.combat2_party_depart_without_canary_gate(uuid,uuid,uuid)`, arguments `_leader_character_id`, `_destination_node_id`, `_request_id`, JSONB result. Closest complete composed definition is the exact `requested_identity` in the unchanged [F5 archive](legacy-001F5-party-parity-envelope.json). Its declaration line8 includes `cost integer`; line115 contains the terminal result aggregate; lines118–119 catch unique violations and all other errors. These line numbers are **within the archived function definition**, not the one-line JSON container.

The originating [party migration](../../supabase/migrations/20260908122530_e728cbda-72d0-415c-96bf-a8758fe327ac.sql) declares `cost` at line96 and aggregates at line175. The archived composition additionally contains the [immediate-movement patches](../../supabase/migrations/20260929100000_combat2_immediate_authoritative_departure.sql), lines53–205, including encounter prelocking/frozen movers. This task reuses that composition; it does not replay migration patches against production.

The ambiguous expression is `'cost',cost` in:

```sql
SELECT jsonb_agg(jsonb_build_object(
  'character_id',character_id,'display_name',display_name,
  'order',movement_order,'status',status,'cost',cost
) ORDER BY movement_order)
INTO outcomes FROM public.combat2_party_departure_member
WHERE request_id=_request_id;
```

The same identifier names both the PL/pgSQL scalar and member-table column. CREATE FUNCTION succeeds locally; the error occurs when that SQL statement is planned/executed. The unchanged normal function catches the underlying42702 and returns `{"ok":false,"kind":"party_movement_failed"}`, rolling its internal writes back. A separately labeled diagnostic variant replaces only that catch-all RETURN with RAISE, exposing **SQLSTATE42702, `column reference "cost" is ambiguous`**. That diagnostic is not the candidate or a proposed change to the normal refusal contract.

### Other references inspected in the same function

| Occurrence, archived relative lines | Interpretation |
|---|---|
| `cost:=...` / MP validation,75–76 and90 | Intentional calculated scalar per mover, unchanged. |
| Member INSERT values,92; child request values,95–96; event payload,99 | Intended current scalar values. INSERT target-column lists name table columns by syntax; they are not ambiguous expression lookups. |
| `mp=mp-mover.cost`,107 | Already explicit member-record field; actual MP deduction is independent of the terminal ambiguous result. |
| Terminal aggregate,115 | SQL FROM relation and scalar both expose `cost`: confirmed collision. Other selected columns (`character_id`, `display_name`, `movement_order`, `status`, `request_id`) do not name declared scalars in this reviewed body, but are also explicitly qualified by the candidate. |
| Row variables `leader`, `p`, `mover`, `fighter`, `prior`, `encounter`; other scalars | Inspected uses are record-qualified fields, PL/pgSQL targets, or distinct names (`caller` versus `caller_id`, `_request_id` versus `request_id`). No other comparable expression/column ambiguity was found in the inspected body/known schema. This is not a guarantee against unknown installed schema/body drift. |

## Explicit compiler-setting experiments

The [native evidence](evidence/legacy-001G4A10-party-compatibility-postgres.txt) records **23 PASS, zero skipped**, PostgreSQL18.6 on Windows:20 sequential tests and3 independently connected, lock-observed session cases. Every case starts in a fresh disposable database; global settings are explicitly assigned before redefining/calling the target. READ COMMITTED is explicitly configured locally, not inferred for hosted callers.

Fixtures give the leader cost5 and follower cost8 using the existing capacity/weight formula (13 ordinary item rows in the follower's bag). Both start with100MP. This distinguishes real per-member costs from accidentally repeated scalar values without changing any formula.

| Original setting / experiment | Observed local outcome |
|---|---|
| Global `error` | Normal structured `party_movement_failed`, no movement/MP/request or HP accounting survives; diagnostic reveals42702. |
| Global `use_column` | Movement succeeds; result costs follower8/leader5; MP92/95. |
| Global `use_variable` | Movement and MP92/95 are correct, but terminal response repeats the last scalar cost5 for both members. Thus changing a setting to avoid refusal is not an equivalent correction. |
| Global `error`, function SET `use_column` | Original succeeds with correct member costs; caller setting restores to `error` after return. |
| Global `use_column`, function SET `error` | Original refuses as above. |
| Global `use_column`, function SET `use_variable` | Original succeeds with incorrect follower result cost5. |
| Inline `#variable_conflict use_variable` with global `error` and function SET `use_column` | Directive wins in this local test; incorrect follower result cost5. Candidate source guard rejects that altered body. No directive is added by the correction. |
| Compile/call under `use_column`, later SET `error` in the same backend | Previously compiled original still succeeds with column semantics; replacing the original definition then reproduces refusal under `error`. A later session-setting observation does not establish a cached function's compilation semantics. |
| Corrected body under each global mode, and with function SET `use_variable` | Correct result follower8/leader5, MP92/95. Existing function setting is retained, not overridden. |

No server/role default or function setting is changed as a proposed workaround. SET/ALTER commands above are disposable fixture experiments only. These are local PostgreSQL18.6 results, not PostgreSQL17.6 hosted execution or independent hosted sessions.

## Minimal isolated correction and preservation proof

[Candidate](../../scripts/proofs/g4a10/candidate.sql), SHA256 **`6b32214dd250d9128f1f67ae1b07ba0104e97ba971b41c0bd84567d0ba7a3159`** over repository LF bytes. One DO operation, restricted to `g4a6_fixture_g4a10_%` plus the existing fixture marker and exact private fixture signature. It cannot target `public` or act as a production migration. It obtains the existing definition and changes only the terminal aggregate to alias the member table as `m` and qualify member-result columns, ORDER BY and request column:

```sql
SELECT jsonb_agg(jsonb_build_object(
  'character_id',m.character_id,'display_name',m.display_name,
  'order',m.movement_order,'status',m.status,'cost',m.cost
) ORDER BY m.movement_order)
INTO outcomes FROM public.combat2_party_departure_member m
WHERE m.request_id=_request_id;
```

The example shows the intended source identity; executable candidate operates **only in g4a6 fixture namespace**. It copies no maintained full function body and adds no grant/helper/table. Exact pre-body SHA guards the one replacement boundary. The post-body must equal G4A9's already qualified source adapter byte-for-byte. Entire `pg_proc` metadata excluding only `prosrc` must remain equal: OID, signature/argument names, return type, owner, security mode, volatility, search path, function settings, ACL/grant options and other catalog attributes.

Local pre/post adapted `prosrc` hashes are `e63e6cedb61b36ae2553fc15d7c3784e95512aa467c8f09e7b2f41fda95183ca` → `954b8ca828392f285e9f5c3e676fae184c6ab2545c2248cfa80a3d96db97ae14`. These are **fixture** hashes after namespace/clock/Auth substitution, not installed fingerprints. Source drift, unexpected compiler directive and repeated application fail atomically. Tests also preserve explicit local server EXECUTE/grant option, deny the local client, retain SECURITY DEFINER/function settings in a metadata case and leave the complete effective F6 `party_mutate` definition unchanged on every candidate application. Those role experiments do not prove hosted effective privileges.

Movement costs/deductions, frozen mover discovery, follower/leader order, all locks, UUID derivation/replay, transaction boundaries, JSON keys and error handlers remain unchanged. Corrected successful JSON is exactly equal to original `use_column` behavior; it intentionally fixes the incorrectly reported scalar cost under `use_variable`, without changing actual deductions. Refusal/insufficientMP JSON and rollback match the original unambiguous interpretation.

## Regression scope and source fidelity

[Harness](../../scripts/proofs/g4a10/postgres.test.mjs) uses unchanged G4A6–G4A9 fixtures/extractors/adapters, restores the original target, then applies the new guarded DO candidate. Source pins and historical F9 normalized F6 body check remain active. No prior proof/evidence is rewritten. Tests exercise original/corrected settings, function/inline/cached behavior, drift/reapply guards, full metadata/ACL preservation, solo movement, queued leader/waiting follower, request identity/replay/conflict, insufficientMP rollback and complete response shape.

Three actual session cases use observer `pg_blocking_pids` and ungranted advisory-lock evidence, not sleep-only assumptions: corrected coordinated movement versus regeneration (explicit40001 coverage retry, coherent45HP), unchanged F6 stop-following versus movement (fresh frozen mover set), and corrected coordinated departure versus stale Combat2 commit (old claim refused,40HP retained). The before/after F6 definition is unchanged; the candidate contains no lock addition or movement-body edit. This does not prove global deadlock freedom or hosted concurrency.

The [G4A9 fidelity limits](legacy-001G4A9-movement-party-coverage-integration.md#executed-body-fidelity) still apply: namespace/clock/fixture actor substitution, reduced schema/ACL context, scope/hidden-path/legacy catch-up doubles and selected claim/commit fragments. Fixture item rows test source bag-cost calculation; they are not a general inventory audit. Direct row resets in the cache/solo tests are test setup, not supported gameplay operations. Real resolver, full commit/stance/effects/Arena and all lifecycle/privileged routes remain unproved. The G4A9 native history is retained; this task does not relabel its25 tests as newly executed.

## Source drift and future installed-parity gate

Before separately authoring an installable forward artifact, establish through a separately authorized permitted read-only route:

1. Exact current public identity/signature, complete definition and normalized fingerprint/prosrc. Historical F5 whole-definition normalized SHA is `6a1fabd7dbdea1ad132e189d3eb48c0b7caa625b5b0fe81b18759c254f2aacf4`; its original public `prosrc` raw SHA is `4b7f16cfd9da168704831ebf641740e9ce69cd206272a39244b076855adb1ea5`. Do not transplant fixture hashes into a production guard. Any different definition, already-qualified query or inline directive needs reconciliation first.
2. Owner/security/volatility/search path and function-level options. F5 observed postgres/SECURITY DEFINER/volatile/`public, auth, pg_temp`, with no recorded per-function variable-conflict option or inline directive. That observation is historical, not proof of current caller/compiler state.
3. Exact direct/effective EXECUTE and other trusted rights. F5 observed browser anon/authenticated denial and postgres/service_role access, plus retained platform ACL evidence. Preserve legitimate existing rights; no new browser EXECUTE or unrelated revocation. Missing visibility remains a gap, not inferred safety.
4. Supported wrapper/delegate identity and effective F6 serialization parity where necessary to ensure the same private target is still used. Unknown external/dynamic callers remain a limitation. Metadata cannot prove deployed behavior or reconstruct every backend's cached compilation history; the explicit qualification removes reliance on a favorable setting but does not substitute for fresh source/security reconciliation.

No metadata query, connection route, hosted runtime probe, production SQL candidate or migration is prepared/executed here. Do not reuse forbidden sandbox execution or read-write metadata connections. G3D remains BLOCKED; its deferral is not bypassed by this task.

**Next smallest action:** separately authorize bounded installed-parity preparation for this exact helper and its directly necessary wrapper expectations, then decide whether an installable minimal correction is applicable. Full creature HP integration retains its independent claim/commit/effect/stance/Admin/maintenance gates. G4A9-R1 is not marked fixed or hosted-verified.

## Validation and preservation

PASS:23 native PostgreSQL18.6 tests (3 independent-session),34 unchanged accounting baseline tests,3 project-state tests; source/F6 parity, 134 documentation targets/6 anchors, JSON/generated Markdown synchronization, ancestry, unchanged production/history/prior proof/disposition records, syntax and whitespace. The single task-created cluster is confirmed stopped. No application typecheck/build required for isolated proof files with no production imports or edits.

Eight scoped files: local candidate and harness; native evidence; this report; G1 audit index; engine roadmap; state JSON/generated Markdown. No implementation/deployment, new gameplay, migration/history or previous closure change. Recovery stash preserved. G4A9-R1/G4-R1/G4-R2/E13/G/parent remain OPEN; G3 correction deferred/G3D BLOCKED. Preserve prior B–F/progression closures, four OPEN progression F limitations, deferred F1 retry-UUID, privileged/delegation/Combat1 uncertainties. Administrative XP grants remain paused; normal gameplay XP earning is not intentionally disabled or runtime-verified by this work. Git push is not installation, Edge deployment or frontend publication.
