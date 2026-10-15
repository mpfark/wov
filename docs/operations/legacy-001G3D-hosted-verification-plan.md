# ENG-LEGACY-001G3D — Hosted read-only evidence preparation

2026-10-15; starting/fetched checkpoint `3bd74ebab3969ed21517cf617518a4f104307f4c`. **Prepared, NOT EXECUTED.** Preparation/push is not execution approval. Installation remains BLOCKED pending actual caller isolation, fresh installed parity and separate owner installation authorization.

## Package and exact payload hashes

Catalog routines/relations are explicitly pg_catalog-qualified. Each SQL file contains one top-level catalog/metadata SELECT (WITH CTEs); no transaction-control statement, SET, DDL, DML, role change, lifecycle/gameplay call or scheduler invocation. Hashes are SHA-256 of the complete execution payload file bytes, including comments and final LF; do not reformat or change line endings before hash verification.

| Execution order / exact file | Purpose | SHA-256 |
|---|---|---|
| 1 — [legacy-001G3D-functions.sql](legacy-001G3D-functions.sql) | Exact function identities, complete definitions, fingerprints, security/configuration and direct/effective EXECUTE. | `39477650a9fd9b9e81563330fb4735840bbb03f893eb5f11235d8b46fee42fd2` |
| 2 — [legacy-001G3D-callers.sql](legacy-001G3D-callers.sql) | Exact idle cron job metadata, observed job caller rights and filtered database/role/inspection-visible isolation configuration. | `a03dd23aa671723544f446500d25b9c873e17474f898a62afeb05d56e4447ab5` |

The [G3B correction](legacy-001G3B-idle-activation-lock.sql) remains byte-identical, SHA-256 `ec2ddfc2458c28d8ecb291c8f405f5091a8364708fd7c6097716ba51c97f233c`. **Do not execute it.** Reuse [G3C installation gate](legacy-001G3C-idle-activation-installation-gate.md), [G3A source analysis](legacy-001G3A-idle-activation-serialization.md) and [G3B native results](legacy-001G3B-idle-activation-readiness.md); no repeated concurrency probe is requested.

## Required execution route — currently unestablished

The owner must separately approve a named, permitted hosted **read-only connection/interface and execution principal**, with the intended project/database identity confirmed by supported platform context. It must already enforce transaction_read_only=on. A role named supabase_read_only_user is not sufficient proof of that property or approval; nor are a role-name suffix, project name or repository configuration proof of endpoint identity. No route is asserted available by this preparation.

Before execution, the operator must attest route/principal approval and read-only enforcement through existing supported connection/interface information. Do not use sandbox_exec, any previously rejected route, a read/write connection, owner/service-role impersonation, SET ROLE, or BEGIN/SET as a workaround. If approved route/read-only context cannot be established, **STOP — BLOCKED**, return no invented replacement procedure. Do not execute these queries merely to discover whether a forbidden route is safe.

Necessary visibility is limited to pg_proc, pg_namespace resolution, pg_language, pg_roles, pg_database, pg_db_role_setting, pg_settings, pg_extension and the exact cron.job metadata row, plus standard catalog/deparser/ACL/hash/snapshot functions. No access to player tables, balances, presence/claims, contract/gift/inventory history, Vault, authentication rows, secrets or cron job execution history is required. Use existing read access; do not grant privileges or switch to a more privileged route to complete output.

Both SELECTs defensively return BLOCKED if current_user/session_user is sandbox_exec or transaction_read_only is not on. This is **not** a route authorization mechanism, cannot identify every forbidden route, and does not guarantee the query can bypass missing relation permissions. Relation permission errors can occur before the result guard; they are stop conditions, not permission to broaden access.

## Statement 1 — Exact function metadata

Seven requested identities, with missing identities represented rather than substituted:

1. public.combat2_session_access(uuid,uuid)
2. public.idle_shutdown_check()
3. public.wake_world()
4. public.shutdown_world()
5. public.combat2_dispatch_scheduler_enable()
6. public.combat2_dispatch_scheduler_disable()
7. public.return_unique_items()

The first two are the authority boundary. The five direct dependencies are specifically justified by G3C's lifecycle/scheduler lock-order assessment, not an expansion to all Combat2 functions. No fire/claim/commit, creature regeneration, broad trigger inventory or gameplay function is executed. Further expansion requires a demonstrated concrete dependency and owner review, not automatic recursive inspection.

Output per identity: existence, exact installed signature/arguments/result, owner/language/volatility, SECURITY DEFINER, full proconfig (including search_path), prosrc and pg_get_functiondef, SHA-256 fingerprints of each after CRLF→LF only, explicit ACL/NULL-default flag, expanded direct/default grants and effective EXECUTE for anon/authenticated/service_role/postgres. PUBLIC is an ACL grantee, not a role passed to has_function_privilege. Effective access includes relevant inherited/owner rights; it is not a successful authorization or gameplay test. Preserve masking/errors as REQUIRES EVIDENCE. If a returned definition would expose secret material, stop and report the visibility/redaction gap rather than disclose it or claim complete parity.

Expected normalized **prosrc** comparisons from source, not fresh hosted evidence:

- Idle: `3c14b179b83d26da8b25cf50f1f568f0a137490b603e51b947c299c6a261604e`; postgres-owned PL/pgSQL, VOLATILE, DEFINER, void/no args; exact candidate configuration array `['search_path=public, cron, pg_temp']`.
- Session access: `7207f310e6d8ac664c1a771df65dd77202e899ccf7e31b8fbf7c5dbad12e9399`, compared with [Drizzle0013](../../drizzle/migrations/0013_progression_001g_c2_reset_and_cutover.sql). Verify active-character/auth/node checks, production-activation advisory lock and unchanged wake/enable/presence composition.

G3B's whole-CREATE fixture hashes are a different domain from prosrc/pg_get_functiondef. Do not compare these domains, trim bodies or replace whitespace to manufacture equality. Review direct dependencies against the specific [G3 source map](legacy-001G3-world-lifecycle-scheduling.md) for compatible identity/composition and absence of a reverse production-activation lock acquisition. A drifted dependency is not automatically unsafe, but it is not automatically compatible either; stop for reconciliation.

## Statement 2 — Job and caller/default metadata

cron.job is restricted to jobname=idle-shutdown-check. Return job ID/name, database, username, schedule, active status and exact-command comparison. The expected command is `SELECT public.idle_shutdown_check();`. Its text is returned **only if exactly equal**. An unexpected command is withheld (could contain unreviewed embedded sensitive data); report mismatch and stop. Such output does not satisfy exact-command parity and needs separately reviewed evidence. Do not normalize differences or run the command to diagnose it.

Zero rows may mean world asleep/job removed, RLS filtering or absent job. Do not infer which from emptiness. Duplicate rows, wrong database or unexpected command require review; do not operate on the scheduler. A missing idle job does not authorize world wake, job creation or execution. Reuse the [source job template](../../supabase/migrations/20260824010343_58a2d74d-8e2d-41e2-adb0-a3e2576785ec.sql), line220, but keep actual job login/connection unknown until supported evidence establishes it.

Role scope is only candidate API login authenticator, gameplay role authenticated and observed idle-job username(s). Authenticator is labelled a **candidate**, not a verified actual API login. The query returns exact observed cron-caller EXECUTE on the two targets. If the actual platform API login differs, report it for a narrowly reviewed query amendment, not an all-role scan.

pg_db_role_setting is filtered to global/current/job database scope, those exact roles plus all-role defaults, and these keys only: default_transaction_isolation, transaction_isolation, pgrst.db_pre_request, pgrst.db_tx_end, pgrst.db_config. No unrestricted rolconfig, connection string, environment or secret dump. pg_settings returns only default_transaction_isolation and cron.use_background_workers with visible setting/boot/reset/source; this is **inspection-visible configuration**, not necessarily an unoverridden server or caller value. pg_extension returns pg_cron's installed version only. Missing keys/settings or empty arrays are visibility/absence questions, not proof of defaults or no overrides.

## Caller isolation — what catalogs cannot prove

| Evidence layer | Reconciliation limit |
|---|---|
| PostgreSQL built-in / database / login-role defaults | Useful inputs; source, precedence, caller database/login and connection/startup overrides must still be established. The inspecting session can have its own overrides. |
| Function-level proconfig | Shows explicit function settings. SECURITY DEFINER and search_path do not create a fresh caller transaction or prove its isolation. Absence of an isolation setting does not prove actual READ COMMITTED. |
| PostgREST request | Repository [caller](../../src/features/combat2/session-access.ts) sends the RPC; [client](../../src/integrations/supabase/client.ts) has no transaction policy. Need actual running PostgREST version, login/effective role mapping and supported configuration explaining transaction isolation selection, relevant pre-request hook and request overrides. Defaults observed in another session are insufficient. |
| pg_cron execution | Command/database/user and visible worker-mode setting narrow the question. Need platform explanation of actual connection/worker mode, startup options and single-command transaction contract. Inspection SQL is not a job invocation; job metadata alone does not exclude overrides. |
| Current metadata transaction | Each result explicitly labels inspection_isolation_only and caller_isolation_established=false. A READ COMMITTED inspection does not prove either caller uses it. |

Required **non-catalog evidence**: a version-matched supported platform configuration attestation explaining how the actual RPC and cron paths select effective isolation, including overrides. Ask for nonsecret facts and authoritative configuration/documentation references, not environment values or secret-derived material. Generic documentation is conditional on actual version/configuration and is not installation attestation.

If catalogs/platform configuration cannot establish both READ COMMITTED contracts, installation stays BLOCKED. No new diagnostic RPC/job, same-path gameplay call, owner impersonation or settings change is authorized. Even an existing nonmutating execution-context diagnostic requires separate owner review of its identity, safety and route before use. G3B's higher-isolation serialization-failure case is not a universal safety proof.

## Result provenance, interpretation and stop conditions

Return each complete JSON envelope unchanged, plus operator-attested route/project context. Each statement records UTC statement/transaction times, current/session role, database, read-only setting, inspection isolation and snapshot. Each query's catalog reads are one statement observation; the two files are **separate observations**, not a shared snapshot. Matching timestamps alone do not prove shared snapshots. If truncated/partially masked or split further, label the gaps and stop; do not infer missing functionality or reconstruct missing outputs.

- **PASS for catalog subset:** exact identities, complete matching target bodies/settings, compatible direct dependencies, expected effective authority and readable caller/job configuration. This does not by itself pass caller isolation.
- **REQUIRES EVIDENCE / BLOCKED:** masked or incomplete source/ACLs/settings, unverified actual API login or cron connection contract, absent/hidden job, incomplete override evidence or unknown project/route identity. Missing visibility is not permission to acquire more access.
- **FAIL / BLOCKED:** candidate prerequisite mismatch, unsupported isolation, unexpected authority/security/configuration drift or reverse lock order, wrong database/unexpected job command, read-only off or forbidden/unapproved route. Preserve the evidence; do not repair, modify candidate guards, switch routes or rerun automatically.
- Full reconciliation still needs explicit owner installation authorization and the standard [Drizzle migration-channel/history prerequisites](ai-operating-guide.md). This package intentionally contains no ledger query: current task is caller/parity preparation, not migration execution. Repository journal23/last0022 remains source evidence only; any later ledger verification requires its own approved scope.

## Lovable-ready handoff — for a later separately authorized execution

> Do not execute anything until the owner separately approves the exact read-only connection/interface and principal for this project. Confirm that the permitted route already enforces transaction_read_only=on; never use sandbox_exec, another rejected route, a read/write connection or a privilege/settings workaround. If the route cannot be established, report BLOCKED and stop.
>
> After that separate approval, verify the two G3D file hashes in this plan and execute only their SELECT statements, in order, without modification. Return complete original JSON envelopes and explicit route/project/observation provenance. Stop on a permission error, missing visibility, unexpected command/configuration, truncation or other criteria above; do not substitute a route, expand scope or run additional queries automatically.
>
> Separately provide supported, version-matched nonsecret platform configuration evidence explaining actual PostgREST RPC and pg_cron transaction isolation and overrides. Do not equate the metadata session's isolation with those callers. If unavailable, report caller isolation UNRESOLVED and installation BLOCKED.
>
> Do not read player/character data, invoke gameplay/lifecycle/scheduler functions or cron jobs, wake the world, install the G3B correction, change schema/privileges/settings/history, deploy or publish the frontend. Preparation and metadata PASS are not installation approval.

## Preservation and validation

Only this plan and the two SELECT files are added. Candidate/source/application/migration/state/roadmap/idea-register files remain unchanged. G2 accepted limitations, OPEN E13, G/ENG-LEGACY-001 OPEN, prior B–F closures, privileged/Combat1 uncertainties and deferred findings including OPEN ENG-LEGACY-001F-R3-RETRY are preserved. All four progression F limitations remain OPEN. Administrative XP grants remain paused; normal gameplay XP is not intentionally disabled or runtime-established here.

Relevant [engine authority/heartbeat rules](../design/game-engine.md) and roadmap IDs [ENG-LEGACY-001/ENG-HB-001](../roadmap/game-engine-roadmap.md) are preserved. No hosted or local SQL execution of this package; static validation only, not database compilation.18 existing focused tests PASS (project-state3, production-cutover5, scheduler7, session-access3); JSON/Markdown synchronization PASS unchanged.14 repository links, payload/candidate hashes, seven-function scope, exact idle-job filter, literal/comment-aware SELECT-only checks, balanced delimiters, absence of mutation/control/gameplay access, baseline ancestry and unchanged tracked files PASS. Staged whitespace checked before commit. Recovery stash unchanged. The required hosted execution route and actual caller isolation remain unresolved; stop for owner review.
