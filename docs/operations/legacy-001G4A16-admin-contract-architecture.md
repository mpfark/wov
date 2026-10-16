# ENG-LEGACY-001G4A16 — Creature Admin contract and visual architecture

Starting/synchronized checkpoint: `21620622adcea74ea11b229683533ce7f15e285a`. **DESIGN PREPARED; NO-GO for implementation or hosted installation.** This task authors documentation only, reusing [G4A15](legacy-001G4A15-creature-admin-configuration-integration.md) and G4A8–14 evidence. No new source integration, SQL candidate, policy approval, audit closure or database test is claimed.

## Deliverables

- [Architecture index/legend](../architecture/README.md): evidence labels, ownership hierarchy and maintenance rules.
- [WoV ownership overview](../architecture/wov-ownership.md): Mermaid system map, readable flow and companion source/evidence table.
- [Creature Admin authority](../architecture/creature-admin-authority.md): second Mermaid diagram, current entry points, proposed common envelope and nine logical operations, lock/retry/failure/ownership contracts, A–D owner decision table.
- [Dependency-ordered readiness checklist](../architecture/creature-hp-readiness.md): decisions → source → containment → legacy healer cutover → parity/authorization → reviewed deployment/live verification.

The [engine specification](../design/game-engine.md) remains rules authority; [project state](project-state.json) remains status authority. Architecture documentation creates no alternative feature backlog. The engine roadmap/audit index get referential G4A16 entries only; existing rules, idea register, Admin backlog and previous records are unchanged.

## Findings and recommendations

Current CreatureManager full-object saves include generated HP/maxHP and other config; creation/edit is followed by a separate reward RPC. NodeEditor directly assigns/unassigns, Populate loops independent creations, legacy loot editor writes loot_mode. Their source behavior and local proof boundaries are retained; no deployed exclusive authorization or coherent HP protection is inferred.

The proposed browser contract sends explicit content intent and operation-scoped expected fields, never current HP, lifecycle/generation, projection, claim or accounting state. Server owns validation, formula derivation, common accounting, synchronization and atomic commit. Metadata is name/description only; gameplay-affecting boss/level/rarity/aggression/respawn values are protected config. No independent regeneration writer, reward redesign or new mandatory approval/reason framework.

Already-approved HP behavior remains: durable creatures.hp; persistent wounds; Combat2 ownership while active; relevant effect/action blockers;60-second uninterrupted eligibility; elapsed eligible time including sleep; no retroactive initialization; configurable0–100% with at most two decimals; provisional default5%; old-rate settlement/whole HP/fraction discard without restarting eligibility; missing-HP-preserving max edits/living floor1; ordinary dead respawn/generation; safe-ended reassignment with claim/version protection. These rules are not newly declared installed.

**Owner decisions remain PENDING:**

| Decision | Recommended default, not approval |
|---|---|
| A Stale forms | Refuse operation-scoped authored conflicts and require explicit review; unrelated HP/tick changes do not stale metadata. |
| B Retained history | Refuse hard deletion with retained references; no archive/cascade/purge semantics invented. |
| C NULL-node unassignment | Explicit support only for quiet, unprojected/unreferenced creatures initially; retained-state cases refuse. |
| D Save/reward atomicity | Separate explicit operations initially, with accurate partial-save feedback. Combined operation only after separate design/authorization. |

Exact historical replay needs bounded compatible receipts; current reward receipts apply only to rewards. Metadata may offer a deliberately weaker already_matches contract instead of a new durable log, but cannot then claim original-request replay or conflicting UUID detection. Final promise/storage/retention is an implementation-review prerequisite, not an approved new framework or schema.

Lock order preserves sorted nodes → party lifecycle → encounters → required request keys → dependent rows → revalidation/effects. Existing reward request/reward advisory locks precede its creature row. G4A15.cover is not a drop-in wrapper around that RPC because it already takes dependent rows; nesting could invert row/request order. The design explicitly forbids that composition rather than silently changing source behavior. No SQL correction or global deadlock conclusion is authorized.

## Remaining blockers and next task

Implementation authorization must follow A–D disposition and the scoped replay promise, explicit field/formula mapping, raw protected-write containment and retained-reference coverage. Direct generic Admin and legacy healing writers remain source concerns. Fresh installed dependency/ACL/RLS/trigger parity, production caller isolation and permitted read-only route remain outstanding. G4A11/G3D gates are not bypassed by this documentation. Deployment, frontend publication and live verification each need separate authorization.

**Recommended next owner action:** approve/amend A–D and the replay promise. Then separately authorize bounded local contract-to-source design/implementation for these existing Admin inputs and required containment, preserving canonical HP and request lock order. Do not begin it automatically. No new broad audit, contract/reward redesign, or retained private queued-party restoration.

G4-R1/G4-R2/G4A9-R1/E13/G/parent remain OPEN; G4A11 BLOCKED; G3 correction deferred/G3D BLOCKED. Prior B–F/progression closures, four OPEN progression F limitations, privileged v3→v2/external/dynamic caller uncertainty, Combat1 risk and deferred F1 retry weakness remain unchanged. Administrative XP grants remain paused; normal gameplay XP earning is not intentionally disabled and its hosted runtime behavior is not established here.

## Validation and handoff

Documentation/state checks cover repository links/anchors, both diagrams' declared node IDs/edge endpoints/classes, fence balance and simple flowchart grammar, prior-record preservation, generated JSON/Markdown synchronization, project-state tests and whitespace. **Mermaid parser/CLI is unavailable locally; diagrams have not been renderer-validated.** Structural/manual review is reported honestly rather than as full Mermaid parser execution. No external renderer, hosted route or new dependency installation was used.

Executed results: **3 project-state tests PASS**; JSON/Markdown synchronized; **81 local links/3 anchors valid**; **2 diagrams structurally checked,34 declared nodes/48 edges**. Historical index/roadmap lines and earlier state records/statuses preserved exactly; source/history/proof preservation and staged whitespace checks pass. The unavailable Mermaid parser remains a documentation validation limit, not hosted or runtime evidence.

G4A15's25 native tests/8 independent-session cases are historical local evidence reused, not rerun or expanded here. No database, scheduler, world, gameplay, migration, grant, hosted, Lovable, deployment or frontend operation. No application build/typecheck is required for Markdown-only work. Nine scoped files: four architecture documents, this report, G audit index, engine roadmap and JSON/generated state. Production source, prior proofs/evidence, migration history, types and recovery stash preserved. Git push is source transport only.
