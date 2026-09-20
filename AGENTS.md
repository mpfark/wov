# Shared AI operating instructions

Before changing this repository, read `docs/operations/project-state.json`, `docs/operations/project-state.md`, and `docs/operations/ai-operating-guide.md`.

Fetch and inspect `origin/main`, preserve unrelated work, and validate Git ancestry from `based_on_source_sha`. A newer descendant is not a conflict. Keep pushed source, installed migrations, generated Cloud types, deployed Edge Functions, and manually published frontend as separate states. Never infer Cloud state from repository files; unknown remains unknown, and volatile runtime facts require fresh timestamped evidence.

Update the project-state JSON whenever work materially changes a tracked state, regenerate the Markdown view, and run `npm run project-state:check`. Use `docs/operations/handoff-template.md` for handoffs.

Never claim that a Git push published the frontend. AI agents and Lovable must not publish it or instruct automatic publication. Mik performs frontend publication manually.
