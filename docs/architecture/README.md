# WoV architecture and ownership

Start with the [system ownership map](wov-ownership.md), then the [Creature Admin contract and write flow](creature-admin-authority.md). The [ordered readiness checklist](creature-hp-readiness.md) separates decisions, implementation and installation gates. These are maintainable views of existing evidence and proposed integration, not a replacement engine specification, backlog or deployment record.

Authority remains with the [engine specification](../design/game-engine.md), [roadmap](../roadmap/game-engine-roadmap.md), [project-state JSON](../operations/project-state.json) and its [generated view](../operations/project-state.md). Product proposals remain in the [idea register](../roadmap/game-ideas.md); Admin backlog ownership is unchanged. This area introduces no competing feature IDs or implementation priorities.

## Diagram legend and evidence rules

| Label / style | Meaning |
|---|---|
| `SOURCE` / blue | Current repository path or writer. **Not** proof of fresh installed parity, exclusive authority or deployed execution. |
| `STATE` / teal | Durable state or read projection. Storage itself is not an authorization boundary. |
| `APPROVED HP / LOCAL ONLY` or `APPROVED DESIGN` / purple | Owner-approved HP/policy direction; selected HP behavior has local proof, while newly approved Admin policy has no new implementation. Production integration is absent. |
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

Current design checkpoint: ENG-LEGACY-001G4A17, based on `e0f7527463f3886a8c591b19d0520708fa142442`. [Approved decisions and implementation-readiness handoff](../operations/legacy-001G4A17-admin-implementation-readiness.md). A–D/replay approval comes from the owner and canonical spec, not diagram color. No implementation/hosted authorization follows. [Original G4A16 handoff](../operations/legacy-001G4A16-admin-contract-architecture.md) remains historical preparation evidence.

Current recommendation: [G4A18 simplification](../operations/legacy-001G4A18-simplified-admin-hp-proposal.md) preserves these ownership diagrams and proposes one Admin mutation boundary instead of eight interfaces, no new authoring receipt subject to explicit replay-policy amendment, and two implementation slices. G4A17 approved policy remains binding pending that amendment; no SOURCE or installed arrows change.
