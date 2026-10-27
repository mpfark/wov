# ENG-ABILITY-WIZARD-001F — local Arcane and CP foundation

Source baseline: `43b9aabd785ccc8f0f34c319667ba565a5204088`, fetched origin/main and local HEAD match. Owner authorizes local implementation/tests only; no commit/push, database-authoring, SQL/migration, Cloud, Edge deployment or frontend Publish. The [approved Wizard specification](../design/wizard-redesign.md) remains the rules authority. Affected areas: Resources and attributes; Effects and stances; Combat resolution; claim/commit verification. No rule, coefficient, attribute modifier or scaling profile is redesigned.

## Local implementation

- `src/shared/combat2/cp.ts`: arithmetic helpers for effective non-stance base cost and fixed-versus-percentage reservation. They read authoritative supplied state; they do not store CP or create another resource authority.
- `catalog.ts` / `mechanics.ts`: opt-in `cp_reserve_fixed`, `extra_cp_max`, and `offense_mode: base_cp_discount` with `cp_discount_min`. Fixtures select Focus5/minimum5, Overload30 base/max30 extra, and the approved Wizard fixed costs/reservations. Existing published records select none of these policies.
- `resolver.ts`: calculate the effective base before affordability, then extra burn from current working spendable CP; pass the total cost to the existing handler/settlement. Miss spends the same computed cost. Previous actions affect the next action's budget; no browser-supplied burn, cooldown, manual slider or separate wallet.
- `src/shared/formulas/ability-calc.ts`: add only typed `extra_cp` context and its validation allowlist. No formula coefficients, modifiers or curves change. The authored Overload fixture contains `12 + round(3*B(i)) + floor(level/3) + 1.5*extra_cp`, settled through existing integer HP and hit/crit/grazing rules.
- `types.ts` / `decode.ts`: prepare an explicit future fixed reservation claim descriptor. Existing percentage claims decode unchanged. Mixed/malformed metadata refuses; a catalogue/claim fixed-mode mismatch aborts resolution through the existing worker's `resolver_failed` handling before commit.
- Surge reuses existing `offense/damage_mult` consumers. Tests verify its INT10–22% multiplier and direct spell/basic/Conflagrate scope; Ignite/Scorched, Orbs and item procs remain excluded.

Future fixed claim shape: `reserve_pct: 0` plus `reservation: { mode: 'fixed', amount: N }`. This is a **local wire contract**, not an instruction to insert zero into today's database: the historical `character_stance.reserve_pct > 0` constraint and percentage-only SQL do not support it. No guessed conversion such as `N/MaxCP`, legacy JSON fallback, browser writer or temporary persistent authority is introduced. The existing encounter stance path is exercised only by local fixtures; persistent activation remains SQL-owned and gated.

Force Shield still reads SQL-owned `state.ward_remaining` during persistent projection, including zero. Fixed reservation is retained when depleted and independent of MaxCP. Local tests verify that catalogue INT-derived preview cannot replace supplied ward state, new entry projection preserves the supplied state, and death proposes the existing stance cleanup. These are claim/proposal tests, not evidence of installed movement, reconnect, OOC regeneration or Arena transactions. The WIS pool and INT OOC regeneration SQL are untouched.

## Required SQL integration — blocked, not implemented

The exact installed wrapper chain and ACLs require separately authorized verification when the migration/history gate is resolved. The following source definitions identify the necessary scope; no SQL candidate, registration or installation is prepared here:

| Function / state | Required later parity |
|---|---|
| `character_stance`, `combat2_test_arena_stance_snapshot` | Explicit reservation mode/amount representation and reviewed transition of existing rows. Preserve ward, version, ownership and percentage rows; do not silently reinterpret or reset existing state |
| `combat2_stance_reserved_cp(uuid,integer)` | Sum fixed amounts or existing floored percentages according to authoritative mode |
| `combat2_character_stances(uuid)` | Return consistent raw/reserved/spendable CP and each stance's mode, amount, state and version |
| `combat2_change_stance(uuid,text,text,uuid)` | New stance keys, approved activation costs/fixed reservations, base affordability and idempotent activate/drop under existing locks. No Focus rebate on these costs |
| `combat_intent(uuid,uuid,text,text,text,uuid,uuid,uuid)` and spendable-CP predecessor wrappers | Apply the same Focus effective-base rule before affordability. Require only the effective Overload base; extra is automatic from working state at resolution. Inspect every retained preflight predecessor to prevent a later old30CP check rejecting a valid25CP cast |
| `combat2_hostile_action(uuid,text,text,uuid,uuid)` | Verify entry delegates to matching CP/loadout preflight without an independent stale full-price check |
| `node_tick_claim(uuid,integer)` | Freeze the explicit mode/amount plus existing stance version and ward, together with current resources and other existing fences |
| `node_tick_commit(uuid,uuid,integer,integer,bigint,uuid[],jsonb)` | Verify the captured stance/version/resource contract and settle the proposal once. Preserve existing stale-claim, stale-state and replay refusals; never recompute a second extra burn from a later pool |
| `combat2_restore_arena_stances(uuid)`, `combat2_test_stop(uuid,uuid)`, `combat2_test_reset(uuid,uuid,boolean)` | Snapshot/restore the new reservation representation and exact ward state atomically. Arena restore must not refund activation or recreate dead-character stances |
| `combat2_regenerate_force_shields(timestamptz,integer)`, `settle_out_of_combat_resources(timestamptz)` | Preserve WIS pool, INT OOC refill and existing exclusions/cadence; prove the new reservation representation does not replace or reset ward/resource ownership |
| `combat2_refuse_invalid_stance_class_change()`, `combat2_refuse_invalid_stance_equipment_change()`, loadout swap guards and relevant resource-sync callers | Preserve drop-first invalidation, pending-request/version fencing and affordability after cap/equipment changes; fixed amounts do not resize with MaxCP |

Sources: [persistent stance SQL](../../supabase/migrations/20261001130000_combat2_character_persistent_stances.sql), [CP preflight](../../supabase/migrations/20260924110000_combat2_intent_spendable_cp_preflight.sql), [hostile entry wrappers](../../supabase/migrations/20260928100000_combat2_authoritative_arrival_hostile_initiation.sql). These are source references, not fresh installed-state evidence. Migration history remains a separate blocked area. Any future SQL preparation/install requires its own scope and authorization through the existing standard Lovable/Drizzle lane; no workaround is authorized.

## Lifecycle and publication gates

Movement/completion/reconnect must retain the existing character-owned stance row, fixed amount and ward; a new fighter entry only rematerializes the claimed state. Death clears all stances/reservations/ward; respawn restores none. MaxCP changes do not resize a fixed reservation; insufficient raw CP clamps spendable to zero and does not auto-drop. Drop at zero spendable remains possible, frees reservation and never refunds activation. Arena needs the matching durable snapshot/restore contract. Local proposal tests do not prove those SQL transactions.

Before release, extend existing composition/publication/schema validation to carry the authored policies consistently through database configuration, source and Edge records. Generated catalogues remain unchanged at36 records in001F. Reconcile every SQL price/allowlist and legacy preflight consumer before publishing the new authoring; loading a new bundle alone cannot establish parity. Edge mirrors are deliberately unchanged and this is **not a deploy-ready bundle**.

Frontend later must consume authoritative reservation amounts rather than deriving percentages, display effective Focus base costs, distinguish Overload base/extra/total preview, retain spendable-CP and action-readiness fences, and never submit a client-selected extra burn. Stance and loadout views must agree on fixed reservations and approved role choices. No UI or runtime controls change here.

## Explicit open acceptance point

**OPEN — 001E Weakened coverage gap:** generic character-targeted creature-owned effect-pulses bypass the direct `applyCreatureDamage` boundary and its outgoing reduction. They do not trigger Frost Armor, and their outgoing damage is not yet reduced by Weakened. 001F does not fix or close this gap. Full outgoing-source acceptance remains blocked on a separately scoped resolution; direct contact coverage must not be described as full coverage.

## Local checks and handoff boundary

Targeted tests cover pricing/floor/stance exceptions, Overload0/partial30 extra, Focus combination, working CP ordering, miss/grazing/crit, fixed/percentage and mixed fixed totals, depleted/authoritative ward, claim mismatch rejection, death proposal, pure deterministic retry and absence of replayed consumed intents. Retained Fire/Frost and all-class formula parity suites must remain green. Application TypeScript, catalogue publication and project-state checks are required; exact final counts/results are recorded in the task report/project state. Pure proposal retry is not durable SQL replay/concurrency proof.

No commit/push is authorized by this task. Existing controls, other-class published numbers, accepted limitations and deferred ENG-BALANCE-001 priority/dependencies are preserved. Stop after the local implementation report; subsequent SQL/publication/frontend/hosted work needs separate authorization.
