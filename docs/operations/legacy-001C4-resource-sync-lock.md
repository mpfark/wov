# ENG-LEGACY-001C4 — minimal resource sync lock handoff

**INSTALLED / METADATA VERIFIED per owner-supplied C4B evidence**, reconciled by C4C on 2026-10-12. Local preparation/installation instructions below are historical and are not authorization to replay 0018. Starting source `4ee7994cbe1e19ea836b634e7dec28d386088844`. Reuses [C2 boundary/lock analysis](legacy-001C2-resource-sync-ac-ownership.md) and [C3 preflight](legacy-001C3-resource-sync-preflight.md). No engine formula, AC, item override policy, callbacks or legacy helper changes.

## C4B installation / C4C source reconciliation

- Installed migration: `0018_legacy_001c4_resource_sync_lock`, owner-reported hosted Drizzle history 19 rows/latest0018.
- Automatic commit `92ce58e2a1583fed23e6fd7698abee19c86091e1`, merged at `0ef1a1a3827d692e6a0f1b0836c45854dc7e45d2`; clean local checkout fast-forwarded from a21bbd0e with ancestry verified, no history rewrite.
- Committed migration SQL is byte-identical to the approved `719809335e6a3ae7d5b560322d5a2332fc2a59ce68b7ec0960c6dd2e32b7c3c6` artifact. Source journal index18/tag0018 and snapshot chain through 19 entries verified; original18 source entries unchanged. Windows working-copy line endings do not replace the committed-byte comparison.
- Installed normalized prosrc `65fef58ca1438e8f276b2f6eeef48272aa93174e9b95043d500a64f197377638`; original owner/security settings/EXECUTE preserved, per supplied hosted evidence. No direct hosted inspection by Codex. Full observation timestamp/role/catalog output not supplied; the date here is recording date, not an invented installation time.
- Lovable cost 2.7 credits, owner-reported. No additional Lovable work requested. Automatic changes limited to migration SQL/journal/snapshot; no generated types, Edge or frontend source change in these commits.

C3's three REQUIRES EVIDENCE remain unresolved at their supplied evidence level: no full per-check breakdown was supplied, so do not invent their identities or mark all trigger/isolation metadata PASS. Independent-session blocking/runtime remains unverified. C1/C2's AC freshness, SQL/TS empty override semantics, equipment callbacks/separate transactions, retained heal/damage helper authority and privileged equipment/ward writers still require targeted disposition. The exact unlocked-read defect is corrected in installed source; this is not overall C closure or proof every resource interleaving is safe.

## Exact correction / evidence

[Reviewed SQL](legacy-001C4-resource-sync-lock.sql), SHA-256:
`719809335e6a3ae7d5b560322d5a2332fc2a59ce68b7ec0960c6dd2e32b7c3c6`.

Only body change in `public.sync_character_resources(uuid)`:

```sql
SELECT * INTO c FROM public.characters WHERE id=p_character_id FOR UPDATE;
```

It replaces the identical initial unlocked SELECT. Authorization remains before it; current HP/CP/MP, attributes, class and level are captured only by this locking read. The lock lasts through equipment aggregation, calculation, resource UPDATE and transaction end. Existing bounds/clamping and SQL empty-override semantics remain byte-identical; a higher maximum grants no current resources. No AC, base-attribute, inventory or trigger writes are added.

Owner supplies C3 results: four PASS, zero FAIL, three REQUIRES EVIDENCE, installed normalized sync fingerprint `f5fb2896e66dec364d86403494c485b0e9ef967e7fe1bb99a1fae7bf8a30e096`. This confirms the installed unlocked body **as owner-reported evidence**, not direct Codex hosted verification. Check-by-check results, observation time/role and full remaining-gap descriptions were not supplied in C4; do not invent which three checks remain unresolved or treat all metadata as PASS. No hosted mutation/concurrency test reported.

## Serialization and lock order

The lock protects the sync's captured character record: earlier committed resource mutations are read before calculation; later mutations of that character must wait. UPDATE's previous late lock did not protect those earlier captured values. Under READ COMMITTED, locking SELECT follows the committed row after a conflicting updater completes; under stricter isolation PostgreSQL may reject the transaction with a serialization error rather than write a stale version. Existing caller/error handling is unchanged; no retry framework is introduced.

| Existing owner / source | Compatibility |
|---|---|
| Combat commit, 0002:367–378; B3A node-first wrapper | Node/encounter precede character/inventory. Sync adds only the character lock and never acquires node/encounter/advisory locks afterward. Existing current-resource UPDATE was already character-locking; acquisition moves before its captured read. No new lock-order reversal in this traced body. |
| OOC settlement, 0013:359–507 | Cursor/UUID-ordered character locks before calculation. Single-target sync does not request cursor or another character afterward; keeps OOC eligibility separate. |
| Progression derived helper, 0001:81–117 | Character FOR UPDATE before base values/config/gear; enclosing progression supplies its own decision and locks. Sync does not acquire class/config locks or progression receipts. |
| Inventory action/repair, September inventory authority:26–220 | Request advisory → character → inventory. Sync character lock then ordinary MVCC equipment reads; no new inventory row/advisory lock. Compatible with this canonical gear serialization, without making equip/repair and subsequent sync atomic. |

Exact filenames and fuller caller ordering are in C2. Restrict/lifecycle/resource triggers may hold additional locks; complete current trigger topology and actual RPC isolation remain as reported C3 evidence gaps, not independently verified here. There is no claim of universal deadlock freedom. The unchanged UPDATE activates the same trigger set as before; the patch does not modify or assume a new trigger.

This change does not freeze bypassing service inventory writers, item templates or all claimed combat snapshots. It does not solve AC freshness, two-RPC equipment synchronization, ignored callback errors, or SQL/TS override differences. Those remain separate follow-ups; no previously accepted closure is reopened.

## Exact installation prerequisites and handoff

Before separately authorized installation, confirm:

- Target signature exists; original normalized prosrc is exactly `f5fb2896e66dec364d86403494c485b0e9ef967e7fe1bb99a1fae7bf8a30e096` (CRLF → LF only).
- Owner postgres, scalar jsonb, plpgsql, volatile, SECURITY DEFINER, exact `search_path=public`, argument name `p_character_id`, no defaults. The SQL refuses drift rather than patching an unknown function.
- Read/reconcile the actual C3 full security/EXECUTE and trigger findings where available. Preserve original ACL, owner and settings and effective anon/authenticated/service access; no grants/revokes. The transaction snapshots those values and checks equality afterward, including custom direct ACLs. Visibility gaps remain REQUIRES EVIDENCE, not a reason to broaden privileges.
- Reviewed source checkpoint is separately committed/pushed, SQL hash matches, current standard Drizzle prefix is verified and no unrecorded pending migration/path collision exists. Historical Supabase ledger/routing remain frozen.

Minimal later Lovable task, **not authorized by this preparation**: install these exact bytes transactionally using the standard custom-SQL Drizzle workflow; let the tool create numbered SQL/journal/snapshot. Keep this reviewed artifact outside migrations until then; do not hand-register or repair history. Stop on guards, unexpected metadata or runner mismatch. Inspect automatic commits after success/failure and compare generated SQL, journal/snapshot, installed history and full function/security/ACL readback.

Expected patched normalized prosrc:
`65fef58ca1438e8f276b2f6eeef48272aa93174e9b95043d500a64f197377638`.

Post-install verification is metadata-only unless separately authorized. No gameplay sync, concurrency probe, Edge deployment or frontend publication is requested. Installation authorization and any unavailable prerequisite readback remain gates; no additional gameplay policy decision is needed for the one-line lock correction.

## Local validation

Nine isolated PGlite tests PASS using the actual original function and exact correction: body difference limited to FOR UPDATE; previously committed damage/healing/spends retained; increasing maxima grants nothing; clamp/dead/null behavior; gems/empty override/broken gear; owner/missing-target refusal; AC/attributes unchanged; injected late trigger failure rolls back; actual/custom ACL preservation; source-drift refusal. A before/after comparison observes the additional RowShare relation lock retained to transaction end and rollback preservation.

Fixture ownership is deliberately modeled, not real hosted JWT/RLS/trigger topology. PGlite here has one backend session: sequential serialized updates plus source-order and lock-mode checks **do not demonstrate independent-session blocking or reproduce a concurrent hosted race**. No independent-session PostgreSQL harness was established for these checks. PostgreSQL locking semantics/source invariant support the correction; multi-session execution remains unproven, not silently PASS. No gameplay mutation probe performed.

Command: `node scripts/legacy-001C4-resource-sync-lock.test.mjs ../001C-local-db-tests/node_modules/@electric-sql/pglite/dist/index.js`.

Project-state/source checks, reviewed hash, links, whitespace and immutable migration-chain checks accompany preparation. Existing Windows bash ENOENT import-specifier check remains separately reported without test changes. No build/typecheck necessary for SQL/artifact-only preparation. Recovery stash, Combat2/progression closures, four OPEN F limitations and v3→v2 uncertainty preserved. Administrative XP grants remain paused; normal gameplay XP policy unchanged and runtime not newly established.

Additional results: 18 existing source/project-state/mirror equality tests PASS; one unchanged import-specifier test FAILS with `spawnSync bash ENOENT`. State synchronization, three handoff links, 18-entry migration chain and whitespace PASS. The nine new SQL tests are separate from these source checks; the Windows failure is not counted as a pass.

**GO for source review/publication consideration. NOT an installation GO without the prerequisite checks and separate authorization.**

## Lovable installation prompt — requires separate installation authorization

> Confirm the published C4 checkpoint and verify `docs/operations/legacy-001C4-resource-sync-lock.sql` SHA-256 `719809335e6a3ae7d5b560322d5a2332fc2a59ce68b7ec0960c6dd2e32b7c3c6`. Reconcile the full C3 metadata and outstanding visibility gaps. Target `public.sync_character_resources(uuid)` must have normalized prosrc SHA-256 `f5fb2896e66dec364d86403494c485b0e9ef967e7fe1bb99a1fae7bf8a30e096`, postgres owner, scalar jsonb, plpgsql/volatile/SECURITY DEFINER, exact search_path=public, argument p_character_id and no defaults. Record original owner/settings/direct ACL and effective anon/authenticated/service EXECUTE; preserve them unchanged. STOP on source/security drift or an unresolved prerequisite; do not replace expected hashes or broaden grants.
>
> Verify the current installed Drizzle prefix against the published journal/SQL and ensure no pending migration or filename collision. After separate owner installation authorization, use only the standard Lovable custom-SQL Drizzle tool to install the exact artifact transactionally. Let the tool create numbered SQL/journal/snapshot; no hand registration, alternate runner or historical Supabase/Drizzle repair. No other function, trigger, AC, formula, override, callback or privilege change.
>
> After success or failure inspect automatic source commits. Verify generated SQL hash, journal/snapshot chain and installed history separately. On success return the installed normalized prosrc fingerprint `65fef58ca1438e8f276b2f6eeef48272aa93174e9b95043d500a64f197377638` and unchanged owner/security/search_path/direct ACL/effective EXECUTE evidence. On failure report diagnostics and establish rollback; do not retry automatically or repair history.
>
> No gameplay/resource-sync invocation, concurrency probe, direct data repair, Edge deployment or frontend publication. Metadata verification is not runtime/concurrency proof. Source publication alone does not authorize this installation.
