# ENG-LEGACY-001G4A3 — Creature HP contract and configuration readiness

Date: 2026-10-15. Source checkpoint: `8571ba136a4e0d6acd9b71cb2b1f7405a67ddfc8`.

**Design/readiness only. No implementation, schema, SQL candidate, installed parity or runtime verification.** This records the owner's G4A3 direction and refines the [G4A2 options](legacy-001G4A2-coherent-creature-hp-design.md); its earlier pending decisions remain historical, not current rejection of the approved subset. [G4A ownership evidence](legacy-001G4A-regeneration-hp-ownership.md) and [G4 writer map](legacy-001G4-creature-authority-lifecycle.md) remain valid.

## Approved requirements versus proposals

Owner-approved: `creatures.hp` is durable shared-world authority; Combat2 projections must agree and stale claims cannot overwrite newer HP. Living wounds persist across players/encounters. Ordinary regeneration requires relevant combat effects and pending actions to resolve, then 60 seconds of uninterrupted OOC eligibility. Eligible elapsed sleep counts without continuous simulation. Existing wounds receive no pre-initialization credit. Dead creatures use ordinary respawn, never regeneration. Reassignment during active Combat2 attachment is rejected/deferred. Regeneration must be inspectable/configurable per creature in Admin.

**5% max HP per minute is only a provisional default**, not a finalized universal rate or authorization to backfill every creature. The configuration representation, exact blocker predicate, fractional accounting, edit policies and implementation stages below are recommendations requiring approval. No existing legacy regeneration formula has changed.

## Source comparison: creatures and players

| Concern | Source-established behavior | Consequence |
|---|---|---|
| Creature attributes | [creature formulas](../../src/shared/formulas/creatures.ts), `generateCreatureStats`: STR/DEX only; comment explicitly says previously generated CON/INT/WIS/CHA were removed because combat did not read them. HP = round((15 + level × 8) × rarity HP multiplier); regular/rare/boss multipliers 1/1.5/6. | No established creature CON/WIS regeneration semantics. Historical JSON can retain other keys; no hosted creature rows inspected. |
| Player maximum HP | [resource formulas](../../src/shared/formulas/resources.ts), `getMaxHp`/`getEffectiveMaxHp`: class base + twice CON modifier + (level−1)×5, effective gear CON and flat HP. | Distinct from creature level/rarity HP. Do not transplant player attributes. |
| Player HP regeneration | Same module `getStatRegen`: 2 + floor(sqrt(max(0, CON−10))); milestone HP additions 2/4/6/8/10 at levels20/25/30/35/40. [C2 SQL](../../drizzle/migrations/0013_progression_001g_c2_reset_and_cutover.sql), lines359–505, uses effective CON, usable equipped item `hp_regen`, milestones and +10 inn bonus. WIS drives CP, not HP. | Actual settlement uses four-second buckets, at most three jitter intervals; longer gaps award one current interval. Alive/active/location/combat/transition gates apply; sleep/maintenance time is not banked. This is source behavior, not newly verified runtime or a creature model. |
| Legacy creature healing | [G4A exact sources](legacy-001G4A-regeneration-hp-ownership.md): `regen_creature_hp` adds max(ceil(max_hp×10%),1) per eligible call with a five-minute damage guard and old combat/effect guards; `heal_creatures_on_wake` full-heals eligible living rows. | Neither provides the approved continuous 60-second contract nor synchronizes Combat2 HP. G4-R1 stays OPEN. |
| Existing configuration | [generated creatures type](../../src/integrations/supabase/types.ts), `creatures.Row`, has hp/max_hp/stats/last_damaged_at/died_at/spawn_seq/respawn_seconds, no dedicated regeneration rate or accounting cursor. [CreatureManager](../../src/components/admin/CreatureManager.tsx), `defaultForm`, selection, `handleSave`, Stats section. | Respawn seconds means dead respawn, not living regeneration. Do not repurpose stats JSON, timestamps or boss fields. Types/source are not fresh installed-schema evidence. |

### Configuration alternatives and recommendation

| Model | Compatibility/cost | Assessment |
|---|---|---|
| Per-creature percentage of max HP/minute | One explicit rate field; scales with existing level/rarity max HP; straightforward preview. Needs deterministic fractional credit and max-HP edit policy. | **Recommended**, independent of STR/DEX. |
| Fixed HP per interval | One rate plus a fixed global interval, or two fields if interval configurable; does not scale when max HP changes. | Viable but more manual balancing; no current compatible creature rate field to reuse. |
| Attribute-derived | Must establish a new creature attribute/formula and authoring semantics, especially for historical JSON. | Larger design change; no evidence supporting CON/WIS reuse. |

Proposed smallest rate schema: one integer basis-points-per-minute field on existing `creatures` (illustrative name `hp_regen_bps_per_minute`). 100 basis points = 1%; provisional5% =500. This precision is a proposal, not existing schema. Require server validation, finite nonnegative bounded input, and a separately selected maximum. Decide whether zero means deliberately disabled. Do not invent an upper bound or silently set existing creatures to500. No new configuration table or creature template redesign.

Minimum accounting also needs explicit per-generation eligible-since and accounted-through timestamps; continuous fractional settlement likely needs a bounded fractional remainder. Existing `last_damaged_at` cannot represent interruptions or already-paid time; `node_creature.updated_at` is not a regeneration cursor. Three added accounting values plus one rate is the proposed continuous model, not approved DDL. An anchored whole-interval alternative could avoid a residual column, but quantizes healing; choose before minimizing schema.

### CreatureManager presentation and save boundary

Add a small **Out-of-combat HP regeneration** section near generated stats/respawn: editable `% of max HP / minute`, calculated `HP / minute`, fixed60-second eligibility explanation and provisional/default label where applicable. Example only:5% and23 maxHP shows1.15HP/min, not rounded to1 as the configured rate. New creatures preview generated maxHP; existing creatures preview saved maxHP, with draft level/rarity changes visibly identified. Display configured potential rate, not an unverified live “regenerating” status. Existing selection/list should expose the saved rate; retain dead respawn as a separate control.

Current `CreatureManager.tsx` lines260–297 regenerates stats and sends **hp and max_hp both as generated.hp on every save**; lines596–654 contain level/respawn/stats controls. A regeneration-only edit must not reuse that HP-reset payload. A narrow server-authoritative configuration edit must preserve current wounds and serialize parameter changes with settlement. Existing node reassignment and generic full-HP save finding G4-R2 remains unresolved; do not present this UI proposal as a fix. Admin permission enforcement must be retained, not replaced by UI validation. No UI code is changed here.

## Proposed technical contract for the next local proof

| Boundary | Proposed rule / open choice |
|---|---|
| Combat blockers | Treat engaged active combat, relevant unresolved damage/healing effects, queued hostile actions/casts and applicable unresolved transition work as blockers for the current creature/generation. A permanent unrelated character stance/cosmetic record is not automatically a blocker. Exact fields, target scope and terminal states must be enumerated from the [claim/resolver sources in G4A](legacy-001G4A-regeneration-hp-ownership.md), including `node_effect` and `node_creature.pending_action`. Unknown applicability fails closed. No-player presence alone does not release unresolved combat. |
| Eligibility transitions | Record the server-side release of the final blocker; start60seconds there. Any new blocker resets the full delay and usable fractional credit. Damage is a blocker transition, not an alternative five-minute timer. An active but genuinely quiet encounter is not by itself proof of combat; the exact quiet predicate needs approval/proof. |
| Delay and clock | No regeneration before eligible_since +60seconds; at that boundary zero post-delay credit. Settle using one server cutoff obtained under the relevant locks. Same cutoff retry pays zero extra; timestamps cannot run backward. A live claim defers maintenance without inventing a new eligibility interruption. |
| Sleep | Count only continuously proved eligible time after the delay. If effects/actions remain unresolved during sleep, keep eligibility closed; wall-clock expiry alone does not fabricate a release time. Canonical resolution on resume establishes release. No catch-up combat, rewards or respawn simulation. Full HP bounds useful healing; no extra time cap proposed. |
| Fractions | Recommended fixed-point accumulation: elapsed whole milliseconds × maxHP × basis-points/minute + saved remainder; divide by600,000,000, floor wholeHP and retain remainder. Advance only accounted time; use checked/wide arithmetic and avoid unbounded per-tick loops. Precision, residual representation and reset policy require approval. Chunked versus single settlement must agree. |
| Full health | Clamp at maxHP and discard excess/remainder, moving the cursor forward so no banked healing restores later damage. No regeneration changes death/alive state, spawn generation or rewards. |
| Initialization | At an explicit cutover time T0, give no earlier credit. Proven quiet wounded rows start eligibility no earlier thanT0 and still wait60seconds; unknown/blocked rows remain closed until proved released. Existing HP mismatch requires separate evidence/disposition, not choosing a higher/lower copy silently. |
| Respawn | Preserve existing due respawn and dead→alive generation increment; clear old accounting on new generation. Never settle old-generation credit or revive via regeneration. |
| MaxHP/rate edits | Proposed: settle proved old-parameter credit up to the edit cutoff, then apply new parameters without retroactivity. Increasing maxHP does not refill; lowering clamps HP to the new cap. Preserve fractional HP value or discard it only under an explicitly approved parameter-edit policy; do not reinterpret old residual using a different denominator. These edit mechanics need owner approval. |
| Projection coherence | Under one transaction, update durable HP and every relevant same-generation projection, including retained ended projections. Never rely on `ON CONFLICT DO NOTHING` seed to refresh stale HP. Ended-row reactivation/seed must use the synchronized durable value. Unknown mismatch fails without automatic repair. |
| Claim fencing | Serialize with entry/claim/commit. Defer live claims; actual maintenance HP/projection changes must fence stale/expired snapshots through existing encounter version/claim controls, without advancing combat tick or awarding rewards. Row locking alone cannot invalidate a claim returned by an earlier transaction. |
| Reassignment | Approved rejection/defer applies during active Combat2 attachment, even if no player is present. Proposed quiet/ended reassignment locks old/new nodes deterministically and revalidates attachment/generation; no late new-node locks. No implied relocation permission or new generation just for moving. |
| Failure/retry | HP, projection, accounting and required version changes commit or roll back together. Retry after deadlock/serialization failure restarts discovery and rereads current cutoff/state; never reapplies a stale absolute HP. Cursor/idempotent transitions prevent duplicate passive credit; no generalized receipt framework. |

## Lock/readiness boundary

Reuse [G4A2 lock protocol](legacy-001G4A2-coherent-creature-hp-design.md): discover nodes/attachments, acquire deterministic node advisory locks before sorted encounter rows, then dependent creature/projection rows. Revalidate generation, membership and discovered coverage before mutation; refuse/retry if coverage changed without acquiring late node locks. Serialize no-projection cases with seed/entry on the node. Multiple creatures sharing an encounter must fence its version coherently. Exact retained commit/respawn/Admin lock compatibility is still a proof obligation, not a completed deadlock assessment.

Do not place unbounded encounter/creature locking inside wake after publication/trigger DDL. Replace independent legacy regen/wake HP writes only in a separately approved coordinated cutover; keep ordinary respawn. Use existing authoritative heartbeat bounded maintenance and supported pre-entry settlement, not another cron or browser timer. A read-only roster remains read-only and may show last committed HP until settlement. This is a targeted future creature sleep-accounting exception, not a change to player OOC settlement, one-heartbeat architecture or G3 disposition.

## Minimal staged implementation/test plan — not authorized by this report

1. **Approve the remaining configuration/technical choices below.** Produce an executable pure transition/accounting model and exact blocker-to-source mapping locally; no production candidate yet. Test60second boundary/reset, relevant effects/pending work, sleep release, full/dead/init, fixed-point partition invariance and parameter edits.
2. **Separately authorize one narrow local authority candidate.** Add approved metadata/config on existing rows; synchronize durable/projection HP and fences at maintenance, seed/reactivation and eligibility transitions. Adapt legacy healing delegates coherently without deleting respawn. Keep resolver damage/reward/proposal shape. Include safe parameter edit/reassignment boundary before enabling Admin rate edits.
3. **Local disposable PostgreSQL proof.** Deterministic independent sessions: heal versus claim/commit/entry, ended projection reactivation, respawn generation, node reassignment and concurrent config edits; barriers/block evidence, no sleep-only tests. Assert rollback/cursor/version consistency, no stale overwrite, no duplicate credit and unchanged reward/generation/death behavior. Dependency doubles must be disclosed.
4. **Small UI integration after authority proof.** Rate load/edit/validation/preview; saved-versus-draft maxHP; description/rate edits preserve wounds; active attachment blocks reassignment; no client HP writes. Focused actual-control tests plus typecheck/build when code is separately authorized.
5. **Separate installed parity and rollout approval.** Fresh exact dependencies/settings/ACL/trigger composition and migration prerequisites, using a permitted read-only route only. Source/types are not installed proof. No direct database access is assumed; G3D stays BLOCKED and is not reopened. Candidate/source publication, installation, Edge and manual frontend publication are separate decisions.

## Owner decisions and recommendation

- Approve percentage-per-minute and proposed0.01percentage-point precision, allowed maximum and whether0 disables regeneration.
- Decide provisional5% as new-creature default and the explicit initial per-creature/backfill policy; do not assume all existing creatures share that rate.
- Approve the exact source-mapped blocker/release policy, including unresolved work across sleep and technically active but quiet encounters.
- Choose fixed-point continuous accumulation versus anchored intervals, parameter-edit remainder handling and no-refill/clamp maxHP policy.
- Separately authorize the staged local model/proof before implementation. Required rate choices remain open; no balance or runtime correction is declared complete.

**Recommendation: ready for owner configuration decisions and then bounded local model/test preparation; NOT implementation/install ready.** G4-R1, G2/E13 and G/ENG-LEGACY-001 remain OPEN. G3 correction remains deferred; G3D BLOCKED. Prior B–F/progression closures, four OPEN progression F limitations, privileged delegation/caller uncertainties and deferred F1 retry-UUID correction are unchanged. Administrative XP grants remain paused; normal gameplay XP earning is not intentionally disabled and is not runtime-verified by this task. No hosted/runtime tests were run.

## Local validation

- Project-state generation/check synchronized; three project-state tests passed.
- Existing formula parity/effective-resource tests:48 passed. These verify existing formulas, not the proposed creature regeneration model.
- Local Markdown link targets checked across changed documentation; whitespace clean. Source ancestry, previous state records/dispositions, recovery stash and unchanged G3B candidate SHA-256 verified. No implementation, SQL or migration files changed.
- No database/concurrency, hosted metadata or gameplay execution; the proposed test plan remains unexecuted.
