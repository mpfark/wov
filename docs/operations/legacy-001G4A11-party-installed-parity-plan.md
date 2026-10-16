# ENG-LEGACY-001G4A11 — Party movement installed-parity readiness

2026-10-16. Starting checkpoint: 68169465c89851017f6c1160fb2a426445ee5e22. **Planning complete; hosted execution and installation NOT AUTHORIZED.** G4A9-R1 remains OPEN. Engine rules are preserved; no specification change.

## Scope and evidence

Reuse [G4A9](legacy-001G4A9-movement-party-coverage-integration.md), [G4A10](legacy-001G4A10-party-movement-sql-compatibility.md), [F5 archive](legacy-001F5-party-parity-envelope.json), [F5B](legacy-001F5B-party-correction-readiness.md) and [F9A](legacy-001F9A-installation-reconciliation.md). No previous source, proof, candidate or evidence is rewritten. No new database test was executed.

The source declares cost as a PL/pgSQL scalar and also selects the unqualified member-result cost column. G4A10 locally reproduced underlying42702 with structured rollback under error, incorrect reported per-member costs under use_variable, and correct qualification across tested settings. These are PostgreSQL18.6 fixture results, not hosted defect evidence. Metadata cannot reconstruct cached compilation modes in every supported caller backend.

F5 observation: 2026-10-13T20:43:06.818651+00:00, PostgreSQL17.6, sandbox_exec, transaction_read_only=off. Retain it as historical evidence under its existing limitations, never as permission to repeat that route. F9 records installation0022 of party_mutate, normalized fingerprint 4db8db846b0099fb87518e48de84602794c544ba3c294aacea3b4b6990822fdd, and23 migrations. It does not supply fresh party-departure definitions or compilation settings; no exact new F9 observation timestamp/full export is inferred.

## Exact metadata targets and expected outputs

[Review script](legacy-001G4A11-party-installed-parity.sql.review), SHA256 **a810943664a8753b7d6764902e2ed061614a8c85f22fe998041ba750320248ba**, is deliberately named .sql.review, outside migration/runner channels. One catalog SELECT produces one envelope with same-statement observation and exactly three function records when route checks pass. It has not been executed or database-compiled. Queries deparse definitions; they never invoke these gameplay functions.

| Exact public signature (all UUID,UUID,UUID) | Source relationship | Historical settings | Historical effective EXECUTE anon/authenticated/service_role/postgres |
|---|---|---|---|
| combat2_party_depart_without_canary_gate | Target ambiguous aggregate | search_path=public, auth, pg_temp | false/false/true/true |
| combat2_party_depart_without_immediate_transition | Direct caller of target; sorted node-lock wrapper | search_path=public, pg_temp | false/false/true/true |
| combat2_party_depart | Supported outer RPC; calls immediate-transition predecessor and finish helper | search_path=public, pg_temp | false/true/true/true |

All historically postgres-owned, PL/pgSQL, VOLATILE, SECURITY DEFINER, JSONB result; argument names _leader_character_id, _destination_node_id, _request_id. Expected complete-definition/body hashes are embedded separately in the review script. F5 private target normalized whole-definition SHA is 6a1fabd7dbdea1ad132e189d3eb48c0b7caa625b5b0fe81b18759c254f2aacf4; raw prosrc SHA is 4b7f16cfd9da168704831ebf641740e9ce69cd206272a39244b076855adb1ea5. Whole-definition normalization replaces CRLF with LF then collapses PostgreSQL whitespace runs, **without trimming**, hashing UTF8. Raw body hashing does not normalize whitespace. Fixture hashes must not become production drift guards.

The script returns exact identity/arguments/result, owner, language, volatility, security mode, all function settings, full definition/body, both hashes, raw/expanded ACL and grant options, and effective privileges for the four named roles. PUBLIC is ACL grantee0, not a login role. A NULL proacl may represent PostgreSQL defaults; expanded defaults are labelled. Redacted/interface-masked output or missing visibility remains REQUIRES EVIDENCE, never inferred denial. Preserve all existing trusted ACL entries including platform entries, owner and grant options. EXECUTE alone does not establish successful gameplay authorization or an exploit.

No finalizer/trigger/party_mutate re-audit is needed for this terminal aggregate-only correction with unchanged locks and dependencies. If returned wrappers show changed calls or locks, STOP for scoped review; do not automatically expand the query. Unknown external/dynamic callers remain unverified.

## Approved route requirements and stop conditions

Follow the [G3D route restrictions](legacy-001G3D-hosted-verification-plan.md), without reopening G3D. Before any execution, separate owner authorization must name the permitted interface/connection, execution identity, verified project/database context, exact script hash and three-function scope. The trusted interface must already enforce a read-only transaction covering this SELECT. Obtain platform/interface evidence of that enforcement, with transaction_read_only=on observed in the same statement/transaction. A role name such as supabase_read_only_user, a client label, or a different connection's SHOW is insufficient.

No sandbox_exec or sandbox_exec_* execution/session identity; no read-write connection, alternate elevated route, impersonation, SET ROLE or ad hoc BEGIN/SET workaround. No approved route currently established: **execution BLOCKED**. The SELECT's defensive role/read-only guard is not execution authorization or proof of enforcement; catalog permission failures can occur before output, so stop rather than broadening access. Missing/redacted metadata, wrong project, transaction_read_only=off or unapproved identity means STOP. No player/party/inventory rows, gameplay calls, scheduler metadata/controls or global privilege scan.

One statement provides a shared statement snapshot for its catalog results; the timestamp is observation metadata, not runtime-history proof. F5/F9 and any future run are separate observations, never one shared snapshot. Metadata-backend variable_conflict/isolation do not establish supported gameplay callers' settings or cached compilation. No new runtime probe is proposed.

## GO / NO-GO for a later minimal forward correction

- **Conditional GO to separately prepare installable correction:** fresh complete body matches reviewed historical original, owner/security/settings/signature and wrapper chain reconcile, effective browser restrictions/server rights reconcile, visibility is sufficient. Scope remains qualification of member-result columns only. Preserve costs, ordering, frozen movers, request/replay semantics, return/error shapes, transaction/lock hierarchy and F6 serialization. Current plan is not this GO and not installation authorization.
- **Already corrected:** raw target body e01ed3c1d24627771f40a95960eecd1b39eed7d089c371b2eb5abdf0884de7b1 is the locally calculated public-body result of G4A10's exact qualification. This is a comparison aid, not installed evidence. If matched, review full definition/settings/ACL; do not install a redundant replacement. Semantically qualified but byte-different source requires review, not automatic acceptance.
- **NO-GO:** missing identity/definition, unresolved redaction, different signature/security/rights/settings/wrappers, inline directives or unexpected body drift. Reconcile individually before authoring; never loosen guards to pass. A favorable variable_conflict does not repair ambiguous source deterministically.
- Any future installable artifact needs fresh approved-source guards, exact post-body and full metadata/ACL preservation checks, focused compatibility/rollback evidence and separately authorized standard forward Drizzle channel. Do not edit historical migrations/journal or copy the fixture candidate to public. The fixture candidate remains non-deployable.

## Disposition and next authorization

Next smallest step: owner separately approves a named, enforced read-only route and this exact three-target metadata artifact. If no permitted route exists, retain the gate as BLOCKED and continue no execution. Returned metadata would support a later applicability decision, not authorize correction or prove runtime reachability/concurrency.

Preserve G4A9-R1/G4-R1/G4-R2/E13/G/parent OPEN, G3 correction deferred, G3D BLOCKED, all prior B–F/progression closures and four OPEN progression F limitations. Retain privileged/delegated/Combat1 uncertainties and OPEN F1 retry-UUID correction. Administrative XP grants remain paused; normal gameplay XP earning is not intentionally disabled or runtime-verified here. No creature rule, HP authority or balance decision changes.

## Local validation

Validation covers catalog-only static review, exact targets/hash pins, real documentation references, project-state tests/synchronization, unchanged source/migration/proof/history records and whitespace. SQL syntax/runtime and hosted metadata are NOT verified by these checks. No database execution, hosted request or Lovable contact. Publication publishes preparation only.

Executed local checks:3 project-state tests PASS; JSON/Markdown synchronized;133 documentation file references valid; SELECT-only static checks and exact three targets PASS; prior state records and runtime/history/proofs unchanged; ancestry and whitespace PASS. Recovery stash preserved. No PostgreSQL or hosted query was executed.
