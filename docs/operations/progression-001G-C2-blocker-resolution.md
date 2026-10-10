# C2 hosted preflight — bounded blocker resolution

Source baseline/current HEAD `e712a3f65ff3fbd67bb00712a0fef4aeb13f6369`, synchronized with origin/main. Findings below are supplied Lovable observations via Mik on2026-10-10; inspection time/raw definitions/203-row snapshot were not supplied. No Codex hosted access. This report supersedes the integrated handoff's installation readiness where noted; approved C2 policies/architecture and all four F limitations are unchanged.

## Materials: structural cause proven;203-row disposition unproven

The original [table definition](../../supabase/migrations/20260511100538_ba7e2e71-28ff-4b13-b12e-c8f98448b8f7.sql#L24) stores character UUID/material/count/updated_at with **no character FK or account ownership**. Historical [add_material](../../supabase/migrations/20260511110342_53371110-9a2c-481e-aa15-011d2237f4a2.sql#L4) validates delta/catalog key but not the character before upserting. Thus privileged/stale calls could create missing-parent material rows. The [starting trigger](../../supabase/migrations/20260803232302_acc7c4e5-4148-48c0-8f35-8c2299e23944.sql#L1) creates seven legitimate resource rows, not an orphan detector or historical ownership record.

[Legacy hard-delete](../../supabase/migrations/20260623072204_ba238bbb-a55c-4000-8b35-69eb36bb3cba.sql#L34) and the [Arena cleanup](../../supabase/migrations/20260813123556_def190db-e5b8-4122-ae7d-1e2737cee161.sql#L120) explicitly remove materials, so their age alone does not prove they caused203 leftovers. Other raw character deletion or [Auth account cascade](../../supabase/migrations/20260211212345_41f57ff6-5254-4fb2-99cf-eccf43f00fc5.sql#L96) could remove the parent without materials before0010. Which path produced these rows cannot be recovered from source. Broad pre0010 grants permitted direct privileged writers; RLS still constrained ordinary browser access. No new bypass fix or privilege redesign is needed here.

Installed0010 (operator-reported) added the character FK **NOT VALID**, enforcing new writes/cascades while deliberately retaining old orphans. It neither proves their provenance nor cleans them. Integrated B correctly stops at FK validation.203 is a **row count**, not a character count or proof that balances are worthless. Removed parents may have held legitimately earned/admin-granted balances or be recovery candidates. Matching a starter pattern/old timestamp/zero balance is not deletion authorization. No automatic character reconstruction, regrant, reassignment, purge or policy exception is proposed.

The original query also lacked an RLS visibility check. A read-only principal seeing materials but not all characters can produce apparent orphans. **203 remains operator-reported, not independently classified as physical absence.** Revised preflight returns NULL/unreliable rather than a misleading count when RLS applies. Read `blocker-evidence.sql` visibility results first; incomplete access means stop and obtain an already authorized complete administrative read context, not new grants or SET ROLE.

Minimum row evidence: UUID/key/count/last-updated snapshot plus boolean links to inventory, progression state, immutable origin, creation replay and lifecycle receipts. No emails, player names, private receipt JSON or account tokens. Inspect only this table's constraints/incoming FKs/noninternal trigger names. Positive evidence flags are recovery/contradiction cases; negative flags do not prove historical legitimacy or completeness of external backups.

`orphan-cleanup-template.sql` is deliberately incomplete and fails until an explicit approved203-row VALUES snapshot is inserted in a separately reviewed copy. It is **not** an installation input and is not composed into A/B. It requires postgres/full visibility, short bounded locks on characters then materials, exact unchanged keys/amounts/timestamps, continuing parent absence and no listed recovery evidence. It deletes only that approved allowlist in one transaction, checks203 affected rows, and leaves character/provenance/replay/storage rules unchanged. Missing/changed/live/evidence-linked rows or a late failure roll everything back. Unknown incoming FK/trigger side effects are a stop condition before authorization. No production cleanup was executed; local203-row fixtures are synthetic.

**Owner decision after inspection:** discard the exact identified balances as detached legacy residue, or retain/investigate recovery. Approval must acknowledge legitimate prior balances may be lost. If only a subset qualifies or counts drift, review a new bounded snapshot/procedure; never silently enlarge/shrink this203-row template. No blanket approval to delete future orphans.

## Settlement: preserve later behavior, never restore the obsolete outer body

The reviewed C2 runtime package copied September23's full settlement body and expected `6f3adbca…d9135`. Two later source events are directly relevant:

1. [September24 ownership correction](../../supabase/migrations/20260924100000_combat2_post_completion_settlement_ownership.sql#L1) scopes live claims to `f.present`; current project-state records its installation as operator evidence. The stale C2 replacement would undo that correction.
2. [October1 persistent stances](../../supabase/migrations/20261001130000_combat2_character_persistent_stances.sql#L498), with generated source copy `20261001213148_dec8975a-1fb3-43c9-b5a8-73620bd1e0e8.sql`, renames the settlement body to `settle_out_of_combat_resources_without_character_stances`, then creates an outer wrapper that invokes it and conditionally regenerates Force Shields. Project-state records installation as operator evidence. Replacing the outer wrapper with September23 code would remove that composition and `force_shields_regenerated` result.

These are **proven repository omissions in the prepared cutover**, but the reported installed mismatch alone does not prove hosted bodies equal these sources. Expected source-derived body SHA-256 (LF-normalized prosrc, not full definitions):

| Body | Reference hash |
|---|---|
| September23 base used by old C2 package | 6f3adbcae008361bbec089f55a42f1eb1f348fb3ee519c2da67a2df0948d9135 |
| September24 corrected body, later renamed inner | 69e507eb64d25d0559cfd4a37cfc4e3016b2201f221692a3326bb9c219d46e90 |
| October1 outer settlement wrapper | 17185b0df23c90e8707a739249c7940324dd387d49f6ec300a7be1d58d99c183 |
| October1 Force Shield regeneration helper | bb2b219f099d6f78809ff1172f219518e5d20f3894dab8a06adddcf8ce1764d8 |

**Recommendation:** accept/preserve the later reviewed composition **if exact installed definitions/security/ACLs match**; do not restore September23 or merely whitelist the outer hash. Obtain only these three definitions plus owner, security mode, volatility, path, ACL and body hash. If different, compare semantic differences before choosing a patch.

Once confirmed, the smallest C2 revision patches the actual inner character loop with the active-character predicate, preserves the wrapper/present-fighter predicate/cursor/cadence/formulas, and checks the stance helper's active-character boundary. The lifecycle prerequisite must follow the preserved outer→inner route, not insist on a character loop in the wrapper. Review helper exclusion if necessary without changing Force Shield calculations or unrelated combat rules. Regenerate the composed B package and guards only after that evidence is available. **No runtime SQL/hash guard was changed here**; current B remains blocked and its old strict guard safely refuses the known later wrapper. Tests demonstrate refusal without altering the chain; they do not validate installed behavior.

## Installer privileges: check target capability, not inspector authority

`supabase_read_only_user` failing an Auth TRIGGER check proves nothing about the standard installer. A/B require actual `current_user=postgres` during execution. Revised read-only preflight checks **postgres** Auth USAGE/TRIGGER, public CREATE and current-database CONNECT; pg_cron schema USAGE, exact `cron.schedule(text,text,text)` EXECUTE and job-table SELECT; role login/security attributes; API owner/language/security mode and dedicated job-name collision. No grants, SET ROLE, scheduling or installer probe.

pg_cron1.6.4 is supplied installed metadata. Exact API availability/effective postgres permissions remain **unverified**, not failed. Auth TRIGGER/cron scheduling are B gates; their absence alone does not invalidate dormant A. A still requires its postgres/public CREATE/identity/storage dependencies. ACL metadata can establish entry permissions, not prove launcher/job execution. No passwords, connection configuration or secret material is requested. Inspect actual installer identity as part of a later explicitly authorized standard-tool operation, never invoke a migration just to discover it. Preserve existing world jobs and the single authoritative heartbeat.

## Minimal next Lovable action and sequence

One **read-only** pass, no tool installation/probe:

1. Run revised integrated preflight for postgres capabilities. Return actual inspector identity, API metadata/target privilege booleans and reliability flag; no grants/schedule calls.
2. Run blocker-evidence visibility query; proceed with the203-row snapshot only under complete administrative visibility. Return only the narrow material/FK/trigger evidence described above.
3. Return the three settlement-chain definitions/metadata. No gameplay or maintenance function invocation.

Then locally review evidence, obtain exact orphan-disposition approval, and prepare the known-chain runtime patch/updated B guards. **A remains separate and unchanged**, conditionally proposable once its dependency/installer checks pass; it does not require deleting orphans or changing runtime settlement. Future cleanup requires its own reviewed data-mutation authorization. Recheck zero physical orphans afterward. **B is NO-GO** until orphan resolution and preserved-chain SQL are reviewed, plus the existing separate cutover authorization. No activation/frontend publication or new product-policy approval is implied.

## Local validation and changes

Focused local tests: installer-vs-inspector privileges and RLS count reliability; old package refusal preserving the later wrapper/corrected inner; five cleanup tests for unfilled refusal, exact allowlist/rollback, snapshot/live-parent drift and recovery evidence. SQL tests use disposable PGlite, not hosted state or independent sessions. Force Shield test uses a stub solely to prove wrapper invocation/result composition. 45/45 extended C2 SQL tests,5/5 cleanup tests and3/3 project-state tests pass. Project-state/generated-view/composition/diff checks pass. Initial fixture omissions were corrected; no baseline failure remains. No application code, installed migrations, journal/snapshot/types, grants or runtime package bodies changed.

Exact files changed (10):

- docs/operations/progression-001G-C2-integrated-preflight.sql
- docs/operations/progression-001G-C2-integrated-handoff.md
- docs/operations/progression-001G-C2-blocker-evidence.sql
- docs/operations/progression-001G-C2-orphan-cleanup-template.sql
- docs/operations/progression-001G-C2-blocker-resolution.md
- scripts/progression-001G-C2-P2-C-sql.test.mjs
- scripts/progression-001G-C2-orphan-cleanup.test.mjs
- docs/operations/project-state.json
- docs/operations/project-state.md
- docs/roadmap/game-engine-roadmap.md

No commit/push or hosted mutation.

Four F limitations preserved: **HOSTED MULTI-SESSION BEHAVIOR UNPROVEN; NATURAL RUNTIME PATH NOT YET OBSERVED; AUTHENTICATED COMMANDS-PAUSED RUNTIME PROBE NOT EXECUTED; RP EARNING AUTHORITY GAP.** Affected roadmap ENG-PROGRESSION-001G/C2 and existing authority/resource/failure specification rules preserved.

## SQL identity

| File under docs/operations | SHA-256 |
|---|---|
| progression-001G-C2-integrated-preflight.sql (revised read-only) | 609fbb06b10e14174f3d58a2f721478bf3b8acf41a54ed18b803e53c864257be |
| progression-001G-C2-blocker-evidence.sql (read-only) | 5e9ba617020c6a426f845d298bc415d5199da747873eef92503f465e71bef147 |
| progression-001G-C2-orphan-cleanup-template.sql (incomplete/nonexecutable without snapshot) | 0d201b516cd6c0482f71cb7e10bcb7fb072a47cc7f8d6162098fac7986a9b2d4 |
| progression-001G-C2-integrated-private-support.sql (unchanged A) | 5aa1c167bd59c239e94bdfd9e7a929f5ed060deda9ad3f754a68b83b8e01938c |
| progression-001G-C2-integrated-cutover.sql (unchanged, blocked B) | 2977ee653b31c8ecca9ff2881e5764bc97251f1212d0b0457c8f5bbee5ea6024 |
