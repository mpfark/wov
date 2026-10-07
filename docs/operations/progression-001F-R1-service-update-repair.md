# ENG-PROGRESSION-001F-R1 service UPDATE repair

ENG-PROGRESSION-001F INSTALLED / VERIFICATION BLOCKED BY SERVICE_ROLE CHARACTERS UPDATE REGRESSION. R1 is prepared locally for a separately authorized narrow forward ACL repair. F Edge NOT DEPLOYED / COMMANDS PAUSED / FRONTEND NOT PUBLISHED. This is not F closure or installation authorization.

Starting source: `b8c18c90b1b5a5532244b76c41568a15986a0cfe`; fetched/synchronized source: `491677c891c22f81dab261b7c970dc044ad62bf3`. Main fast-forwarded normally through platform commit `819fd1236760d249c7965a2dc36476b7ca82f33f` and its merge `491677c8`. Both are descendants of the starting source and the recorded project-state baseline. Platform changes consist only of 0005 SQL, its snapshot/journal entry and generated Supabase declarations. All are preserved. Recovery stash `0a5529d5227675319b166881b10f1c91edd7486b` remains untouched. Final pushed identity is in the final handoff, avoiding a self-referential commit SHA.

Mik's supplied hosted evidence says standard Drizzle 0005 `progression_001f_canonical_renown_respec_authority`, row id6, committed atomically. Installed/reviewed bytes match SHA-256 `c5c3c05341a7fc42678326d9572ed1442f04579e568d228b4d89f5eb811e18ff`, 57669 bytes / 693 LF lines. Six canonical F identities, key containment and protected Renown raw-write fencing passed; character/Renown fingerprints were unchanged; disposable hosted HMAC probe passed. Unrelated service character UPDATE was over-revoked. This is operator-reported Cloud evidence, not a Codex inspection. No rollback or rewrite of 0005 is planned.

## Root cause and verification boundary

The installed F block granted unprotected column UPDATE and then revoked table UPDATE. PostgreSQL table REVOKE removes matching column privileges too. The strongest available local engine, PGlite0.3.14 / embedded PostgreSQL17.5, **reproduces this behavior**: table UPDATE=false and hp UPDATE=false after the original sequence. The unchanged complete F payload likewise leaves no service column UPDATE in the expanded fixture. There is no observed PGlite semantic difference for this bug. The original F tests missed the positive unprotected privilege assertions; their negative protected-field checks passed despite loss of all writes.

No native psql/postgres/docker executable is available. Embedded PostgreSQL proves local ACL and actual DML behavior, not hosted schema identity, hosted effective role membership, concurrency or live callers. The existing F pgcrypto availability substitution/disposable HMAC fixture is used only to establish local 0005; **R1 SQL executes unmodified**. No control row is ever activated. Hosted post-repair verification remains required.

## Exact reviewed inventory

Source: current generated `src/integrations/supabase/types.ts`, `characters.Row`, preserved at synchronized source. All53 existing columns were previously covered by broad service UPDATE. No intentional additional exclusions; no future-column discovery/grant at install.

Protected15:

`str, dex, con, int, wis, cha, level, xp, class, is_classless, unspent_stat_points, respec_points, bhp, bhp_trained, rp_total_earned`.

Unprotected38, exact explicit service grant:

`ac, active_contract, combat_trace_enabled, contracts_completed, cp, created_at, crown_item_created, current_node_id, family_changed_after_creation, family_id, family_name, gender, gold, hp, id, king_slayer_at, last_death_at, last_death_log, last_online, max_cp, max_hp, max_mp, movement_locked_until, mp, name, portrait_generated_at, portrait_metadata, portrait_url, race, reserved_buffs, soulforged_item_created, soulring_inventory_id, soulring_tier, stance_state, updated_at, user_id, wimp_direction, wimp_hp_threshold`.

The complete53-column inventory is exactly the union above, with no overlap. The manifest also supplies one sorted complete list. Restoring identity/ownership/resource fields preserves the previously broad service authority; this task does not redesign admin privileges. PostgreSQL-owned functions and existing triggers retain their own constraints.

Browser authenticated preference UPDATE remains exactly `last_online, wimp_hp_threshold, wimp_direction, portrait_url, portrait_metadata, portrait_generated_at`; authenticated SELECT remains present and table UPDATE absent. Source evidence: the September inventory/character-authority migrations. Every non-service-UPDATE table/column ACL entry is compared before/after, including grant options and grantors.

## Bounded direct service-role writer audit

Search covered current `supabase/functions`, `src` and `scripts`; all direct service-role PostgREST character UPDATE calls are the following ten calls in four Edge files. AST regression scans every Edge TypeScript file and pins their paths/counts. All four clients use the service-role key. Other Edge character references (`mcp`, shared orchestration, gemcutter) are reads. Browser `GamePage`/`useCharacter` use authenticated grants; SQL RPC bodies are separate postgres authority and outside this direct-writer audit.

| Writer / action | Protected fields, still denied | Existing unrelated fields, restored |
|---|---|---|
| sell-material | none | gold |
| ai-character-portrait | none | portrait_url, portrait_metadata, portrait_generated_at |
| forge-strip (endpoint paused) | none | gold |
| admin-users set-level | level, xp, str, dex, con, int, wis, cha, unspent_stat_points, respec_points | max_hp, hp, max_cp, cp, max_mp, mp |
| admin-users update-character allowlist | xp, str, dex, con, int, wis, cha, unspent_stat_points, respec_points | name, hp, max_hp, gold, ac, current_node_id, gender |
| admin-users teleport | none | current_node_id |
| admin-users revive | none | hp |
| admin-users reset-stats | str, dex, con, int, wis, cha, unspent_stat_points | max_cp, cp |
| admin-users grant-gold | none | gold |
| admin-users grant-respec | respec_points | none |

Mixed protected/unprotected updates fail as whole SQL statements; restoring unrelated columns does not make set-level/reset-stats successful. Protected admin operations remain fenced pending001G. Ordinary admin grant-xp remains paused. No caller implementation changed.

## Reviewable forward artifact and guards

SQL: [progression-001F-R1-service-update-repair.sql](progression-001F-R1-service-update-repair.sql). Generator: `scripts/prepare-progression-001F-R1.mjs`; machine identity/inventory: [manifest](progression-001F-R1-manifest.json). Future authorized migration name: `progression_001f_r1_restore_unprotected_service_updates`. Nothing is registered in Drizzle discovery now.

The artifact requires a standard surrounding Drizzle transaction and locks characters ACCESS EXCLUSIVE before inspecting/granting. Exact sequence:

1. A: Verify installed0005 identity and the observed complete service UPDATE loss.
2. B: Revoke service table UPDATE.
3. C: Explicitly revoke protected15 column UPDATE.
4. D: Grant exactly the reviewed unprotected38 columns.
5. E: Assert no table UPDATE, every protected=false, every unprotected=true, unchanged other ACLs/authority and paused control.

Guards pin all six F bodies and full function metadata (signature, owner, definer/invoker, language, return/set, search_path, volatility, parallel, strict/leakproof, argument names/defaults). Each has one overload, including the single eight-argument command. Raw fence trigger identity/enabled/type are pinned. Character owner must be postgres; sorted full inventory matches exactly and generated/identity columns refuse. Protected/granted sets are disjoint and reconcile exactly53.

Control must have exactly one singleton false row. Current service table/any-column UPDATE must be false; unexpected partial repair or inherited access aborts rather than guessing. Browser six-column/SELECT contract is pinned. Command direct/effective EXECUTE is service-only; private F EXECUTE remains owner-only. Legacy train_renown_stat remains owner-only and F's five-operation receipt check remains installed.

Private sidecars/key require postgres owner, RLS, no policies, no nonowner table/column ACLs. Key catalog inventory/type/nullability, version PK/positive check, 32-byte material constraint and unique valid active-key partial index are checked **without selecting any key row or material**. Effective nonadministrative/custom-role access is denied; PostgreSQL built-in pg_read_all_data/pg_write_all_data roles inherently have administrative data privileges and are excluded as direct principals, while memberships held by ordinary/custom roles still fail effective checks.

Before/after catalog equality covers every progression function/table/attribute/constraint/index/policy and character trigger plus all other character ACL entries/owner. This proves command/private/key metadata and browser grants unchanged by repair. Unknown guarded drift raises an exception and rolls back the surrounding transaction.

## Data safety and regression coverage

Production mutations are exactly two REVOKE statements and one GRANT. No data UPDATE/INSERT/DELETE/TRUNCATE, function replacement, gameplay call, key read/rotation, backfill, receipt, activation or inventory/combat write exists. Catalog snapshots and the false-control read are the only reads beyond privilege checks. The disposable fixture compares character, sidecar, milestone, control, inventory and encounter/fighter rows before/after. A key DML/TRUNCATE sentinel aborts any attempted mutation without reading key data.

R1 tests execute real positive service DML for gold, hp, current_node_id and all three portrait fields. Each of the protected15 columns has an actual denied service UPDATE. Negative fixtures detect missing hp privilege, protected grant, broad table grant, new/missing column, browser grant drift, owner/identity/function ACL/key containment/overload/fence drift and unrelated command authority mutation. The historical unsafe sequence fails the new positive final assertions. Activation is checked statically; no row is set true.

Historical F generator/artifact/manifest and0005 are preserved. Its archival `--check` assumes the pre-install migration prefix and live release hashes, so R1 uses a dedicated synchronized-prefix check, verifies the exact installed0005 bytes, and independently confirms historical F `payload()` still equals its frozen artifact. New artifacts are deterministic UTF-8/LF without BOM.

## Validation and handoff

Final SQL SHA-256: `a5471f1e249e22a40910ce132359c28fd782fcb6998e8d1e3242afdc14ffa51a`; **21577 bytes /182 LF lines**, UTF-8, no BOM. Deterministic generator/manifest, frozen F payload reproduction, exact0005 bytes and synchronized migration/journal/types/runtime preservation checks pass.

Validation: R1 ACL9; F authority39; F actual Combat2 chain12; C16; D integration9; D containment6; E22; E chain11; historical E-R1 assertions11; E-R2 repair8; historical F audit5: all pass. Focused Edge/browser/progression/Combat2/state acceptance: **276 passed**, including F browser21 and project-state3. Root/app/node/strict Edge TypeScript checks pass; production build passes. Full suite at **maxWorkers2:2751 passed/18 failed**, exactly the same18 failure identities as accepted `F-impl-full.json`; no new or removed failure identity. Logs live outside the app at `../001C-local-db-tests/F-R1-*`. Generated build/test snapshots and MCP mirror were restored after validation; no runtime changes remain.

Affected specification sections: Engine principles and authority; Progression and rewards; Failure, diagnostics and verification. Roadmap ID: ENG-PROGRESSION-001F (R1 corrective ACL preparation). All engine rules, economics, protected-field boundaries and the shared heartbeat decision are preserved; operational status changes only.

Retained limits: **HOSTED MULTI-SESSION BEHAVIOR UNPROVEN; NATURAL RUNTIME PATH NOT YET OBSERVED; AUTHENTICATED COMMANDS-PAUSED RUNTIME PROBE NOT EXECUTED; RP EARNING AUTHORITY GAP**. The uncalled equipment degradation writer gap remains separately scoped.

Next safe action is separately authorized standard hosted ACL repair followed by exact effective-privilege, identity, paused-control and data-preservation verification. No hosted access, Lovable invocation, installation, Edge deployment, activation, frontend publication or001G/H work occurred in R1.
