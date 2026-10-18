# Shared AI operating instructions

Before changing this repository, first read the approved [project understanding and document map](docs/design/project-understanding.md), then `docs/operations/project-state.json`, `docs/operations/project-state.md`, and `docs/operations/ai-operating-guide.md`. For gameplay or engine work, also read the canonical [engine specification](docs/design/game-engine.md) and [engine roadmap](docs/roadmap/game-engine-roadmap.md). The project understanding is an entry point, not a competing rules, evidence or backlog source.

Fetch and inspect `origin/main`, preserve unrelated work, and validate Git ancestry from `based_on_source_sha`. A newer descendant is not a conflict. Keep pushed source, installed migrations, generated Cloud types, deployed Edge Functions, and manually published frontend as separate states. Never infer Cloud state from repository files; unknown remains unknown, and volatile runtime facts require fresh timestamped evidence.

Update the project-state JSON whenever work materially changes a tracked state, regenerate the Markdown view, and run `npm run project-state:check`. Use `docs/operations/handoff-template.md` for handoffs.

Never claim that a Git push published the frontend. AI agents and Lovable must not publish it or instruct automatic publication. Mik performs frontend publication manually.

Gameplay/engine tasks must identify affected specification sections and roadmap IDs, and state whether they preserve or intentionally change engine rules. Update the specification and roadmap in the same commit when rules or planned work change; keep operational evidence in project state. Never silently reinterpret an unresolved rule. The specification's one-authoritative-world-heartbeat decision remains binding unless Mik explicitly changes it.

## Delivery handoff

Use the [handoff template](docs/operations/handoff-template.md) and [Lovable/Supabase operating contract](docs/operations/lovable-supabase-operating-contract.md) for Codex → GitHub → Lovable delivery. Name the exact reviewed commit, artifacts/hashes, affected files, relevant checks, minimal hosted verification and authorized next action. Required SQL verification precedes matching Edge deployment, then compatible frontend activation and Mik's manual publication; each needs its scoped authorization.

Lovable's standard custom-SQL Drizzle tool owns migration registration and the outer transaction. Prepare SQL outside automatic migrations without top-level BEGIN/COMMIT; preserve PL/pgSQL blocks. Do not pre-generate registered migration files/history, journal/snapshots or Cloud-derived types, replay historical migrations, or silently rewrite reviewed bytes for a runner. Link existing valid evidence; repeat audits/tests only for changed assumptions, failures or unresolved requirements. Use documentation checks for documentation-only work. Do not bundle unrelated fixes or turn a handoff into another broad audit.
