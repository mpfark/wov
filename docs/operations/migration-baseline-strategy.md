# ENG-PROGRESSION-001B — Baseline strategy reconciled with Lovable (B2)

**Current status:** the final read-only check below has since passed and Mik accepted H0 closure, per [H0-FINAL](progression-001B-h0-evidence-report.md),2026-10-04 22:33:30UTC/read and22:39UTC/acceptance. B2 verdict B and pending-gate statements below are historical preparation, not current blockers. The canonical Drizzle model remains accepted; all mutations require per-task authorization. The separate 001C [installed dependency preflight](progression-001C-installed-preflight.md) and Mik's four resume decisions resolve its dependency STOP. Local dormant preparation is complete; [application handoff](progression-001C-lovable-application.md) is prepared and undispatched. This does not reopen H0 or authorize migration execution.

Current B2 source baseline: `e5913a7dc0a90a53bebc3a0b0b94851882710ea6`, 2026-10-05. Mik approved B1's architectural direction at checkpoint, including abandoning historical Supabase normalization as a future-authority prerequisite. **Architecture approval is not mutation or 001C authorization.** B2 recommends the platform-native existing Drizzle lane rather than a new namespace/history. Verdict **B: one final narrowly scoped read-only hosted integrity check**, not a migration/tool probe; H0 remains paused pending that evidence and review. Gameplay Progression and rewards and one-world-heartbeat rules are unchanged.

## Current B2 model and evidence attribution

Mik supplied fourteen statements from Lovable on 2026-10-05; the exact platform conversation timestamp/version was not supplied. These are operator-supplied platform evidence, not new Codex Cloud verification:

- Lovable moved agent migrations from the historical Supabase ledger to custom SQL through Drizzle Kit. Batch C is already the first `0000` forward entry.
- Its runner uses `drizzle/migrations/meta/_journal.json` with `drizzle.__drizzle_migrations`, does not discover `supabase/migrations/` and does not consult the Supabase history.
- Mature projects start from the current installed database implicitly; no old migration registration/replay is needed. Blank `drizzle/schema.ts` is intentional because custom SQL, not declarative ORM diff generation, supplies changes.
- Supabase artifacts can remain archival. Operational freeze prohibits legacy migration execution, including `supabase db push`. Future schema migration tasks use Lovable's standard Drizzle tool, not direct CLI lifecycle management.
- No true nonmutating migration dry-run is exposed. Review precedes tool invocation. Platform constraints also include additive-change preflight and automatic Supabase type regeneration after successful migrations; exact preflight rules need task-specific clarification, not invented semantics.

Repository independently corroborates config output directory, blank schema placeholder, the `0000` SQL and one journal tuple (idx0, tag0000_combat2_legacy_browser_privileges, when1791021613818, version7). Committed Batch C byte SHA-256 is `73df81b17ee54a0294e231d2f91a70ecc3a9da37508c027f00674d8181b92b65`. Earlier hosted reports supply one matching Drizzle row; neither repository files nor platform statements alone prove today's hosted pending state, metadata integrity or effective ACLs. No hosted reads occur in B2.

Recommended model: historical Supabase files/ledger → frozen evidence; existing installed database → implicit schema base; existing Drizzle `0000`/Batch C → first actual forward-history event; subsequent standard-tool entries `0001`, `0002`, etc. → one canonical forward sequence. Keep real tool identities/journal metadata, protect their immutable executed prefix, and record exact SQL hashes in evidence; do not invent a custom version generator or manage the CLI directly.

No new `database/baselines/wov-b1/`, `database/migrations/wov-b1/`, `wov_b1` history, production baseline migration or explicit baseline-registration operation is necessary in this model. The current one-entry journal is forward history, **not** a reconstruction or full-schema snapshot of production. A complete snapshot/catalog manifest remains useful for audit, fresh bootstrap and recovery; it is not a second production authority or a global prerequisite for every additive migration. Unknown definitions affecting a proposed migration still require focused inspection.

## B2 H0 blocker matrix

Classifications distinguish acceptance of documented platform behavior from direct operational verification. An item labelled resolved is resolved at the stated evidence level, not freshly exercised in production.

| Earlier blocker | B2 classification | Reason / remaining obligation |
|---|---|---|
| Unknown future discovery | RESOLVED | Lovable explicitly identifies journal/Drizzle-ledger routing and exclusion of Supabase; independently corroborated config. Current source-to-hosted executed prefix/pending consistency still needs the narrow check below |
| Metadata-only Batch C Supabase recognition | SUPERSEDED BY PLATFORM MODEL | Batch C already recorded in canonical candidate Drizzle route; no Supabase insertion needed |
| Scheduler table creating history unattributed | SEPARATE HISTORICAL/RECONCILIATION ISSUE | No old replay; inspect actual object only if a later task touches it, privileges/dependencies or bootstrap |
| Four edited historical source files | SEPARATE HISTORICAL/RECONCILIATION ISSUE | Freeze retained source/Git/ledger evidence; differing old bytes are not forward pending work |
| Two test migration mismatches | SEPARATE HISTORICAL/RECONCILIATION ISSUE | No historic file execution; actual test functions matter only to affected future work/reconstruction |
| Ledger-only20260728070225 | SEPARATE HISTORICAL/RECONCILIATION ISSUE | Preserve actual history; inspect sync_character_resources before dependent progression changes |
|258alternate-version identities /31duplicate pairs | SUPERSEDED BY PLATFORM MODEL | Supabase is not consulted by forward discovery; no renaming/rekeying |
| No native Drizzle dry-run | ACCEPTED PLATFORM CONSTRAINT | Exact source review, pending-prefix/catalog preflight and post-apply checks replace the missing capability; never probe with migration tool |
| Old Supabase route coexistence | STILL BLOCKING | Close through recorded operational freeze/sole-route acceptance and confirmation no separately scheduled/authorized legacy route is active. Repository prohibition is documented, not a claim of technical platform disabling |
| Journal contains only Batch C | RESOLVED | Valid first forward entry, not incomplete schema baseline; current row/hash/prefix consistency must still be checked |
| Blank drizzle/schema.ts | ACCEPTED PLATFORM CONSTRAINT | Custom SQL is intended; leave placeholder blank, no schema push/diff generation |
| Full schema/bootstrap reproducibility | SEPARATE HISTORICAL/RECONCILIATION ISSUE | Needed for reconstruction/recovery scope, not new production history. Do not bootstrap production; task-specific recoverability remains mandatory |
| Current Drizzle executed-prefix/pending integrity | STILL BLOCKING | Latest source hash/journal locally verified, hosted row evidence older; require current match, no duplicate/unexplained entries or unrecorded pending file |
| B1 new namespace/history/registration capability | SUPERSEDED BY PLATFORM MODEL | Existing platform boundary removes the capability requirement |
| Persistent-data/privilege drift for next task | STILL BLOCKING | Task-specific gate, not demand for global historical cleanup. Inspect affected objects/data and approve safe SQL before each invocation |

## Safety without native preview and minimal containment

Before any mutating task: clean synchronized source checkpoint; standard Lovable Drizzle route declared; reviewed exact custom SQL/change set and protected-data outcome; current journal/ledger prefix comparison by reads; no unexplained pending Drizzle SQL; focused catalog/privilege/dependency inspection; explicit Mik authorization. Review tool-created migration/journal mapping and preserve exact artifact/evidence hashes. `drizzle-kit check` is a platform step, not a native database execution dry-run or proof of data safety. Do not require a nonexistent preview endpoint.

Use deterministic local SQL/containment tests where meaningful. Additive preflight must be satisfied as the platform defines it; clarify exact limitations before approving risky/nonadditive tasks. Same-migration explicit PUBLIC/anon/authenticated/service_role/internal caller, owner, definer/invoker and search_path policy remains mandatory. Static review cannot prove effective inherited rights or dynamic SQL behavior. Risky/destructive work requires available disposable rehearsal and recovery evidence; if unavailable, block that task rather than block every safe additive task permanently. Fail loudly and preserve persistent data; no compatibility/dual-write shortcut.

Post-apply: record actual new SQL/journal/history identity/hash, verify intended catalog changes/effective ACLs and persistent-data invariants, and inspect automatically regenerated Supabase type diff as an expected platform side effect. Generated types are derived evidence, not schema authority. Type regeneration does not deploy Edge or publish frontend. Verify failure/transaction/recovery semantics per task rather than assume rollback. On unexpected extra migrations, replay, data/security delta or failure, STOP; no fallback runner or historical repair.

Recommended subsequent small containment task, **not implemented here**: freeze Supabase migration and pending paths by reviewed baseline blob manifest (reject additions/edits/deletions except explicit archival exception); prohibit new executable legacy-route scripts/instructions without treating historical quoted evidence as a runnable instruction; protect Drizzle executed SQL and journal tuples while permitting legitimate append-only standard-tool entries; reject new migration SQL in other directories; flag routing/config/placeholder changes; require explicit privilege intent/reviewer verification. Repository checks cannot revoke platform capabilities, so operator/task policy must forbid all legacy routes. Preserve existing history/journals rather than reset them.

## Verdict B: exact final read-only questions

On a separately authorized hosted read-only task, synchronize/verify the reviewed source checkpoint and project identity using safe metadata. Read the entire current Drizzle ledger and compare each row/hash/time to committed journal and SQL; establish the one-to-one executed prefix, no duplicates, no unknown row/source and no pending unrecorded Drizzle entry. At the B2 checkpoint the expected prefix is only Batch C id1/hash73df…/created_at1791021613818; do not interpret that timestamp as recovered execution time. If legitimate later source/rows exist, stop for review rather than repair or assume the old expected count. Use reads/comparison, not a native runner plan or migration-tool invocation.

Record that the current authorized future route is Lovable standard custom-SQL Drizzle, and operationally freeze every legacy Supabase route: no future db push/legacy migration task, script or scheduled external migration executor. Ask only whether any separately configured legacy automation/operator path is active; do not demand platform-wide capability revocation or runner execution as proof. Missing visibility means explicit STOP/owner confirmation, not secret search. Platform routing statements suffice for documented behavior; the final check tests concrete current metadata integrity.

If integrity and operational freeze are confirmed, H0 can be recorded resolved after review, with unavailable native dry-run/blank schema/automatic types/additive rules explicitly accepted. No baseline activation/migration/metadata operation is needed. Historical origin imperfections and fresh-bootstrap incompleteness remain tracked separately. If an unexplained pending migration, hash mismatch or actual legacy executor remains, H0 stays blocked. Task-specific data/privilege checks continue even after H0 closure.

Shortest path: review/checkpoint B2 → authorize only this final read-only check → review H0 result → separately authorize001C dormant/additive preparation and its eventual exact hosted SQL. Refresh only relevant H1 writers/triggers/ACLs/config/column widths/dependencies, including installed sync_character_resources where affected. Protect opaque character baseline; no cap normalization, XP writer activation or old-source replay. Active cutover remains001D. No task is dispatched and001C is untouched here.

## Historical B1 rationale — superseded requirements are not instructions

The sections below retain B1's reviewed reasoning from checkpoint `e5913a7d…` for traceability. Mik has since approved its architectural direction. B2 above supersedes its proposed new directories/history/registration, universal native-plan/full-bootstrap prerequisites, CLI/executor management suggestions and retirement of the existing Drizzle lane. Data preservation, immutable evidence, explicit privileges and production-versus-bootstrap separation remain binding. Use the current B2 model and operating guide for future work; do not execute the historical transition plan below.

## Evidence boundary

The freshest installed-history observation is [hosted H0 evidence](progression-001B-h0-evidence-report.md), 2026-10-04 12:43:26–12:47 UTC. Its committed CSVs locally recount as 278 same-version content matches, 258 other-version matches and nine unmatched sources out of545. 505/510 history rows match, with31 rows each matching two sources. Matching uses six whitespace/line-ending byte variants; this is not unqualified original-byte equality. Four sources were changed after installation; one history row has never had a source. Scheduler creation and two test-source equivalences remain unresolved; reward-channels was not installed. Batch C is recorded in Drizzle and absent from Supabase. Its ACL fingerprints were last observed in the earlier 10:45–10:51 inspection, not re-read by H0.

These are attributed hosted observations, not new Codex Cloud reads. R1 matrices remain pinned historical audit artifacts and must not be regenerated to reinterpret this later export. Content matching explains much of the history but does not certify the complete live schema, data, privileges or future discovery behavior.

Repository facts: `drizzle.config.ts` points at `./drizzle/migrations` and `./drizzle/schema.ts`; schema.ts is an intentionally blank generated placeholder, not a representation of WoV's installed schema. One Drizzle journal entry represents Batch C. Supabase has545 migrations and four pending files; its config identifies the project and Edge settings but does not prove a runner. Package.json declares drizzle-kit^0.31.11/drizzle-orm^0.45.3, no migration command, and no committed CI route establishes sole ownership. Relevant local installed Drizzle package source was unavailable; no package installation was attempted. Hosted tool documentation describes custom SQL through Drizzle check/migrator. No nonmutating plan, exact future discovery set or safe metadata-only operation is exposed. The older Lovable route wrote Supabase history; its future availability is unknown.

## Meaning of baseline

A baseline is an approved, reproducible description and attestation of **actual installed state at a bounded observation/cutover**, plus an enforceable boundary excluding all earlier SQL from future discovery. It is not an applied-migration claim. Separate seven responsibilities:

| Concern | Proposed meaning |
|---|---|
| Installed state | Existing production schema and persistent data remain in place; unknown drift is explicitly inspected/dispositioned |
| Historical evidence | Existing files, journals, both ledgers and reports retained with hashes and provenance |
| Schema representation | Complete verified installed-schema snapshot and normalized catalog manifest, with platform-owned dependencies separated |
| Discovery | Exactly one explicit forward-only namespace and pinned immutable ordered manifest |
| Execution | One supervised, pinned executor applies only approved forward SQL; bootstrap is a distinct explicit mode |
| Recording | One isolated post-boundary history with exact identity/hash/result; baseline attestation distinct from executed migrations |
| Ownership | One WoV forward-migration lane owns changes, privilege checks and verification; no competing migration route |

The baseline never declares unexecuted historical SQL applied, replays old files, deletes history, rebuilds production, resets characters/world/content or silently accepts drift. Capturing an unattributed existing object is possible only after its actual definition, dependencies, intended disposition and security are reviewed. An attestation records observed provenance limits; it does not invent their origin or certify defects as intended gameplay.

## Strategy comparison

| Strategy | Existing-data safety / replay | Historical cleanup / audit | Current Lovable / local workflow | Bootstrap / recovery | Simplicity / dual authority |
|---|---|---|---|---|---|
| 1. Repair Supabase history | Potentially safe only with no-replay proof; aliases and edited sources make generic discovery hazardous | Content evidence is strong but many identities and nine exceptions need disposition; raw identity cleanup is unnecessary | No supported metadata-only operation or preview; Codex can audit, cannot operate DB | History alone cannot reliably bootstrap installed state; rekeying recovery needs ledger exports | Retains original policy but currently blocked; Drizzle still needs exclusion |
| 2. Adopt current Drizzle directly | Existing production is not an empty schema; one Batch C entry proves no full-schema baseline | Preserves Supabase as evidence but gives no explanation of all installed objects | Available tool routes this way, yet discovery/preview unknown and blank declarative schema is hazardous | One ACL migration cannot bootstrap; no schema-wide rollback guarantee | Superficially simplest; insufficient alone and risks retaining both authorities |
| 3. Verified snapshot boundary | Production stays in place; explicit checkpoint and exclusion remove historic replay dependence | Preserve unresolved provenance as evidence after actual-state review; no cosmetic rekeying | Snapshot extraction and activation capabilities must be proven; Codex designs/checks artifacts | Snapshot plus content pipeline supports empty DB; production backup/recovery remains separate | Clear separation of observed base and later changes; needs one runner, not just a snapshot |
| 4. New namespace/history | Isolation can prevent old discovery only if enforced | Retain both old systems historical-only; no marking missing SQL applied | Current fixed route does not prove configurable folder/history; local manifest review feasible | New namespace alone cannot reconstruct base; isolated history aids auditing, not data recovery | Prevents dual ownership if old routes are disabled; otherwise adds a third authority |

**Recommendation: combine3 and4**, using one explicitly controlled **Drizzle-based forward lane** as the preferred implementation candidate. This chooses a migration mechanism, not a second declarative schema owner. Do not adopt current Drizzle directly. This is a proposed change to Mik's previous Supabase-canonical decision and needs explicit approval; the existing policy and pause remain effective today. Reusing the currently available engine minimizes routing change only if hosted control can actually be established. If that proof fails, stop and revisit the decision; never silently fall back to Supabase or ordinary Lovable migration tooling.

## One future owner

The WoV forward lane would own discovery, execution, isolated history, baseline manifests, privilege validation and application verification. Codex prepares immutable artifacts and deterministic local checks; an explicitly authorized hosted operator executes that same reviewed lane; Mik approves architecture, baseline activation and each mutating task. Actor separation is not multiple migration authorities.

Suggested future layout, **not created**: `database/baselines/wov-b1/` for observed snapshot/manifest and attestations; `database/migrations/wov-b1/` for forward-only SQL/journal. One isolated history identity `wov_b1` is a design label, not an assertion of supported table/config semantics. Exact physical history schema/table, discovery configuration and supported executor must be proven before implementation. If Drizzle requires a journal, it is only the index for this lane, never an independent history owner. Journal ordering timestamps must be deterministic, strictly increasing and conflict-checked; human source identity/hash and runner identity must have an explicit one-to-one mapping. No tool-generated alternate identity is accepted implicitly.

All pre-boundary SQL remains physically unchanged during this design. Later isolation must prevent both the old fixed Drizzle directory and the Supabase migration directory from any autonomous execution. A declaration that they are historical is insufficient; configuration/capability and planned-set evidence must prove exclusion. Freeze or operationally deny the older tool routes before activating the lane. Do not leave default tooling able to migrate behind the reviewed lane.

## Production and empty bootstrap

Production path: existing verified state → nonexecuting baseline attestation → forward migrations. Registering a boundary may later create isolated metadata, but must not apply schema snapshot DDL or simulate execution records. Verify exactly what metadata the supported runner requires; no ad-hoc history insert and no synthetic historical migration execution. This capability is unproven today. Baseline registration and schema execution must be separate, auditable operations.

Empty development/test path: verify platform prerequisites → restore approved schema snapshot → deterministic canonical-content/seed pipeline → establish the same boundary identity → apply the same forward sequence. A bootstrap mode cannot be selected against an existing production database; enforce environment identity and emptiness checks, not a casual boolean flag. Production snapshot attestation and actual bootstrap execution have different records. No production player data is placed in source/bootstrap seed files.

The authoritative base artifact is a schema-only installed-state snapshot plus a normalized catalog/privilege/dependency manifest. Include schemas, extensions/versions, types, sequences/defaults, tables/constraints/indexes, functions/full signatures/bodies/security/search_path, triggers, RLS policies/enabling, explicit/effective grants and relevant publication configuration. Clearly distinguish WoV-owned objects from managed auth/storage/platform objects, role memberships and unavailable internals. Scrub secret-bearing definitions safely; if redaction destroys reproducibility, require a separately controlled provisioning step rather than committing secrets. No credentials or personal data are requested by this design.

Drizzle's blank schema.ts and generated browser types are not sources from which to infer this full snapshot. A later declarative representation can be useful only if verified for all relevant PostgreSQL features; it must not become a second schema generator with independent production authority. Any generated executable baseline artifact is **fresh-bootstrap only**, never discovered as a production forward migration.

Canonical world/content seed data needs a separately versioned, reviewed pipeline with stable keys/foreign keys, sequence reconciliation, dependency order and no player/inventory/reward receipts. Distinguish authored content from dynamic world state and mixed tables explicitly, including starting defaults. Existing production content is preserved; fresh test content need not copy live personal data. Prove reconstruction on two empty disposable databases yields the same normalized schema/content fingerprints and baseline plus forward sequence. No such artifact or proof exists yet.

## Historical artifacts

| Artifact | Proposed post-activation treatment |
|---|---|
| supabase/migrations/* and pending files | Immutable historical evidence, excluded from executable discovery; no automatic move/deletion in B1 |
| drizzle/migrations/* and old journal | Immutable historical evidence, including Batch C; old route inactive |
| Supabase510rows and old Drizzle row | Preserve untouched; read for archaeology, never used to decide new-lane pending work |
| R1 matrices and hosted CSVs/reports | Retain with pinned checkpoints/hash variants and observation times; earlier unknowns remain historical |
| Batch C | Actual observed ACL state included in verified baseline; old Drizzle evidence retained; no forced Supabase recognition needed by new-lane design |
| Repository-only reward-channels | Remains unapplied; no snapshot inclusion merely because its source exists; later intent requires separately reviewed forward work |
| Four edited-after-install files | Retain current blobs and Git/history/hash provenance; snapshot actual installed definitions; no retroactive correction |
| Scheduler/test/ledger-only exceptions | Capture/review current objects and dependencies; preserve unknown origin/differing definitions explicitly; do not replay nearest source |
| Baseline snapshot | Nonexecuting evidence for production; executable only through guarded empty bootstrap |
| New forward lane | Sole executable migration namespace after approved activation |

No old Supabase rows are rekeyed, no Batch C fake application record is needed, and no unapplied reward source is folded into baseline. Future removals/privilege corrections are honest new migrations, not edits to the snapshot or old migrations. Historical content mismatch need not block forever once actual-state coverage, approved dispositions and enforced exclusion are proven; unknown actual state still blocks.

## Post-boundary invariants and containment

The existing [operating guide](ai-operating-guide.md) remains policy owner. Proposed activation adds: one runner/namespace/history; pinned baseline identity and deterministic versions/order; immutable exact file hashes after execution; forward replacements instead of edits; explicit same-migration privileges/owner/security/search_path; deterministic local checks and hosted before/after verification; no fallback; no pre-baseline discovery.

Containment checks should compare historical path/blob manifest and executed forward prefix against approved checkpoints; reject added SQL outside the new namespace, edits/deletions/reordering/duplicate IDs, generated alternate versions, changes to runner routing/history, and bootstrap artifacts in forward discovery. Static privilege checks assist review but cannot prove effective inherited grants or dynamic SQL safety. Require exact future planned IDs/hashes, environment/baseline identity and comparison to history before any mutation; apply only that approved set under one serialized executor. Verify no pending migration when the intended set is empty, and refuse drift/hash mismatch. A disposable-environment rehearsal must prove discovery behavior and second-runner exclusion; production may not be used as a probe.

No CI/tests/configuration are implemented here. Package/config ownership and hosted tool rights must be included in enforcement; repository checks alone cannot prevent out-of-band Cloud tools. Avoid a large new framework: one manifest, one controlled runner configuration, one history and one repeatable verifier are sufficient if capabilities support them.

## Transition and H0 exit

1. **Approve architecture / establish capability, still paused.** Mik reviews B1 and decides whether to replace the Supabase-canonical choice. Codex can specify artifact formats/containment locally in a later approved task. A separately authorized Lovable read-only feasibility task must establish controllable runner/discovery/history, nonmutating planning, isolated boundary registration and old-route exclusion. Stop if these cannot be proven. No blind tool probe.
2. **Capture and verify base, still paused.** Separately authorized hosted reads/export and recovery preparation capture complete actual schema/privileges/content boundaries and named exceptions. Record UTC window/source/platform dependencies, full signatures and normalized hashes; resolve definition/intent ambiguity without gameplay repairs. Backup recovery includes persistent data and is securely retained, not committed. Validate restore in an authorized disposable environment, with managed dependencies/restoration limits explicit. Codex reviews artifact completeness and prepares local checks only when approved. No production snapshot DDL.
3. **Rehearse then activate boundary, explicit mutation authorization required.** In a disposable environment prove bootstrap, forward ordering/history, no historical replay, failure handling and recovery. Review exact production metadata/configuration changes and exclusion controls. Mik authorizes the concrete activation separately. Hosted operator applies only approved boundary metadata/tool routing, never historical SQL. Reconfirm production snapshot hasn't drifted, histories and persistent-data fingerprints unchanged, and empty forward planned set. Any unknown/implicit SQL, privilege delta, concurrent schema change, old-path selection, hash mismatch or unsafe recovery means STOP. A fresh checkpoint is required if capture drifts.
4. **Resolve H0 by evidence; progression separately.** Record exact runner/version/namespace/history, complete verified baseline and exceptions, replay exclusion, recovery proof and post-activation reads. Mik reviews explicit H0 resolution; only then authorize subsequent migration tasks through this lane. H0 is not lifted by B1 approval, a snapshot file, or a new directory.

Recovery before activation: retain approved snapshot/hash and unchanged histories; if activation fails, pause all migration lanes and diagnose, do not restore old automatic replay. Metadata reversal must be separately reviewed with audit preserved; do not edit executed forward records to hide work. Later destructive/data-affecting changes need task-specific rollback/forward-fix or tested full data restoration; a schema snapshot or reverse DDL alone cannot recover lost persistent data. Do not promise transactional atomicity across operations the actual runner/platform cannot guarantee.

## 001C prerequisites

Baseline establishment resolves the migration mechanism, not progression correctness. Before 001C: approved and evidenced H0 exit; refreshed H1 installed trigger/writer/privilege inventory and relevant deployed consumer visibility; confirmed column widths/checked arithmetic and resource/config dependencies; reviewed handling of provenance/opaque existing character state without rewriting it; task-specific privilege/no-active-writer containment and deterministic SQL/provenance tests; exact approved hosted application plan. Unknown consumers must be scoped out with evidence or remain blockers.

001C remains **additive dormant authority/provenance** under the roadmap. It must not silently adopt the older 001B report's suggestion to activate an XP writer or make unrelated privilege/cap repairs. Active coordinated writer cutover belongs to001D; trainer/respec and historical anomaly repairs retain their later approval boundaries. Respec/stance decision need not block dormant preparation if no such behavior is introduced. No immediate001C permission follows from baseline activation.

Proposed next work: local B1 approval/checkpoint, then separately authorized **read-only baseline capability and catalog-coverage feasibility** via Lovable. No task is dispatched here. If hosted control cannot satisfy single ownership, return a concrete feasibility limitation for architectural reconsideration, not a dual-runner workaround.
