# AI operating guide

`project-state.json` is the single repository-backed status source; `project-state.md` is generated. Always fetch GitHub first and verify ancestry rather than comparing SHA text. Repository evidence proves source state only. Cloud installation and deployment require authorized Cloud evidence; Mik's explicit statement may be recorded as `operator_reported`, never as direct verification. Runtime observations expire conceptually and must carry a fresh timestamp.

Lovable may install migrations, regenerate Cloud-derived types, or deploy Edge Functions only when explicitly authorized. Lovable and every other AI must leave frontend publication to Mik and describe it as “ready for Mik's manual publication.”

## Gameplay and engine work

Before gameplay or engine work, read the [authoritative engine specification](../design/game-engine.md) and [engine roadmap](../roadmap/game-engine-roadmap.md). Name the affected specification sections and stable roadmap IDs in the plan/handoff, and say whether the task preserves or intentionally changes a rule. Rule changes and corresponding roadmap changes belong in the same commit. Installation, deployment, publication and live observations belong only in project state. Never silently resolve an open product decision or describe a proposed rule as implemented. Treat the one-authoritative-world-heartbeat decision as binding unless Mik explicitly changes it.

The Admin Game Manual and Admin Roadmap are presentation layers, not alternate sources of truth. Do not copy a new manually maintained engine backlog or rule set into them. Sensitive operational details remain admin-only.
