# Shared AI operating instructions

Before changing this repository, read `docs/operations/project-state.json`, `docs/operations/project-state.md`, and `docs/operations/ai-operating-guide.md`. For gameplay or engine work, also read the canonical [engine specification](docs/design/game-engine.md) and [engine roadmap](docs/roadmap/game-engine-roadmap.md).

Fetch and inspect `origin/main`, preserve unrelated work, and validate Git ancestry from `based_on_source_sha`. A newer descendant is not a conflict. Keep pushed source, installed migrations, generated Cloud types, deployed Edge Functions, and manually published frontend as separate states. Never infer Cloud state from repository files; unknown remains unknown, and volatile runtime facts require fresh timestamped evidence.

Update the project-state JSON whenever work materially changes a tracked state, regenerate the Markdown view, and run `npm run project-state:check`. Use `docs/operations/handoff-template.md` for handoffs.

Never claim that a Git push published the frontend. AI agents and Lovable must not publish it or instruct automatic publication. Mik performs frontend publication manually.

Gameplay/engine tasks must identify affected specification sections and roadmap IDs, and state whether they preserve or intentionally change engine rules. Update the specification and roadmap in the same commit when rules or planned work change; keep operational evidence in project state. Never silently reinterpret an unresolved rule. The specification's one-authoritative-world-heartbeat decision remains binding unless Mik explicitly changes it.
