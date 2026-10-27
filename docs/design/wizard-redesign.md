# ENG-ABILITY-WIZARD-001 — Wizard design and implementation boundary

Design record: ENG-ABILITY-WIZARD-001B, owner instructions and final approval 2026-10-27. Source baseline: `b696ddb5bbc7a48e33f161e02bdf5d9d97bc3b28`. Mechanics and corrected damage coefficients below are approved as the first implementation baseline. Final owner decisions select existing damage-soft-scaling for direct Orbs damage and retain WIS-based Ignite duration of 30–45 seconds. Later tuning must be based on tests and gameplay. Design approval is not implementation or release authorization. No gameplay, catalogue, SQL or deployment change is included in this document.

The preceding 001A report was delivered in chat. Its relevant assumptions and the necessary paired recalculations are preserved in the [balance appendix](../operations/wizard-001B-balance.md). The [engine specification](game-engine.md) links this bounded approved design; [project state](../operations/project-state.json) owns delivery evidence. Broader attribute investigation remains deferred under [ENG-BALANCE-001](attribute-model-followup.md); Wizard implementation must retain today's modifiers and soft profiles.

## Five roles and ten abilities

Exactly one equipped choice per role; all 32 combinations are legal. Alternatives in the same role cannot coexist in a loadout. An equipped stance need not be active. Existing server-owned unlock/loadout checks remain authoritative; the browser cannot bypass role selection. Changing a choice that invalidates an active stance retains the existing drop-first refusal policy.

| Role / unlock | Choice A | Choice B |
|---|---|---|
| Signature L1 | Fireball | Frostbolt |
| Discipline L5 | Force Shield | Frost Armor |
| Doctrine L10 | Arcane Surge | Arcane Focus |
| Pressure L15 | Orbs of Fire | Winter's Grasp |
| Mastery L20 | Conflagrate | Arcane Overload |

Roles do not impose element dependencies: Fireball + Winter's Grasp and Frostbolt + Orbs + Conflagrate are valid. No new abilities beyond these ten and no other-class rebalance are authorized.

## CP contract

| Stance | Activation CP | Fixed reserved CP |
|---|---:|---:|
| Force Shield | 10 | 10 |
| Frost Armor | 10 | 10 |
| Arcane Surge | 15 | 15 |
| Arcane Focus | 15 | 15 |
| Orbs of Fire | 20 | 20 |

Successful activation charges once and establishes the fixed reservation atomically. Spendable CP is `max(0, raw CP - total reservations)`; reservation is capacity withheld, not a recurring charge. Drop frees the reservation without refunding activation CP. A depleted Force Shield keeps its reservation. MaxCP changes do not resize these Wizard reservations, charge CP or refund CP. If raw CP is below reservations, spendable CP is zero and dropping remains possible. Death, movement, reconnect, Arena and action-slot rules retain existing character-scoped stance authority.

| Active non-stance ability | Base CP | With Arcane Focus |
|---|---:|---:|
| Fireball / Frostbolt | 10 | 5 |
| Winter's Grasp | 20 | 15 |
| Conflagrate | 30 | 25 |
| Arcane Overload | 30 + automatic extra 0–30 | 25 + automatic extra 0–30 |

Focus changes only the base price: `max(5, base CP - 5)`. It never discounts stance activation, reservations or Overload's extra expenditure. Overload takes `extra = min(30, max(0, spendable CP - discounted base))` from the authoritative state at resolution. Insufficient base CP refuses; a resolved miss still spends base plus extra. No cooldown or manual Overload slider is introduced. Preflight is a readiness check, not authority to spend a stale browser-derived extra amount. Concurrent/replayed operations must not double-spend.

These fixed Wizard reservations intentionally supersede the existing percentage policy for Wizard only when implemented. Other classes retain their authored percentage reservations and current costs. All resource formulas and WIS/milestone regeneration remain unchanged.

## Damage notation and calibration

Use effective durable-equipment/gem attributes. `m(A)=floor((A-10)/2)`, `i=max(0,m(INT))`, `w=max(0,m(WIS))`. Retain existing soft profiles: `D(i)=i` through 20 then `20+0.45*(i-20)`; `B(i)=i` through 18 then `18+0.40*(i-18)`. Existing evaluator term rounding and final damage settlement remain binding.

| Ability | Calibration / approved function |
|---|---|
| Fireball | Existing `5 + round(2*D(i)) + floor(level/3)` direct INT damage; 35% Ignite proc per landed hit replaces separate Scorched |
| Frostbolt | Existing direct INT formula, identical to Fireball; one shared Chilled stack per landed hit |
| Force Shield | Preserve persistent SQL-owned pool and OOC regeneration, below |
| Frost Armor | Defensive contact stance; applies Weakened, below; no direct retaliation damage |
| Arcane Surge | Preserve authored `1.10 + min(0.12, 0.02*sqrt(i))` direct-attack multiplier |
| Arcane Focus | CP base-price reduction only; no extra damage coefficient |
| Orbs of Fire | Preserve `0.25 + min(0.25, 0.04*sqrt(i))` chance per combat heartbeat; successful proc deals direct fire damage and applies Ignite |
| Winter's Grasp | `8 + round(2*D(i)) + floor(level/3)`, multiplied by `1 + 0.12*shared Chilled stacks`; never consumes Chilled |
| Conflagrate | Existing `4 + round(2*B(i)) + floor(level/3)`, multiplied by `1 + 0.30*own Ignite stacks` |
| Arcane Overload | `12 + round(3*B(i)) + floor(level/3) + 1.5*extra CP`; extra component remains inside direct damage before normal hit/crit/Surge/target amplification settlement |

Existing Orbs direct damage is `max(1,2+m(INT))`. The approved redesign reuses the damage profile as `max(1,floor(2+soft(m(INT),'damage')))`. No new curve or global cap. Below modifier 20 the values match. At INT100, direct Orb damage becomes 33 instead of 47; at INT150, 44 instead of 72. Preserve the independent proc roll: no additional d20, grazing or crit roll for an Orb.

Arcane Surge description must say: **Increase damage from your direct attacks, including basic attacks and direct abilities. Does not increase Ignite, other DoT ticks, Orb procs or item procs.** This matches Combat2's `offense/damage_mult` consumer; the old `ARCANE_SURGE_DAMAGE_MULT=1.15` helper is not the Combat2 contract. A later Frost Armor application deals no damage to amplify.

Force Shield's retained persistent stance formulas are `pool=max(1,m(effective WIS)+floor(level/2))` on activation, and OOC cap `max(1,max(0,m(effective WIS))+floor(level/2))`. Its existing OOC regeneration is `1+floor(max(0,m(effective INT))/2)` per nominal two-second unit, settled as two such units per eligible four-second bucket, clamped to the pool. Preserve existing exclusions/catch-up/ward persistence; no combat regeneration or browser timer. The generated catalogue's old INT pool/timed duration must be reconciled with this persistent SQL authority, not used to redefine it. Sources: [stance SQL](../../supabase/migrations/20261001130000_combat2_character_persistent_stances.sql), [stance authority](combat2-ability-availability-and-persistent-stances.md).

## Status and contact rules

### Ignite

- One shared status identity for Fireball and Orbs, grouped by caster + creature instance/spawn + status, not by applying ability key. Different casters keep separate groups.
- Maximum five caster-owned stacks per creature; full damage per stack. Each tick deals `stacks * (2 + floor(0.25*w))`, every two seconds. No diminishing returns between stacks.
- New applications refresh the entire group's duration, including at five stacks. Do not duplicate stack groups for Fireball versus Orbs or grant an immediate extra DoT tick on refresh.
- Conflagrate reads only the resolving caster's group. Landed hits, including grazing, consume it; misses preserve it while spending CP. Zero stacks is a valid base-damage cast. Consumption and damage commit atomically; another caster's stacks are untouched.
- Fireball's proc roll occurs only after landed contact; Orbs' successful proc itself applies Ignite if the target remains alive. No cross-caster Ignite synergy.
- Approved duration: retain `min(45,30+w)` seconds from the existing source (30–45 seconds, WIS-scaled). This is an explicit owner decision; the 30-second empty-start recalculations do not establish long-fight balance by themselves.

### Chilled and Winter's Grasp

- Exactly one creature/spawn-scoped shared group, independent of caster or applying ability: up to five stacks, ten-second duration, entire group refreshed by a new application, including at cap.
- A landed Frostbolt adds one stack, including grazing. A miss adds none. The applying hit uses the pre-hit state; no retroactive amplification of that hit.
- Shared damage taken is `1+0.02*stacks`, for qualifying damage from all players, including DoT. Preserve the existing eligible categories `weapon`, `ability`, `stance`, `dot`, `proc`, source attribution and spawn fencing. No multiplication per caster and no retained standalone +10% Chilled effect on top.
- Grasp's separate direct ability bonus is `1+0.12*stacks`. At five stacks, Grasp gets 1.60 times its base before the shared 1.10 target amplification: 1.76 combined before the normal integer/quality pipeline. These are two different bonuses. Grasp neither consumes stacks nor requires any particular Signature choice; without Chilled it deals base damage.

### Weakened and Frost Armor

- Direct non-evaded landed creature hits apply Weakened to the attacking creature, including critical, grazing and supported opportunity attacks. Fully blocked/absorbed contact still qualifies; positive HP damage is not required. Misses, evasion, DoT and environmental damage do not trigger it.
- Weakened reduces the creature's subsequent outgoing damage by 10% for ten seconds. It does not stack; further applications refresh one creature/spawn-scoped effect. It is not a reflected damage proc or a per-caster additive reduction.
- The triggering hit is already resolved and is not reduced retroactively. Apply the reduction through the existing outgoing-damage ordering before grazing/critical/defender mitigation, preserving existing reduction composition. Sequential later hits see authoritative current effects; no replay may repeat the application or damage.
- Cover the existing ordinary/opportunity/direct ability/boss primary and secondary attack paths through the common creature-damage boundary. Non-direct sources cannot trigger Frost Armor; any creature-owned outgoing source lacking a Weakened consumer must be identified in the bounded implementation before claiming full outgoing-damage coverage. No environmental or player DoT damage is relabelled as creature direct contact.

## Hit rules, ownership and publication

Retain Combat2's player hit bands, natural-one miss, critical handling, INT accuracy and grazing maximum of three damage. Landed grazing can apply statuses and consume Conflagrate stacks. Orbs and DoT use their existing independent proc/pulse paths. Grasp and Overload use normal direct-spell hit rules and spend CP on resolved misses.

All outcomes use claimed authoritative effective attributes, entry/spawn identities and committed tick timing. Never combine cross-spawn stacks or preserve an expired status by browser state. Resolve all simultaneous actors deterministically against shared working state: two casters can add Chilled up to the same global five-stack limit, while Ignite and Conflagrate remain caster-owned. Accepted requests, damage, CP, effects and reservation/ward changes retain atomic commit, version/claim fencing and replay safety. No new timer or parallel status authority.

Reuse the existing publication chain: base mechanics -> ability identities/attributes -> Wizard assignments/roles/overrides -> applied statuses -> validated source/Edge catalogues. See [publication contract](ability-publication-and-semantics.md). Do not hand-edit generated JSON. New shared fields must be generic authored semantics with unchanged defaults for other classes; never silently change Eviscerate's consumption or other-class reservation policy. Preflight, immediate persistent stances, OOC settlement, claim projection, Combat2 consumers, tooltips and generated output must agree on fixed Wizard CP semantics. A published bundle alone cannot synchronize database authoring or installed SQL.

## Final approval and remaining evidence

**Approved mechanics:** role matrix/free combinations; status ownership/caps/refresh principles; Conflagrate consumption only on landed hit; Frost shared amplification; Surge scope; Focus/base-versus-extra CP; no Overload cooldown/manual setting; defensive trigger rules; all five stance activation/fixed reservation values.

**Approved first implementation baseline (owner2026-10-27):** tabled direct damage, Ignite magnitude/35% Fireball proc, existing Orbs chance, Grasp +12% and20 CP, Conflagrate +30% and30 CP, Overload +1.5/extra CP, existing INT soft profiles and Surge magnitude. The corrected 001B coefficients are accepted; later tuning must be based on tests and gameplay, not an assumed future attribute formula. Separate implementation, installation, deployment and publication gates remain in force.

**Closed decisions:** direct Orb damage uses the existing damage-soft profile; Ignite retains `min(45,30+w)` seconds. There are no remaining coefficient/duration choices blocking this first implementation baseline. No new caps/DR, coefficient changes to other classes or attribute-formula redesign are approved. Missing representative L40 creatures and verified real gear loadouts remain balance limitations, not a requirement to start Cloud work here. The 30-second dummy assumes logical two-second ticks; it does not prove live scheduler cadence or survival. Existing-loadout/stance transition details still require bounded implementation review before any data mutation.

## Bounded implementation plan — preparation only

1. **Freeze the release inputs.** Use the approved soft-Orbs, 30–45second Ignite and corrected 001B calibration baseline. Reconcile exact current main/configured authoring and retained Force Shield authority. Preserve old assignment provenance; define the transition for existing Wizard loadouts/active stances without inventing a forced reset or changing other classes. Owner approval is required for any destructive transition.
2. **Author Wizard semantics.** Add the four currently missing alternatives (Frost Armor, Arcane Focus, Winter's Grasp, Arcane Overload); preserve and bind existing Frostbolt alongside the existing defaults. Add role/unlock bindings and explicit status/cost semantics through the existing composition model. Keep exactly one choice per role. Specify landed-only consumption as an authored policy so Eviscerate defaults remain unchanged. Unify Fireball/Orbs Ignite grouping and shared Chilled/Weakened identities. Do not add a second catalogue or runtime fallback.
3. **Prepare the minimal server transaction changes.** Fixed Wizard reservations and Focus/Overload authoritative CP need matching preflight, persistent stance projection/activation/drop, resource/equipment/class/loadout synchronization and claim/commit consumers. Implement via the existing owners. Any required SQL is prepared outside automatic migrations, reviewed with explicit owners/ACLs/search_path/drift guards; the standard Lovable Drizzle tool later owns registration and outer transaction. No migration is prepared by 001B.
4. **Implement the bounded Combat2 consumers and presentation.** Reuse hit/pulse/amplification/outgoing-reduction paths; retain Force Shield's SQL-owned ward lifecycle. Publish deterministic source and Edge mirrors; update Wizard labels/descriptions/CP previews. Preserve other-class formulas, eligibility and historical status data through an explicitly reviewed transition.
5. **Validate locally.** Run the targeted acceptance cases below, catalogue generation/check and mirror checks. Use rollback-only SQL fixtures for changed database contracts, then relevant type/build checks. Broad Combat2 audits and unrelated fixes are excluded.
6. **Review and deliver under separate approvals.** Record exact reviewed commit and artifact hashes in the [handoff template](../operations/handoff-template.md). Commit/push, SQL installation/configuration synchronization, matching Edge deployment and frontend activation are separate gates. Verify SQL first, then every actual Edge consumer, then Mik's manual frontend Publish and bounded gameplay acceptance. No automatic migration registration, deployment or publication; no runtime completion claim from local tests.

### Targeted acceptance requirements

- All 32 legal role combinations; locked unlocks and duplicate same-role choices refuse server-side. Active invalidated stances must be dropped first. Cross-role elemental mixes work without hidden prerequisites.
- Fireball and Orbs hit the same owned Ignite group, including in one tick; six applications cap at five and refresh at cap without duplicate ticks. Two casters remain isolated across consumption, departure/re-entry, expiry, death and respawn/spawn changes.
- Conflagrate: natural-one/AC miss preserves stacks but spends CP; grazing/normal/critical landed hits consume only own live stacks once; no-stack cast works; retry/stale commit does not consume/spend twice. Verify other stack finishers retain their current policy.
- Chilled from simultaneous different casters shares one cap/refresh. All eligible players' direct/DoT/proc damage sees the proper current amplification. Grasp uses +12% per stack separately from shared +2%, consumes nothing, works at zero and remains correct after original caster departure.
- Focus price floor; stance costs unaffected; exact Overload extra at base-only, partial extra, full extra, reservations, changed resources, missed hits and replays. No negative spendable CP, client-chosen extra, cooldown or manual slider.
- Every stance activation/drop is charged once; fixed Wizard reservations survive relevant movement/reconnect/MaxCP changes and are released on drop/death as existing authority requires. Depleted ward keeps reservation; other-class percentage reservations do not change. OOC activation and in-combat action-slot behavior remain consistent.
- Force Shield WIS pool, INT OOC regen, no combat/browser regeneration, durable remaining pool, caps, equipment/gems and existing settlement exclusions. No catalogue-derived INT-only replacement.
- Frost Armor: ordinary/opportunity/instant/boss primary/secondary contact, crit/grazing/zero-HP-damage; miss/evasion/DoT/environment exclusions; ten-second refresh/no stacking; reduction only on subsequent outgoing hits, before grazing; retry/identity/expiry isolation.
- Surge boosts direct spells/basic attacks/finishers/Overload but not Ignite, other DoT, Orbs or item-procs; display matches all tested paths.
- Composition, fixed-versus-percent contracts, configured SQL/published worker parity, mirrored bytes and source hashes. Source test PASS, installed parity and live acceptance are recorded separately. No other-class numeric drift.

## Local documentation handoff

Reviewed baseline is the SHA above. Owner authorizes one bounded documentation commit and normal push to origin/main after ancestry and documentation checks; the resulting commit identity is reported separately to avoid a self-referential SHA. 001B intentionally documents approved future Wizard rule changes while preserving runtime and current shared attribute math. SQL/artifact installation hashes, installed parity, Edge deployment and frontend publication are N/A for this documentation task. Existing rollout evidence, controls, next approved task and unrelated backlog priorities are preserved. Stop after push; implementation requires a separate scoped instruction.

Local validation: `npm run project-state:generate` and `npm run project-state:check` passed; Markdown relative file targets resolve; `git diff --check` passed. The standalone appendix model reproduced51 reported comparison cells, deterministic repeats and Orb-only isolation checks. The changed-file inventory contains only documentation/state files. Gameplay tests, SQL installation and live checks are not claimed for this documentation-only task.
