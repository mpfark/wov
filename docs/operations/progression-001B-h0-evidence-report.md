# ENG-PROGRESSION-001B-H0 — Read-only hosted evidence report

- Window: 2026-10-04 12:43:26–12:47 UTC. Actor: Lovable. Read principal: `supabase_read_only_user` via the authorized Cloud read tool (SELECT only). Project ref `gpclaklkaolyzfnooajt` (tool metadata).
- Source: start = synced = `c50cbb6568ffc5f48575f9d2bb2f811a37536efe` (origin/main); R1 baseline `b0a1feb1…` and 001A `c6c63fc2…` in ancestry.
- Executed handoff: `progression-001B-h0-readonly-followup.md`. No mutation, migration, ledger change, function call, deployment or publication. 001C not started. Engine Progression rules preserved.
- Outcome: **H0 remains_blocked**.

## 1. Hosted Supabase ledger export

510 rows, newest `20261001230000`, `20261002190000` absent. Every row has exactly one statement; `created_by = apikey@lovable.dev` on all 510; 234 rows carry an idempotency key; 269 rows have a non-empty name. Export (hashes only, no statement text): `migration-reconciliation/hosted-ledger-2026-10-04.csv`.

Hash algorithm: `sha256(convert_to(array_to_string(statements, E'\n'), 'UTF8'))`, hex. With one statement per row this is SHA-256 of the statement text. No redaction was needed for hashing; statement text was not committed.

Drizzle history (from 001B, unchanged): 1 row, id 1, hash `73df81b1…2b65`, created_at 1791021613818 = local journal `when`; journal time is not execution proof.

## 2. Content-based source → ledger mapping

Each repository file was compared to ledger statement hashes under six byte variants: exact bytes, final newline stripped, CRLF→LF, CRLF→LF plus final newline stripped, whole-text strip, and per-line trailing whitespace. Full mapping: `migration-reconciliation/hosted-content-mapping-2026-10-04.csv`.

| Result over 545 sources | Count |
|---|---|
| Content equals the ledger row with the same version | 278 |
| Content equals a ledger row under another version | 258 |
| No ledger row with equal content | 9 |

- No source matches more than one ledger row.
- 505 of the 510 ledger rows are matched by content. 31 ledger rows are each matched by two sources: these are the 31 R1 duplicate-content groups, with a generated copy plus a descriptive source.
- Delta histogram for the 258 (ledger minus source, real seconds): −1 s ×168, −2 s ×34, +1 s ×14, −3 s ×4, and 38 singletons ranging from −82831 s to +167416 s (the generated or descriptive aliases).
- **Reconciling 001B's numbers:** 001B's "279 exact" was a version-only match. 278 of those match by content. The 279th, `20260731134850`, has the same version but different content: the repository file was later edited to remove emoji. 001B's "~230 nearby" and "40 unmatched" both came from timestamp matching. Content matching replaces them with 258 and 9. The R1 figure of 36 is the correct count of named sources: 31 of the 36 content-match exactly the alternate R1 listed, and the other 5 have no ledger content.

### The 9 sources with no equal ledger content

| Source | Hosted finding |
|---|---|
| 20260302163721 (area types) | Ledger `20260302163720` differs only by emoji literals stripped from the repository later (no-emoji policy edit) |
| 20260329075004_email_infra | Ledger `20260329075003` differs only by an appended comment block in the repository |
| 20260511100538 (materials seed) | Ledger `20260511100537` differs only by stripped emoji literals |
| 20260731134850 | Same-version ledger row; repository later had emoji removed |
| 20260831133000 scheduler foundation | No ledger row creates `combat2_dispatch_schedule_state` (it is referenced first by `20260906134803` RLS ALTER, and the table exists). Creation is **not attributable** from the ledger |
| 20260906160000 test-environment controls | Nearest ledger `20260906144044` is a different earlier version (ratio 0.984, 11 changed lines: deterministic stop id, raise-on-failure, removed recent-player gate); later `20260911222513` also redefines `combat2_test_environment_start`. Source equivalence: **none** |
| 20260907110000 test runs | Ledger `20260907055519` (placeholder draft) and `20260907055727` (ratio 0.988; ledger adds leading DROP … IF EXISTS lines). Not equal; **unattributed** |
| 20260915200000 reward channels (excluded) | No ledger content; `admin_creature_reward_request` and `admin_set_creature_rewards` absent from the catalog. `20260921223049` is contract-only claim-snapshot repair and creates no objects of this file. Remains repository_only |
| 20261002190000 Batch C | Absent; Drizzle row only |

### The 5 ledger rows with no equal source

The four rows listed above (`20260302163720`, `20260329075003`, `20260511100537`, `20260731134850`) are explained by repository edits made after installation. The fifth, `20260728070225`, is named `20260728070224_b2491f76-…`; it is a `sync_character_resources` replacement, and no repository file under either version has ever existed in Git history (`git log --all`). It is **ledger_only**.

## 3. Batch C reconfirmation

Source and Drizzle copy SHA-256 `73df81b1…2b65` (unchanged checkpoint files). The canonical version is absent from Supabase history, and the rejected `1fc13140…` is absent from both histories. Function fingerprints and ACLs were recorded in 001B at 10:45–10:51 UTC. They were not re-read in this pass, so they are a historical observation only.

## 4. Runner routing, discovery and history behaviour

Evidence is documentation and metadata only. The active Lovable migration tool contract says it creates an empty Drizzle Kit custom migration, writes the SQL verbatim, runs `drizzle-kit check`, and applies it with Drizzle's migrator to `drizzle.__drizzle_migrations`. `drizzle.config.ts` targets `./drizzle/migrations`.

All 510 Supabase rows have `created_by = apikey@lovable.dev`. This shows a different, earlier Lovable route that wrote `supabase_migrations` (the generated-version and idempotency-key pattern). That route's discovery rules are not documented in the available tooling.

- **Not proven:** whether any current or future runner discovers `supabase/migrations/*`, whether the Drizzle runner would also read the Supabase history, and what it would plan.
- **No status, list or preview capability is exposed** by the available tools, so no planned set was captured. No migration tool was run as a probe.

## 5. Metadata-only recognition capability

None is available. The available tooling exposes no documented operation that records a Supabase history row without executing SQL. A hand-written INSERT is excluded by the handoff. A safe Batch C repair handoff therefore **cannot** be prepared.

## Remaining H0 blockers

1. Runner discovery and planned set are unproven, and no non-mutating preview exists.
2. No metadata-only recognition capability exists.
3. The scheduler-foundation table's creation is not attributable to any ledger row.
4. Test-environment-controls and test-runs sources are not equal to any ledger row; their installed bodies would need a catalog-vs-source comparison.
5. `20260728070225` is ledger-only with no source.
6. Four repository files were edited after installation, so their content differs from the ledger. A CLI-style runner would see versions `20260302163721`, `20260329075004` and `20260511100538` as pending, plus the 258 alias versions.

## Limitations

Statement text was compared in the sandbox and not committed. Function bodies were not re-fingerprinted in this pass. Deployed Edge revisions, Vault and dynamic or external callers were out of scope.

## H0-FINAL — Drizzle prefix integrity and legacy-route freeze (2026-10-04 22:33:30 UTC)

- Repository inspected: `2600f52352aaf0de0047cb4d567f645cb1ca5407` (HEAD = origin/main, clean). Actor: Lovable, read-only Cloud query tool (SELECT only). No migration tool invocation.
- Committed journal: 1 entry, idx 0, tag `0000_combat2_legacy_browser_privileges`, when `1791021613818`. Only SQL file `drizzle/migrations/0000_combat2_legacy_browser_privileges.sql`, SHA-256 `73df81b17ee54a0294e231d2f91a70ecc3a9da37508c027f00674d8181b92b65` (identical to the Supabase source copy).
- Hosted `drizzle.__drizzle_migrations`: 1 row, 1 distinct hash: id 1, hash `73df81b1…2b65`, created_at `1791021613818`.
- Comparison: one-to-one with journal idx 0; hash equal; created_at equals journal `when`; no unknown hosted rows; no unrepresented journal entries; no pending Drizzle migrations; no duplicates or gaps.
- Legacy route: Supabase ledger unchanged at 510 rows, newest `20261001230000` (no new writes since the earlier H0 pass). `cron.job` has 0 rows. Repository has no `.github` workflows and no non-doc scripts invoking `supabase db push`, Supabase migration commands or `drizzle-kit migrate/push`.
- Limitation: Lovable platform-side automation outside the project database and repository is not visible; none is identified. The freeze rests on that plus the platform statements recorded in `migration-baseline-strategy.md`.
- **Verdict: A — H0 FINAL CHECK PASSED.** Evidence requirements for H0 closure are satisfied; the legacy Supabase route is recorded as operationally frozen. Migration execution still requires per-task authorization; 001C not started.
