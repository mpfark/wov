# ENG-LEGACY-001G3C — Idle/activation installation readiness gate

2026-10-15. Starting/fetched checkpoint `84d3f7fb6aae7fe04201434f377303a64ae72cfc`. Evidence/reconciliation only. **GO for bounded verification preparation; BLOCKED for installation.** The candidate is intact and locally validated, but actual caller isolation and fresh installed parity are not established. This report authorizes neither verification execution nor installation.

## Evidence reused and scope

Reuse [G3 lifecycle map](legacy-001G3-world-lifecycle-scheduling.md), [G3A transaction analysis](legacy-001G3A-idle-activation-serialization.md) and [G3B readiness/native results](legacy-001G3B-idle-activation-readiness.md). G3B's11 PostgreSQL18.6 independent-session tests reproduced the original race and both corrected READ COMMITTED orderings in a disposable fixture; dependency doubles do not establish the hosted stack. Those tests were not repeated here because neither source nor candidate changed.

Relevant specification areas remain [engine authority and one authoritative heartbeat](../design/game-engine.md); roadmap IDs [ENG-LEGACY-001 / ENG-HB-001](../roadmap/game-engine-roadmap.md). No rules/statuses change. The active-empty-encounter F10 observation remains compatible with the separate shutdown predicates; it is not evidence of this race or a reason to block sleep.

## A — Supported caller isolation

| Layer | Established locally | What it does not establish |
|---|---|---|
| PostgreSQL defaults | A default is a starting configuration; effective transaction isolation is the property needed by this correction. G3B explicitly selected/asserted READ COMMITTED on local test sessions. | A local default or another connection's current_setting is not hosted caller proof. Server, database, login-role, session/startup and transaction-level overrides must be reconciled. |
| Repository RPC path | [Session client](../../src/features/combat2/session-access.ts), checkCombat2SessionAccess, calls supabase.rpc with exactly character/node arguments. [Client setup](../../src/integrations/supabase/client.ts) configures authentication storage, not server transaction isolation. | No repository-controlled PostgREST server configuration, running version or effective request transaction policy was established. Client omission of an isolation option does not prove server omission of an override. |
| Repository cron path | [Wake source](../../supabase/migrations/20260824010343_58a2d74d-8e2d-41e2-adb0-a3e2576785ec.sql), line220, creates idle-shutdown-check every30minutes with `SELECT public.idle_shutdown_check();`. | No explicit isolation clause in that command; actual job identity, login role/database, cron connection mode/options and resulting isolation are not established by source. |
| Function declaration | Both target routines are VOLATILE PL/pgSQL SECURITY DEFINER, with fixed search_path; neither sets/checks isolation. | SECURITY DEFINER changes execution authority, not the caller's transaction into a fresh READ COMMITTED transaction. Role permissions/owner alone do not establish isolation. |
| Existing hosted observations | [C3](legacy-001C3-resource-sync-preflight.md), [F5B](legacy-001F5B-party-correction-readiness.md) and [F7](legacy-001F7-party-preflight-handoff.md) explicitly limit metadata-session isolation evidence. | None establishes these actual RPC/cron execution contexts. G2B's conditional forbidden-role observations are not compliant execution or permission to repeat it. |
| Documented platform behavior | The local operating contract distinguishes platform execution from repository assumptions. No version-matched hosted PostgREST/cron transaction contract or configuration attestation for these callers is in the reused evidence. | Generic product documentation/default behavior would be conditional on actual running versions/configuration; it cannot attest this installation. No web/platform lookup or hosted call was performed in this local-only task. |

**Supported RPC boundary:** browser → Supabase client → PostgREST RPC request → database transaction → combat2_session_access → response after request completion under the server's commit policy. The target cannot independently COMMIT. Its activation advisory lock is transaction-scoped; its exception block rolls back its own changes on exception. The identity of the API connection role, role switching and transaction-selection policy must be supplied by actual platform configuration, not inferred from the function owner or browser key. READ COMMITTED is not established merely by seeing authenticated EXECUTE.

**Supported idle boundary:** pg_cron executes the named SQL command through its configured execution mode/connection as its configured database/user. A successful command's writes and advisory locks belong to that transaction; the target itself cannot COMMIT. Need evidence of the actual command and whether execution is a single command transaction with any connection/startup or surrounding transaction overrides. Do not infer the cron login from service_role EXECUTE: pg_cron can run as another owner with effective rights.

The correction relies on eligibility statements after the activation-lock wait seeing a newly committed presence lease. G3B proves that in its READ COMMITTED fixture. A transaction-wide older snapshot is not refreshed by an advisory lock. Its one REPEATABLE READ40001 case is not proof every unsupported-isolation execution is safely rejected. **Caller isolation remains UNRESOLVED, an installation blocker rather than an accepted runtime guarantee.** No connection or function isolation setting is changed.

### Smallest sufficient isolation evidence

1. Identify the actual PostgREST login/effective gameplay role and job database/login from supported configuration and the exact idle job metadata. Record running PostgREST/pg_cron versions and the cron execution mode where visible.
2. Reconcile server/database/login-role defaults, relevant API role transaction-selection configuration and request/connection startup overrides. Include function proconfig and any specifically configured pre-request hook; do not treat SET ROLE as proof the login defaults and target-role defaults are interchangeable.
3. A version-matched, supported platform configuration attestation explaining how these values determine **both actual execution paths** can establish the contract without invoking either gameplay function. A separately observed inspection session's transaction_isolation value cannot do so.
4. If the platform cannot attest the override chain, request only an **existing, supported nonmutating execution-context diagnostic** through the same API/cron transaction setup, returning effective isolation and role/database context. Do not create a diagnostic RPC/job, schedule or run a job, invoke session access/idle, impersonate a service role, or change settings to obtain this evidence. No such diagnostic was located/authorized here. If unavailable, keep BLOCKED and ask for a separately reviewed fail-closed isolation-policy decision; do not weaken the evidence threshold or candidate guard.

## B — Exact installed-parity requirements

No fresh complete installed parity was located for the two targets. The source and G3B native evidence already cover the one-line transformation and READ COMMITTED logic; do not repeat broad Combat2 or earlier party audits.

| Exact identity | Minimum missing evidence / comparison |
|---|---|
| `public.idle_shutdown_check()` | Exact existence/signature and void return; complete pg_get_functiondef and prosrc; SHA-256 of UTF8 prosrc after CRLF→LF only; owner, language, volatility, SECURITY DEFINER, proconfig; direct and effective EXECUTE. Must meet candidate's exact body/settings guard, preserve observed owner/ACL and retain intended server-only callers. |
| `public.combat2_session_access(uuid,uuid)` | Same identity/definition/settings/security/ACL metadata, including active-character exclusion and activation lock before mode/wake/schedule/presence. Source comparison to0013, not only the historical September13 body. No change proposed to this function. |
| `public.wake_world()`, `public.shutdown_world()` | Exact definitions/identity/settings to reconcile the directly invoked composition and absence of a new reverse activation-lock acquisition. Their existing side effects remain unchanged; no wake/shutdown execution. |
| `public.combat2_dispatch_scheduler_enable()`, `public.combat2_dispatch_scheduler_disable()` | Exact definitions/identity/settings/ACL: schedule lock, existing job identity, no reverse acquisition of production-activation gate. Reuse G3 source comparison; no dispatcher/fire/claim/commit probe or re-audit. |
| `public.return_unique_items()` | Exact direct dependency identity/definition/settings; reconcile against inspected source for lock relevance. Retain known inventory/trigger uncertainty, not a general inventory audit. |

For the two target routines, return explicit proacl (including NULL), expanded default/direct ACL using COALESCE with acldefault, and relevant effective has_function_privilege results for anon, authenticated, service_role, postgres and the **identified actual cron caller**. Report PUBLIC as an ACL grantee, not as an executable database role. Owners/inheritance can confer effective rights; record these separately. Effective EXECUTE is not a successful gameplay authorization test, and SECURITY DEFINER's owner context is not the caller's isolation context.

For unchanged direct dependencies, reuse prior complete dated metadata only when exact identity/fingerprint and lack of later source change support it; otherwise fetch just their missing metadata above. Auth.uid and the Arena-access helper are existing session-access dependencies, not new correction targets. Expand to a hook/trigger/nested function **only if returned definitions/configuration demonstrate a concrete serialization dependency**, recording the reason first. No recursive all-function, all-trigger or ACL scan. No need to read player/presence/claim/inventory rows.

Expected source comparisons (not fresh installed fingerprints):

- Idle normalized **prosrc** SHA-256 `3c14b179b83d26da8b25cf50f1f568f0a137490b603e51b947c299c6a261604e`; from [production cutover](../../supabase/migrations/20260913100000_combat2_production_cutover.sql), lines69–81. Owner postgres, PL/pgSQL/VOLATILE/DEFINER, void/no args, `proconfig = ARRAY['search_path=public, cron, pg_temp']` must match the candidate guard exactly.
- Session-access normalized **prosrc** SHA-256 `7207f310e6d8ac664c1a771df65dd77202e899ccf7e31b8fbf7c5dbad12e9399`; from [Drizzle0013](../../drizzle/migrations/0013_progression_001g_c2_reset_and_cutover.sql), lines326–357. Preserve public,auth,cron,pg_temp search_path and existing authority. A mismatch needs comparison, not automatic acceptance.
- G3B's complete CREATE-statement fixture hashes are a different domain. Never compare them to installed prosrc or normalize timestamps/whitespace beyond the specified CRLF conversion.

## C — Candidate integrity and migration channel

Verified exact file and Git blob SHA-256 for [unchanged candidate](legacy-001G3B-idle-activation-lock.sql):

`ec2ddfc2458c28d8ecb291c8f405f5091a8364708fd7c6097716ba51c97f233c`

No material local defect identified. Review confirms:

- Single transaction; one guarded function replacement, no lifecycle/gameplay function invocation, scheduler operation, grants, ownership change, migration registration or application edit.
- The only body delta is production-activation transaction lock immediately after BEGIN, before all three eligibility predicates and effects. Original30/5minute windows, claim check, reclamation, mode write, disable and shutdown remain byte-equivalent after removing that addition.
- Complete existing declaration is deparsed/reused. NULL/FALSE guard fails closed; body/settings drift or patch-cardinality mismatch aborts. Postcondition compares complete pg_proc metadata except prosrc and the exact new body, preserving observed owner, SECURITY DEFINER/settings and ACL. G3B tested this locally; it is not fresh hosted attestation.
- Preserving a hosted ACL does not prove it is appropriate. Unexpected browser EXECUTE on idle or missing required trusted rights is a preflight mismatch requiring disposition, not an implicit authorization to change grants.
- Local snapshot/native tests do not attest inherited/effective ACLs, installed dependencies or installer authority on the hosted server. Verify installer capability for this exact postgres-owned function through permitted metadata/platform evidence, not a trial write.

The repository journal currently has23 entries ending0022_legacy_001f6_party_combat_serialization. That is source state, not a new hosted ledger read. A future install needs current source/journal/hosted ledger prefix reconciliation and exact candidate identity, no guessed next migration number, replays or changes to existing hashes/snapshots. Keep the candidate outside automatic migrations. Use only the [standard Lovable Drizzle custom-SQL channel](ai-operating-guide.md) after separate authorization; no Supabase db push, direct CLI fallback, history normalization or dry-run migration-tool probe. Confirm the supported runner can preserve this atomic transaction, and abort/reconcile any source mismatch before invocation. This report performs no installation.

## D — Minimal next hosted verification plan — NOT EXECUTED

Use only an existing **permitted read-only connection with transaction_read_only=on**. If unavailable, stop; do not use sandbox_exec, any previously rejected route, broader privileges or a read/write connection. Do not manufacture compliance with BEGIN/SET on a forbidden connection. This report contains a query plan, not authorization to run it.

| Observation | Catalog/configuration projections and strict bounds |
|---|---|
| 1 — Function parity | pg_proc/pg_namespace/pg_language/pg_roles and pg_get_functiondef, to_regprocedure, SHA-256 expressions, aclexplode/acldefault and has_function_privilege, for the seven exact identities above only. Missing targets/visibility are explicit gaps; do not substitute overloads. Return full source, fingerprints, configuration and ACL classifications. |
| 2 — Caller/settings | current_database, current_user/session_user, observation UTC time, transaction_read_only and transaction_isolation **of this observation only**. Whitelist pg_settings default_transaction_isolation and the visible cron execution-mode setting; pg_extension for pg_cron version. Whitelist pg_db_role_setting/pg_roles configuration for the current database, global defaults and exactly the identified API login, authenticated gameplay role and idle-job login, filtering output to isolation and specifically relevant PostgREST transaction/pre-request configuration keys. No generic rolconfig dump, credentials or unrelated roles. |
| 3 — Exact idle job | cron.job restricted to jobname='idle-shutdown-check': visible database, username, active, schedule and whether command exactly equals `SELECT public.idle_shutdown_check();`. Return that known command only when it matches; unexpected command is a mismatch, not permission to reveal unreviewed embedded secrets. An absent job while asleep does not prove a defect: reuse wake's source job template and require platform evidence of the intended cron execution context. Do not create/enable/run a job to inspect it. |
| 4 — Platform attestation | Separately provide version-matched actual PostgREST/cron connection/transaction configuration and override-chain explanation from supported nonsecret platform configuration. This is not replaced by observation2. Do not request secret values, hashes/prefixes, full environment dumps or gameplay diagnostics. |
| 5 — Migration prerequisite, only when installation is being prepared | Existing standard read-only journal/Drizzle ledger prefix check, restricted to migration identifiers/hash/timestamp. No registration, history repair or runner invocation. |

Record role, UTC observation time, read-only state and snapshot metadata for each returned statement/group. Catalog results returned separately are **separate observations**, not a coherent shared snapshot merely because transaction times match. Do not read gameplay rows, execute lifecycle/claim/sync/commit functions, change cron, wake the world or inspect secrets. Returned direct dependencies are metadata, not successful runtime behavior.

### Interpretation and stop conditions

- **PASS:** exact candidate prerequisite matches; unchanged session access/dependencies compatible with the lock hierarchy; required trusted rights preserved and expected client restrictions observed; actual API **and** cron READ COMMITTED execution contracts established through version/configuration evidence; installer/channel/history prerequisites satisfied when installation is considered.
- **FAIL / BLOCKED:** source/security/authority drift, unsupported caller isolation, reverse lock acquisition, unexpected job command or incompatible ledger/runner state. Do not modify the approved candidate or guards to get PASS. Owner review required.
- **REQUIRES EVIDENCE / BLOCKED:** masked ACL/configuration, incomplete definitions, unknown job caller/connection mode, unavailable platform attestation, or inspection-only READ COMMITTED value. Missing visibility is not missing functionality; stop rather than escalate privilege or invoke gameplay.
- Even a complete metadata PASS is **GO to seek installation authorization**, not authorization itself or hosted concurrency/runtime verification. Unknown external/privileged callers and inherited legacy risks remain documented; do not silently classify new uncertainty as accepted.

## Recommendation and preservation

**GO for the bounded read-only evidence preparation above; installation remains BLOCKED.** Recommended next owner decision: authorize execution of that scoped catalog/configuration verification through a permitted read-only route and request the supported platform isolation attestation. If the route or attestation is unavailable, retain BLOCKED; a separately reviewed fail-closed isolation policy may be proposed, never silently added to this approved candidate.

G2 remains COMPLETE WITH EXPLICIT LIMITATIONS, E13 transfer OPEN, G/ENG-LEGACY-001 OPEN; prior B–F/progression closures unchanged. Preserve privileged v3→v2/Combat1 uncertainty, OPEN deferred ENG-LEGACY-001F-R3-RETRY, all four OPEN progression F limitations and other deferred findings. Administrative XP grants remain paused; normal gameplay XP is not intentionally disabled or runtime-established here. No implementation, state/roadmap/idea-register change, hosted operation, world wake, SQL execution, migration or publication of the frontend. Recovery stash preserved.

## Validation / publication scope

Only this new report is committed/pushed.18 focused tests PASS (project-state3, production-cutover5, scheduler7, session-access3); JSON/Markdown synchronized unchanged. Candidate file/blob hash and original idle/session prosrc hashes recomputed; baseline ancestry verified;23-entry repository journal inspected unchanged. Documentation links and staged whitespace checked before commit. No G3B native rerun, hosted query or SQL execution performed; its existing11 native results are reused at their original bounded scope.
