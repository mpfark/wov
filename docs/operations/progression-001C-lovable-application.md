# ENG-PROGRESSION-001C — Prepared dormant application handoff

**Prepared, undispatched, unapproved for hosted execution.** Local preparation authorization is not migration authorization. Review/checkpoint this exact payload first; obtain separate scoped approval before sending this handoff to Lovable. No 001D activation is included.

## Source and task state

- Starting/synchronized/final local SHA: `e8d94acafa6558cb33268a51dcf48102348ab16a`; local changes uncommitted, not pushed. Remote tracking SHA matches at synchronization; record fresh remote SHA at future dispatch.
- Recorded baseline and reviewed 001A/B2/H0 ancestry verified locally. H0-FINAL accepted by Mik; do not reopen historical migration reconciliation.
- Exact custom-SQL payload: [progression-001C-authority.sql](progression-001C-authority.sql), SHA-256 `e9526a64e166fc8ca84ee80a8397ebec9c919922078e84563aa2ef83b239557a`. Verify the same digest from the approved checkpoint before application; never reconstruct from this prose.
- Migrations authored/installed: no discoverable migration or journal entry authored here; dormant payload only, not installed.
- Generated Supabase types, Edge deployments, frontend and gameplay: unchanged by this task. No publication requested; only Mik publishes manually.
- Tests: 16 actual local PostgreSQL-engine tests; 67 existing 001A tests; root/app TypeScript and build passed. Full-suite comparison and exact payload digest are in the external 001C report. Local PGlite is serialized and is not hosted multi-session proof.
- Cloud operations: none. Gameplay operations: none. No repair, compatibility rewrite or historical replay.

## Intended standard-tool operation after approval

Use Lovable's standard custom-SQL Drizzle mechanism exclusively. Preserve `0000` / Batch C and the executed prefix. The expected next entry after the observed one-entry journal is `0001`, but verify the actual source/hosted prefix and absence of unrelated pending entries immediately before application. If it changed, stop for review rather than force a number or rewrite history. Let the standard tool generate the numbered file/journal entry and perform its normal atomic execution/type regeneration. Do not hand-edit the journal, use a separate runner, add to `supabase/migrations`, replay Batch C, or repair the Supabase ledger. Native dry-run absence is accepted; it is not a renewed H0 blocker.

Reconfirm only affected installed dependencies from [installed preflight](progression-001C-installed-preflight.md): column types/checks, class/resource/equipment inputs, owner/HP lifecycle triggers, candidate-name absence and default privileges. Relevant drift stops application for review. Preserve production character/world/content rows exactly; installing this payload only creates new empty provenance objects. No production character calls, sample awards, backfill, repair or normalization.

Before production application, use a separately approved disposable hosted test context for actual trigger/default-ACL compatibility, role denial and two-session contention/commit/rollback/retry tests. Do not run mutation tests against production characters. The local owner-trigger fixture is a model, not a full hosted lifecycle integration test. Require same-request retries after transport uncertainty to return the committed historical receipt and conflicting same-key requests to refuse after the first transaction commits. Verify no partial sidecar/milestone/character mutation after an abort. Failure or unavailable safe test context stops execution and is reported; do not substitute production probes.

Apply the approved bytes exactly once, transactionally through the standard tool. Any schema/name collision must abort rather than using `IF NOT EXISTS` or replacing an existing object. No production RPC invocation or activation follows installation. Capture resulting entry/hash/journal/executed-prefix evidence and type-generation diff; review unexpected changes separately. No Edge deployment or frontend publication.

## Objects, privileges and containment

Creates `progression_character_state`, `progression_receipt`, `progression_respec_milestone` and five functions: the three authority primitives plus compact snapshot and validated class-config helpers. All belong to postgres. All functions are SECURITY DEFINER with fixed `pg_catalog,public` search path and reject a non-null owner/browser JWT context. Tables enable RLS with no policies. Explicit revocations and a catalog-driven final sweep remove every nonowner direct object grant, including PUBLIC/anon/authenticated/service_role/custom default grants. No service-role grant or ordinary public wrapper is supplied. Administrative owner/superuser access remains inherent.

Verify effective privileges after installation for every ordinary role, including roles receiving unsafe defaults: no table access and no function EXECUTE; verify owner, search path, RLS and exact bodies. Verify no new trigger, schedule, source/Edge reference or wrapper. Do not alter existing object ACLs/default privileges. Snapshot/hash comparison of relevant existing rows/definitions must show no installation mutation; provenance tables must be empty. Preserve existing level CHECK 1..100 and all runtime writers. Report data equality without publishing player-identifying records.

## Transaction, provenance and resources

State is captured lazily at the first future accepted authority operation, not at installation. Existing materialized stats/class/level/XP/Renown/ranks/pools/resources remain opaque; six new refundable counters begin at zero. Only newly recorded discretionary allocation increments them and consumes unspent points; permanent reward does not. Full refund/respec is not implemented. Versions are bounded to JavaScript-safe integers. Future cutover must fence legacy writers; they do not maintain this version and this dormant foundation cannot detect their arbitrary intervening writes.

Lock character first, then relevant class configuration FOR SHARE. Receipt identity is `(character, source, UUID event)` across operation types; persist canonical request and compact before/after result atomically. Same request returns the stored receipt before stale-version/current-config validation; different payload/metadata/operation refuses. Independent `(character, milestone)` uniqueness protects 10/20/30/40 grants. Configuration is captured, not replay input. No client-supplied maxima or class-growth values.

Apply every crossed threshold, discretionary grant and configured growth before final resource synchronization. Living-before level-up refills HP once to final MaxHP; dead stays zero. CP/MP preserve and clamp only above final maxima. No-level XP does not synchronize or heal. Permanent delta synchronization clamps HP without healing and preserves/clamps CP/MP. Read class base HP from `classes.base_hp` (current classless 18); equipment empty override falls back to item stats, exclude unusable/broken/unequipped items, use installed gems/formulas/caps. Never read/recompute/write AC. No trusted transaction flag and no call to browser-owned `sync_character_resources`.

Growth config fingerprint is SHA-256 over canonical JSONB class key/classless/normalized six-stat bonuses; no `updated_at`. Capture base HP separately when used for resources. Negative, fractional, unknown and null config values refuse before mutation. Checked numeric intermediates and existing bounds prevent overflow. Historical invalid/out-of-range/backlogged XP requires reconciliation, not incidental normalization. Malformed resource input raises and rolls back the whole operation; do not catch it into a partial-success receipt.

The SQL representation is private durable storage, not an exported browser DTO. Later trusted domain adapters must validate actual reward claims/completions, admin actor/reason, trainer/combat/location eligibility and source amounts before calling owner-only primitives without browser JWT. Accepted dormant source labels do not prove event eligibility. Creation/class join/switch/Renown/full respec/destructive admin overrides are intentionally absent. No material milestone rewards are introduced. The internal resource policy booleans are derived by trusted primitives, not exposed as gameplay options.

## Next safe action

Mik reviews the local payload, test evidence and report. Separate approval is needed for a source checkpoint and separately for the exact hosted application. This handoff remains undispatched. Successful installation still leaves every authority dormant; 001D requires its own authorization and coordinated integration design.

## Revised gate and installation record (2026-10-04)

Mik chose option (b): installation of the dormant authority does not require unavailable hosted multi-session mutation testing. Installed once as Drizzle `0001_progression_001c_dormant_authority` (byte-identical to the approved payload, SHA-256 `e9526a64…7a`); see project state for evidence.

Hosted multi-session contention/retry/rollback validation remains unproven and is a mandatory ENG-PROGRESSION-001D pre-activation gate. Before any production caller: real PostgreSQL multi-session proof of row-lock serialization, same-request retry after commit, conflicting same-key refusal, rollback atomicity and no partial receipt/provenance/milestone/character mutation. If 001D cannot prove this without production-character experimentation, STOP for a new decision.
