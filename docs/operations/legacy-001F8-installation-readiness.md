# ENG-LEGACY-001F8 — Hosted installation readiness

Baseline1a7ec70ecc51265795ef25d309956c537cc06644. **GO recommendation for separately authorized installation of the unchanged F6 candidate**, subject to the explicit retained-visibility limitations below, a current source/dependency check and a quiet installation window. This report is not installation authorization. Parties IN PROGRESS; parent OPEN. No hosted operations or publication performed.

## Original evidence and provenance

- [Statement1 catalog](legacy-001F7-statement1-catalog.txt):100417 bytes, copied unchanged from owner's original Downloads file and byte-compared. Successful observation2026-10-14T04:48:02.680118+00:00, supabase_read_only_user, PostgreSQL17.6, transaction/default read committed, transaction_read_only on.
- [Statement2 ledger](legacy-001F7-statement2-ledger.txt):9601 bytes, copied unchanged and byte-compared. Observed2026-10-14 04:49:22.045943+00 as supabase_read_only_user.

Files are original textual Go-map serialization, **not JSON**. Do not rewrite or reserialize them. The two statements are separate observations, never one snapshot, and remain distinct from [F5 JSON](legacy-001F5-party-parity-envelope.json) and [F5A text](legacy-001F5A-hosted-report.txt). Scoped Git attributes preserve their original bytes.

Owner reports statement1 initially failed under sandbox_exec and succeeded **unchanged** under supabase_read_only_user. The supplied files contain successful results, not the first error transcript; exact initial error/SQLSTATE is not established here. No permission repair or SQL adjustment inferred. Hosted observations are owner-supplied; Codex independently verified archive identity, local source/hash and consistency of reported metadata, not hosted execution.

## F7 criteria reconciliation

| Criterion | Reported evidence / disposition |
|---|---|
| Target function | PASS: public.party_mutate(uuid,text,uuid,uuid,uuid,uuid) exists; normalized whole-definition f00dc054af96c05d74b66be30db9909c6b6baafdf33e57b98a04a967aae0745f; postgres owner, DEFINER, volatile, search_path public,auth,pg_temp. Effective EXECUTE anon=false, authenticated=true, service_role=true, postgres=true. |
| Dependency source/security | PASS:48 returned function hashes equal F5 expected hashes; no missing function. All reported owners, DEFINER settings and search paths match F5. Full target definition supplied; unchanged dependency definitions reused from archive, not guessed from nil definition output. |
| Required schema | PASS:41 required columns present with UUID identities/nodes, boolean flags, text statuses, JSONB result and timestamptz lifecycle/claim fields; Drizzle bookkeeping columns visible. Relevant returned FK/constraint/index metadata retained. No schema change required. |
| Triggers | PASS:25 reported definitions/bindings and enabled states match F5 exactly. Membership changes do not update location/HP/buffs and do not fire character UPDATE movement triggers; F5A nested movement dependency retained as historical evidence. No new lock dependency established. |
| Ledger | PASS:22 installed entries, IDs1–22, idx0–21,22 source_hash_matches=true, no false/missing/extra rows; ends0021_legacy_001e6_npc_gift_correction. Source hashes from committed Git blobs, not Windows checkout bytes. No history repair. |
| Explicit ACL strings | **REQUIRES EVIDENCE**:13 function records include REDACTED ACL strings, including target authenticated entry. Do not reconstruct raw aclitem bytes from decoded entries or effective permissions. No raw-ACL completeness claim. |
| Effective permissions / RLS | Reported effective four-role rights satisfy target gate and agree with relevant F5 rights. Browser DML absent on party/member/request tables. Broad Combat2 table DML grants coexist with RLS/SELECT-only policies; no proved browser mutation or runtime-role test inferred. Preserve this uncertainty, not resolved/rewritten ACLs. |
| Isolation / runtime | Successful metadata session read committed/read-only confirmed in report, not actual API isolation. Local PostgreSQL18.6 six-session scenarios and14 SQL tests passed; hosted runtime/concurrency, dynamic callers and every deployed path remain unverified. |

## Remaining gaps and owner disposition

The redacted raw ACL entries do **not** establish incompatibility for this replacement. Candidate reads actual pg_proc.proacl inside the installation transaction and requires exact before/after equality, plus owner/security/settings and effective-role equality. It changes no grants. Raw bytes are available to server-side assertions even when the reporting tool masks them. Effective target rights observed separately. Thus this is a nonblocking **visibility limitation proposed for explicit acceptance in installation approval**, still REQUIRES EVIDENCE; it is not silently marked already owner-accepted or verified.

Hosted gameplay/concurrency and actual API isolation are similarly nonblocking verification gaps for a metadata-guarded, source-compatible function replacement; do not present them as tested. Owner's separate installation approval should acknowledge these limited guarantees. Existing explicit acceptance of unresolved Combat1 deadlock risk remains. Privileged callers/raw-table writers that skip public node-first wrappers remain outside the supported-path serialization guarantee; installation approval must retain or disposition this documented uncertainty, not call it contained. No new corrective scope proposed.

No observed source/settings/column/trigger/history incompatibility blocks this specific installation. If approval requires complete unmasked raw ACL readback, that requirement remains unsatisfied: stop rather than invent completeness. No extra hosted query is run or requested automatically.

## Bounded installation procedure (after separate owner authorization)

1. Publish this F8 handoff/evidence only when separately authorized, or provide it directly to installer with its owner-approved limitations. Verify source ancestry from1a7ec70e and source checkpoint; no unrelated local/platform changes. Use established [B2 workflow](migration-baseline-strategy.md) and [operating guide](ai-operating-guide.md), never legacy Supabase replay or an alternate runner.
2. Verify exact [F6 SQL](legacy-001F6-party-combat-serialization.sql) SHA-256 **39f5595fa1495a5033ef0fa921a15a0f8dc2f6402dd5e8885bc94e3822e1db1d**; [F7 preflight](legacy-001F7-party-preflight.sql)9a103e56a376d5cf4c42bb74b87b0ac753801ccc0f8b07a4f23bf4553aaf2f54 is unchanged. Confirm current target still satisfies candidate's F5 fingerprint/settings/effective grants and source-dependent lock graph; reuse recent F7 evidence unless elapsed changes require scoped reconciliation. Function guard is authoritative at execution, not permission to ignore dependency drift.
3. Expected installed prefix22 through0021. Proposed next identity **0022_legacy_001f6_party_combat_serialization**, only if current prefix/source still agree and intended path unused. Keep reviewed SQL outside drizzle/migrations: Lovable standard migration tool creates SQL, journal and snapshot. Do not pre-create the destination file or hand-edit metadata. Do not modify22 existing rows or historical Supabase records. Stop on newer/different prefix or filename collision.
4. Arrange a short quiet window with no known party mutation/entry/movement requests. Already-running calls may have cached the old function; installation is not a fence for their execution. Coordinate with owner, do not introduce a global gameplay pause, grant change or player mutations. Stop/reschedule if relevant old requests are known in flight.
5. Preserve a practical pre-install checkpoint: complete old pg_get_functiondef for target, owner/security/settings, actual server-side ACL and effective-role results, scoped dependencies, journal/history/source commit. F7 masked report is not an exact raw-ACL backup. Actual ACL comparison is performed inside candidate; if export tooling masks raw bytes, document it and retain checkpoint in an installer-readable restricted form or accept its limited readback explicitly. Do not store credentials or gameplay data.
6. Only after approval, installer submits **exact reviewed bytes** through standard transactional tool. Candidate BEGIN/DO/COMMIT must stay atomic; source/body/authority guard failure rolls back the function replacement, with no partial schema/gameplay work. No automatic Edge deployment or frontend publication. Inspect automatic source commits after success or failure; no duplicate/manual historical registration.

## Expected effects and post-install verification

Only party_mutate definition changes. No signature/OID/owner/security/search_path/ACL or helper/table/trigger/character/resource changes. Protected accept/leave/kick/disband/follow/stop_following/set_tank get sorted node→lifecycle→sorted encounter→UUID character locks, coverage revalidation and existing refusal kind. Committed UUID replay and original mutation body remain. Existing create/invite/cancel/decline semantics, party tank metadata and Combat2 tank functions remain untouched. No administrative XP or normal gameplay XP change.

Read-only post-install verification (metadata only):

- Generated migration SQL byte-identical to reviewed39f559…; new journal/snapshot links valid; expected ledger23 entries, previous22 hashes/identities unchanged. New normalized target whole-definition fingerprint **4db8db846b0099fb87518e48de84602794c544ba3c294aacea3b4b6990822fdd** is the local compiled expectation, not preclaimed hosted fact. Use F3 algorithm CRLF→LF/whitespace collapse of pg_get_functiondef; reconcile any difference, do not just replace expected hash.
- Target signature/OID, postgres owner, DEFINER/volatile/config unchanged; effective anon denial and authenticated/service/postgres rights preserved. Actual server ACL equality is enforced by candidate; masked exported strings still remain visibility REQUIRES EVIDENCE if masking persists.
- Original mutation suffix unchanged; sorted locks/coverage abort/replay present; relevant dependency fingerprints and25 trigger bindings/enabled states unchanged. No gameplay function calls or player-row reads required for installation metadata verification.
- Review automatic SQL/journal/snapshot/source commit and any regenerated types; unchanged signature should not require client code. Report installed/metadata-verified separately from runtime; Parties remains IN PROGRESS until separately reviewed closure/other findings, including F1 malformed-response retry UUID weakness.

## Rollback / recovery

Pre-commit assertion/install failure: transaction rollback is the first recovery; verify no new ledger row or partial definition, inspect any automatic commit and preserve history. Do not retry with weakened guards.

After successful commit, do not delete migration rows, reset history or replay older migrations. A separately approved **forward-only compensating function replacement** can restore the checkpointed old definition with guards on the installed F6 hash/settings/ACL. Retain signature/owner/settings/ACL and quiet-window safeguards. Restoring old body reintroduces the known source race, so it is not an automatic default or silently safe fix; owner must approve that trade-off. No character data rollback is expected because installation writes none; production calls that occur after installation are not automatically undone by restoring code. No new permanent backup/recovery system or gameplay repair proposed.

All earlier closures, four OPEN progression limitations, accepted authority uncertainties and recovery stash retained. Administrative XP grants remain paused; normal gameplay XP earning is not intentionally disabled and its runtime is not established here. **GO recommendation, awaiting separate installation authorization and explicit limited-readback/risk acknowledgment; no install/commit/push performed.**

## Local validation

3 project-state tests passed; JSON/Markdown synchronized;8 report links valid; both original archives byte-identical; F6 candidate and F7 preflight hashes unchanged;22 reported ledger rows consistent; prior blockers/migration records unchanged; whitespace checks passed. Recovery stash unchanged. No new SQL/application/migration or hosted changes; no commit/push.

## F8A owner acceptance and publication

The owner explicitly approved hosted installation of the unchanged F6 candidate and accepted the retained limitations documented above. This supersedes the initial pending-approval wording for this specific installation, not the REQUIRES EVIDENCE classification of masked raw ACLs or unverified runtime/callers. Privileged caller uncertainty, unresolved Combat1 deadlock risk, F1 retry-UUID issue and all progression limitations remain. F8A authorizes Codex only to publish these six documentation/evidence changes; no hosted operation is performed. Parties IN PROGRESS; parent OPEN.
