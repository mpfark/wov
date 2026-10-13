# ENG-LEGACY-001F6 — Local party serialization correction

Baseline e29785bd84930b4658bddcd388eb8bee5e95315d. Parties IN PROGRESS; parent OPEN. [F3 design](legacy-001F3-party-lock-design.md), [F5B readiness](legacy-001F5B-party-correction-readiness.md), [F5 JSON](legacy-001F5-party-parity-envelope.json) and [F5A text](legacy-001F5A-hosted-report.txt) are retained. Hosted evidence is owner-supplied, not a new Codex read. No installation/deployment/commit/push.

## Artifact and exact scope

[Reviewed candidate](legacy-001F6-party-combat-serialization.sql), SHA-256 **39f5595fa1495a5033ef0fa921a15a0f8dc2f6402dd5e8885bc94e3822e1db1d**, outside drizzle/migrations. One BEGIN/DO/COMMIT operation changes only public.party_mutate(uuid,text,uuid,uuid,uuid,uuid). No helpers/tables, grants, schema metadata, API or UI edits. It obtains the actual installed definition, validates the F5 normalized whole-definition fingerprint f00dc054af96c05d74b66be30db9909c6b6baafdf33e57b98a04a967aae0745f, postgres owner/DEFINER/volatile/search_path public,auth,pg_temp and required EXECUTE assumptions, inserts the reviewed preparation block and leaves the original authorization/mutation/receipt suffix unchanged. After replacement verifies owner/security/config/full ACL and effective four-role rights unchanged. Drift fails atomically. Reapplication to a changed body fails, not a silent no-op.

A fresh preflight must reconcile the source fingerprint using the F3 whitespace-collapsed pg_get_functiondef algorithm. Never substitute a body-only hash or repair a guard to bypass drift. Relevant existing trigger/entry/claim/movement fingerprints come from F5; nested F5A hashes are abbreviated and cannot be executable guards. Full installed body must remain reviewable for future exact installation.

## Lock implementation

Protected operations: accept, leave, kick, disband, follow, stop_following and existing guarded set_tank. Create/invite/cancel/decline keep their original lifecycle boundary and semantics.

1. Auth/shape checks remain. Visible committed UUID replay uses the original complete payload binding before current-state discovery; original lookup repeats under lifecycle before mutation. Replay during later combat remains original success.
2. Discover party (accept resolves recipient membership), all party members including pending invitees, actor, character nodes/deleted state, current-node encounters, every referenced fighter encounter, active party arrival groups and pending/queued departure encounter references. Include off-node members and former-node encounter dependencies.
3. Sorted deduplicated combat_enter_node UUID advisories → global party-lifecycle. Rediscover full coverage. Changed party/member/node/encounter coverage returns existing decoded party_operation_failed kind plus reason lock_coverage_changed, before inserting a request receipt or writing membership. No internal spinning or new late node acquisition; a subsequent user request is a fresh transaction. No party API retry change.
4. Sorted encounter UUID FOR UPDATE → sorted affected character UUID FOR UPDATE → rediscover/revalidate again → existing request/actor/party/member locks, guard and mutation body. These locks remain until caller transaction ends. Claim does not take node locks, hence encounter locks independently close its lease-establishment window. No resource/stat/location UPDATE is added.

## Lock graph and remaining hazards

| Interaction | Assessment |
|---|---|
| Supported public entry / hostile action | Shared nodes serialize before entry's encounter/FK/fighter writes. Mutation first holds nodes through guard/write; entry first becomes visible and original combat refusal applies. |
| Claim | Existing encounter SKIP LOCKED skips mutation-held rows; claim first serializes before character locks and its lease is checked by original guard. Claim primitive test is not a full heartbeat/runtime proof. |
| Coordinated public departure | Both sorted nodes→lifecycle→sorted encounters→UUID characters. Existing mover derivation and finalizers unchanged. |
| Solo movement / arrival | Sorted node pair protects relocation; discovery revalidation refuses changed coverage after waits. Membership never changes current_node_id, hp or reserved_buffs, so no character UPDATE/movement trigger fires. |
| OOC / resource / FK / tank callbacks | UUID character order retained; no encounter acquired after character rows by this correction. Capture former-node active groups before existing tank callback; tank metadata/selection functions unchanged. Lifecycle child KEY SHARE remains. |
| Direct service predecessor/raw writes | Restricted predecessors can bypass public node-first wrappers; a direct party predecessor still contains lifecycle→node order. Unknown external callers and arbitrary raw DML are outside supported-RPC guarantee. Potential inversion with such bypass callers is retained, not disproven or newly contained. Installation approval must explicitly retain/dispose this limitation; no grant changes here. |
| Legacy Combat1 | F5A movement participant/advisory hazard remains temporarily owner-accepted, unresolved. No legacy lock or repair added; no unrestricted legacy safety claim. |

No claim all concurrent writers are safe. Isolation for actual API callers, effective special role/RLS contexts and hosted runtime remain unverified. Broad Combat2 DML grants coexist with SELECT-only RLS metadata; no mutation policy or ACL change in this task. All four OPEN progression limitations and other prior closures remain. Administrative XP grants remain paused; normal gameplay XP earning is not intentionally disabled and is not verified here. F1 malformed-response UUID weakness stays separate.

## Executed tests and environment boundary

**14 PGlite SQL tests passed.** The fixture installs F5 party body, actual entry predecessor, guard, finish helper, lifecycle child fence, tank validation/callback and refresh helper; it uses reduced character/encounter/inventory-free tables with real relevant FKs. Auth UID is a local fixture setting; unrelated spawn mechanics are stubbed. No hosted authentication or full combat mechanics claim. Tests cover accept/replay/conflict, off-node entry-first refusal, replay after combat, absent-fighter live claim, follow/stop/leave/kick/disband, ownership/null/dead/deleted refusal, injected rollback, no character UPDATE, source drift, metadata/ACL/body preservation, deterministic coverage-drift injection, pending invite/cancel/decline/create and former-node active-group tank callback.

The coverage-drift injection is a **single-session deterministic test**, not a concurrent schedule. PGlite SQL execution proves compilation/behavior in this fixture, not independent-session locking.

**Initial checkpoint: six native scenarios were skipped; superseded by the successful execution below.** Native PostgreSQL/initdb/pg_ctl and Docker unavailable; WSL not installed. The postgres JS driver is declared by the project but missing from this local node_modules; it is required when native tests run. No packages/server/platform were installed to disguise this limitation.

[SQL tests](../../scripts/legacy-001F6-party-sql.test.mjs), [two-session tests](../../scripts/legacy-001F6-party-concurrency.test.mjs), [shared fixture](../../scripts/fixtures/legacy-001F6-party-fixture.mjs). Native runner accepts a binary directory only, starts a new temporary loopback trust-auth cluster, never accepts a hosted URL or credentials, and stops its own server. Temporary logs/data remain outside repository; no recursive deletion. Test copies add a barrier before accept's membership UPDATE; production candidate has no barrier. Use actual pg_blocking_pids for waits, not timing alone. Scenarios: reproduce original real-entry race; corrected mutation-first blocks entry; entry-first refusal; claim lease row first; claim SKIP LOCKED primitive; canonical invite while lifecycle wait changes coverage and refuses acceptance.

Commands:

- node scripts/legacy-001F6-party-sql.test.mjs <PGlite dist/index.js path>
- node scripts/legacy-001F6-party-concurrency.test.mjs <native PostgreSQL bin directory> (requires installed project postgres driver; independent-session gate)

## Next authorization / preflight decision

**GO for separately authorized metadata-only hosted preflight.** The six native scenarios have now executed successfully; their local concurrency gate passed. Installation still requires separate preflight, explicit authorization and disposition of retained privileged bypass limitations. Also retain/dispose direct privileged predecessor/raw-writer limitation explicitly at installation review. No additional hosted request was sent.

Minimum future metadata reconciliation: unchanged F5 party_mutate identity/settings/hash/EXECUTE, guard, character/member/node/encounter/group/departure columns used by coverage, relevant current lifecycle/FK/tank bindings and public entry/claim/departure wrapper composition from F5/F5A. Only drift-sensitive objects; no gameplay rows or probes. Do not repeat the broader Combat2 audit. Proposed future installation uses reviewed SQL outside migrations until Lovable standard Drizzle tool installs it, with source checkpoint/hash verification and post-install authority/body readback; no historical replay or automatic routing. Explicit owner installation authorization remains required.

Project-state/links/whitespace and existing party tests are recorded in the final task report. No runtime deployment/activation or closure.

Final local checks:13 existing party/state tests passed; project-state synchronized; report links/whitespace and native harness syntax passed. Git HEAD/origin remain e29785bd; prior migrations and all application files unchanged; recovery stash unchanged.14 SQL tests remain PASS; six native scenarios initially skipped but subsequently executed PASS as recorded below. No build/typecheck needed for this SQL-only correction; no application source changed.

## Executed native follow-up — 2026-10-14

Owner requested Codex run the tests with installed PostgreSQL18. All six independent-session scenarios PASS, zero skipped/failed, in a new temporary loopback cluster using PostgreSQL18.6. Actual blocking verified through pg_blocking_pids. Windows pg_ctl startup originally hung on inherited output pipes; test harness now uses spawn with ignored stdio and waits for process exit. SQL candidate unchanged (39f5595fa1495a5033ef0fa921a15a0f8dc2f6402dd5e8885bc94e3822e1db1d). Driver3.4.9 installed only in separate local test dependencies, exposed through ignored node_modules junction; repo dependency files untouched. Both the abandoned first test cluster and successful cluster were stopped; no existing PostgreSQL service or database touched. Local native execution is not hosted concurrency/runtime proof. No commit/push or Lovable contact.
