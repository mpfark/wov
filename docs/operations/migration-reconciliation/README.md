# ENG-PROGRESSION-001B-R1 reconciliation

Local evidence analysis pinned to `b0a1feb19e009f16ecb899fe7cae94f5940f446e` (Verified ENG-PROGRESSION-001B). H0 **remains_blocked**. This plan neither authorizes nor performs history repair. Engine Progression and rewards rules are preserved; ENG-PROGRESSION-001C is not started.

## Reproduce

From repository root, run `node scripts/reconcile-migration-history.mjs` to regenerate, `node scripts/reconcile-migration-history.mjs --check` to compare, and `node --test scripts/reconcile-migration-history.test.mjs` to validate parsing, normalization, evidence boundaries and deterministic output. Only local Git and pinned repository blobs are read. No environment values, credentials, network, SQL execution or database clients are used. Updating project state does not change these pinned inputs.

`matrix.json` and RFC-style quoted `matrix.csv` contain every source path, version/name, first Git introduction, blob OID, exact-byte SHA-256, normalized-text SHA-256, available history attribution, confidence, timestamp delta, classification and action. `summary.json` records totals, input hashes, duplicate groups, drift evidence and journal. `unmatched-decisions.md` lists each named unmatched source individually. This is a complete **repository** inventory, not a reconstructed complete hosted ledger: 545 Supabase migrations, four explicitly staged pending SQL files and one Drizzle file, plus six specifically reported ledger-only identities = 556 rows. Other ledger rows are not invented.

## Evidence and vocabulary

Fresh installed observations come from `../progression-001B-evidence-report.md`, inspection 2026-10-04 10:45:59–10:51 UTC. Earlier attributed installation mappings come from pinned project-state.json; each row labels their age and whether fresh identity verification exists. Local source equality proves only equality of retained source artifacts. Normalization changes CRLF to LF and terminal whitespace/newline only, not SQL semantics. Split ledger statements were not exported or reassembled, so ledger byte/content equality remains unknown unless separately attributed by prior evidence.

Each row has exactly one classification:

| Classification | Meaning here |
|---|---|
| exact_match | Explicitly evidenced same source/ledger version; older observations are labelled historical, and fresh statement equality is not claimed |
| timestamp_alias | Content/history-proven systematic timestamp transformation; none established by supplied evidence |
| generated_alias | Explicit fresh or prior attributed installation under another version; source counterpart also identified |
| duplicate_content_alias | Equal normalized repository artifacts; execution attribution unresolved |
| installed_but_unrecorded_canonical | Batch C artifact and intended ACL effect observed, canonical Supabase version absent; Drizzle mirror represents the same operation |
| repository_only | Explicitly excluded source, no later evidence of that exact migration installation |
| ledger_only | Specifically reported ledger identity with no proven source attribution; nearby candidates are not mappings |
| historical_superseded | Intentional identity supersession established by evidence; none proven for a complete migration here |
| ambiguous | Supplied artifacts cannot establish safe attribution; may include some of the reported 279/230 members |

Actions use the closed vocabulary in the script. `no_action` means no proposed metadata change, not permission for runner execution. `recognize_alias_only` means retain the evidenced mapping; any future runner still must demonstrate no replay. Unresolved attribution takes `requires_installed_inspection`; all rows also carry runner risk. `requires_separate_migration_analysis` must never be converted automatically to applied history. The sole `metadata_repair_candidate` is not authorization.

## Namespace model

The 545 Supabase names comprise 502 UUID-generated names and 43 descriptive names, all with 14-digit timestamps. The complete matrix gives their individual Git introduction times. Earlier generated versions and the September/October descriptive/generated source pairs coexist; filenames alone do not reveal execution timestamps. True timestamp differences use UTC calendar seconds, not subtraction of decimal version numbers.

There are 31 equal-normalized-text groups within Supabase migrations, each with two versions. One additional group links a Supabase migration to a staged pending copy; another links Batch C to its Drizzle copy. None demonstrates two executions. Git records a content-changing R058 rename at `055f64213ce5a72d8101ef94f4e4cff8b1bc7599`, from `20260907160000_combat2_ability_support_gate.sql` to `20260907170000_combat2_stack_ability_support_gate.sql`; this is not a proven installed alias. Drizzle uses sequential `0000`, journal v7/postgresql, idx0, tag `0000_combat2_legacy_browser_privileges`, when 1791021613818 and breakpoints=true. Journal time is not recovered execution time.

## Timestamp drift: precise limits

001B reports 230 nearby matches, mostly +1 second. It supplies neither those 230 pairs nor all 510 ledger rows nor statement hashes. Their exact membership, delta distribution, one-to-one relation and content correspondence therefore **cannot be reconstructed** locally. No systematic runner transformation is proven; Drizzle's sequential journal is not such a transformation.

The six named ledger-only rows reveal actual matching ambiguity: the first five each have two local candidates within 60 seconds. Candidate deltas ledger-minus-source are respectively (40,-1), (47,-1), (31,-1), (12,-1), (54,-2). The sixth, `20260728070225`, has no nearby local candidate. These ten pairs are not ten proven aliases or the distribution of the 230. The nine explicitly attributed generated aliases have separate, generally much larger deltas, listed in summary.json; three have fresh 001B identity attribution and six only earlier attribution.

Answers: drift is not yet fully understood or deterministic; ledger repair need is unknown, and no bulk rewrite is proposed. A version-discovering runner could select missing identities or reject mismatched history; its exact planned set is unknown. Historical aliases can remain only after content/collision attribution and demonstrated runner exclusion. All unresolved replay-capable identities block migration resumption.

## Every named unmatched source

The reported “40” list expands to **36 distinct existing versions**. `279 + 230 + 36 = 545`; this exposes an inconsistent label, not verification of the reported matching partition. Raw matching output must establish typo versus omitted identities. Do not invent four files.

Of 36, 31 have another Supabase artifact of equal normalized content and Batch C has its exact Drizzle mirror. Nine are attributed generated aliases (three fresh, six historical); 22 remain source-only duplicate aliases; one is installed Batch C; one is explicitly excluded reward-channels source; three remain ambiguous. Zero complete superseded identities are proven. Source-only duplicates are not counted as proven installed aliases.

The individual decisions and actions are in unmatched-decisions.md. Additional investigation for the four with no complete-source counterpart:

| Source | Local evidence / next question | Replay assessment |
|---|---|---|
| 20260831133000 scheduler foundation | No complete normalized copy. Defines scheduler controls/table; current zero cron jobs proves no source attribution. Export object bodies/ledger statements and identify original installation or subsequent replacement | Unknown; never replay based on current asleep state |
| 20260906160000 test-environment controls | Generated `20260906144044_f8e846c5-a26e-447b-9328-a0c5e57af6ee.sql` contains overlapping operation controls but is not equal normalized whole text. Later lifecycle repairs also overlap | Unknown; compare statement sequence and historic constraints/definitions |
| 20260907110000 test runs | Generated `20260907055519_afa767b2-4995-40e0-a8aa-8f1af2463794.sql` and `20260907055727_c6b1b60c-d04e-4592-9cab-a25c62f41227.sql` contain overlapping run objects; no complete-text alias | Unsafe to assume replay of CREATE TABLE/unique objects; attribution unresolved |
| 20260915200000 reward channels | Explicitly excluded/unapplied; ADM-025B assertions reportedly abort. A narrower contract-only migration `20260921223049` supplies some columns/projection, not proof that the whole original migration ran or was intentionally superseded | Separate analysis; never mark original applied |

## Repair decision table

Counts below describe all 556 evidence rows, not the reported 279/230 hosted partition. Batch C appears twice as source/mirror, with only one candidate action.

| Category | Count | Understood? | Replay risk | Metadata repair needed? | Blocks migrations? |
|---|---:|---|---|---|---|
| exact_match | 15 | Attributed identity, some historical | Must prove runner exclusion | None proposed | Fresh planned-set verification required |
| generated_alias | 9 | Attributed mapping, six historical | Source identity may be discovered | None proposed pending runner proof | Yes until no replay proved |
| duplicate_content_alias | 46 | Source content only | Unknown installation | Unknown | Yes |
| installed_but_unrecorded_canonical | 2 | One logical Batch C operation | Canonical source version absent | One Supabase version candidate | Yes |
| repository_only | 1 | Prior explicit exclusion | Unapplied historical SQL | No automatic repair | Yes if discoverable |
| ledger_only | 6 | Identity only, five collisions | Attribution unknown | No deletion/rekey proposed | Yes |
| ambiguous | 477 | No sufficient attribution | Unknown | Unknown | Yes |
| timestamp_alias / historical_superseded | 0 | None established | — | None proposed | — |

## Batch C and smallest possible scope

Source `supabase/migrations/20261002190000_combat2_legacy_browser_privileges.sql` and retained `drizzle/migrations/0000_combat2_legacy_browser_privileges.sql` have identical Git blob `8387794e0fea37b4baec858d7f509a089e30fc9e` and exact SHA-256 `73df81b17ee54a0294e231d2f91a70ecc3a9da37508c027f00674d8181b92b65`. Fresh Drizzle row id1 has that hash and created_at1791021613818 matching journal. Earlier CRLF working hash is historical, not present committed bytes. Rejected artifact `1fc1314088a3b48184c354f568046abadfc795c50f15c5a753f01088affb762f` was absent from both histories with prior SQLSTATE42501/no effects.

Fresh 001B H0 lists the five exact signatures and definition fingerprints: effects_catchup_send, effects_catchup_dispatch_one, effects_catchup_reconcile, effects_catchup_credential_health and clear_stances. All retain postgres ownership, SECURITY DEFINER, volatility and fixed public search_path; PUBLIC/anon/authenticated cannot execute; service_role/postgres and documented nonbrowser grants remain. The report is the authoritative installed observation, not a fresh R1 inspection. These effects plus exact Drizzle artifact support `installed_but_unrecorded_canonical`; Supabase history explicitly lacks 20261002190000.

The only supported candidate outcome is: **Supabase history recognizes version `20261002190000` as already installed without executing its SQL**. No other identity is a candidate. Preserve all existing 510 Supabase rows, the Drizzle row/journal, SQL copies, installed bodies/ACLs, and runtime state. Exact metadata name/statements representation and supported repair semantics must be proven, not invented. No ad-hoc INSERT or executable mutation command is supplied.

Before separate authorization, Lovable must prove an available targeted metadata-only capability, exact one-version scope, no SQL replay or automatic migration/deployment, auditable before/after export, independently verifiable or reversible recovery, and post-operation history/function/ACL preservation. Batch C alone would not resolve global H0. Given missing ledger attribution and routing evidence, **no repair handoff is ready**; the next handoff is read-only.

## Future runner requirements

Supabase canonical-history selection is policy, not installed runner behavior. `drizzle.config.ts` discovers `./drizzle/migrations`; no secret URL value was read. The fresh hosted tool description delegates custom migration creation and execution to Drizzle, but its exact command cannot be recovered locally. No local wrapper establishes a Supabase canonical route. Do not remove retained configuration, dependencies, journals or mirrors.

Before any real migration establish separately: actual tool/runner identity and version; discovered directory and explicit exclusions (including pending and Drizzle mirrors); history schema/table read; history table write; generated versus retained version identity; execution semantics; and whether a genuine nonmutating list/status/dry-run exists. Require exact planned migration identities, collision decisions and assurance no historical replay on either route. If read-only preview is unavailable, stop rather than invoke a nominal migration operation to discover behavior.

See [prepared read-only follow-up](../progression-001B-h0-readonly-followup.md). It remains undispatched. Migration execution stays paused. Default function privilege requirements belong to the existing [operating guide](../ai-operating-guide.md#migration-history-and-runner-policy).
