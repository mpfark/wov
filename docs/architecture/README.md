# WoV architecture and ownership

Start with the [system ownership map](wov-ownership.md), then the [Creature Admin contract and write flow](creature-admin-authority.md). The [ordered readiness checklist](creature-hp-readiness.md) separates decisions, implementation and installation gates. These are maintainable views of existing evidence and proposed integration, not a replacement engine specification, backlog or deployment record.

Authority remains with the [engine specification](../design/game-engine.md), [roadmap](../roadmap/game-engine-roadmap.md), [project-state JSON](../operations/project-state.json) and its [generated view](../operations/project-state.md). Product proposals remain in the [idea register](../roadmap/game-ideas.md); Admin backlog ownership is unchanged. This area introduces no competing feature IDs or implementation priorities.

## Diagram legend and evidence rules

| Label / style | Meaning |
|---|---|
| `SOURCE` / blue | Current repository path or writer. **Not** proof of fresh installed parity, exclusive authority or deployed execution. |
| `STATE` / teal | Durable state or read projection. Storage itself is not an authorization boundary. |
| `APPROVED HP / LOCAL ONLY` or `APPROVED DESIGN` / purple | Owner-approved HP/policy direction; selected HP behavior has local proof, with gated local Admin/accounting candidate code. Production integration is absent. |
| `PROPOSAL` / amber | Architecture/API recommendation, awaiting review and implementation authorization. |
| `LEGACY / OVERLAP` / red | Retained or competing source writer; reachability may be restricted or unknown. Red does not mean demonstrated exploit. |
| `DECISION` / gray diamond | Explicit unresolved owner decision. Recommendations are not approvals. |
| Solid arrow | Source delegation/write or intended proposal flow, according to endpoint labels. Does not imply deployment. |
| Dotted arrow | Read/projection delivery, or proposed linkage; the edge text distinguishes them. |
| Undirected line | Shared transaction/lock dependency; not a second independent writer. |

Node labels and companion traceability tables are authoritative for diagram interpretation; color alone carries no evidence claim. Historical installed/deployed observations belong in linked operations records with their timestamps. **Fresh installed composition is unknown unless expressly cited.** A repository push installs nothing and does not publish the frontend.

## Maintenance rules

Keep diagrams small, with stable node IDs and descriptive labels. Put exact signatures, files and evidence in the adjacent table, not inside every box. Each major node/edge must have a table reference. Update this view when a separately approved integration changes ownership; do not silently promote `PROPOSAL` to `SOURCE` or local proof to installed evidence. Split diagrams rather than expanding them into a universal writer audit.

The Mermaid fences are the diagram source; do not maintain separate hand-edited image copies. Use a Mermaid parser/renderer where available and check links/state on each edit. G4A16 had no installed Mermaid parser/CLI: structural checks and manual grammar review were performed, **not renderer validation**.

Current checkpoint: [G4A19 implementation](../operations/legacy-001G4A19-simplified-admin-implementation.md), based on64f568ba9c7542d196f2543b18403bb79eecbb48. The owner approves G4A18 replay simplification and new2%-per4seconds regeneration. Local clients/candidate are gated and uninstalled; historical G4A16–18 evidence remains linked from the report. Two implementation slices replace the older five-slice recommendation.
