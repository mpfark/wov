# ENG-LEGACY-001F10 — Bounded hosted runtime smoke plan

Historical preparation record. [F11 evidence reconciliation](legacy-001F11-evidence-and-closure-assessment.md) now records owner-supplied F10E/F10F/F10H execution results; NOT EXECUTED below describes the original local planning task, not the later reported hosted smoke.

Planning only; **NOT EXECUTED**. F9A source checkpoint46cbfb4a16fd91c55a5b563917bc83c34ed37d6c, installed-source mergebdcb3968422108aa9963fd287460d107f6d58cb3. [F9A reconciliation](legacy-001F9A-installation-reconciliation.md) records0022 installed/metadata-verified with owner-accepted terminal-LF exception. Parties IN PROGRESS; parent OPEN. This document remains local; F9B authorized publication only of four F9A files. No new status or hosted result claimed.

## Safe test manifest — owner must fill/approve before execution

No actual safe actor/account/party UUIDs have been established by this local task. Labels below are planned roles, **not existing database identities or approved creation names**. Do not invent IDs, select a character by similar name or assume an old canary remains disposable.

| Role | Actual UUID / account required | Baseline and permission |
|---|---|---|
| T-LEADER | owner-approved disposable character A and its authenticated owner U1 | living, active lifecycle, safe resources, no accepted/pending party membership/leadership, no combat/queued departure/Arena/other protected transaction |
| T-MEMBER | disposable B, authenticated owner U2 (distinct from U1 preferred for real ownership coverage) | same baseline; will accept invitation |
| T-PENDING | disposable C and owner U2 or U3 | remains pending until combat acceptance-refusal test; no other party |

Three characters across at least two controlled authenticated sessions suffice; three accounts are not mandatory. Prefer ordinary player role to cover browser gameplay authority; if only admin-role test accounts exist, record the actual role and limit results to that context, never claim ordinary-player equivalence. Verify each session owns its exact actor. No service-role/postgres caller, JWT impersonation, token copying/logging or direct table mutation.

**Exclude Calikon1d738976-eef4-40cf-94fa-99132ed2ee3d and Canaryone5097e553-83d8-4e14-8eae-23162b945dfc**, all existing non-test characters, parties and unrelated encounter participants. Existing test actors may be used only with explicit current owner designation. If actors must be created, canonical C2 creation is a separately approved setup write; account quota includes soft-deleted characters. No purge/rename/reset or quota bypass.

Record approved account/character/node UUIDs, role context and test party membership IDs before each call. Need a safe, approved canary-compatible node/route and valid live creature to establish Combat2 presence, with no unrelated fighters/players at the relevant nodes or encounter. No boss/unique/persistent-world admin reset or spawn configuration change. Characters start co-located out of combat for invitations; all following flags false. Avoid special travel, teleport, summon and legacy Combat1 paths. No creature kill or reward verification is required. Owner-reported level1 combat difficulty remains unrelated; if safe entry cannot be established, stop, do not repair stats or combat.

## Caller / replay prerequisite

[F10A fixture readiness](legacy-001F10A-fixture-readiness.md) establishes the supported C2 creation path, an ordinary authenticated Vite caller with immutable six-argument replay, the unpopulated fixture manifest and narrowly scoped safety reads. No caller or hosted fixture has been executed/verified. First request owner nomination and separate read-only fixture authorization; gameplay setup/testing requires subsequent explicit approval.

Use supported public party_mutate(uuid,text,uuid,uuid,uuid,uuid) under the real character owner's application session, or a separately approved scoped authenticated client able to record and resubmit exact arguments. UI alone may not expose UUIDs. Confirm that capability before executing the first request; do not add application instrumentation/refactoring or read private auth storage in this task. Private-ledger readback, if needed, requires separate scoped read authorization by exact test UUIDs; never grant browser ledger access.

Record request UUID and immutable six arguments **before** dispatch. Generate one fresh UUID for each new logical operation. Replay must reuse original actor, operation, party_id, target_character_id, membership_id and request_id exactly, including nulls. Use the original invitation membership ID from invitation success, not a newly fetched different invitation. Do not substitute a new UUID for a lost/unknown outcome.

## Proposed sequential execution (every RPC/gameplay action requires separate authorization)

| Step | Action and arguments / authorization | Expected result and bounded evidence |
|---|---|---|
| 0 — baseline | Owner approves manifest, relevant scoped reads and all intended setup/test/cleanup writes. Read only nominated actors, party state and node participation. | All identities disposable/exclusions absent; no combat/party conflict; approved route/creature available. If not, STOP. Record timestamp/session role and fresh state. |
| 1 — party | A invokes party_mutate(A,create,null,null,null,Rcreate). **WRITE.** | ok=true, kind=party_created, capture returned P. Only A accepted; leader A; no node/resource mutation from party command. |
| 2 — invitations | A invokes invite with P,target B then target C, distinct request UUIDs; membership_id=null. **WRITES.** | invited for each; capture MB/MC; P has three rows including pending, within existing cap4. No unintended account/character/party touched. |
| 3 — acceptance | B invokes party_mutate(B,accept,null,null,MB,Raccept). **WRITE.** | invitation_accepted; A/B accepted, C pending, following false. Read authoritative party_state for approved owners; location/resources unchanged by this command. |
| 4 — exact replay | Resubmit the identical six acceptance arguments including Raccept and MB. **RPC; potentially mutating authority, authorization required even though expected replay.** | Original success/result/party identity unchanged; exactly one accepted MB, unchanged joined_at/following/membership count. joined_at needs an approved scoped member-row read if party_state does not return it; otherwise mark that field unverified. If private read approved, one request row for Raccept and unchanged stored result; never infer ledger cardinality solely from UI. |
| 5 — combat setup | Use existing supported Combat2 entry/hostile action with approved actor A or B, route and target. **GAMEPLAY WRITE:** may change encounter, intent/effects/resources and trigger ticks. | Before refusal calls, a nominated accepted member has present=true fighter in active encounter at current node, living and owned; no unrelated participants. Read this evidence with timestamp, not merely an animation/combat log. Do not force presence with SQL. |
| 6 — refusal | While that participation is freshly established: C accepts MC; B follows, stops following or leaves; A kicks B or disbands. Fresh UUID per operation; normal valid owner/leader/target arguments. **RPC WRITES to request ledger are possible even for refusal; all require authorization.** | Expected ok=false, kind=combat_active for six bounded cases: accept, follow, stop_following, leave, kick, disband. A/B remain accepted, C pending; leader/following/location unchanged by refused party calls. Optional set_tank is not required; no tank-mechanics probe. Stop rather than race repeated attempts if presence expires. |
| 7 — cleanup | After ordinary authoritative combat release/approved safe movement and confirmed no active fighter/live claim/pending departure for affected actors, A cancels C's pending invite then disbands test P. **GAMEPLAY/PARTY WRITES.** | invitation_cancelled and party_disbanded; no test party/member rows remain, no active test fighter/pending departure. Retain normal request/encounter history; no history deletion or arbitrary cascade. If blocked, retain evidence/state and request bounded owner disposition. |

Each call is sequential and independently observed; two authenticated clients alone do **not** mean a concurrency experiment. No deliberate overlap, held-lock barrier, manual claim manipulation or stress loop in F10. Six local PostgreSQL18.6 independent-session scenarios remain separate evidence; F10 cannot prove production serialization under independent concurrent calls.

Do not evaluate resource equality across combat ticks as proof a refusal altered nothing: ticks may legitimately change HP/CP/MP. Check party-owned fields and command receipts/result, record intervening gameplay effects separately. Similarly a membership changed by another operation invalidates the fixture; do not attribute it to replay without evidence.

## Evidence and outcome classification

Collect source checkpoint/installed metadata baseline, observation/call times in UTC, exact actor/session/party/membership/request IDs and non-secret command payloads, raw RPC JSON/error, pre/post authoritative party fields, and scoped fighter/encounter presence status. Never log authentication/service secrets or raw claim tokens; lease-presence boolean suffices. Result records are test artifacts, not platform settings.

PASS only for each demonstrated case. REFUSED as expected is a positive result, not an HTTP transport success alone. Wrong ownership/shape/leader/invitation result is a setup failure, not proof of combat containment. If server returns party_operation_failed/lock_coverage_changed, do not label combat refusal PASS: inspect known fixture drift from approved reads and stop; retry only after bounded explicit decision. No blanket reclassification as corruption.

Replay success demonstrates sequential idempotency for that exact recorded UUID, not protection against reload/remount or malformed responses. F1's confirmed malformed-response coordinator clearing its UUID remains a separate correction candidate; no malformed transport injection in F10. Unknown/ambiguous response: retain UUID/payload, collect available scoped evidence, STOP dependent actions; do not let UI silently mint a new UUID or treat missing receipt visibility as proof of noncommit.

Evidence reads are separate snapshots unless explicitly collected in one read statement; retain timestamps and distinguish UI cache from authoritative state. Failed/blocked cleanup or missing private-ledger visibility is reported honestly; no forced deletion or fabricated PASS.

## Cleanup ownership and stop conditions

Owner-approved cleanup includes only these test identities and supported operations. Existing movement may create retained departure records/FKs; if they prevent disband or lifecycle cleanup, STOP rather than delete request history or bypass fences. Leave the disposable test party/characters in a documented state pending owner instruction. No account deletion, character purge, inventory grant, economy correction, administrative XP grant or creation/lifecycle policy change. Newly created test characters remain unless separately approved canonical lifecycle cleanup is provided; soft-delete still occupies quota.

Stop for any non-test identifier/participant, wrong actor/session, unsafe encounter/route, maintenance/canary exclusion, death or insufficient movement resources, uncertain result, unrecorded UUID, changed invitation/membership, impossible cleanup, unexpected mutation/authority response or missing authorization. No repair or broader Combat2 audit follows automatically.

## Authorization checklist / current readiness

Current task authorizes **planning only**. Before execution owner must provide/approve actual disposable actor/account UUIDs and role/session control, test node/creature/exit route, exact setup/combat/replay/refusal/cleanup write scope and bounded evidence reads. If canonical character creation is needed, include it explicitly; do not infer permission from this plan. A safe current fixture, exact-UUID-capable caller and authorization are presently missing, so hosted execution is **NOT READY**. No technical installation blocker inferred.

Preserve masked ACL visibility limits, unknown privileged callers/direct predecessors, accepted unresolved Combat1 risk, F1 retry issue, earlier closures and four OPEN progression limitations. Administrative XP grants remain paused; normal gameplay XP earning is not intentionally disabled and its runtime is not established here. Parties IN PROGRESS; parent OPEN. No hosted calls, migrations, deployment or Publish; no F10 execution or closure.

## Local planning validation

Scope/exclusion/replay/write-authorization/static checks and local documentation links passed; whitespace clean. F9A publication validation separately passed3 state tests,12 report links, both exact SQL hashes, installed fingerprint record and23-entry journal/snapshot chain. No F10 calls executed. F10 planning/state changes remain uncommitted because F9B publication scope covered only the four F9A files.
