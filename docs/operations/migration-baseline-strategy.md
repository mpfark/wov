# ENG-PROGRESSION-001B-B1 — Proposed canonical baseline strategy

Design/source audit only, based on `0e09cb6733868d7ff50aa14ecef66f2c8f5f949a`. **Not adopted or implemented. H0 remains blocked.** No baseline, SQL, migration, history edit, runtime change or 001C work is authorized by this document. Engine Progression and rewards rules and one-world-heartbeat semantics are preserved.

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
