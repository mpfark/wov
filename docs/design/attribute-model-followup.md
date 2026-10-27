# Attribute investigation — deferred ENG-BALANCE-001 follow-up

Recorded by ENG-ABILITY-WIZARD-001B, owner direction2026-10-27. This reuses **ENG-BALANCE-001 — Broader ability and balance audit**; no separate attribute task is created. Status remains **deferred**, priority **18**, dependencies **stabilized heartbeat/targeting/rewards**. No audit, new formula or implementation is started. [Canonical roadmap](../roadmap/game-engine-roadmap.md#eng-balance-001--broader-ability-and-balance-audit).

## Direction, not an approved formula

Investigate a common attribute model in which every attribute point can contribute instead of multiple points sharing `floor((attribute-10)/2)`, high values continue to have smoothly declining marginal value, all attributes retain distinct attractive uses beyond primary damage, and rules stay simple and explainable. Integer final damage may still round; this intention does not promise +1 visible damage per point or establish a replacement derivative, base, cap or curve.

Preserve the existing modifier, accuracy, resource and soft-scaling formulas until a separately authorized numerical investigation and owner-approved replacement. Wizard implementation must use its [current mathematical basis](wizard-redesign.md#damage-notation-and-calibration), not anticipate this future direction. ENG-BALANCE-001 is not a blocking prerequisite for the bounded Wizard implementation; it remains deferred.

## Existing work located and retained

| Existing record | Current disposition and relation |
|---|---|
| ENG-BALANCE-001 | Best existing umbrella; deferred/18; evidence-based formula/content review. Add this explicit attribute investigation without changing scheduling or dependencies |
| ENG-ABILITY-001 | implemented_source; configured publication and numeric semantic parity, remaining release gates. Not permission to redesign attributes |
| Ability Calculation Rework | [Historical completed checkpoints1–7](ability-calculation-rework.md); configurable formula/evaluator work, not an outstanding attribute-balance task. INV-A04 aliases ENG-ABILITY-001; do not reopen or duplicate |
| ENG-PROGRESSION-001 | [Roadmap](../roadmap/game-engine-roadmap.md#eng-progression-001--canonical-character-progression-authority): installed E/F authority, A–H COMPLETE WITH ACCEPTED LIMITATIONS; commands/activation evidence remains separately recorded. Owns progression/provenance, not a new scaling model |
| WOV-IDEA-033 | IN PROGRESS for remaining gem acceptance in [idea register](../roadmap/game-ideas.md); +1 attribute gem direction and existing item limits retained. Not a common attribute-model redesign |
| WOV-IDEA-024 | Deferred admin class-access/attribute/resource corrections in [idea register](../roadmap/game-ideas.md). Privileged correction/provenance scope; do not merge with gameplay balance |

The search covered engine roadmap, idea register, project-state JSON/Markdown and design notes. No narrower outstanding common-attribute task was found. Broad balance is the reusable existing owner; no new ID or priority is needed.

## Source map for the later bounded investigation

| Input / consequence | Existing source and question to measure later |
|---|---|
| Modifier | [stats.ts](../../src/shared/formulas/stats.ts): `floor((attribute-10)/2)`; compare adjacent point contributions without silently changing resource settlement |
| Soft scaling / DR | [effective.ts](../../src/shared/formulas/effective.ts): damage20/.45, burst18/.40, dot20/.50, utility12/.30, stacking10/.25; [stats.ts](../../src/shared/formulas/stats.ts) also owns sqrt-based diminishing helpers. Different existing curves are evidence, not a newly unified model |
| Accuracy and combat roles | [combat.ts](../../src/shared/formulas/combat.ts): proficiency, accuracy-stat sqrt bonus, INT Combat Insight, DEX crit/AC, WIS anti-crit, STR damage floor; preserve natural-roll and grazing rules in comparisons |
| Damage and abilities | [ability-calc.ts](../../src/shared/formulas/ability-calc.ts), [Combat2 mechanics](../../src/shared/combat2/mechanics.ts), [published catalogue](../../src/shared/combat/inventory/active-abilities.json): inspect direct/raw modifiers versus shaped modifiers and integer settlement, including proc/DoT paths |
| CP, HP, MP and regen | [resources.ts](../../src/shared/formulas/resources.ts), [progression resource reference](../../src/shared/progression/resource-reference.ts), canonical SQL settlement/stance consumers: INT/WIS CP capacity, WIS CP regen, CON HP, DEX MP and milestones; avoid counting one attribute twice or introducing browser authority |
| Creation and races | [creation manifest](progression-001G-C2-P2-A-creation-manifest.md), [races.ts](../../src/shared/formulas/races.ts): base8 and frozen race deltas; preserve stored provenance rather than reconstructing legacy characters |
| Level growth and investment | [engine progression rules](game-engine.md#progression-and-rewards), [progression reference](../../src/shared/progression/golden-vectors.ts): level points, captured class installments, mixed-class history, discretionary refunds, Renown/permanent grants; configured reference is not proof of a current hosted class row |
| Items and gems | [items.ts](../../src/shared/formulas/items.ts), [gems.ts](../../src/shared/formulas/gems.ts), [gem delivery evidence](../operations/idea-033-gem-application-handoff.md): budget/taper/per-stat limits, effective durable equipment and +1 gem steps. Distinguish feasible constructed builds from observed owned items |

## Later acceptance scope

When separately authorized, compare adjacent attribute points and equal-budget distributions across realistic levels, races and verified gear/gems; enumerate their effects on accuracy, crit/defense, direct/periodic damage, abilities, CP/HP/MP capacity and regeneration. Include extreme asymmetric combinations, expected hit damage rather than maxima, and current-versus-candidate behavior. Explain each retained attribute role and any quantization at final settlement. Consider data/provenance, SQL/Edge/client numeric parity and migration consequences before approving a formula. New caps, diminishing curves or global rescaling need numerical justification and explicit owner acceptance.

No broader audit or other-class change is authorized by recording this direction. Current Wizard design and its implementation scope remain independent; no automatic follow-up execution.
