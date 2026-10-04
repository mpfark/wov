# AI operating guide

Begin with the [project understanding and document map](../design/project-understanding.md). It provides project context and the reading order, but it does not replace the sources below.

`project-state.json` is the single repository-backed status source; `project-state.md` is generated. Always fetch GitHub first and verify ancestry rather than comparing SHA text. Repository evidence proves source state only. Cloud installation and deployment require authorized Cloud evidence; Mik's explicit statement may be recorded as `operator_reported`, never as direct verification. Runtime observations expire conceptually and must carry a fresh timestamp.

Lovable may install migrations, regenerate Cloud-derived types, or deploy Edge Functions only when explicitly authorized. Lovable and every other AI must leave frontend publication to Mik and describe it as “ready for Mik's manual publication.”

## Migration history and runner policy

Mik selected Supabase migration history as the canonical target for future project migrations. Batch C is reported installed and recorded in Drizzle; its Supabase history alignment remains pending. Do not blindly replay it. Further Cloud migrations are paused until history alignment and runner routing are reconciled; local ability/admin design may proceed without Cloud changes.

Lovable's migration tool description delegates to Drizzle. This policy does not automatically change that tool: a future installation plan must prove the selected routing and prevent second-path replay. No removal of Drizzle configuration, dependencies, journals or SQL artifacts is authorized. Retain both batch-C SQL files unchanged. The detailed evidence and deferred, separately authorized metadata-only repair checklist live in the [legacy SQL dependency audit](../design/combat2-legacy-sql-dependency-audit.md). No hand-authored ledger INSERT, replacement migration or blind reapplication is an acceptable repair.

The [001B-R1 reconciliation](migration-reconciliation/README.md) preserves its pinned source/evidence audit. The later [hosted H0 follow-up](progression-001B-h0-evidence-report.md) supplies content attribution and supersedes R1's missing-ledger conclusions as current evidence. H0 remains blocked; neither report is repair authorization. Before migration execution, prove runner discovery, execution and history recording independently, including the exact planned set and exclusion of historical SQL on both paths.

Every new or replaced progression SQL function must declare explicit privilege intent in the same migration: PUBLIC, anon, authenticated, service_role and each intended private/internal caller; ownership; SECURITY DEFINER versus invoker; and fixed search_path where applicable. Private progression primitives must not rely on default function privileges. Verify effective privileges, including inherited access, against the intended callers. Fresh 001B observed postgres/public defaults granting EXECUTE to anon/authenticated; this engineering invariant authorizes no current ACL/default-privilege change.

## Gameplay and engine work

WoV is pre-release. Protect persistent player/world/content data and intentional gameplay semantics; legacy runtime compatibility is not a goal by itself. Controlled development/cutover may fail loudly. Do not add compatibility layers solely to keep intermediate builds playable or dual-write old/new authorities unless required for proven data safety. Prefer reviewed removal/revocation of obsolete writers to indefinite wrappers, subject to caller/dependency evidence and explicit cutover scope. This freedom never authorizes risking persistent data or making unrelated runtime changes.

The [B1 baseline strategy](migration-baseline-strategy.md) proposes a verified snapshot boundary and isolated Drizzle-based forward lane. It is not adopted: changing the previous Supabase-canonical choice requires Mik's explicit decision and proven hosted capabilities. Migration execution remains paused. Any eventual boundary must enforce one runner, discovery namespace and history; deterministic identities/order; immutable executed files and forward replacements; explicit function privileges/security; local checks and hosted verification; no silent fallback and no automatic pre-baseline replay. This paragraph implements no baseline or migration mechanism.

Before gameplay or engine work, read the [authoritative engine specification](../design/game-engine.md) and [engine roadmap](../roadmap/game-engine-roadmap.md). Name the affected specification sections and stable roadmap IDs in the plan/handoff, and say whether the task preserves or intentionally changes a rule. Rule changes and corresponding roadmap changes belong in the same commit. Installation, deployment, publication and live observations belong only in project state. Never silently resolve an open product decision or describe a proposed rule as implemented. Treat the one-authoritative-world-heartbeat decision as binding unless Mik explicitly changes it.

The Admin Game Manual and Admin Roadmap are presentation layers, not alternate sources of truth. Do not copy a new manually maintained engine backlog or rule set into them. Sensitive operational details remain admin-only.
